/**
 * 背景：三层视差星空 + 预渲染星云 + 偶尔掠过的行星与流星。
 * 全部走低频、低亮度，任何高对比元素都留给弹幕——可读性优先于华丽。
 */
import { VIEW } from '../config.js';
import { C } from './palette.js';
import { rand, randInt, TAU } from '../core/util.js';

const STAR_LAYERS = [
  { count: 78, speed: 18, size: [0.6, 1.1], alpha: [0.18, 0.42], color: C.starFar, tail: 0 },
  { count: 46, speed: 46, size: [1.0, 1.7], alpha: [0.3, 0.65], color: C.starMid, tail: 1.6 },
  { count: 20, speed: 96, size: [1.5, 2.5], alpha: [0.5, 0.95], color: C.starNear, tail: 5 },
];

function makeNebulaCanvas(seedColors) {
  const size = 384;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = rand(size * 0.15, size * 0.85);
    const y = rand(size * 0.15, size * 0.85);
    const r = rand(size * 0.12, size * 0.42);
    const color = seedColors[randInt(0, seedColors.length - 1)];
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color.replace('ALPHA', rand(0.05, 0.13).toFixed(3)));
    grd.addColorStop(1, color.replace('ALPHA', '0'));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return cv;
}

function makePlanetCanvas() {
  const size = 260;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  const cx = size / 2, cy = size / 2, r = 74;

  // 环（后半）
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.34);
  g.strokeStyle = 'rgba(160,190,255,0.16)';
  g.lineWidth = 12;
  g.beginPath();
  g.ellipse(0, 0, r * 1.62, r * 0.44, 0, Math.PI, TAU);
  g.stroke();
  g.restore();

  // 球体
  const sphere = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  sphere.addColorStop(0, 'rgba(120,160,230,0.55)');
  sphere.addColorStop(0.55, 'rgba(52,78,140,0.5)');
  sphere.addColorStop(1, 'rgba(8,14,34,0.35)');
  g.fillStyle = sphere;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();

  // 大气边缘
  g.strokeStyle = 'rgba(140,200,255,0.22)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.stroke();

  // 环（前半）
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.34);
  g.strokeStyle = 'rgba(190,215,255,0.22)';
  g.lineWidth = 12;
  g.beginPath();
  g.ellipse(0, 0, r * 1.62, r * 0.44, 0, 0, Math.PI);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, r * 1.32, r * 0.36, 0, 0, TAU);
  g.stroke();
  g.restore();

  return cv;
}

export class Background {
  constructor() {
    this.time = 0;
    this.speed = 1;

    this.stars = [];
    for (const layer of STAR_LAYERS) {
      for (let i = 0; i < layer.count; i++) {
        this.stars.push({
          x: rand(0, VIEW.w),
          y: rand(0, VIEW.h),
          speed: layer.speed,
          size: rand(layer.size[0], layer.size[1]),
          alpha: rand(layer.alpha[0], layer.alpha[1]),
          color: layer.color,
          tail: layer.tail,
          twinkle: rand(0, TAU),
        });
      }
    }

    this.nebulae = [
      { cv: makeNebulaCanvas(['rgba(28,70,140,ALPHA)', 'rgba(30,110,170,ALPHA)']), x: 90, y: -80, w: 560, h: 620, drift: 2.4, phase: 0 },
      { cv: makeNebulaCanvas(['rgba(110,26,90,ALPHA)', 'rgba(70,20,120,ALPHA)']), x: 300, y: 420, w: 520, h: 540, drift: 3.6, phase: 2.1 },
      { cv: makeNebulaCanvas(['rgba(14,90,92,ALPHA)', 'rgba(20,60,120,ALPHA)']), x: 180, y: 900, w: 620, h: 620, drift: 1.8, phase: 4.4 },
    ];

    this.planet = { cv: makePlanetCanvas(), x: VIEW.w * 0.74, y: -240, speed: 5.2 };
    this.meteors = [];
    this.meteorTimer = rand(3, 7);
  }

  reset() {
    this.time = 0;
    this.meteors.length = 0;
    this.planet.y = -240;
  }

  update(dt, speed = 1) {
    this.time += dt;
    this.speed = speed;

    for (const s of this.stars) {
      s.y += s.speed * speed * dt;
      s.twinkle += dt * 2.4;
      if (s.y > VIEW.h + 12) {
        s.y = -12;
        s.x = rand(0, VIEW.w);
      }
    }

    for (const n of this.nebulae) {
      n.y += n.drift * speed * dt;
      if (n.y > VIEW.h + n.h * 0.6) n.y = -n.h * 0.9;
    }

    this.planet.y += this.planet.speed * speed * dt;
    if (this.planet.y > VIEW.h + 260) {
      this.planet.y = -260;
      this.planet.x = rand(VIEW.w * 0.2, VIEW.w * 0.8);
    }

    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0) {
      this.meteorTimer = rand(4, 9);
      const fromLeft = Math.random() < 0.5;
      this.meteors.push({
        x: fromLeft ? -30 : VIEW.w + 30,
        y: rand(0, VIEW.h * 0.7),
        vx: (fromLeft ? 1 : -1) * rand(160, 260),
        vy: rand(120, 210),
        life: rand(0.7, 1.2),
        age: 0,
        len: rand(30, 70),
      });
    }

    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age > m.life) this.meteors.splice(i, 1);
    }
  }

  draw(ctx) {
    // 星云
    for (const n of this.nebulae) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(n.cv, n.x + Math.sin(this.time * 0.12 + n.phase) * 12, n.y, n.w, n.h);
    }
    ctx.globalAlpha = 1;

    // 行星
    ctx.drawImage(this.planet.cv, this.planet.x - 130, this.planet.y - 130, 260, 260);

    // 星空
    for (const s of this.stars) {
      const tw = 0.75 + Math.sin(s.twinkle) * 0.25;
      ctx.globalAlpha = s.alpha * tw;
      ctx.fillStyle = s.color;
      if (s.tail > 0) {
        ctx.fillRect(s.x - s.size / 2, s.y - s.tail * this.speed, s.size, s.size + s.tail * this.speed);
      } else {
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    }
    ctx.globalAlpha = 1;

    // 流星
    for (const m of this.meteors) {
      const fade = Math.sin((m.age / m.life) * Math.PI);
      const nx = m.x - m.vx * 0.12;
      const ny = m.y - m.vy * 0.12;
      const grd = ctx.createLinearGradient(m.x, m.y, nx - m.vx * 0.0008 * m.len * 40, ny - m.vy * 0.0008 * m.len * 40);
      grd.addColorStop(0, `rgba(200,240,255,${0.7 * fade})`);
      grd.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(nx - m.vx * 0.12, ny - m.vy * 0.12);
      ctx.stroke();
    }
  }
}
