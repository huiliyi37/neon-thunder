/**
 * 特效层：粒子、冲击波、浮动文字、道具掉落。
 * 粒子分三类——spark（发光碎屑）、debris（实体碎片）、smoke（烟尘）。
 * 全部走缓存精灵，高密度下不产生逐帧渐变对象。
 */
import { PICKUP, VIEW } from '../config.js';
import { C, PICKUP_STYLE } from '../art/palette.js';
import { drawOrbAt, drawPickup, drawShockwave, glow } from '../art/sprites.js';
import { rand, randInt, TAU, swapRemove, velocityToward, weightedPick, withAlpha } from '../core/util.js';

const MAX_PARTICLES = 900;

export class Effects {
  constructor(game) {
    this.game = game;
    this.particles = [];
    this.shockwaves = [];
    this.texts = [];
    this.pickups = [];
  }

  reset() {
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.texts.length = 0;
    this.pickups.length = 0;
  }

  _push(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  // ── 粒子发射器 ──────────────────────────────────────────

  spark(x, y, color, count = 1, opts = {}) {
    const { speed = [60, 260], life = [0.18, 0.5], size = [1.6, 3.6], dir = null, spread = TAU } = opts;
    for (let i = 0; i < count; i++) {
      const a = dir === null ? rand(0, TAU) : dir + rand(-spread / 2, spread / 2);
      const sp = rand(speed[0], speed[1]);
      this._push({
        kind: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(life[0], life[1]), max: 0, size: rand(size[0], size[1]),
        color, drag: 2.6, rot: 0, spin: 0,
      });
      const p = this.particles[this.particles.length - 1];
      p.max = p.life;
    }
  }

  debris(x, y, color, count = 4, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 180) * power;
      const p = {
        kind: 'debris', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.5, 1.1), max: 0,
        size: rand(1.6, 4.2) * power,
        color, drag: 0.6,
        rot: rand(0, TAU), spin: rand(-9, 9),
      };
      p.max = p.life;
      this._push(p);
    }
  }

  smoke(x, y, count = 3, scale = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(10, 55);
      const p = {
        kind: 'smoke', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10,
        life: rand(0.4, 0.95), max: 0,
        size: rand(7, 17) * scale,
        color: '#2a1a2e', drag: 1.4, rot: 0, spin: 0,
      };
      p.max = p.life;
      this._push(p);
    }
  }

  ring(x, y, radius, color = '#ffffff', opts = {}) {
    this.shockwaves.push({
      x, y,
      radius: radius * 0.25,
      target: radius,
      life: opts.life ?? 0.4,
      max: opts.life ?? 0.4,
      color,
      width: opts.width ?? 3,
      growth: opts.growth ?? 3.2,
    });
    if (this.shockwaves.length > 24) this.shockwaves.shift();
  }

  /** 标准爆炸：碎屑 + 火花 + 烟尘 + 冲击波 */
  explosion(x, y, scale = 1, color = C.hostileWarm, accent = '#ffffff') {
    this.spark(x, y, accent, Math.round(6 * scale), { speed: [120, 340 * scale], size: [1.4, 3.2] });
    this.spark(x, y, color, Math.round(10 * scale), { speed: [50, 260 * scale], size: [2, 4.4] });
    this.debris(x, y, color, Math.round(4 * scale), Math.min(2, scale));
    this.smoke(x, y, Math.round(3 * scale), scale);
    this.ring(x, y, 26 * scale, color, { life: 0.34 + scale * 0.12, width: 2 + scale });
  }

  text(x, y, content, color = '#ffffff', size = 13) {
    this.texts.push({ x, y, content, color, size, life: 0.9, max: 0.9, vy: -46 });
    if (this.texts.length > 40) this.texts.shift();
  }

  // ── 道具 ────────────────────────────────────────────────

  spawnPickup(x, y, kind = null) {
    const k = kind || weightedPick(PICKUP.weights);
    this.pickups.push({
      x, y, kind: k,
      vx: rand(-18, 18), vy: -30,
      age: 0, life: PICKUP.lifetime, magnet: false, spin: rand(0, TAU),
    });
  }

  /** 返回被拾取的道具种类数组，供调用方播放音效/加分 */
  updatePickups(dt, player) {
    const collected = [];
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += dt;
      p.life -= dt;
      p.spin += dt * 2;

      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const dist = Math.hypot(dx, dy);

      if (player.alive && dist < PICKUP.magnetRadius) p.magnet = true;

      if (p.magnet && player.alive) {
        const v = velocityToward(p.x, p.y, player.x, player.y, PICKUP.magnetSpeed);
        p.vx = v.x;
        p.vy = v.y;
      } else {
        p.vy = Math.min(p.vy + 70 * dt, PICKUP.speed);
        p.vx *= 1 - 1.6 * dt;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < 14 || p.x > VIEW.w - 14) p.vx *= -0.7;

      if (player.alive && dist < PICKUP.radius + 14) {
        collected.push(p.kind);
        swapRemove(this.pickups, i);
        continue;
      }
      if (p.life <= 0 || p.y > VIEW.h + 30) {
        swapRemove(this.pickups, i);
      }
    }
    return collected;
  }

  // ── 更新 / 绘制 ─────────────────────────────────────────

  update(dt) {
    const particles = this.particles;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { swapRemove(particles, i); continue; }
      const drag = 1 - Math.min(0.95, p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life <= 0) { swapRemove(this.shockwaves, i); continue; }
      const k = 1 - s.life / s.max;
      s.radius = s.radius + (s.target - s.radius) * Math.min(1, s.growth * dt + k * 0.08);
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) { swapRemove(this.texts, i); continue; }
      t.y += t.vy * dt;
      t.vy *= 1 - 1.8 * dt;
    }
  }

  drawParticles(ctx) {
    // 烟尘（正常混合）
    ctx.save();
    for (const p of this.particles) {
      if (p.kind !== 'smoke') continue;
      const k = p.life / p.max;
      ctx.globalAlpha = 0.16 * k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 火花（叠加）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (p.kind !== 'spark') continue;
      const k = p.life / p.max;
      const r = p.size * (0.4 + k * 0.9);
      drawOrbAt(ctx, p.x, p.y, r, p.color, k * 0.95);
    }
    ctx.restore();

    // 碎片（正常混合，带旋转）
    ctx.save();
    for (const p of this.particles) {
      if (p.kind !== 'debris') continue;
      const k = p.life / p.max;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      ctx.restore();
    }
    ctx.restore();
  }

  drawShockwaves(ctx) {
    for (const s of this.shockwaves) {
      const k = s.life / s.max;
      drawShockwave(ctx, s.x, s.y, s.radius, k * 0.9, s.color);
    }
  }

  drawPickups(ctx) {
    for (const p of this.pickups) {
      if (p.life < 3 && Math.sin(p.life * 22) < -0.2) continue; // 即将消失时闪烁
      ctx.save();
      ctx.translate(p.x, p.y);
      drawPickup(ctx, p.kind, this.game.time + p.spin);
      ctx.restore();
    }
  }

  drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.font = `600 ${t.size}px "SF Mono", Menlo, monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(t.content, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.content, t.x, t.y);
    }
    ctx.restore();
  }

  /** 道具的额外光晕（画在精灵之下） */
  drawPickupGlow(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pickups) {
      const style = PICKUP_STYLE[p.kind] || PICKUP_STYLE.power;
      glow(ctx, p.x, p.y, 26, style.glow, 0.3 + Math.sin(this.game.time * 6) * 0.1);
    }
    ctx.restore();
  }
}
