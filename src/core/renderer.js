/**
 * 渲染器：画布尺寸/DPR、逻辑坐标系、全局屏幕特效，以及后处理管线。
 *
 * 后处理（这是「酷炫」的主要来源，也是性能敏感区）：
 *   begin() → 世界绘制 → postprocess()（泛光 + 暗角）→ screenFx()（速度线/过载染色）
 *   → HUD → drawFlash()（闪屏，永远最上层）
 *
 * 泛光做法：把主画布降采样到 1/3，用 filter 压暗部 + 提亮部 + 模糊，
 * 再以 lighter 混合叠回。滤不掉暗部时会整体发灰，所以 contrast 必须够。
 * 若不支持 ctx.filter 或实测掉帧，自动降级为无泛光，不牺牲可玩性。
 */
import { VIEW } from '../config.js';
import { clamp, damp, rand, TAU } from './util.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.scale = 1;
    this.dpr = 1;
    this.time = 0;

    this.shakeMag = 0;
    this.shakeTime = 0;
    this.flashes = [];      // { color, alpha, decay }
    this.hitStopTimer = 0;  // 剩余顿帧时长（秒）——属性名刻意与方法 hitStop() 区分

    // 镜头
    this.zoom = 1;
    this.zoomTarget = 1;

    // 泛光
    this.bloomEnabled = true;
    this.bloomIntensity = 0.5;
    this._bloom = document.createElement('canvas');
    this._bctx = this._bloom.getContext('2d');
    this._bctx.filter = 'blur(1px)';
    this._filterSupported = this._bctx.filter !== 'none';
    if (!this._filterSupported) this.bloomEnabled = false;

    // 性能自适应
    this._perf = { frames: 0, accum: 0, samples: 0 };
    this.avgFrameMs = 16.7;
    this.bloomAutoDisabled = false;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas.parentElement || canvas);
    }
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || VIEW.w;
    const cssH = rect.height || VIEW.h;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.scale = w / VIEW.w;
    this.ctx.imageSmoothingEnabled = true;

    // 泛光缓冲：约 1/3 分辨率，够糊且足够便宜
    const bw = Math.max(64, Math.round(w / 3));
    const bh = Math.max(64, Math.round(h / 3));
    if (this._bloom.width !== bw || this._bloom.height !== bh) {
      this._bloom.width = bw;
      this._bloom.height = bh;
    }
  }

  /** 触发震屏（取较大值，避免小震动覆盖大震动） */
  shake(magnitude, duration = 0.35) {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  /** 镜头缩放目标：1 为正常，<1 拉远，>1 推近 */
  setZoom(z) { this.zoomTarget = z; }

  /** 全屏闪色 */
  flash(color, alpha) {
    this.flashes.push({ color, alpha, decay: 6.5 });
    if (this.flashes.length > 6) this.flashes.shift();
  }

  /** 顿帧：让命中更有「咬合感」 */
  hitStop(seconds) {
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds);
  }

  /** 返回本帧实际用于逻辑推进的 dt（顿帧期间被缩放） */
  consumeDt(dt) {
    if (this.hitStopTimer <= 0) return dt;
    this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
    return dt * 0.18;
  }

  /** 性能采样：连续掉帧时自动关闭泛光（宁可少一层光，也不要卡） */
  trackFrame(ms) {
    const p = this._perf;
    p.frames++;
    p.accum += ms;
    if (p.frames < 90) return;
    const avg = p.accum / p.frames;
    this.avgFrameMs = avg;
    p.frames = 0;
    p.accum = 0;
    if (avg > 28 && this.bloomEnabled && !this.bloomAutoDisabled) {
      this.bloomEnabled = false;
      this.bloomAutoDisabled = true;
      console.info(`[renderer] 平均帧时 ${avg.toFixed(1)}ms，已自动关闭泛光以保证流畅`);
    }
  }

  update(dt) {
    this.time += dt;
    this.zoom = damp(this.zoom, this.zoomTarget, 7, dt);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      this.shakeMag *= Math.exp(-6.5 * dt);
      if (this.shakeTime === 0) this.shakeMag = 0;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.alpha -= f.decay * dt * (0.4 + f.alpha);
      if (f.alpha <= 0.005) this.flashes.splice(i, 1);
    }
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#01030a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 以逻辑中心为锚点应用缩放，再叠加震屏
    const s = this.scale * this.zoom;
    const ox = this.scale * (VIEW.w / 2) * (1 - this.zoom);
    const oy = this.scale * (VIEW.h / 2) * (1 - this.zoom);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    if (this.shakeMag > 0.05) {
      const m = this.shakeMag;
      ctx.translate(rand(-m, m), rand(-m, m) * 0.7);
    }
  }

  /**
   * 泛光 + 暗角。必须在世界绘制完成后、HUD 之前调用。
   */
  postprocess() {
    const ctx = this.ctx;

    // 暗角：把注意力压向画面中心（放在泛光前，避免被光晕冲淡）
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const g = ctx.createRadialGradient(
      VIEW.w / 2, VIEW.h * 0.46, VIEW.h * 0.26,
      VIEW.w / 2, VIEW.h * 0.5, VIEW.h * 0.86,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.58)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    if (!this.bloomEnabled) return;

    const b = this._bctx;
    const bw = this._bloom.width;
    const bh = this._bloom.height;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw, bh);
    // brightness 抬亮部、contrast 压暗部、blur 扩散——三者缺一就会发灰
    b.filter = 'brightness(1.55) contrast(1.85) saturate(1.18) blur(2.2px)';
    b.drawImage(this.canvas, 0, 0, bw, bh);
    b.filter = 'none';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.bloomIntensity;
    ctx.drawImage(this._bloom, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  /**
   * 屏幕级特效：过载时的速度线与蓝色染色。intensity 0..1。
   */
  screenFx(intensity = 0) {
    if (intensity <= 0.01) return;
    const ctx = this.ctx;
    const cx = VIEW.w / 2;
    const cy = VIEW.h * 0.55;
    const t = this.time;

    ctx.save();
    // 蓝色外扩光
    const g = ctx.createRadialGradient(cx, cy, VIEW.h * 0.18, cx, cy, VIEW.h * 0.78);
    g.addColorStop(0, 'rgba(40,120,255,0)');
    g.addColorStop(0.65, `rgba(40,140,255,${0.10 * intensity})`);
    g.addColorStop(1, `rgba(90,180,255,${0.30 * intensity})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    // 放射速度线
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const lines = 22;
    for (let i = 0; i < lines; i++) {
      const a = (i / lines) * TAU + t * 0.9;
      const flick = 0.55 + Math.sin(i * 2.7 + t * 11) * 0.45;
      const r1 = 190 + Math.sin(i * 4.3 + t * 6) * 34;
      const r2 = r1 + 150 + flick * 130;
      const ax = cx + Math.cos(a) * r1;
      const ay = cy + Math.sin(a) * r1 * 1.3;
      const bx = cx + Math.cos(a) * r2;
      const by = cy + Math.sin(a) * r2 * 1.3;
      ctx.strokeStyle = `rgba(160,235,255,${0.16 * intensity * flick})`;
      ctx.lineWidth = 1 + flick * 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 闪屏：永远画在最上层（HUD 之后），表达「被击中/大爆炸」的瞬时冲击 */
  drawFlash() {
    if (!this.flashes.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      ctx.globalAlpha = clamp(f.alpha, 0, 0.85);
      ctx.fillStyle = f.color;
      ctx.fillRect(-60, -60, VIEW.w + 120, VIEW.h + 120);
    }
    ctx.restore();
  }

  /** 兼容旧入口：仅闪屏部分 */
  drawOverlay() { this.drawFlash(); }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
  }
}
