/**
 * Game —— 单一编排者。
 * 职责：状态机、实体生命周期、碰撞、计分、关卡流程、绘制顺序。
 * 实体自身不互相持有引用，所有交互都经由这里的公共方法，便于推理与调试。
 *
 * 关卡循环：
 *   playing ──(波次跑完)──> bossWarning ──> boss(enter→fight) ──(击败)──> stageClear ──> 下一关
 *      └──(生命耗尽)──> over
 */
import {
  BOMB, FX, PLAYER, SCORING, STAGE, STORAGE_KEY, VIEW,
} from './config.js';
import { C } from './art/palette.js';
import { Background } from './art/background.js';
import { AudioEngine } from './core/audio.js';
import { Renderer } from './core/renderer.js';
import { Bullets } from './entities/bullets.js';
import { Effects } from './entities/effects.js';
import { Boss, createEnemy, drawEnemyEntity, updateEnemy } from './entities/enemies.js';
import { Player } from './entities/player.js';
import { Spawner } from './systems/spawner.js';
import { HUD } from './systems/hud.js';
import { chance, circlesHit, formatScore, TAU } from './core/util.js';

const STATE = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over',
};

export class Game {
  constructor(canvas, hooks = {}) {
    this.hooks = hooks;
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioEngine();
    this.background = new Background();

    this.player = new Player(this);
    this.bullets = new Bullets();
    this.fx = new Effects(this);
    this.spawner = new Spawner(this);
    this.hud = new HUD(this);

    this.enemies = [];
    this.boss = null;

    this.state = STATE.MENU;
    this.time = 0;
    this.stage = 1;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.hiscore = this._loadHiscore();

    this.bombTimer = 0;
    this.bombRadius = 0;
    this.bombClearTimer = 0;

    this.bossWarningTimer = 0;
    this.stageClearTimer = 0;
    this.overTimer = 0;
    this.timeScale = 1;
    this.timeScaleTimer = 0;
    this.shotsFired = 0;
  }

  // ── 持久化 ──────────────────────────────────────────────

