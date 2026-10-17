/**
 * 玩家自机。
 * 手感要点（这些是弹幕射击的生死线，改动前请先想清楚）：
 *  - 移动是「瞬时」的，没有惯性——精确操控优先于物理真实。
 *  - 判定半径 3.6px 远小于机体视觉（约 36×44），玩家永远觉得「擦弹」是运气好而不是被冤枉。
 *  - 受击后有 2.4s 无敌 + 明显闪烁，避免连锁死亡。
 *  - 开火完全自动，玩家只需要专注走位。
 */
import { PLAYER, SHOT, WEAPONS, VIEW } from '../config.js';
import { drawOption, drawPlayer, glow } from '../art/sprites.js';
import { C } from '../art/palette.js';
import { clamp, damp, TAU } from '../core/util.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.trail = [];
    this.reset(true);
  }

  reset(full = false) {
    this.x = PLAYER.spawnX;
    this.y = PLAYER.spawnY;
    this.tilt = 0;
    this.state = 'alive';
    this.invuln = PLAYER.invulnOnStart;
    this.focus = false;
    this.fireTimer = 0;
    this.optionTimer = 0;
    this.laserTick = 0;
    this.flash = 0;
    this.thrust = 1;
    this.respawnTimer = 0;
    this.trail.length = 0;
    this.shieldTimer = 0;
    if (full) {
      this.lives = PLAYER.lives;
      this.bombs = PLAYER.bombs;
      this.power = 1;
    }
  }

  get alive() { return this.state === 'alive'; }
  get weapon() { return WEAPONS[clamp(this.power, 1, WEAPONS.length) - 1]; }
  get options() { return this.weapon.options; }

  update(dt, input) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.flash = Math.max(0, this.flash - dt * 5);

    if (this.state === 'dying') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.state = 'alive';
        this.x = PLAYER.spawnX;
        this.y = PLAYER.spawnY;
        this.invuln = Math.max(this.invuln, PLAYER.invulnOnHit);
        this.trail.length = 0;
      }
      return;
    }

    // ── 移动：键盘轴 + 指针拖动，二者叠加但各自独立
    const axes = input.axes;
    this.focus = input.focus;

    let dx = axes.x;
    let dy = axes.y;
    const pd = input.takePointerDelta();
    // 指针位移直接换算成逻辑像素位移（1:1 跟手）
    this.x += pd.x;
    this.y += pd.y;

    const speed = this.focus ? PLAYER.focusSpeed : PLAYER.speed;
    this.x += dx * speed * dt;
    this.y += dy * speed * dt;

    this.x = clamp(this.x, 22, VIEW.w - 22);
    this.y = clamp(this.y, 84, VIEW.h - 26);

    // 视觉倾斜跟随横向输入
    const targetTilt = clamp(dx + clamp(pd.x * 0.25, -1, 1), -1, 1);
    this.tilt = damp(this.tilt, targetTilt, 10, dt);
    this.thrust = damp(this.thrust, this.focus ? 0.55 : 1, 9, dt);

    // 尾迹
    this.trail.push({ x: this.x, y: this.y + 14, life: 0.28, max: 0.28 });
    if (this.trail.length > 14) this.trail.shift();
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }

    this._fire(dt);
  }

  _fire(dt) {
    const w = this.weapon;

    // 主武器
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer += w.interval;
      if (this.fireTimer < -w.interval) this.fireTimer = w.interval; // 防止长时间暂停后爆发式补射

      const n = w.count;
      const half = (n - 1) / 2;
      for (let i = 0; i < n; i++) {
        const idx = i - half;
        const spreadX = idx * w.spread;
        const angle = -Math.PI / 2 + (half === 0 ? 0 : (idx / half) * w.angle);
        this.game.bullets.spawnPlayer(
          this.x + spreadX, this.y - 20, angle, SHOT.speed, w.damage,
          { size: this.power >= 5 ? 1.15 : 1 },
        );
      }
      this.game.audio.shoot(this.power);
    }

    // 僚机
    if (this.options > 0) {
      this.optionTimer -= dt;
      if (this.optionTimer <= 0) {
        this.optionTimer += SHOT.optionInterval;
        for (let i = 0; i < this.options; i++) {
          const ox = this._optionX(i);
          this.game.bullets.spawnPlayer(ox, this.y + SHOT.optionOffset.y - 8, -Math.PI / 2, SHOT.optionSpeed, SHOT.optionDamage, { size: 0.7 });
        }
        this.game.audio.optionShot();
      }
    }

    // 激光（Lv6）
    if (w.laser) {
      this.game.audio.setLaser(true);
      this.laserTick -= dt;
      if (this.laserTick <= 0) {
        this.laserTick = SHOT.laserTickInterval;
        const dmg = SHOT.laserDps * SHOT.laserTickInterval;
        this.game.applyLaserDamage(this.x, this.y - 24, SHOT.laserWidth, dmg);
      }
    } else {
      this.game.audio.setLaser(false);
    }
  }

  _optionX(i) {
    const side = i % 2 === 0 ? -1 : 1;
    return this.x + side * SHOT.optionOffset.x + this.tilt * 5;
  }

  /** 是否处于无敌（含护盾） */
  get invulnerable() { return this.invuln > 0 || this.state === 'dying'; }

  /** 由 Game 调用：玩家被击中。返回 true 表示生命耗尽（游戏结束） */
  hit() {
    if (this.invulnerable) return false;
    this.lives -= 1;
    this.power = Math.max(1, this.power - 1);
    this.flash = 1;
    this.game.audio.setLaser(false);

    if (this.lives <= 0) {
      this.state = 'dying';
      this.respawnTimer = 999;   // 不再复活，由 Game 收尾
      this.game.onPlayerDestroyed(this.x, this.y);
      return true;
    }

    this.state = 'dying';
    this.respawnTimer = PLAYER.respawnDelay;
    this.game.onPlayerHit(this.x, this.y);
    return false;
  }

  addPower(n = 1) {
    const before = this.power;
    this.power = clamp(this.power + n, 1, PLAYER.maxPower);
    return this.power !== before;
  }

  addBomb(n = 1) {
    const before = this.bombs;
    this.bombs = clamp(this.bombs + n, 0, PLAYER.maxBombs);
    return this.bombs !== before;
  }

  addLife() {
    this.lives = Math.min(5, this.lives + 1);
  }

  grantShield(seconds = 4) {
    this.invuln = Math.max(this.invuln, seconds);
    this.shieldTimer = seconds;
  }

  // ── 绘制 ─────────────────────────────────────────────────

  drawTrail(ctx) {
    if (this.state !== 'alive') return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.trail) {
      const k = p.life / p.max;
      glow(ctx, p.x, p.y, 12 * k + 4, C.playerGlow, 0.16 * k);
    }
    ctx.restore();
  }

  drawLaser(ctx) {
    if (!this.weapon.laser || this.state !== 'alive') return;
    const t = this.game.time;
    const width = SHOT.laserWidth * (0.85 + Math.sin(t * 40) * 0.08);
    const top = 0;
    const bottom = this.y - 22;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const g = ctx.createLinearGradient(this.x - width, 0, this.x + width, 0);
    g.addColorStop(0, 'rgba(95,247,255,0)');
    g.addColorStop(0.35, 'rgba(95,247,255,0.28)');
    g.addColorStop(0.5, 'rgba(235,255,255,0.95)');
    g.addColorStop(0.65, 'rgba(95,247,255,0.28)');
    g.addColorStop(1, 'rgba(95,247,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.x - width, top, width * 2, bottom - top);

    // 流动的能量节点
    for (let i = 0; i < 5; i++) {
      const y = ((t * 900 + i * 160) % (bottom - top + 60)) - 30;
      glow(ctx, this.x, y, 12, C.playerGlow, 0.45);
    }
    ctx.restore();
  }

  draw(ctx) {
    if (this.state !== 'alive') return;

    // 无敌闪烁：保持清晰可辨，不做成完全消失
    const blink = this.invuln > 0 ? (Math.sin(this.game.time * 34) > 0 ? 1 : 0.32) : 1;

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(this.x, this.y);

    // 护盾光环
    if (this.shieldTimer > 0 || (this.invuln > 0 && this.state === 'alive')) {
      const r = 30 + Math.sin(this.game.time * 6) * 2.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.shieldTimer > 0 ? 'rgba(95,247,255,0.75)' : 'rgba(140,220,255,0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + this.game.time * 0.9;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      glow(ctx, 0, 0, r * 1.5, C.playerGlow, 0.18);
      ctx.restore();
    }

    drawPlayer(ctx, {
      t: this.game.time,
      power: this.power,
      tilt: this.tilt,
      focus: this.focus,
      flash: this.flash,
      thrust: this.thrust,
    });

    // 僚机
    if (this.options > 0) {
      for (let i = 0; i < this.options; i++) {
        ctx.save();
        const ox = this._optionX(i) - this.x;
        const oy = SHOT.optionOffset.y + Math.sin(this.game.time * 3 + i * Math.PI) * 3;
        ctx.translate(ox, oy);
        drawOption(ctx, this.game.time, i * Math.PI);
        ctx.restore();
      }
    }

    // 精准模式判定点
    if (this.focus) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, 11, C.hostileShot, 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER.radius, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,110,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER.radius + 2.6, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}
