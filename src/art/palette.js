/**
 * 调色板 —— 全部视觉颜色的唯一来源。
 * 冷色（青/蓝）属于玩家与友方能量，暖色（红/橙）属于敌方火力，
 * 洋红用于警告与 Boss，金色只留给奖励。这套语义在所有绘制代码中保持一致。
 */
export const C = {
  // 玩家侧
  playerBody: '#dff6ff',
  playerBodyDeep: '#5aa9ff',
  playerCore: '#9ffcff',
  playerGlow: '#5ff7ff',
  playerEngine: '#7fe6ff',
  laser: '#8ffcff',

  // 敌方
  hostileCore: '#ff4d6d',
  hostileWarm: '#ff8c42',
  hostileElite: '#ff2d95',
  hostileShot: '#ff5f7e',
  bossShell: '#3a1f3d',
  bossArmor: '#8a4b6b',
  bossCore: '#ff2d95',
  bossCoreHot: '#ffd9ec',

  // 中性 / 环境
  starFar: '#4a6fa5',
  starMid: '#9fc7ff',
  starNear: '#ffffff',
  nebulaA: '#1b3a6b',
  nebulaB: '#5a1a4a',
  nebulaC: '#0b6b6b',

  // UI
  ui: '#eafcff',
  uiDim: 'rgba(234,252,255,0.45)',
  uiCyan: '#5ff7ff',
  uiGold: '#ffd166',
  uiMagenta: '#ff3c8e',
  uiLine: 'rgba(95,247,255,0.22)',

  white: '#ffffff',
  black: '#000000',
};

/** 道具配色 */
export const PICKUP_STYLE = {
  power: { color: '#ffd166', label: 'P', glow: '#ffb703' },
  weapon: { color: '#b388ff', label: 'W', glow: '#8a5cff' },
  shield: { color: '#5ff7ff', label: 'S', glow: '#1e7bff' },
  bomb: { color: '#ff9f43', label: 'B', glow: '#ff5f1f' },
  life: { color: '#ff6fb5', label: '1', glow: '#ff2d95' },
};
