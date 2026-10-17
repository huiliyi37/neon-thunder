/**
 * 全局调参表 —— 单一事实来源。
 * 单位约定：时间 = 秒，速度 = 像素/秒，尺寸 = 逻辑像素（480×800 竖屏坐标系）。
 * 任何数值手感相关的魔数都应落在这里，而不是散落在实体文件中。
 */

export const VIEW = Object.freeze({ w: 480, h: 800 });

/** 玩家自机 */
export const PLAYER = Object.freeze({
  spawnX: VIEW.w / 2,
  spawnY: VIEW.h - 110,
  speed: 335,
  focusSpeed: 150,
  /** 判定半径（远小于机体视觉尺寸，这是弹幕射击的核心手感） */
  radius: 3.6,
  lives: 3,
  bombs: 3,
  maxPower: 6,
  maxBombs: 6,
  invulnOnStart: 1.6,
  invulnOnHit: 2.4,
  respawnDelay: 0.9,
  /**
   * 受击后从最近一次位置重新出发时，屏幕上会飞出这些残骸数量
   */
  deathParticles: 42,
  /** 精确模式的视觉收缩系数 */
  focusVisualScale: 0.82,
});

/**
 * 武器等级表。每一级是一个"弹道组"：
 *   count     主弹道数量（1/2/3/5）
 *   spread    主弹道之间的横向偏移（px）
 *   angle     最外侧弹道的外扩角（弧度）
 *   interval  发射间隔（秒）
 *   damage    单发伤害
 *   options   僚机数量
 *   laser     是否附带持续激光柱
 */
export const WEAPONS = Object.freeze([
  /* Lv1 */ { count: 1, spread: 0, angle: 0, interval: 0.105, damage: 1.0, options: 0, laser: false },
  /* Lv2 */ { count: 2, spread: 13, angle: 0, interval: 0.105, damage: 1.0, options: 0, laser: false },
  /* Lv3 */ { count: 3, spread: 15, angle: 0.055, interval: 0.10, damage: 1.0, options: 0, laser: false },
  /* Lv4 */ { count: 3, spread: 16, angle: 0.075, interval: 0.095, damage: 1.15, options: 2, laser: false },
  /* Lv5 */ { count: 5, spread: 14, angle: 0.15, interval: 0.09, damage: 1.2, options: 2, laser: false },
  /* Lv6 */ { count: 5, spread: 15, angle: 0.16, interval: 0.085, damage: 1.35, options: 2, laser: true },
]);

/** 玩家主弹 / 僚机弹 / 激光 */
export const SHOT = Object.freeze({
  speed: 940,
  width: 5,
  height: 17,
  optionSpeed: 760,
  optionDamage: 0.55,
  optionInterval: 0.19,
  optionOffset: { x: 30, y: 6 },
  laserWidth: 16,
  laserDps: 26,
  laserTickInterval: 0.06,
  homingSpeed: 540,
  homingTurnRate: 6.2,
  homingLife: 2.4,
});

/* ── 武器流派 ──────────────────────────────────────────────
 * 四类主炮，手感与战术定位完全不同：
 *   PULSE  均衡连射——任何距离都稳
 *   SPREAD 广域散射——近身清场，远距离衰减
 *   LASER  持续光束——高 DPS 但必须对准，考验走位精度
 *   HOMING 追踪导弹——自动索敌，节奏慢、单发重
 * 等级（POWER 1-6）对所有类型通用，拾取 W 切换类型并保留等级。
 */
export const WEAPON_TYPES = Object.freeze(['pulse', 'spread', 'laser', 'homing']);

export const WEAPON_META = Object.freeze({
  pulse: { label: 'PULSE', color: '#5ff7ff', blurb: '均衡连射' },
  spread: { label: 'SPREAD', color: '#ffd166', blurb: '广域散射' },
  laser: { label: 'LASER', color: '#ff8ad0', blurb: '持续光束' },
  homing: { label: 'HOMING', color: '#7dffd4', blurb: '追踪导弹' },
});

export const WEAPON_SPECS = Object.freeze({
  pulse: WEAPONS,
  spread: Object.freeze([
    { kind: 'bullet', count: 3, spread: 26, angle: 0.18, interval: 0.150, damage: 0.62, options: 0 },
    { kind: 'bullet', count: 4, spread: 24, angle: 0.20, interval: 0.145, damage: 0.62, options: 0 },
    { kind: 'bullet', count: 5, spread: 22, angle: 0.24, interval: 0.140, damage: 0.66, options: 0 },
    { kind: 'bullet', count: 6, spread: 20, angle: 0.28, interval: 0.135, damage: 0.68, options: 2 },
    { kind: 'bullet', count: 7, spread: 18, angle: 0.32, interval: 0.130, damage: 0.70, options: 2 },
    { kind: 'bullet', count: 9, spread: 16, angle: 0.40, interval: 0.125, damage: 0.72, options: 2 },
  ]),
  laser: Object.freeze([
    { kind: 'laser', width: 13, tickInterval: 0.06, tickDamage: 0.95, options: 0 },
    { kind: 'laser', width: 16, tickInterval: 0.06, tickDamage: 1.10, options: 0 },
    { kind: 'laser', width: 19, tickInterval: 0.06, tickDamage: 1.28, options: 0 },
    { kind: 'laser', width: 22, tickInterval: 0.06, tickDamage: 1.46, options: 2 },
    { kind: 'laser', width: 26, tickInterval: 0.06, tickDamage: 1.68, options: 2 },
    { kind: 'laser', width: 30, tickInterval: 0.06, tickDamage: 1.92, options: 2 },
  ]),
  homing: Object.freeze([
    { kind: 'homing', count: 1, interval: 0.62, damage: 2.6, options: 0 },
    { kind: 'homing', count: 1, interval: 0.56, damage: 3.0, options: 0 },
    { kind: 'homing', count: 2, interval: 0.60, damage: 2.8, options: 0 },
    { kind: 'homing', count: 2, interval: 0.54, damage: 3.1, options: 2 },
    { kind: 'homing', count: 3, interval: 0.56, damage: 3.2, options: 2 },
    { kind: 'homing', count: 4, interval: 0.50, damage: 3.4, options: 2 },
  ]),
});


