/**
 * 程序化精灵库：所有机体、子弹、道具的视觉都在这里用路径绘制。
 * 不加载任何图片资源——保证离线可玩，也让配色与形态可以随时统一调整。
 *
 * 约定：所有 draw* 函数都在「已平移到实体中心」的坐标系中作画，
 * 机头朝向由调用方决定（玩家朝上，敌机与 Boss 朝下）。
 */
import { C, PICKUP_STYLE } from './palette.js';
import { clamp, lerp, TAU, withAlpha } from '../core/util.js';

// ── 对称路径工具 ───────────────────────────────────────────

/** 由右半侧控制点生成左右镜像闭合路径 */
function symPath(ctx, half) {
  ctx.beginPath();
  ctx.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) ctx.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 1; i >= 0; i--) ctx.lineTo(-half[i][0], half[i][1]);
  ctx.closePath();
}

// ── 光晕缓存 ───────────────────────────────────────────────

const glowCache = new Map();

/** 离屏光晕：中心色 → 透明，绘制时按逻辑半径缩放。分辨率 2× 保证高分屏清晰。 */
function getGlowSprite(color, radius) {
  const key = `${color}|${radius}`;
  let sprite = glowCache.get(key);
  if (sprite) return sprite;

  const px = Math.max(8, Math.ceil(radius * 4)); // 2 倍逻辑尺寸
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  grd.addColorStop(0, withAlpha(color, 1));
  grd.addColorStop(0.22, withAlpha(color, 0.75));
  grd.addColorStop(0.55, withAlpha(color, 0.22));
  grd.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, px, px);

  sprite = { cv, radius };
  glowCache.set(key, sprite);
  return sprite;
}

/** 叠加型光晕（自动使用 lighter 混合并恢复） */
export function glow(ctx, x, y, radius, color, alpha = 1) {
  if (alpha <= 0.01 || radius <= 0.5) return;
  const sprite = getGlowSprite(color, Math.round(radius / 4) * 4 || 4);
  const r = sprite.radius;
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.drawImage(sprite.cv, x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
}

// ── 子弹球体缓存 ───────────────────────────────────────────

const orbCache = new Map();

function getOrb(color, radius, coreColor = '#ffffff') {
  const key = `${color}|${radius}|${coreColor}`;
  let cv = orbCache.get(key);
  if (cv) return cv;

  const size = Math.max(12, Math.ceil(radius * 6)); // 3× 逻辑半径，2 倍超采样
  cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;

  const halo = g.createRadialGradient(c, c, radius * 0.4, c, c, c);
  halo.addColorStop(0, withAlpha(color, 0.85));
  halo.addColorStop(0.35, withAlpha(color, 0.35));
  halo.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  const body = g.createRadialGradient(c - radius * 0.35, c - radius * 0.35, radius * 0.12, c, c, radius * 1.05);
  body.addColorStop(0, coreColor);
  body.addColorStop(0.45, color);
  body.addColorStop(1, withAlpha(color, 0.15));
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, radius * 1.05, 0, TAU);
  g.fill();

  orbCache.set(key, cv);
  return cv;
}

export function drawOrb(ctx, x, y, radius, color, alpha = 1) {
  const cv = getOrb(color, Math.round(radius * 2) / 2);
  const r = cv.width / 6 * 1.05;
  ctx.globalAlpha = alpha;
  ctx.drawImage(cv, x - r * 3 * 0.5 - (cv.width / 2 - r * 1.5), y - (cv.height / 2 - r * 1.5));
  ctx.globalAlpha = 1;
}

