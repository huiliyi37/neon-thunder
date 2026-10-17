/**
 * 波次编排：一关 = 78 秒的编队时间轴 + 收尾 Boss。
 * 节奏设计（呼吸感比密度更重要）：
 *   0–15s  热身：单编队、慢速、给玩家熟悉武器
 *   15–30s 提速：俯冲与追踪混入
 *   30–45s 压力：悬停炮台 + 首个精英
 *   45–65s 高压：多方向夹击、无人机群
 *   65–78s 总攻：双精英 + 终局混合编队
 * 每个编队都通过 schedule() 错峰生成，避免「一堵墙」式同屏。
 */
import { STAGE, VIEW } from '../config.js';
import { rand, randInt, swapRemove } from '../core/util.js';

const FORMATIONS = {
  /** V 字编队：中央先入，两翼随后 */
  vFormation(s, { type = 'grunt', count = 5, gap = 0.11, cx = VIEW.w / 2, amp = 20 }) {
    for (let i = 0; i < count; i++) {
      const idx = i - (count - 1) / 2;
      const x = Math.max(36, Math.min(VIEW.w - 36, cx + idx * 52));
      const delay = Math.abs(idx) * gap * 2;
      s.schedule(delay, () => s.spawn(type, {
        x, y: -40 - Math.abs(idx) * 26, behavior: 'sine', amp,
      }));
    }
  },

  /** 从两侧鱼贯俯冲 */
  sideDive(s, { type = 'diver', count = 4 }) {
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      s.schedule(i * 0.24, () => s.spawn(type, {
        x: side < 0 ? -26 : VIEW.w + 26,
        y: rand(-40, 90),
        behavior: 'dive',
      }));
    }
  },

  /** 单列纵队横扫 */
  column(s, { type = 'grunt', count = 4, x = VIEW.w / 2, interval = 0.2, amp = 30 }) {
    for (let i = 0; i < count; i++) {
      s.schedule(i * interval, () => s.spawn(type, {
        x, y: -40, behavior: 'sine', amp, phase: i * 0.7,
      }));
    }
  },

  /** 无人机群：高速追踪 */
  droneRush(s, { count = 5 }) {
    for (let i = 0; i < count; i++) {
      s.schedule(i * 0.16, () => s.spawn('drone', {
        x: rand(50, VIEW.w - 50), y: -30, behavior: 'homing', vxCap: 260,
      }));
    }
  },

  /** 重装炮台：左右成对悬停 */
  hoverPair(s, { type = 'tank', count = 2 }) {
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? VIEW.w / 2 : 120 + (i * (VIEW.w - 240)) / Math.max(1, count - 1);
      s.schedule(i * 0.5, () => s.spawn(type, {
        x, y: -60, targetY: 132 + i * 34, behavior: 'hover', hold: 6.5,
      }));
    }
  },

  /** 狙击线：横排悬停点射 */
  hoverLine(s, { type = 'sniper', count = 3 }) {
    for (let i = 0; i < count; i++) {
      const x = 90 + (i * (VIEW.w - 180)) / Math.max(1, count - 1);
      s.schedule(i * 0.35, () => s.spawn(type, {
        x, y: -50, targetY: 112 + (i % 2) * 58, behavior: 'hover', hold: 7.5,
      }));
    }
  },

  /** 精英机 */
  elite(s, { count = 1, cx = VIEW.w / 2 }) {
    for (let i = 0; i < count; i++) {
      s.schedule(i * 1.1, () => {
        s.game.banner('WARNING', 'ELITE UNIT');
        s.spawn('elite', {
          x: cx + (i - (count - 1) / 2) * 150,
          y: -70,
          targetY: 118 + (i % 2) * 40,
          behavior: 'strafe',
          baseX: cx + (i - (count - 1) / 2) * 150,
        });
      });
    }
  },

  /** 混合编队：考验多目标处理 */
  mixed(s) {
    s.pending.push(
      { delay: 0, run: () => FORMATIONS.vFormation(s, { type: 'grunt', count: 5, cx: VIEW.w * 0.3 }) },
      { delay: 0.9, run: () => FORMATIONS.vFormation(s, { type: 'grunt', count: 5, cx: VIEW.w * 0.7 }) },
      { delay: 2.2, run: () => FORMATIONS.sideDive(s, { type: 'diver', count: 4 }) },
      { delay: 3.6, run: () => FORMATIONS.droneRush(s, { count: 4 }) },
    );
  },

  /** 终局总攻 */
  finale(s, { extra = 0 }) {
    s.pending.push(
      { delay: 0, run: () => FORMATIONS.hoverLine(s, { type: 'sniper', count: 2 + extra }) },
      { delay: 0.6, run: () => FORMATIONS.sideDive(s, { type: 'diver', count: 6 }) },
      { delay: 2.8, run: () => FORMATIONS.vFormation(s, { type: 'grunt', count: 7, cx: VIEW.w * 0.5 }) },
      { delay: 4.2, run: () => FORMATIONS.droneRush(s, { count: 6 }) },
      { delay: 5.6, run: () => FORMATIONS.hoverPair(s, { type: 'tank', count: 2 }) },
    );
  },
};

