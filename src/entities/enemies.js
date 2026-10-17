/**
 * 敌机与 Boss。
 * 设计原则：
 *  - 每种敌机只承担一个「教学意图」：直线、俯冲、追踪、悬停炮击、重装。
 *  - 所有攻击都有前摇（发光/停顿），弹幕必须可读、可躲，不做无提示的必死。
 *  - Boss 的三个阶段分别考校走位、节奏与空间管理。
 */
import { BOSS, ENEMY_TYPES, STAGE, VIEW } from '../config.js';
import { C } from '../art/palette.js';
import { drawBoss, drawBossCore, drawEnemy, glow } from '../art/sprites.js';
import {
  angleBetween, clamp, damp, rand, randInt, TAU, velocityToward,
} from '../core/util.js';

// ── 普通敌机 ───────────────────────────────────────────────

const DEFAULT_BEHAVIOR = {
  grunt: 'sine',
  diver: 'dive',
  drone: 'homing',
  sniper: 'hover',
  tank: 'hover',
  elite: 'strafe',
};

export function createEnemy(type, cfg = {}) {
  const proto = ENEMY_TYPES[type];
  const diff = cfg.difficulty ?? 1;
  const hp = Math.round(proto.hp * diff);
  return {
    type,
    x: cfg.x ?? VIEW.w / 2,
    y: cfg.y ?? -40,
    baseX: cfg.baseX ?? cfg.x ?? VIEW.w / 2,
    targetY: cfg.targetY ?? 160,
    vx: 0,
    vy: 0,
    speed: proto.speed * (1 + (diff - 1) * STAGE.speedScale),
    hp,
    maxHp: hp,
    radius: proto.radius,
    score: proto.score,
    dropChance: proto.dropChance * (cfg.dropScale ?? 1),
    flash: 0,
    age: 0,
    fireTimer: cfg.fireDelay ?? rand(0.6, 2.2),
    fireInterval: proto.fireInterval / (1 + (diff - 1) * STAGE.fireRateScale),
    behavior: cfg.behavior || DEFAULT_BEHAVIOR[type] || 'sine',
    phase: cfg.phase ?? rand(0, TAU),
    amp: cfg.amp ?? rand(18, 34),
    hold: cfg.hold ?? rand(4.5, 7),
    state: 'enter',
    spin: rand(0, TAU),
    vxCap: cfg.vxCap ?? 240,
  };
}

const BEHAVIORS = {
  /** 正弦横摆下降 */
  sine(e, dt, game) {
    e.y += e.speed * dt;
    e.x = e.baseX + Math.sin(e.age * 2.1 + e.phase) * e.amp;
  },

  /** 朝玩家方向有限转向俯冲 */
  dive(e, dt, game) {
    const p = game.player;
    const target = angleBetween(e.x, e.y, p.x, p.y);
    let current = Math.atan2(e.vy || 1, e.vx || 0);
    let diff = target - current;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    current += clamp(diff, -2.1 * dt, 2.1 * dt);
    e.vx = Math.cos(current) * e.speed;
    e.vy = Math.sin(current) * e.speed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  },

  /** 高速追踪玩家横向位置 */
  homing(e, dt, game) {
    const p = game.player;
    const desired = clamp((p.x - e.x) * 2.4, -e.vxCap, e.vxCap);
    e.vx = damp(e.vx, desired, 2.6, dt);
    e.x += e.vx * dt;
    e.y += e.speed * dt;
  },

  /** 下降到指定高度悬停，停留一段时间后离开 */
  hover(e, dt, game) {
    if (e.state === 'enter') {
      e.vy = damp(e.vy, e.speed, 3, dt);
      e.y += e.vy * dt;
      if (e.y >= e.targetY) { e.y = e.targetY; e.state = 'hold'; }
    } else if (e.state === 'hold') {
      e.hold -= dt;
      e.y = e.targetY + Math.sin(e.age * 1.6 + e.phase) * 6;
      e.x += Math.sin(e.age * 0.9 + e.phase) * 14 * dt;
      if (e.hold <= 0) e.state = 'leave';
    } else {
      e.vy = damp(e.vy, e.speed * 1.7, 2.4, dt);
      e.y += e.vy * dt;
    }
  },

  /** 横向巡弋，缓缓下压 */
  strafe(e, dt, game) {
    if (e.state === 'enter') {
      e.y += e.speed * dt;
      if (e.y >= e.targetY) e.state = 'hold';
    } else {
      e.x = e.baseX + Math.sin(e.age * 0.85 + e.phase) * 105;
      e.y = e.targetY + Math.sin(e.age * 1.3) * 14;
    }
  },
};