  _loadHiscore() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch { return 0; }
  }

  _saveHiscore() {
    try {
      if (this.score > this.hiscore) {
        this.hiscore = Math.floor(this.score);
        localStorage.setItem(STORAGE_KEY, String(this.hiscore));
        return true;
      }
    } catch { /* 隐私模式下忽略 */ }
    return false;
  }

  get multiplier() {
    return Math.min(SCORING.maxMultiplier, 1 + Math.floor(this.combo / SCORING.comboStep) * 0.5);
  }

  get playing() { return this.state === STATE.PLAYING; }

  // ── 生命周期 ────────────────────────────────────────────

  reset() {
    this.time = 0;
    this.stage = 1;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.enemies.length = 0;
    this.boss = null;
    this.bombTimer = 0;
    this.bombRadius = 0;
    this.bossWarningTimer = 0;
    this.stageClearTimer = 0;
    this.overTimer = 0;
    this.timeScale = 1;
    this.timeScaleTimer = 0;
    this.shotsFired = 0;

    this.player.reset(true);
    this.bullets.reset();
    this.fx.reset();
    this.spawner.reset(1);
    this.hud.reset();
    this.background.reset();
    this.audio.setIntensity(0);
  }

  start() {
    this.reset();
    this.state = STATE.PLAYING;
    this.audio.init();
    this.audio.setStage(1);
    this.hud.banner('STAGE 1', 'MISSION START', 2.2);
    this.audio.uiSelect();
  }

  togglePause() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.audio.setLaser(false);
      return true;
    }
    if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.audio.resume();
      return false;
    }
    return null;
  }

  toMenu() {
    this.state = STATE.MENU;
    this.audio.setLaser(false);
    this.audio.setIntensity(0);
  }

  // ── 实体接口 ────────────────────────────────────────────

  spawnEnemy(type, cfg) {
    const e = createEnemy(type, cfg);
    this.enemies.push(e);
    return e;
  }

  banner(title, sub = '', duration = 2.2, color = C.uiCyan) {
    this.hud.banner(title, sub, duration, color);
  }

  addScore(base) {
    const gained = Math.round(base * this.multiplier);
    this.score += gained;
    this.hud.popScore();
    return gained;
  }

  addCombo() {
    this.combo += 1;
    this.comboTimer = SCORING.comboWindow;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
  }

  damageEnemy(e, dmg, opts = {}) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = Math.max(e.flash, opts.silent ? 0.35 : 0.9);
    if (!opts.silent) {
      this.audio.enemyHit();
      this.fx.spark(e.x, e.y, '#ffffff', 2, { speed: [40, 150], size: [1, 2.2] });
    }
    if (e.hp <= 0) this._killEnemy(e);
  }

  _killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills += 1;
    this.addCombo();

    const big = e.type === 'tank' || e.type === 'elite';
    const gained = this.addScore(e.score);
    this.fx.explosion(e.x, e.y, big ? 1.5 : 0.95, e.type === 'elite' ? C.hostileElite : C.hostileWarm, '#ffffff');
    this.fx.text(e.x, e.y - 10, `+${formatScore(gained)}`, big ? C.uiGold : '#eafcff', big ? 15 : 12);
    this.audio.enemyExplode(big);
    this.renderer.shake(big ? 5.5 : FX.killShake, 0.28);
    if (big) this.renderer.hitStop(0.05);

    if (chance(e.dropChance)) {
      this.fx.spawnPickup(e.x, e.y);
    }
  }

  applyLaserDamage(x, y, width, dmg) {
    const half = width / 2;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.abs(e.x - x) < half + e.radius && e.y < y) {
        this.damageEnemy(e, dmg, { silent: true });
      }
    }
    if (this.boss && !this.boss.dying && this.boss.state !== 'enter') {
      if (Math.abs(this.boss.x - x) < half + this.boss.radius * 0.8 && this.boss.y < y) {
        if (this.boss.damage(dmg, this)) this._onBossDefeated();
      }
    }
  }

  // ── 玩家事件 ────────────────────────────────────────────

  onPlayerHit(x, y) {
    this.combo = 0;
    this.comboTimer = 0;
    this.fx.explosion(x, y, 2.0, C.playerGlow, '#ffffff');
    this.fx.smoke(x, y, 5, 1.4);
    this.audio.playerHit();
    this.audio.setLaser(false);
    this.renderer.shake(20, 1.0);
    this.renderer.flash('#ff2d55', 0.45);
    this.renderer.hitStop(0.07);
    this.timeScale = 0.45;
    this.timeScaleTimer = 0.55;
    this.bullets.clearEnemyShots((bx, by, color) => {
      this.fx.spark(bx, by, color || C.hostileShot, 2, { speed: [30, 120] });
    });
  }

  onPlayerDestroyed(x, y) {
    this.fx.explosion(x, y, 3.2, C.playerGlow, '#ffffff');
    this.fx.spark(x, y, '#ffffff', 40, { speed: [80, 420], size: [1.5, 3.6] });
    this.fx.smoke(x, y, 10, 2);
    this.audio.playerHit();
    this.audio.setLaser(false);
    this.renderer.shake(30, 1.4);
    this.renderer.flash('#ffffff', 0.7);
    this.renderer.hitStop(0.12);
    this.timeScale = 0.35;
    this.timeScaleTimer = 1.4;
    this.overTimer = 1.9;
    this.bullets.clearEnemyShots();
  }

  // ── 炸弹 ────────────────────────────────────────────────

  useBomb() {
    if (!this.playing) return false;
    if (this.bombTimer > 0) return false;
    if (this.player.bombs <= 0) return false;
    if (!this.player.alive) return false;

    this.player.bombs -= 1;
    this.bombTimer = BOMB.duration;
    this.bombRadius = 24;
    this.bombClearTimer = 0;
    this.player.invuln = Math.max(this.player.invuln, BOMB.invuln);

    this.audio.bomb();
    this.renderer.flash('#ffffff', 0.55);
    this.renderer.shake(BOMB.shake, 0.9);
    this.renderer.hitStop(0.05);
    this.fx.ring(this.player.x, this.player.y, 240, '#ffffff', { life: 0.6, width: 5 });
    this.bullets.clearEnemyShots((x, y, color) => {
      this.fx.spark(x, y, color || C.hostileShot, 3, { speed: [60, 220] });
    });

    // 炸弹落下瞬间对全屏敌人造成一次重击
    for (const e of this.enemies) {
      if (!e.dead) this.damageEnemy(e, BOMB.damage, { silent: true });
    }
    if (this.boss && !this.boss.dying) {
      if (this.boss.damage(BOMB.damage, this)) this._onBossDefeated();
    }
    return true;
  }

  // ── 关卡流程 ────────────────────────────────────────────

  _startBossWarning() {
    this.bossWarningTimer = STAGE.bossWarningDuration;
    this.hud.banner('WARNING', 'DREADNOUGHT APPROACHING', STAGE.bossWarningDuration - 0.2, C.uiMagenta);
    this.audio.warning();
    this.renderer.flash(C.uiMagenta, 0.22);
  }

  _spawnBoss() {
    this.boss = new Boss(this, this.stage);
    this.audio.setIntensity(1);
    this.renderer.flash(C.bossCore, 0.3);
    this.renderer.shake(12, 1.0);
  }

  _onBossDefeated() {
    const boss = this.boss;
    if (!boss || boss.cleared) return;
    boss.cleared = true;
    this.stageClearTimer = STAGE.clearDelay;
    const gained = this.addScore(boss.score);
    this.fx.text(boss.x, boss.y, `+${formatScore(gained)}`, C.uiGold, 22);
    this.audio.setIntensity(0);
    this.timeScale = 0.55;
    this.timeScaleTimer = 1.0;
    this.renderer.flash('#ffffff', 0.65);
    this.renderer.shake(22, 1.4);

    // 清空残余弹幕与杂兵，为结算留白
    this.bullets.clearEnemyShots((x, y, color) => this.fx.spark(x, y, color || C.hostileShot, 2, { speed: [40, 160] }));
    for (const e of this.enemies) if (!e.dead) this.damageEnemy(e, 9999, { silent: true });
  }

  _nextStage() {
    this.stage += 1;
    this.score += SCORING.stageBonus;
    this.boss = null;
    this.stageClearTimer = 0;
    this.bombTimer = 0;
    this.spawner.reset(this.stage);
    this.player.addBomb(1);
    this.audio.setStage(this.stage);
    this.audio.setIntensity(0);
    this.hud.banner(`STAGE ${this.stage}`, 'MISSION START', 2.2);
    this.fx.spark(this.player.x, this.player.y, C.playerGlow, 26, { speed: [60, 240] });
    this.fx.ring(this.player.x, this.player.y, 140, C.playerGlow, { life: 0.6 });
  }

  // ── 主更新 ──────────────────────────────────────────────

  update(dt, input) {
    // 全局动画时间不受暂停/慢动作影响，保证背景与 UI 呼吸自然
    this.time += dt;

    if (this.state === STATE.MENU) {
      this.background.update(dt, 0.55);
      return;
    }
    if (this.state === STATE.PAUSED || this.state === STATE.OVER) {
      return;
    }

    // 慢动作
    if (this.timeScaleTimer > 0) {
      this.timeScaleTimer -= dt;
      if (this.timeScaleTimer <= 0) this.timeScale = 1;
    }
    const scaled = this.renderer.consumeDt(dt * this.timeScale);

    this.background.update(scaled, this.boss ? 1.5 : 1);
    this.renderer.update(dt);

    // 玩家
    this.player.update(scaled, input);

    // 炸弹
    this._updateBomb(scaled);

    // 生成器（Boss 战期间暂停波次）
    if (!this.boss && this.bossWarningTimer <= 0 && this.stageClearTimer <= 0) {
      this.spawner.update(scaled);
      if (this.spawner.finished) this._startBossWarning();
    }

    // Boss 警告倒计时
    if (this.bossWarningTimer > 0) {
      this.bossWarningTimer -= scaled;
      if (this.bossWarningTimer <= 0) this._spawnBoss();
    }

    // 敌人
    for (const e of this.enemies) {
      if (e.dead) continue;
      updateEnemy(e, scaled, this);
    }
    // 清理
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead || e.removed || e.y > VIEW.h + 120) this.enemies.splice(i, 1);
    }

    // Boss
    if (this.boss) {
      this.boss.update(scaled, this);
      if (this.boss.dead) this.boss = null;
    }

    // 子弹
    this.bullets.update(scaled);

    // 碰撞
    this._collide();

    // 特效与道具
    this.fx.update(scaled);
    const picked = this.fx.updatePickups(scaled, this.player);
    for (const kind of picked) this._applyPickup(kind);

    // 连击衰减
    if (this.combo > 0) {
      this.comboTimer -= scaled;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.hud.update(dt);

    // 关卡结算停留（Boss 爆炸结束后仍保留一段呼吸时间再进下一关）
    if (this.stageClearTimer > 0) {
      this.stageClearTimer -= scaled;
      if (this.stageClearTimer <= 0) this._nextStage();
    }

    // 玩家彻底阵亡
    if (this.overTimer > 0) {
      this.overTimer -= dt;
      if (this.overTimer <= 0) this._endRun();
    }
  }

  _updateBomb(dt) {
    if (this.bombTimer <= 0) return;
    this.bombTimer -= dt;
    this.bombRadius += BOMB.radiusGrowth * dt;

    // 持续清空新增弹幕
    this.bombClearTimer -= dt;
    if (this.bombClearTimer <= 0) {
      this.bombClearTimer = 0.18;
      this.bullets.clearEnemyShots();
    }
  }

  _applyPickup(kind) {
    const p = this.player;
    this.audio.pickup(kind);
    this.fx.ring(p.x, p.y, 46, kind === 'life' ? C.uiMagenta : C.uiCyan, { life: 0.35, width: 2 });
    switch (kind) {
      case 'power': {
        const up = p.addPower(1);
        this.fx.text(p.x, p.y - 26, up ? `POWER ${p.power}` : 'MAX', C.uiGold, 13);
        if (up) this.addScore(200);
        break;
      }
      case 'bomb':
        p.addBomb(1);
        this.fx.text(p.x, p.y - 26, 'BOMB', C.hostileWarm, 13);
        break;
      case 'shield':
        p.grantShield(6);
        this.fx.text(p.x, p.y - 26, 'SHIELD', C.playerGlow, 13);
        break;
      case 'life':
        p.addLife();
        this.fx.text(p.x, p.y - 26, '1 UP', C.uiMagenta, 15);
        this.renderer.flash(C.uiMagenta, 0.2);
        break;
      default: break;
    }
    this.addScore(50);
  }

  _collide() {
    const p = this.player;
    const playerVulnerable = p.alive && !p.invulnerable;

    // 玩家弹 × 敌机
    for (const s of this.bullets.player) {
      if (s.life <= 0) continue;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (circlesHit(s.x, s.y, s.radius, e.x, e.y, e.radius)) {
          this.damageEnemy(e, s.damage);
          this.fx.spark(s.x, s.y, C.playerGlow, 2, { speed: [30, 120], size: [1, 2] });
          s.life = 0;
          break;
        }
      }
      if (s.life <= 0) continue;
      if (this.boss && this.boss.state === 'fight' && !this.boss.dying) {
        if (circlesHit(s.x, s.y, s.radius, this.boss.x, this.boss.y, this.boss.radius * 0.92)) {
          if (this.boss.damage(s.damage, this)) this._onBossDefeated();
          this.fx.spark(s.x, s.y, C.playerGlow, 2, { speed: [30, 120], size: [1, 2] });
          this.audio.enemyHit();
          s.life = 0;
        }
      }
    }

    if (!playerVulnerable) return;

    // 敌弹 × 玩家（核心判定：极小半径）
    for (const s of this.bullets.enemy) {
      if (circlesHit(s.x, s.y, s.radius * 0.75, p.x, p.y, PLAYER.radius)) {
        this.player.hit();
        return;
      }
    }

    // 敌机撞击
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (circlesHit(e.x, e.y, e.radius * 0.82, p.x, p.y, PLAYER.radius)) {
        this.damageEnemy(e, 9999, { silent: true });
        this.player.hit();
        return;
      }
    }

    // Boss 本体撞击
    if (this.boss && this.boss.state === 'fight' && !this.boss.dying) {
      if (circlesHit(this.boss.x, this.boss.y, this.boss.radius * 0.8, p.x, p.y, PLAYER.radius)) {
        this.player.hit();
      }
    }
  }

  _endRun() {
    this.state = STATE.OVER;
    const newRecord = this._saveHiscore();
    this.audio.setLaser(false);
    this.audio.setIntensity(0);
    this.hooks.onGameOver?.({
      score: Math.floor(this.score),
      kills: this.kills,
      bestCombo: this.bestCombo,
      stage: this.stage,
      newRecord,
    });
  }

  // ── 绘制 ────────────────────────────────────────────────

  draw() {
    const ctx = this.renderer.ctx;
    this.renderer.begin();

    this.background.draw(ctx);

    if (this.state !== STATE.MENU) {
      this.player.drawLaser(ctx);
      this.player.drawTrail(ctx);

      this.fx.drawPickupGlow(ctx);

      for (const e of this.enemies) {
        if (!e.dead) drawEnemyEntity(ctx, e, this.time);
      }

      if (this.boss) this.boss.draw(ctx);

      this.player.draw(ctx);
      this.bullets.drawPlayer(ctx);
      this.bullets.drawEnemy(ctx);

      this.fx.drawParticles(ctx);
      this.fx.drawShockwaves(ctx);

      this.fx.drawPickups(ctx);
      this.fx.drawTexts(ctx);

      this._drawBomb(ctx);

      if (this.bossWarningTimer > 0) this._drawBossWarning(ctx);

      this.hud.draw(ctx);
    }

    this.renderer.drawOverlay();
  }

  _drawBomb(ctx) {
    if (this.bombTimer <= 0) return;
    const k = 1 - this.bombTimer / BOMB.duration;
    const r = this.bombRadius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const g = ctx.createRadialGradient(this.player.x, this.player.y, r * 0.3, this.player.x, this.player.y, r);
    g.addColorStop(0, `rgba(120,240,255,${0.12 * (1 - k)})`);
    g.addColorStop(0.75, `rgba(95,247,255,${0.22 * (1 - k)})`);
    g.addColorStop(1, 'rgba(95,247,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
    ctx.lineWidth = 2 + 7 * (1 - k);
    ctx.beginPath();
    ctx.arc(this.player.x, this.player.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  _drawBossWarning(ctx) {
    const t = this.time;
    const a = 0.2 + Math.sin(t * 10) * 0.1;
    ctx.save();
    const grd = ctx.createLinearGradient(0, 0, 0, VIEW.h);
    grd.addColorStop(0, `rgba(255,45,149,${a})`);
    grd.addColorStop(0.25, 'rgba(255,45,149,0)');
    grd.addColorStop(0.75, 'rgba(255,45,149,0)');
    grd.addColorStop(1, `rgba(255,45,149,${a})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    // 斜向警戒条纹
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = C.uiMagenta;
    ctx.lineWidth = 26;
    for (let i = -VIEW.h; i < VIEW.w + VIEW.h; i += 68) {
      const offset = (t * 90) % 68;
      ctx.beginPath();
      ctx.moveTo(i + offset, 0);
      ctx.lineTo(i + offset - VIEW.h, VIEW.h);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export { STATE };