// 上面 drawOrb 的定位略绕，这里给出精确版本并统一使用它
export function drawOrbAt(ctx, x, y, radius, color, alpha = 1, core = '#ffffff') {
  const cv = getOrb(color, Math.round(radius * 2) / 2, core);
  const drawSize = radius * 3;               // 画布覆盖 3× 半径
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(cv, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
  ctx.globalAlpha = prev;
}

// ── 玩家战机 ───────────────────────────────────────────────

const PLAYER_HULL = [
  [0, -25],
  [4.5, -12],
  [9.5, -7],
  [18, 6],
  [15.5, 13],
  [7.5, 10],
  [5, 17],
  [0, 14.5],
];

function playerHull(ctx) { symPath(ctx, PLAYER_HULL); }

/**
 * @param {object} o
 * @param {number} o.t 全局时间
 * @param {number} o.power 武器等级 1..6（影响机体发光强度）
 * @param {number} o.tilt 横向倾斜 -1..1
 * @param {boolean} o.focus 精准模式
 * @param {number} o.flash 受击白闪 0..1
 * @param {number} o.thrust 推力 0..1
 */
export function drawPlayer(ctx, o) {
  const { t, power = 1, tilt = 0, focus = false, flash = 0, thrust = 1 } = o;
  ctx.save();
  ctx.rotate(tilt * 0.14);
  if (focus) ctx.scale(0.9, 0.9);

  // ── 引擎尾焰（additive，先画在机体之后方）
  const flick = 0.78 + Math.sin(t * 46) * 0.1 + Math.sin(t * 17.3) * 0.07;
  const flame = (9 + thrust * 13) * flick;
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const fx = side * 6.4;
    const g = ctx.createLinearGradient(fx, 12, fx, 12 + flame + 12);
    g.addColorStop(0, 'rgba(200,252,255,0.95)');
    g.addColorStop(0.35, 'rgba(95,247,255,0.55)');
    g.addColorStop(1, 'rgba(30,123,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx - 3.1, 12);
    ctx.quadraticCurveTo(fx, 12 + flame * 2.0, fx + 3.1, 12);
    ctx.closePath();
    ctx.fill();
  }
  glow(ctx, 0, 16, 17 + flame * 0.4, C.playerGlow, 0.22);
  ctx.globalCompositeOperation = 'source-over';

  // ── 机翼（先画深色垫底，形成层次）
  ctx.fillStyle = 'rgba(20,44,92,0.9)';
  ctx.beginPath();
  ctx.moveTo(-19, 8); ctx.lineTo(0, -2); ctx.lineTo(19, 8);
  ctx.lineTo(15, 15); ctx.lineTo(-15, 15); ctx.closePath();
  ctx.fill();

  // ── 机体
  const body = ctx.createLinearGradient(0, -26, 0, 18);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.28, C.playerBody);
  body.addColorStop(0.68, C.playerBodyDeep);
  body.addColorStop(1, '#1a3f9e');
  playerHull(ctx);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(190,250,255,0.85)';
  ctx.stroke();

  // ── 机脊高光
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, 8);
  ctx.stroke();

  // ── 翼尖能量条
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(C.playerCore, 0.55 + power * 0.06);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-17, 6.5); ctx.lineTo(-10, -4);
  ctx.moveTo(17, 6.5); ctx.lineTo(10, -4);
  ctx.stroke();
  glow(ctx, -16, 7, 9, C.playerGlow, 0.55);
  glow(ctx, 16, 7, 9, C.playerGlow, 0.55);
  ctx.globalCompositeOperation = 'source-over';

  // ── 驾驶舱
  const cockpit = ctx.createLinearGradient(0, -12, 0, 2);
  cockpit.addColorStop(0, '#ffffff');
  cockpit.addColorStop(0.4, C.playerCore);
  cockpit.addColorStop(1, '#1f6dc4');
  ctx.beginPath();
  ctx.ellipse(0, -6.5, 3.4, 7.2, 0, 0, TAU);
  ctx.fillStyle = cockpit;
  ctx.fill();

  // ── 受击白闪
  if (flash > 0.01) {
    playerHull(ctx);
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.85})`;
    ctx.fill();
  }

  ctx.restore();
}

/** 僚机（Option）：旋转的能量环 + 核心 */
export function drawOption(ctx, t, phase) {
  ctx.save();
  ctx.rotate(t * 2.2 + phase);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(C.playerGlow, 0.75);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 3.4, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.4, 7, 0, 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  glow(ctx, 0, 0, 13, C.playerGlow, 0.7);
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

// ── 敌机 ───────────────────────────────────────────────────

const ENEMY_HULLS = {
  grunt: [[0, 15], [7, 6], [13, 0], [8, -9], [0, -13]],
  diver: [[0, 16], [10, 2], [7, -10], [0, -5]],
  drone: [[0, 11], [8, -6], [0, -9]],
  sniper: [[0, 17], [8, 6], [6, -10], [0, -14]],
  tank: [[0, 20], [14, 12], [20, -2], [13, -15], [0, -17]],
  elite: [[0, 24], [15, 17], [25, 0], [16, -17], [0, -22]],
};

const ENEMY_FILL = {
  grunt: ['#ff5470', '#a01033'],
  diver: ['#c77dff', '#5a1a8a'],
  drone: ['#ffb347', '#a35400'],
  sniper: ['#4ff0b7', '#0a6b4f'],
  tank: ['#ff8c42', '#8f3b00'],
  elite: ['#ff2d95', '#7a0a45'],
};

const ENEMY_GLOW = {
  grunt: C.hostileCore,
  diver: '#c77dff',
  drone: '#ffb347',
  sniper: '#4ff0b7',
  tank: '#ff8c42',
  elite: C.hostileElite,
};

/**
 * 绘制敌机。loc 已平移到敌机中心。
 * @param {object} o { t, flash, hpRatio, tilt }
 */
export function drawEnemy(ctx, type, o) {
  const { t = 0, flash = 0, hpRatio = 1 } = o;
  const hull = ENEMY_HULLS[type] || ENEMY_HULLS.grunt;
  const [fillTop, fillBottom] = ENEMY_FILL[type] || ENEMY_FILL.grunt;
  const glowColor = ENEMY_GLOW[type] || C.hostileCore;

  ctx.save();

  // 外发光
  const pulse = 0.35 + Math.sin(t * 6 + hull[1][1]) * 0.06;
  glow(ctx, 0, 2, 30, glowColor, pulse);

  // 旋翼/环（drone / elite 的额外细节）
  if (type === 'drone') {
    ctx.save();
    ctx.rotate(t * 7);
    ctx.strokeStyle = withAlpha(glowColor, 0.6);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(13, 0);
    ctx.stroke();
    ctx.restore();
  } else if (type === 'elite') {
    ctx.save();
    ctx.rotate(t * 1.6);
    ctx.strokeStyle = withAlpha(glowColor, 0.42);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 装甲本体
  const g = ctx.createLinearGradient(0, -18, 0, 20);
  g.addColorStop(0, fillTop);
  g.addColorStop(1, fillBottom);
  symPath(ctx, hull);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = withAlpha('#ffffff', 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 中央能量核
  const coreR = type === 'tank' || type === 'elite' ? 6.5 : 4.2;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, 0, coreR * 3.6, glowColor, 0.85);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, TAU);
  ctx.fillStyle = '#fff3f6';
  ctx.fill();

  // 侧翼细节：让不同机型一眼可辨
  if (type === 'tank') {
    ctx.strokeStyle = 'rgba(255,231,196,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-13, -8); ctx.lineTo(-13, 8);
    ctx.moveTo(13, -8); ctx.lineTo(13, 8);
    ctx.stroke();
  } else if (type === 'sniper') {
    ctx.strokeStyle = 'rgba(190,255,240,0.8)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(0, 8);
    ctx.stroke();
  } else if (type === 'grunt' || type === 'diver') {
    ctx.strokeStyle = withAlpha('#ffffff', 0.3);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-9, -2); ctx.lineTo(0, 5); ctx.lineTo(9, -2);
    ctx.stroke();
  }

  // 受损时内部裂纹
  if (hpRatio < 0.55) {
    ctx.strokeStyle = withAlpha('#000000', 0.5 * (1 - hpRatio));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, -8); ctx.lineTo(2, 1); ctx.lineTo(-2, 9);
    ctx.stroke();
  }

  if (flash > 0.01) {
    symPath(ctx, hull);
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.9})`;
    ctx.fill();
  }

  ctx.restore();
}