function enemyFire(e, game) {
  const p = game.player;
  switch (e.type) {
    case 'sniper': {
      const a = angleBetween(e.x, e.y + 12, p.x, p.y);
      game.bullets.spawnEnemy(e.x, e.y + 12, a, 315, {
        kind: 'needle', color: '#7dffd4', radius: 4.5, length: 22,
      });
      game.audio.enemyShot?.();
      break;
    }
    case 'tank': {
      const base = angleBetween(e.x, e.y + 14, p.x, p.y);
      game.bullets.fanEnemy(e.x, e.y + 14, base, 3, 0.42, 205, {
        radius: 6.5, color: C.hostileWarm,
      });
      game.audio.enemyShot?.();
      break;
    }
    case 'elite': {
      const offset = e.age * 0.7;
      game.bullets.ringEnemy(e.x, e.y, 12, 165, offset, {
        kind: 'diamond', radius: 5.5, color: '#ff6fc0', spin: 0,
      });
      game.audio.enemyShot?.();
      break;
    }
    case 'grunt': {
      game.bullets.spawnEnemy(e.x, e.y + 10, Math.PI / 2, 210, {
        radius: 5, color: C.hostileShot,
      });
      break;
    }
    default:
      break;
  }
}

export function updateEnemy(e, dt, game) {
  e.age += dt;
  e.flash = Math.max(0, e.flash - dt * 5.5);

  (BEHAVIORS[e.behavior] || BEHAVIORS.sine)(e, dt, game);

  // 横向软边界：不让敌机一直贴在屏幕外侧
  if (e.x < -60) { e.x = -60; e.vx = Math.abs(e.vx); }
  if (e.x > VIEW.w + 60) { e.x = VIEW.w + 60; e.vx = -Math.abs(e.vx); }

  // 射击
  if (e.fireInterval > 0 && e.state !== 'enter' && e.y > 40 && e.y < VIEW.h - 120) {
    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      e.fireTimer += e.fireInterval * rand(0.85, 1.2);
      enemyFire(e, game);
    }
  }

  // 离场回收
  if (e.y > VIEW.h + 70 || e.y < -140) e.removed = true;
}

