/**
 * 通用数学 / 随机 / 集合工具。
 * 纯函数，无副作用，不依赖任何其它模块。
 */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** 帧率无关的指数趋近：lambda 越大越快 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** 以固定步长逼近目标值 */
export function approach(value, target, step) {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return target;
}

export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

/** 圆 vs 圆 */
export function circlesHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by, r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

export const angleBetween = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** 目标向量的归一化速度分量 */
export function velocityToward(ax, ay, bx, by, speed) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * speed, y: (dy / len) * speed };
}

/** mulberry32 —— 可复现的轻量 PRNG，用于需要确定性的场景（特效种子等） */
export function createRng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** O(1) 删除：把末元素搬到被删位置 */
export function swapRemove(arr, index) {
  const last = arr.length - 1;
  if (index !== last) arr[index] = arr[last];
  arr.pop();
}

/**
 * 极简对象池：对象在 reset 时被复用，避免弹幕高峰期的 GC 抖动。
 * acquire() 返回一个已重置的实例，release 通过「外部 swapRemove + pool.push」完成。
 */
export function createPool(factory, reset, initial = 0) {
  const free = [];
  for (let i = 0; i < initial; i++) free.push(factory());
  return {
    acquire() {
      const obj = free.length ? free.pop() : factory();
      return obj;
    },
    release(obj) {
      reset(obj);
      free.push(obj);
    },
    get size() { return free.length; },
  };
}

/** 权重抽取：weights = { key: number } */
export function weightedPick(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let roll = Math.random() * total;
  for (const k in weights) {
    roll -= weights[k];
    if (roll <= 0) return k;
  }
  return Object.keys(weights)[0];
}

/** 千分位分数 */
export function formatScore(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 'rgba()' 构造：接受 '#rrggbb' 与 alpha */
export function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 颜色向白色插值（用于受击白闪） */
export function lighten(hex, t) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const m = (c) => Math.round(lerp(c, 255, t));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