// ── Boss ───────────────────────────────────────────────────

const BOSS_HULL = [
  [0, 66],
  [26, 52],
  [52, 44],
  [78, 34],
  [96, 2],
  [88, -26],
  [60, -44],
  [30, -50],
  [12, -40],
  [0, -46],
];

const BOSS_WINGS = [
  [54, 30],
  [92, 8],
  [86, -22],
  [58, -34],
];

/**
 * @param {object} o { t, phase(0..2), flash, hpRatio }
 */
export function drawBoss(ctx, o) {
  const { t, phase = 0, flash = 0, hpRatio = 1 } = o;
  const pulse = 0.5 + Math.sin(t * 3.4) * 0.5;

  ctx.save();

  // 整体环境光
  glow(ctx, 0, 0, 150, C.bossCore, 0.16 + pulse * 0.06);

  // 底部推进器
  ctx.globalCompositeOperation = 'lighter';
  for (const x of [-58, -26, 26, 58]) {
    const len = 20 + Math.sin(t * 12 + x) * 6;
    const g = ctx.createLinearGradient(x, -40, x, -40 - len);
    g.addColorStop(0, 'rgba(255,60,142,0.6)');
    g.addColorStop(1, 'rgba(255,60,142,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 5, -40 - len, 10, len);
  }
  ctx.globalCompositeOperation = 'source-over';

  // 侧翼
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    symPath(ctx, BOSS_WINGS);
    const wg = ctx.createLinearGradient(0, -30, 0, 30);
    wg.addColorStop(0, '#7a4a66');
    wg.addColorStop(1, '#2a1024');
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,200,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 翼端炮口
    ctx.beginPath();
    ctx.arc(84, 4, 6, 0, TAU);
    ctx.fillStyle = phase >= 1 ? '#ff7ab8' : '#4a2536';
    ctx.fill();
    if (phase >= 1) glow(ctx, 84, 4, 20, C.bossCore, 0.55);
    ctx.restore();
  }

  // 主体装甲
  const body = ctx.createLinearGradient(0, -50, 0, 66);
  body.addColorStop(0, '#2b1228');
  body.addColorStop(0.45, C.bossArmor);
  body.addColorStop(1, '#241020');
  symPath(ctx, BOSS_HULL);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,150,200,0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 装甲板分缝
  ctx.strokeStyle = 'rgba(255,180,220,0.22)';
  ctx.lineWidth = 1;
  for (const y of [-30, -6, 20]) {
    ctx.beginPath();
    ctx.moveTo(-70, y);
    ctx.quadraticCurveTo(0, y + 12, 70, y);
    ctx.stroke();
  }

  // 中央核心：相位越高越炽热
  const coreR = 20 + phase * 3 + pulse * 2.5;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, 0, 6, coreR * 4.2, C.bossCore, 0.5 + pulse * 0.35);
  glow(ctx, 0, 6, coreR * 1.8, C.bossCoreHot, 0.7);
  ctx.globalCompositeOperation = 'source-over';

  const coreG = ctx.createRadialGradient(0, 2, 1, 0, 6, coreR);
  coreG.addColorStop(0, '#ffffff');
  coreG.addColorStop(0.4, C.bossCoreHot);
  coreG.addColorStop(1, C.bossCore);
  ctx.beginPath();
  ctx.arc(0, 6, coreR, 0, TAU);
  ctx.fillStyle = coreG;
  ctx.fill();

  // 核心周围旋转的能量环
  ctx.save();
  ctx.translate(0, 6);
  ctx.rotate(t * (0.8 + phase * 0.5));
  ctx.strokeStyle = withAlpha('#ffd9ec', 0.5);
  ctx.lineWidth = 1.6;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, coreR + 9, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 前部双联炮塔：让剪影一眼读作战舰而非盾牌
  for (const side of [-1, 1]) {
    const tx = side * 62, ty = 42;
    ctx.beginPath();
    ctx.arc(tx, ty, 10, 0, TAU);
    ctx.fillStyle = '#1d0c1a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,200,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = phase >= 2 ? '#ff8cc8' : '#4a2536';
    ctx.fillRect(tx - 3, ty + 4, 6, 15);
    if (phase >= 1) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, tx, ty + 16, 14, C.bossCore, 0.35 + phase * 0.12);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // 中央下颚结构
  ctx.strokeStyle = 'rgba(255,170,210,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-20, 30);
  ctx.lineTo(-8, 62);
  ctx.moveTo(20, 30);
  ctx.lineTo(8, 62);
  ctx.stroke();

  // 受损裂纹
  if (hpRatio < 0.66) {
    ctx.strokeStyle = `rgba(0,0,0,${0.35 + (1 - hpRatio) * 0.3})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-38, -34); ctx.lineTo(-18, -6); ctx.lineTo(-30, 22); ctx.lineTo(-12, 44);
    ctx.moveTo(40, -30); ctx.lineTo(24, 0); ctx.lineTo(38, 26);
    ctx.stroke();
  }
  if (hpRatio < 0.33) {
    ctx.strokeStyle = 'rgba(255,120,170,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-62, -16); ctx.lineTo(-34, 4); ctx.lineTo(-46, 34);
    ctx.moveTo(60, -20); ctx.lineTo(36, 8); ctx.lineTo(52, 36);
    ctx.stroke();
  }

  if (flash > 0.01) {
    symPath(ctx, BOSS_HULL);
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.75})`;
    ctx.fill();
  }

  ctx.restore();
}