export function drawEnemyEntity(ctx, e, time) {
  ctx.save();
  ctx.translate(e.x, e.y);
  drawEnemy(ctx, e.type, {
    t: time + e.phase,
    flash: e.flash,
    hpRatio: e.hp / e.maxHp,
  });

  // 蓄力射击前摇：炮口预热光
  if (e.fireInterval > 0 && e.fireTimer < 0.28 && e.y > 40) {
    const k = 1 - e.fireTimer / 0.28;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 8, 16 + k * 12, e.type === 'sniper' ? '#7dffd4' : C.hostileWarm, 0.35 + k * 0.5);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// ── Boss ───────────────────────────────────────────────────

export class Boss {
  constructor(game, stage = 1) {
    this.game = game;
    this.reset(stage);
  }

  reset(stage = 1) {
    this.stage = stage;
    this.form = 0;                 // 0 = 母舰，1 = 脱离后的核心
    this.transition = 0;           // >0 表示形态切换演出的剩余时长
    this.baseTotal = BOSS.baseHp + BOSS.hpPerStage * (stage - 1);
    this.maxHp = Math.round(this.baseTotal * BOSS.formHp[0]);
    this.hp = this.maxHp;
    this.x = VIEW.w / 2;
    this.y = -190;
    this.targetY = 168;
    this.radius = BOSS.radius;
    this.flash = 0;
    this.age = 0;
    this.phase = 0;
    this.state = 'enter';
    this.enterTimer = BOSS.enterDuration;
    this.dying = false;
    this.dead = false;
    this.deathTimer = 0;
    this.explodeTimer = 0;
    this.fireA = 0.9;
    this.fireB = 2.2;
    this.fireC = 0;
    this.spiral = 0;
    this.spiralDir = 1;
    this.score = BOSS.score * stage;
  }

  get hpRatio() { return clamp(this.hp / this.maxHp, 0, 1); }

  update(dt, game) {
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt * 4.5);

    if (this.transition > 0) {
      this._updateTransition(dt, game);
      return;
    }

    if (this.dying) {
      this.deathTimer -= dt;
      this.explodeTimer -= dt;
      if (this.explodeTimer <= 0) {
        this.explodeTimer = rand(0.06, 0.14);
        const x = this.x + rand(-96, 96);
        const y = this.y + rand(-46, 60);
        game.fx.explosion(x, y, rand(0.7, 1.5), C.bossCore, '#ffd9ec');
        game.renderer.shake(rand(4, 11), 0.3);
        game.audio.enemyExplode(true);
      }
      this.y += 6 * dt;
      if (this.deathTimer <= 0) this.dead = true;
      return;
    }

    if (this.state === 'enter') {
      this.enterTimer -= dt;
      const k = 1 - clamp(this.enterTimer / BOSS.enterDuration, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      this.y = -190 + (this.targetY + 190) * eased;
      if (this.enterTimer <= 0) {
        this.state = 'fight';
        this.y = this.targetY;
      }
      return;
    }

    // 阶段推进
    const hpRatio = this.hpRatio;
    const nextPhase = hpRatio > BOSS.phases[0] ? 0 : hpRatio > BOSS.phases[1] ? 1 : 2;
    if (nextPhase > this.phase) {
      this.phase = nextPhase;
      this.flash = 1;
      game.renderer.flash(C.bossCore, 0.3);
      game.renderer.shake(10, 0.5);
      game.audio.warning();
      // 换阶段瞬间清空旧弹幕，给玩家一个清晰的呼吸口
      game.bullets.clearEnemyShots((x, y, color) => game.fx.spark(x, y, color || '#ff6fc0', 2, { speed: [20, 90] }));
      this.fireA = 0.8;
      this.fireB = 1.6;
    }

    // 移动：低血时更狂躁；核心形态更快更飘
    const isCore = this.form === 1;
    const speedFactor = isCore ? 1.5 : 0.55 + this.phase * 0.28;
    const ampX = isCore ? 142 : 96 + this.phase * 10;
    this.x = VIEW.w / 2 + Math.sin(this.age * speedFactor) * ampX;
    this.y = this.targetY + Math.sin(this.age * 0.9) * (isCore ? 20 : 12);

    this._attack(dt, game);
  }

  /** 形态切换演出：母舰崩解，核心脱离 */
  _updateTransition(dt, game) {
    this.transition -= dt;
    this.explodeTimer -= dt;
    if (this.explodeTimer <= 0) {
      this.explodeTimer = rand(0.05, 0.12);
      game.fx.explosion(
        this.x + rand(-84, 84), this.y + rand(-44, 54),
        rand(0.8, 1.7), C.bossCore, '#ffd9ec',
      );
      game.renderer.shake(rand(5, 12), 0.3);
    }
    this.y += 9 * dt;
    if (this.transition <= 0) this._enterCoreForm(game);
  }

  _enterCoreForm(game) {
    this.form = 1;
    this.maxHp = Math.round(this.baseTotal * BOSS.formHp[1]);
    this.hp = this.maxHp;
    this.radius = 44;
    this.targetY = 200;
    this.x = VIEW.w / 2;
    this.y = 200;
    this.flash = 1;
    this.fireA = 1.0;
    this.fireB = 1.5;
    this.spiral = 0;
    game.renderer.setZoom(1);
    game.renderer.flash(C.bossCore, 0.55);
    game.renderer.shake(15, 0.9);
    game.fx.explosion(this.x, this.y, 2.4, C.bossCore, '#ffffff');
    game.fx.ring(this.x, this.y, 230, '#ff6fc0', { life: 0.7, width: 4 });
    game.banner('CORE OVERRIDE', 'PHASE 2', 2.0, C.uiMagenta);
    game.audio.warning();
    game.audio.setIntensity(1);
    game.timeScale = 0.6;
    game.timeScaleTimer = 0.5;
  }

  _attack(dt, game) {
    if (this.form === 1) {
      this._attackCore(dt, game);
      return;
    }

    const p = game.player;
    const aim = angleBetween(this.x, this.y + 20, p.x, p.y);

    this.fireA -= dt;
    this.fireB -= dt;
    this.fireC -= dt;

    // 阶段 0：扇形瞄准 + 侧炮直射
    if (this.phase === 0) {
      if (this.fireA <= 0) {
        this.fireA = 1.55;
        game.bullets.fanEnemy(this.x, this.y + 30, aim, 5, 0.5, 200, { radius: 6.5, color: C.hostileShot });
        this._chargeFx(game);
      }
      if (this.fireB <= 0) {
        this.fireB = 2.1;
        for (const side of [-1, 1]) {
          game.bullets.spawnEnemy(this.x + side * 84, this.y + 6, Math.PI / 2 + side * 0.06, 240, {
            kind: 'needle', color: '#ff7ab8', radius: 5, length: 24,
          });
        }
        this._chargeFx(game);
      }
    }

    // 阶段 1：双向螺旋 + 周期扇形
    if (this.phase >= 1) {
      this.fireC -= 0;
      if (this.spiral <= 0) {
        this.spiral = this.phase >= 2 ? 0.065 : 0.085;
        const arms = 2;
        for (let i = 0; i < arms; i++) {
          const a = this.spiralDir * this.age * 3.1 + (i / arms) * TAU;
          game.bullets.spawnEnemy(this.x, this.y + 18, a + Math.PI / 2, 172, {
            radius: 5.5, color: '#ff9f43',
          });
        }
        this.spiralDir = this.age % 5.4 < 2.7 ? 1 : -1;
      }
      this.spiral -= dt;

      if (this.fireB <= 0) {
        this.fireB = this.phase >= 2 ? 1.35 : 2.4;
        game.bullets.fanEnemy(this.x, this.y + 30, aim, 7, 0.72, 215, { radius: 6, color: C.hostileShot });
        this._chargeFx(game);
      }
    }

    // 阶段 2：环形爆裂 + 瞄准散弹
    if (this.phase >= 2) {
      if (this.fireA <= 0) {
        this.fireA = 1.15;
        game.bullets.ringEnemy(this.x, this.y + 10, 18, 150, this.age * 0.4, {
          radius: 6, color: '#ff6fc0',
        });
        this._chargeFx(game);
        game.renderer.shake(3, 0.2);
      }
    }
  }

  _chargeFx(game) {
    game.fx.ring(this.x, this.y + 16, 60, '#ff6fc0', { life: 0.28, width: 2 });
    game.audio.enemyShot?.();
  }

  /** 核心形态：螺旋 + 环形 + 瞄准穿甲三连，节奏比母舰密集得多 */
  _attackCore(dt, game) {
    const p = game.player;
    const aim = angleBetween(this.x, this.y, p.x, p.y);
    const rage = 1 + (1 - this.hpRatio) * 0.5;   // 血越低越狂暴

    this.fireA -= dt * rage;
    this.fireB -= dt * rage;
    this.spiral -= dt;

    if (this.spiral <= 0) {
      this.spiral = 0.08 / rage;
      for (let i = 0; i < 2; i++) {
        const a = this.age * 3.7 + i * Math.PI;
        game.bullets.spawnEnemy(this.x, this.y, a, 190, { radius: 5, color: '#ff9f43' });
      }
    }

    if (this.fireA <= 0) {
      this.fireA = 2.0;
      game.bullets.ringEnemy(this.x, this.y, 16, 158, this.age * 0.5, { radius: 5.5, color: '#ff6fc0' });
      this._chargeFx(game);
    }

    if (this.fireB <= 0) {
      this.fireB = 1.45;
      game.bullets.fanEnemy(this.x, this.y, aim, 3, 0.24, 285, {
        kind: 'needle', color: '#ff7ab8', radius: 5, length: 20,
      });
      this._chargeFx(game);
    }
  }

  /** 返回 true 表示这一击造成死亡（母舰段被击破只触发形态切换，不算死亡） */
  damage(amount, game) {
    if (this.dying || this.transition > 0) return false;
    this.hp -= amount;
    this.flash = Math.min(1, this.flash + 0.25);
    if (this.hp > 0) return false;

    if (this.form === 0) {
      this._beginTransition(game);
      return false;
    }

    this.hp = 0;
    this.dying = true;
    this.deathTimer = 2.1;
    game.audio.bossExplode();
    game.renderer.shake(18, 1.2);
    game.renderer.flash('#ffffff', 0.55);
    return true;
  }

  _beginTransition(game) {
    this.hp = 0;
    this.transition = 1.7;
    this.explodeTimer = 0;
    this.flash = 1;
    game.audio.bossExplode();
    game.renderer.flash('#ffffff', 0.75);
    game.renderer.shake(24, 1.4);
    game.renderer.setZoom(0.93);
    game.timeScale = 0.45;
    game.timeScaleTimer = 0.9;
    game.bullets.clearEnemyShots((x, y, c) => game.fx.spark(x, y, c || '#ff6fc0', 2, { speed: [40, 200] }));
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.form === 1) {
      drawBossCore(ctx, { t: this.age, flash: this.flash, hpRatio: this.hpRatio });
    } else {
      drawBoss(ctx, { t: this.age, phase: this.phase, flash: this.flash, hpRatio: this.hpRatio });
    }
    ctx.restore();
  }
}
