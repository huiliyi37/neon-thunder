/**
 * 渲染器：负责画布尺寸/DPR、逻辑坐标系、以及全局屏幕特效（震屏、闪色、顿帧）。
 * 逻辑坐标恒为 VIEW.w × VIEW.h；任何绘制代码都不需要关心真实像素。
 */
import { VIEW } from '../config.js';
import { clamp, rand } from './util.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.scale = 1;
    this.dpr = 1;

    this.shakeMag = 0;
    this.shakeTime = 0;
    this.flashes = [];      // { color, alpha, decay }
    this.hitStopTimer = 0;  // 剩余顿帧时长（秒）——属性名刻意与方法 hitStop() 区分

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
  }

  /** 触发震屏（取较大值，避免小震动覆盖大震动） */
  shake(magnitude, duration = 0.35) {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

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

  update(dt) {
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
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.shakeMag > 0.05) {
      const m = this.shakeMag;
      ctx.translate(rand(-m, m), rand(-m, m) * 0.7);
    }
  }

  /** 闪色 / 暗角等屏幕级覆盖，绘制在逻辑坐标空间的最上层 */
  drawOverlay() {
    const ctx = this.ctx;
    for (const f of this.flashes) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(f.alpha, 0, 0.85);
      ctx.fillStyle = f.color;
      ctx.fillRect(-40, -40, VIEW.w + 80, VIEW.h + 80);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 暗角：把注意力压向画面中心
    const g = ctx.createRadialGradient(
      VIEW.w / 2, VIEW.h * 0.46, VIEW.h * 0.28,
      VIEW.w / 2, VIEW.h * 0.5, VIEW.h * 0.82,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
  }
}
