/**
 * HUD：把状态信息压缩到画面四周的窄带里，中心战斗区域保持干净。
 * 信息优先级：Boss 血条 > 生命/炸弹 > 分数 > 连击 > 武器等级。
 * 所有文字走等宽字体 + 固定位置，避免数字跳动导致画面抖动。
 */
import { PLAYER, VIEW, WEAPONS } from '../config.js';
import { C } from '../art/palette.js';
import { clamp, easeOutCubic, formatScore, withAlpha } from '../core/util.js';

const MONO = '"SF Mono", Menlo, Consolas, monospace';

function spaceOut(text) {
  return text.split('').join(' ');
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.activeBanner = null;
    this.scorePop = 0;
    this.scoreDisplay = 0;
    this.showCombo = 0;
  }

  reset() {
    this.activeBanner = null;
    this.scoreDisplay = 0;
    this.scorePop = 0;
    this.showCombo = 0;
  }

  banner(title, subtitle = '', duration = 2.4, color = C.uiCyan) {
    this.activeBanner = { title, subtitle, duration, max: duration, color };
  }

  update(dt) {
    if (this.activeBanner) {
      this.activeBanner.duration -= dt;
      if (this.activeBanner.duration <= 0) this.activeBanner = null;
    }
    const target = this.game.score;
    this.scoreDisplay += (target - this.scoreDisplay) * Math.min(1, dt * 9);
    if (Math.abs(target - this.scoreDisplay) < 1) this.scoreDisplay = target;
    this.scorePop = Math.max(0, this.scorePop - dt * 3.5);
    this.showCombo = Math.max(0, this.showCombo - dt);
  }

  popScore() { this.scorePop = 1; }

  draw(ctx) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    this._drawTopBar(ctx);
    this._drawScore(ctx);
    this._drawLivesAndBombs(ctx);
    this._drawWeapon(ctx);
    if (this.game.combo > 1) this._drawCombo(ctx);
    if (this.game.boss && this.game.boss.state !== 'enter') this._drawBossBar(ctx);
    this._drawBanner(ctx);

    ctx.restore();
  }

  _drawTopBar(ctx) {
    const stage = this.game.stage;
    ctx.save();
    // 顶部细进度线：波次推进
    const progress = this.game.spawner.progress;
    ctx.fillStyle = 'rgba(95,247,255,0.12)';
    ctx.fillRect(0, 0, VIEW.w, 2);
    const grad = ctx.createLinearGradient(0, 0, VIEW.w * progress, 0);
    grad.addColorStop(0, 'rgba(95,247,255,0.5)');
    grad.addColorStop(1, 'rgba(159,252,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW.w * progress, 2);

    ctx.font = `600 10px ${MONO}`;
    ctx.fillStyle = C.uiDim;
    ctx.textAlign = 'center';
    ctx.fillText(`STAGE ${stage}`, VIEW.w / 2, 20);

    // 进度刻度
    const segs = 16;
    const usable = VIEW.w - 40;
    for (let i = 0; i < segs; i++) {
      const active = i / segs < progress;
      ctx.fillStyle = active ? 'rgba(95,247,255,0.55)' : 'rgba(95,247,255,0.12)';
      ctx.fillRect(20 + (usable / segs) * i, 26, usable / segs - 3, 2);
    }
    ctx.restore();
  }

  _drawScore(ctx) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = C.uiDim;
    ctx.fillText('SCORE', 16, 52);

    const pop = easeOutCubic(this.scorePop);
    ctx.font = `700 ${17 + pop * 3}px ${MONO}`;
    ctx.fillStyle = `rgb(${232 + pop * 23},${252},${255})`;
    ctx.fillText(formatScore(this.scoreDisplay), 16, 70);

    ctx.textAlign = 'right';
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = C.uiDim;
    ctx.fillText('HI-SCORE', VIEW.w - 16, 52);
    ctx.font = `700 14px ${MONO}`;
    ctx.fillStyle = withAlpha(C.uiGold, 0.9);
    ctx.fillText(formatScore(Math.max(this.game.hiscore, this.game.score)), VIEW.w - 16, 70);
    ctx.restore();
  }

  _drawLivesAndBombs(ctx) {
    ctx.save();
    const baseY = VIEW.h - 18;

    // 生命：小战机图标
    for (let i = 0; i < Math.min(this.game.player.lives, 5); i++) {
      const x = 20 + i * 20;
      ctx.save();
      ctx.translate(x, baseY - 4);
      ctx.fillStyle = C.playerCore;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 炸弹：菱形计数
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = C.uiDim;
    ctx.textAlign = 'left';
    ctx.fillText('BOMB', 16, baseY - 22);
    for (let i = 0; i < this.game.player.bombs; i++) {
      const x = 56 + i * 13;
      ctx.save();
      ctx.translate(x, baseY - 25);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = C.hostileWarm;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.strokeStyle = 'rgba(255,224,163,0.8)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-3, -3, 6, 6);
      ctx.restore();
    }
    ctx.restore();
  }

  _drawWeapon(ctx) {
    const power = this.game.player.power;
    const right = VIEW.w - 16;
    const baseY = VIEW.h - 22;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = C.uiDim;
    ctx.fillText('POWER', right, baseY - 22);

    const cellW = 9, gap = 3;
    const total = WEAPONS.length;
    for (let i = 0; i < total; i++) {
      const active = i < power;
      const x = right - (total - i) * (cellW + gap) + gap;
      ctx.fillStyle = active
        ? (i === total - 1 ? C.uiGold : C.playerCore)
        : 'rgba(95,247,255,0.10)';
      const h = active ? 8 : 5;
      ctx.fillRect(x, baseY - h, cellW, h);
      if (active) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, baseY - h - 1, cellW, 1);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  _drawCombo(ctx) {
    const combo = this.game.combo;
    const mult = this.game.multiplier;
    ctx.save();
    ctx.textAlign = 'right';
    const x = VIEW.w - 20;
    const y = VIEW.h * 0.42;
    const pulse = 1 + Math.sin(this.game.time * 16) * 0.04;
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = withAlpha(C.uiGold, 0.9);
    ctx.fillText(`${combo} HIT`, 0, 0);
    ctx.font = `700 22px ${MONO}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`×${mult.toFixed(1)}`, 0, 24);
    ctx.restore();
  }

  _drawBossBar(ctx) {
    const boss = this.game.boss;
    const ratio = boss.hpRatio;
    const w = VIEW.w - 72;
    const x = 36;
    const y = 88;
    const h = 9;

    ctx.save();
    ctx.font = `600 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = withAlpha(C.bossCore, 0.9);
    ctx.fillText(spaceOut('DREADNOUGHT'), VIEW.w / 2, y - 7);

    // 底槽
    ctx.fillStyle = 'rgba(255,45,149,0.12)';
    ctx.fillRect(x, y, w, h);

    // 血量
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ff2d95');
    g.addColorStop(0.5, '#ff6fc0');
    g.addColorStop(1, '#ffd9ec');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * ratio, h);

    // 阶段刻度
    for (const threshold of [0.62, 0.3]) {
      ctx.fillStyle = 'rgba(4,6,15,0.9)';
      ctx.fillRect(x + w * threshold - 1, y, 2, h);
    }

    // 边框
    ctx.strokeStyle = withAlpha(C.bossCore, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

    // 受损高光
    if (boss.flash > 0.05) {
      ctx.fillStyle = `rgba(255,255,255,${boss.flash * 0.5})`;
      ctx.fillRect(x, y, w * ratio, h);
    }
    ctx.restore();
  }

  _drawBanner(ctx) {
    if (!this.activeBanner) return;
    const b = this.activeBanner;
    const elapsed = b.max - b.duration;
    const fadeIn = clamp(elapsed / 0.3, 0, 1);
    const fadeOut = clamp(b.duration / 0.5, 0, 1);
    const alpha = Math.min(fadeIn, fadeOut);
    const rise = (1 - easeOutCubic(fadeIn)) * 14;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';

    const cy = VIEW.h * 0.34 + rise;

    // 装饰横线
    ctx.strokeStyle = withAlpha(b.color, 0.55);
    ctx.lineWidth = 1;
    const lineW = 120 * easeOutCubic(fadeIn);
    ctx.beginPath();
    ctx.moveTo(VIEW.w / 2 - lineW, cy + 12);
    ctx.lineTo(VIEW.w / 2 + lineW, cy + 12);
    ctx.stroke();

    ctx.font = `700 24px ${MONO}`;
    ctx.fillStyle = b.color;
    ctx.fillText(spaceOut(b.title), VIEW.w / 2, cy);

    if (b.subtitle) {
      ctx.font = `500 10px ${MONO}`;
      ctx.fillStyle = withAlpha('#ffffff', 0.7);
      ctx.fillText(spaceOut(b.subtitle), VIEW.w / 2, cy + 30);
    }
    ctx.restore();
  }
}
