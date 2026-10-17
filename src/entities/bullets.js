/**
 * 弹丸系统：玩家弹药与敌方弹幕共用一套池化数组。
 * 设计要点：
 *  - 玩家弹走「竖向发光胶囊」缓存精灵，敌方弹走「球体」缓存精灵——零逐帧渐变分配。
 *  - 敌弹必须有极高可读性：白色核心 + 饱和彩环 + 外发光，任何背景上都看得清。
 *  - 越界即回收，数组交换删除，永不 splice 中间元素。
 */
import { VIEW } from '../config.js';
import { C } from '../art/palette.js';
import { drawOrbAt } from '../art/sprites.js';
import { swapRemove, TAU, withAlpha } from '../core/util.js';

const shotPool = [];
const enemyPool = [];

function newShot() {
  return { x: 0, y: 0, vx: 0, vy: 0, radius: 3, damage: 1, size: 1, kind: 'pulse', life: 4, age: 0, spin: 0 };
}

function resetShot(s) {
  s.life = 0;
}

let pulseSprite = null;
function getPulseSprite() {
  if (pulseSprite) return pulseSprite;
  const w = 20, h = 38, k = 3;          // 3× 超采样，逻辑尺寸 20×38
  const cv = document.createElement('canvas');
  cv.width = w * k;
  cv.height = h * k;
  const g = cv.getContext('2d');
  g.scale(k, k);

  const vg = g.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(120,240,255,0)');
  vg.addColorStop(0.18, 'rgba(140,250,255,0.55)');
  vg.addColorStop(0.55, 'rgba(235,255,255,1)');
  vg.addColorStop(0.86, 'rgba(120,240,255,0.55)');
  vg.addColorStop(1, 'rgba(80,220,255,0)');

  g.fillStyle = vg;
  g.beginPath();
  g.roundRect ? g.roundRect(w / 2 - 2.6, 0, 5.2, h, 3) : g.rect(w / 2 - 2.6, 0, 5.2, h);
  g.fill();

  // 核心亮线
  const core = g.createLinearGradient(0, 0, 0, h);
  core.addColorStop(0, 'rgba(255,255,255,0)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(w / 2 - 0.9, h * 0.1, 1.8, h * 0.8);

  // 两侧光晕
  const hg = g.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0, 'rgba(95,247,255,0)');
  hg.addColorStop(0.5, 'rgba(95,247,255,0.30)');
  hg.addColorStop(1, 'rgba(95,247,255,0)');
  g.fillStyle = hg;
  g.fillRect(0, h * 0.12, w, h * 0.76);

  pulseSprite = { cv, w, h };
  return pulseSprite;
}

export class Bullets {
  constructor() {
    this.player = [];
    this.enemy = [];
  }

  reset() {
    while (this.player.length) shotPool.push(this.player.pop());
    while (this.enemy.length) enemyPool.push(this.enemy.pop());
  }

  // ── 生成 ────────────────────────────────────────────────

  /** 按角度（弧度，-PI/2 为正上）发射玩家弹 */
  spawnPlayer(x, y, angle, speed, damage, opts = {}) {
    const s = shotPool.pop() || newShot();
    s.x = x; s.y = y;
    s.vx = Math.cos(angle) * speed;
    s.vy = Math.sin(angle) * speed;
    s.damage = damage;
    s.size = opts.size ?? 1;
    s.radius = 4.2 * (opts.size ?? 1);
    s.kind = opts.kind || 'pulse';
    s.life = opts.life ?? 3;
    s.age = 0;
    this.player.push(s);
  }

  /** 敌方弹：kind = orb | diamond | needle */
  spawnEnemy(x, y, angle, speed, opts = {}) {
    const s = enemyPool.pop() || newShot();
    s.x = x; s.y = y;
    s.vx = Math.cos(angle) * speed;
    s.vy = Math.sin(angle) * speed;
    s.radius = opts.radius ?? 5;
    s.kind = opts.kind || 'orb';
    s.color = opts.color || C.hostileShot;
    s.life = opts.life ?? 14;
    s.age = 0;
    s.spin = opts.spin ?? 0;
    s.length = opts.length ?? 18;
    this.enemy.push(s);
  }

  /** 扇形弹幕：中心角 + 数量 + 张角 */
  fanEnemy(x, y, centerAngle, count, spreadAngle, speed, opts = {}) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      this.spawnEnemy(x, y, centerAngle + t * spreadAngle, speed, opts);
    }
  }

  /** 环形弹幕 */
  ringEnemy(x, y, count, speed, offset = 0, opts = {}) {
    for (let i = 0; i < count; i++) {
      this.spawnEnemy(x, y, offset + (i / count) * TAU, speed, opts);
    }
  }

  // ── 更新 ────────────────────────────────────────────────

  update(dt) {
    const player = this.player;
    for (let i = player.length - 1; i >= 0; i--) {
      const s = player[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.age += dt;
      if (s.life <= 0 || s.y < -40 || s.y > VIEW.h + 40 || s.x < -40 || s.x > VIEW.w + 40) {
        swapRemove(player, i);
        shotPool.push(s);
      }
    }

    const enemy = this.enemy;
    for (let i = enemy.length - 1; i >= 0; i--) {
      const s = enemy[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.age += dt;
      if (s.life <= 0 || s.y < -60 || s.y > VIEW.h + 60 || s.x < -60 || s.x > VIEW.w + 60) {
        swapRemove(enemy, i);
        enemyPool.push(s);
      }
    }
  }

  /** 炸弹/清屏：把敌弹转成碎裂粒子后移除 */
  clearEnemyShots(onCleared) {
    for (let i = this.enemy.length - 1; i >= 0; i--) {
      const s = this.enemy[i];
      onCleared?.(s.x, s.y, s.color);
      swapRemove(this.enemy, i);
      enemyPool.push(s);
    }
  }

  // ── 绘制 ────────────────────────────────────────────────

  drawPlayer(ctx) {
    const sprite = getPulseSprite();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.player) {
      const w = sprite.w * s.size;
      const h = sprite.h * s.size;
      ctx.drawImage(sprite.cv, s.x - w / 2, s.y - h / 2, w, h);
    }
    ctx.restore();
  }

  drawEnemy(ctx) {
    ctx.save();
    for (const s of this.enemy) {
      if (s.kind === 'orb') {
        drawOrbAt(ctx, s.x, s.y, s.radius, s.color, 1, '#ffffff');
      } else if (s.kind === 'diamond') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2 + Math.sin(s.age * 6) * 0.25);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = withAlpha(s.color, 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * 1.9, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.moveTo(0, -s.radius * 1.7);
        ctx.lineTo(s.radius, 0);
        ctx.lineTo(0, s.radius * 1.7);
        ctx.lineTo(-s.radius, 0);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * 0.42, 0, TAU);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      } else {
        // needle：细长穿甲弹，沿速度方向
        const a = Math.atan2(s.vy, s.vx);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(a + Math.PI / 2);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, -s.length, 0, s.length * 0.4);
        g.addColorStop(0, withAlpha(s.color, 0));
        g.addColorStop(0.6, withAlpha(s.color, 0.95));
        g.addColorStop(1, '#ffffff');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, s.length * 0.5);
        ctx.lineTo(s.radius * 0.75, -s.length);
        ctx.lineTo(-s.radius * 0.75, -s.length);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