// ── Boss 二形态：脱离后的核心 ───────────────────────────────

/**
 * 母舰被击破后核心脱离，变成这个更小、更快、更狂暴的形态。
 * 视觉语言从「厚重装甲」切换为「高能核心 + 环绕部件」——一眼就能看出阶段变了。
 */
export function drawBossCore(ctx, o) {
  const { t, flash = 0, hpRatio = 1 } = o;
  const pulse = 0.5 + Math.sin(t * 6) * 0.5;

  // 环境光
  glow(ctx, 0, 0, 132, C.bossCore, 0.22 + pulse * 0.12);

  // 三个环绕的刃片（带深度感：靠近观者时更亮更大）
  for (let i = 0; i < 3; i++) {
    const a = t * 1.7 + (i / 3) * TAU;
    const depth = (Math.sin(a) + 1) / 2;
    const ox = Math.cos(a) * 54;
    const oy = Math.sin(a) * 54 * 0.52;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(a + t * 1.2);
    const s = 0.75 + depth * 0.45;
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(7, -3);
    ctx.lineTo(0, 15);
    ctx.lineTo(-7, -3);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,120,190,${0.30 + depth * 0.45})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,245,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    glow(ctx, ox, oy, 18, C.bossCore, 0.28 + depth * 0.4);
  }

  // 核心本体
  const coreR = 31 + Math.sin(t * 4.2) * 2.2;
  const g = ctx.createRadialGradient(0, -coreR * 0.35, 2, 0, 0, coreR);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, C.bossCoreHot);
  g.addColorStop(1, C.bossCore);
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,235,248,0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 逆向旋转的能量环
  ctx.save();
  ctx.rotate(-t * 2.3);
  ctx.strokeStyle = 'rgba(255,220,245,0.55)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([11, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, coreR + 13, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 正面能量环
  ctx.save();
  ctx.rotate(t * 1.1);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, coreR + 20, (coreR + 20) * 0.3, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();

  // 血量越低，裂纹越明显
  if (hpRatio < 0.5) {
    ctx.strokeStyle = `rgba(0,0,0,${0.3 + (1 - hpRatio) * 0.35})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-14, -18); ctx.lineTo(-4, 2); ctx.lineTo(-12, 16);
    ctx.moveTo(16, -10); ctx.lineTo(6, 6); ctx.lineTo(14, 20);
    ctx.stroke();
  }

  if (flash > 0.01) {
    ctx.beginPath();
    ctx.arc(0, 0, coreR + 2, 0, TAU);
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.75})`;
    ctx.fill();
  }
}