function buildScript(stage) {
  const extra = Math.min(3, stage - 1);
  return [
    { at: 1.2, fn: 'vFormation', args: { type: 'grunt', count: 5 } },
    { at: 4.8, fn: 'sideDive', args: { type: 'grunt', count: 4 } },
    { at: 8.4, fn: 'column', args: { type: 'grunt', count: 4, x: 118, amp: 34 } },
    { at: 11.2, fn: 'column', args: { type: 'grunt', count: 4, x: 362, amp: 34 } },
    { at: 15.2, fn: 'sideDive', args: { type: 'diver', count: 4 } },
    { at: 19.4, fn: 'droneRush', args: { count: 5 + extra } },
    { at: 23.6, fn: 'hoverPair', args: { type: 'tank', count: 2 } },
    { at: 29.0, fn: 'vFormation', args: { type: 'grunt', count: 7, amp: 26 } },
    { at: 33.4, fn: 'hoverLine', args: { type: 'sniper', count: 3 } },
    { at: 39.0, fn: 'elite', args: { count: 1 } },
    { at: 45.2, fn: 'sideDive', args: { type: 'diver', count: 6 } },
    { at: 49.8, fn: 'mixed', args: {} },
    { at: 56.4, fn: 'droneRush', args: { count: 7 + extra } },
    { at: 60.8, fn: 'hoverPair', args: { type: 'tank', count: 2 } },
    { at: 66.0, fn: 'elite', args: { count: 2 } },
    { at: 72.4, fn: 'finale', args: { extra } },
  ];
}

export class Spawner {
  constructor(game) {
    this.game = game;
    this.reset(1);
  }

  reset(stage) {
    this.stage = stage;
    this.time = 0;
    this.script = buildScript(stage);
    this.index = 0;
    this.pending = [];
    this.finished = false;
    this.difficulty = 1 + (stage - 1) * STAGE.hpScale;
    this.dropScale = 1 - Math.min(0.35, (stage - 1) * 0.1);
  }

  /** 延迟执行一个生成动作 */
  schedule(delay, fn) {
    this.pending.push({ delay, run: fn });
  }

  spawn(type, cfg = {}) {
    this.game.spawnEnemy(type, {
      ...cfg,
      difficulty: this.difficulty,
      dropScale: this.dropScale,
    });
  }

  update(dt) {
    this.time += dt;

    while (this.index < this.script.length && this.script[this.index].at <= this.time) {
      const entry = this.script[this.index++];
      const formation = FORMATIONS[entry.fn];
      if (formation) formation(this, entry.args || {});
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        swapRemove(this.pending, i);
        p.run();
      }
    }

    if (this.index >= this.script.length && this.pending.length === 0) this.finished = true;
  }

  /** 进度 0..1，用于 HUD 的关卡进度条 */
  get progress() {
    const total = STAGE.waveDuration;
    return Math.min(1, this.time / total);
  }
}