/** 炸弹：清屏 + 短暂无敌 */
export const BOMB = Object.freeze({
  duration: 1.25,
  invuln: 2.0,
  damage: 60,
  radiusGrowth: 620,
  shake: 22,
});

/**
 * 爆发 / OVERDRIVE —— 本作的核心爽点循环。
 * 能量来自「击杀」与「擦弹」；满槽后主动释放，换来一段时间的火力与时间优势。
 * 设计约束：敌方时间放慢但玩家不变慢，这是「子弹时间」的全部乐趣所在；
 * 因此只缩放敌人、敌弹与 Boss，玩家射速反而提升。
 */
export const OVERDRIVE = Object.freeze({
  maxEnergy: 100,
  duration: 6.0,
  killEnergy: 4.5,
  bossHitEnergy: 0.25,
  grazeEnergy: 2.4,
  pickupEnergy: 7,
  /** 擦弹判定：敌弹边缘到自机判定点的额外距离 */
  grazeRadius: 26,
  grazeScore: 35,
  /** 敌方（敌机/敌弹/Boss）的时间缩放 */
  enemyTimeScale: 0.42,
  /** 玩家射击间隔乘数 */
  fireRateScale: 0.48,
  /** 玩家伤害乘数 */
  damageScale: 1.35,
  invuln: 1.0,
  shakeOnStart: 16,
});

/** 敌机原型。hp / speed 会被关卡难度系数缩放。 */
export const ENEMY_TYPES = Object.freeze({
  grunt: {
    hp: 4, speed: 118, score: 100, radius: 15, dropChance: 0.05,
    color: '#ff4d6d', accent: '#ffb3c1', fireInterval: 2.9,
  },
  diver: {
    hp: 3, speed: 168, score: 130, radius: 13, dropChance: 0.05,
    color: '#c77dff', accent: '#e5c7ff', fireInterval: 0,
  },
  drone: {
    hp: 2, speed: 250, score: 90, radius: 11, dropChance: 0.03,
    color: '#ffb347', accent: '#ffe0a3', fireInterval: 0,
  },
  sniper: {
    hp: 11, speed: 74, score: 260, radius: 16, dropChance: 0.16,
    color: '#4ff0b7', accent: '#bafff0', fireInterval: 1.9,
  },
  tank: {
    hp: 24, speed: 58, score: 420, radius: 22, dropChance: 0.3,
    color: '#ff8c42', accent: '#ffd7a8', fireInterval: 1.6,
  },
  elite: {
    hp: 46, speed: 52, score: 820, radius: 26, dropChance: 0.65,
    color: '#ff2d95', accent: '#ffb3da', fireInterval: 1.15,
  },
});

/** 敌方子弹 */
export const EBULLET = Object.freeze({
  speed: { slow: 150, normal: 215, fast: 305 },
  radius: { small: 4.5, medium: 6.5, large: 9 },
  colors: {
    aimed: '#ff5f7e',
    ring: '#ff9f43',
    spiral: '#c77dff',
    laser: '#5ff7ff',
  },
});

/** 道具 */
export const PICKUP = Object.freeze({
  speed: 92,
  magnetRadius: 118,
  magnetSpeed: 420,
  radius: 13,
  lifetime: 14,
  /** 掉落权重表：power 提升武器等级，weapon 切换武器流派，shield 无敌，bomb 补炸弹，life 加命 */
  weights: { power: 50, weapon: 14, shield: 18, bomb: 14, life: 4 },
});

/** Boss */
export const BOSS = Object.freeze({
  baseHp: 620,
  hpPerStage: 240,
  /** 两段血量占基础血量的比例：母舰段 / 核心段 */
  formHp: [0.62, 0.58],
  radius: 64,
  enterDuration: 2.6,
  score: 12000,
  /** 阶段阈值（血量百分比），击穿后切换攻击组 */
  phases: [0.62, 0.3],
});

/** 关卡循环 */
export const STAGE = Object.freeze({
  /** 每关波次脚本总时长（秒），结束后 Boss 登场 */
  waveDuration: 78,
  bossWarningDuration: 2.6,
  /** 击败 Boss 后的过关结算停留 */
  clearDelay: 3.4,
  /** 每关难度成长 */
  hpScale: 0.34,
  speedScale: 0.08,
  fireRateScale: 0.12,
});

/** 表现层：震屏 / 闪白 / 顿帧 */
export const FX = Object.freeze({
  shakeDecay: 5.2,
  flashDecay: 7.5,
  /** 命中敌人时的微小顿帧（秒） */
  hitStop: 0.022,
  killShake: 2.6,
  maxParticles: 900,
});

/** 计分 */
export const SCORING = Object.freeze({
  comboWindow: 2.2,
  comboStep: 8,
  maxMultiplier: 4,
  /** 每过一关的奖励分 */
  stageBonus: 3000,
});

export const STORAGE_KEY = 'thunder.hiscore.v1';
export const SETTINGS_KEY = 'thunder.settings.v1';