// ── 道具 ───────────────────────────────────────────────────

export function drawPickup(ctx, kind, t) {
  const style = PICKUP_STYLE[kind] || PICKUP_STYLE.power;
  const bob = Math.sin(t * 4) * 1.4;
  const spin = t * 1.8;

  ctx.save();
  ctx.translate(0, bob);

  glow(ctx, 0, 0, 26, style.glow, 0.55 + Math.sin(t * 6) * 0.12);

  ctx.save();
  ctx.rotate(spin);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const x = Math.cos(a) * 11.5;
    const y = Math.sin(a) * 11.5;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = withAlpha(style.color, 0.18);
  ctx.fill();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  ctx.font = 'bold 13px "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#08111f';
  ctx.fillText(style.label, 0, 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(style.label, 0, 0);

  ctx.restore();
}

// ── 通用：爆炸闪光圈 ───────────────────────────────────────

export function drawShockwave(ctx, x, y, radius, alpha, color = '#ffffff') {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, 4 * alpha);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** 屏幕边缘的 Boss 警告条纹（绘制在游戏层顶部） */
export function drawBossWarningFrame(ctx, w, h, t, intensity) {
  const a = 0.16 + Math.sin(t * 9) * 0.08;
  ctx.save();
  ctx.globalAlpha = a * intensity;
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,45,149,0.9)');
  grd.addColorStop(0.3, 'rgba(255,45,149,0)');
  grd.addColorStop(0.7, 'rgba(255,45,149,0)');
  grd.addColorStop(1, 'rgba(255,45,149,0.9)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
