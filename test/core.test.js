/**
 * 核心不变量测试（零依赖，node --test）。
 * 覆盖范围刻意选在「纯数据 + 纯函数」：不碰 Canvas / DOM，任何回归都能秒级定位。
 * 这些断言守住的是策划表结构的一致性——加武器、加道具、调 Boss 血量时最容易漏的地方。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOSS, ENEMY_TYPES, OVERDRIVE, PICKUP, PLAYER, WEAPON_META, WEAPON_SPECS, WEAPON_TYPES,
} from '../src/config.js';
import { PICKUP_STYLE } from '../src/art/palette.js';
import {
  clamp, circlesHit, damp, formatScore, lerp, velocityToward, weightedPick, withAlpha,
} from '../src/core/util.js';

// ── 武器表 ─────────────────────────────────────────────────

test('四种武器流派都存在，且等级数与 PLAYER.maxPower 一致', () => {
  assert.equal(WEAPON_TYPES.length, 4);
  for (const kind of WEAPON_TYPES) {
    const table = WEAPON_SPECS[kind];
    assert.ok(Array.isArray(table), `缺少武器表: ${kind}`);
    assert.equal(table.length, PLAYER.maxPower, `${kind} 的等级数应等于 maxPower`);
  }
});

test('每种武器每一级的参数完整且为正数', () => {
  for (const kind of WEAPON_TYPES) {
    WEAPON_SPECS[kind].forEach((spec, i) => {
      const tag = `${kind} Lv${i + 1}`;
      if (kind === 'laser') {
        assert.ok(spec.width > 0, `${tag}: width`);
        assert.ok(spec.tickDamage > 0, `${tag}: tickDamage`);
        assert.ok(spec.tickInterval > 0, `${tag}: tickInterval`);
      } else if (kind === 'homing') {
        assert.ok(spec.count >= 1, `${tag}: count`);
        assert.ok(spec.interval > 0, `${tag}: interval`);
        assert.ok(spec.damage > 0, `${tag}: damage`);
      } else {
        assert.ok(spec.count >= 1, `${tag}: count`);
        assert.ok(spec.spread >= 0, `${tag}: spread`);
        assert.ok(spec.angle >= 0, `${tag}: angle`);
        assert.ok(spec.interval > 0, `${tag}: interval`);
        assert.ok(spec.damage > 0, `${tag}: damage`);
      }
    });
  }
});

test('武器升级必须变强：总 DPS 随等级单调不降', () => {
  // 单发伤害可以不涨（例如追踪弹升到 Lv3 是「弹数翻倍、单发略降」），
  // 真正要守的不变量是总输出不倒退——这是升级曲线的手感底线。
  const dps = (kind, s) => (kind === 'laser'
    ? s.tickDamage / s.tickInterval
    : (s.count * s.damage) / s.interval);

  for (const kind of WEAPON_TYPES) {
    const table = WEAPON_SPECS[kind];
    for (let i = 1; i < table.length; i++) {
      const cur = dps(kind, table[i]);
      const prev = dps(kind, table[i - 1]);
      assert.ok(cur >= prev - 1e-9, `${kind} Lv${i + 1} 的 DPS(${cur.toFixed(1)}) 低于 Lv${i}(${prev.toFixed(1)})`);
    }
  }
});

test('每种武器都有展示用元数据（名称与颜色）', () => {
  for (const kind of WEAPON_TYPES) {
    const meta = WEAPON_META[kind];
    assert.ok(meta && typeof meta.label === 'string' && meta.label.length > 0, `缺少元数据: ${kind}`);
    assert.match(meta.color, /^#[0-9a-f]{6}$/i, `${kind} 的颜色必须是 #rrggbb`);
  }
});

// ── 道具 ───────────────────────────────────────────────────

test('每个掉落权重都对应一种可绘制的道具样式', () => {
  for (const kind of Object.keys(PICKUP.weights)) {
    assert.ok(PICKUP_STYLE[kind], `缺少道具样式: ${kind}`);
    assert.ok(PICKUP.weights[kind] > 0, `掉落权重必须为正: ${kind}`);
  }
});

test('道具权重总和为 100，便于按百分比理解', () => {
  const total = Object.values(PICKUP.weights).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
});

// ── Boss / 敌机 / 爆发 ─────────────────────────────────────

test('Boss 两段血量比例合法，且二形态不至于无限拖长', () => {
  assert.equal(BOSS.formHp.length, 2, 'Boss 必须有母舰段与核心段两个血量比例');
  for (const r of BOSS.formHp) assert.ok(r > 0 && r < 1, `血量比例越界: ${r}`);
  assert.ok(BOSS.formHp[0] + BOSS.formHp[1] < 1.6, '两段总和过大，Boss 战会过长');
});

test('Boss 阶段阈值严格递减', () => {
  const [a, b] = BOSS.phases;
  assert.ok(a > b && b > 0 && a < 1, '阶段阈值必须递减且落在 (0,1)');
});

test('所有敌机原型字段完整', () => {
  for (const [name, proto] of Object.entries(ENEMY_TYPES)) {
    assert.ok(proto.hp > 0, `${name}: hp`);
    assert.ok(proto.speed > 0, `${name}: speed`);
    assert.ok(proto.radius > 0, `${name}: radius`);
    assert.ok(proto.score > 0, `${name}: score`);
    assert.ok(proto.dropChance >= 0 && proto.dropChance <= 1, `${name}: dropChance`);
    assert.ok(proto.fireInterval >= 0, `${name}: fireInterval`);
  }
});

test('爆发的时间缩放确实让敌人变慢而玩家变快', () => {
  assert.ok(OVERDRIVE.enemyTimeScale > 0 && OVERDRIVE.enemyTimeScale < 1, '敌方时间应被放慢');
  assert.ok(OVERDRIVE.fireRateScale > 0 && OVERDRIVE.fireRateScale < 1, '玩家射击间隔应缩短');
  assert.ok(OVERDRIVE.damageScale > 1, '爆发应提升伤害');
  assert.ok(OVERDRIVE.grazeRadius > 0, '擦弹判定半径必须为正');
  assert.ok(OVERDRIVE.duration > 0);
});

// ── 数学工具 ───────────────────────────────────────────────

test('clamp 在区间内保持原值、越界被夹紧', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('lerp / damp 端点正确且单调趋近', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  let v = 0;
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    v = damp(v, 10, 6, 1 / 60);
    assert.ok(v > prev, 'damp 必须单调上升');
    assert.ok(v <= 10, 'damp 不得越过目标');
    prev = v;
  }
  assert.ok(v > 9, 'damp 应最终收敛到目标附近');
});

test('formatScore 输出千分位', () => {
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(999), '999');
  assert.equal(formatScore(1234567), '1,234,567');
});

test('withAlpha 生成合法 rgba', () => {
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.equal(withAlpha('#00ff00', 0), 'rgba(0,255,0,0)');
});

test('circlesHit：相交为真、相切为真、相离为假', () => {
  assert.equal(circlesHit(0, 0, 5, 8, 0, 5), true);
  assert.equal(circlesHit(0, 0, 5, 10, 0, 5), true);
  assert.equal(circlesHit(0, 0, 5, 10.01, 0, 5), false);
});

test('velocityToward 输出指定速度且指向目标', () => {
  const v = velocityToward(0, 0, 0, 10, 100);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - 100) < 1e-9);
  const d = Math.hypot(v.x, v.y);
  assert.ok(Math.abs(d - 100) < 1e-6);
});

test('weightedPick 只返回权重表内的键', () => {
  const weights = { a: 1, b: 0, c: 9 };
  for (let i = 0; i < 200; i++) {
    const k = weightedPick(weights);
    assert.ok(k === 'a' || k === 'c', `weightedPick 返回了非法键: ${k}`);
  }
  assert.equal(weightedPick({ only: 1 }), 'only');
});
