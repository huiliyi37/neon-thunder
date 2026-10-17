/**
 * 入口：DOM 接线 + 主循环。
 * 循环采用「子步长切分」而非累加器：任何刷新率下每帧都推进、且单步不超过 1/60 秒，
 * 高刷屏不会出现画面重复帧，低端机也不会一次跳太多。
 */
import { Game, STATE } from './game.js';
import { Input } from './core/input.js';
import { STORAGE_KEY } from './config.js';

const MAX_STEP = 1 / 60;
const MAX_DT = 0.05;

const canvas = document.getElementById('game');
const ui = {
  menu: document.getElementById('menu'),
  pause: document.getElementById('pause'),
  over: document.getElementById('over'),
  sound: document.getElementById('btn-sound'),
  menuHiscore: document.getElementById('menu-hiscore'),
  overScore: document.getElementById('over-score'),
  overKills: document.getElementById('over-kills'),
  overCombo: document.getElementById('over-combo'),
  overStage: document.getElementById('over-stage'),
  overRecord: document.getElementById('over-record'),
  overTitle: document.getElementById('over-title'),
};

const show = (el, visible) => el.classList.toggle('hidden', !visible);

const game = new Game(canvas, {
  onGameOver: (stats) => {
    show(ui.over, true);
    show(ui.pause, false);
    ui.overTitle.textContent = 'MISSION FAILED';
    ui.overScore.textContent = stats.score.toLocaleString('en-US');
    ui.overKills.textContent = String(stats.kills);
    ui.overCombo.textContent = String(stats.bestCombo);
    ui.overStage.textContent = String(stats.stage);
    show(ui.overRecord, stats.newRecord);
    ui.menuHiscore.textContent = game.hiscore.toLocaleString('en-US');
  },
});

const input = new Input(window, canvas);
input.onFirstGesture = () => game.audio.init();

// ── DOM 接线 ────────────────────────────────────────────────

function refreshHiscore() {
  ui.menuHiscore.textContent = game.hiscore.toLocaleString('en-US');
}

function startGame() {
  show(ui.menu, false);
  show(ui.over, false);
  show(ui.pause, false);
  game.audio.init();
  game.start();
}

function goHome() {
  game.toMenu();
  show(ui.over, false);
  show(ui.pause, false);
  show(ui.menu, true);
  refreshHiscore();
}

function togglePause() {
  const paused = game.togglePause();
  if (paused === null) return;
  show(ui.pause, paused);
  if (!paused) input.takePointerDelta(); // 丢弃暂停期间累积的拖动
}

function updateSoundLabel() {
  ui.sound.textContent = game.audio.muted ? '音效 · 关' : '音效 · 开';
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-quit').addEventListener('click', goHome);
document.getElementById('btn-home').addEventListener('click', goHome);
ui.sound.addEventListener('click', () => {
  game.audio.init();
  game.audio.toggleMute();
  updateSoundLabel();
});

// 切走标签页自动暂停，回来不会被弹幕打成筛子
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) {
    game.togglePause();
    show(ui.pause, true);
  }
});

// ── 主循环 ──────────────────────────────────────────────────

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, MAX_DT);
  last = now;

  // 全局按键（任何状态都响应）
  if (input.consume('mute')) {
    game.audio.init();
    game.audio.toggleMute();
    updateSoundLabel();
  }
  if (input.consume('pause')) {
    if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) togglePause();
  }
  if (input.consume('confirm')) {
    if (game.state === STATE.MENU || game.state === STATE.OVER) startGame();
  }
  if (input.consume('retry') && game.state === STATE.OVER) startGame();

  if (game.state === STATE.PLAYING && input.consume('bomb')) {
    game.useBomb();
  }

  // 子步长推进
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
  const sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    game.update(sub, input);
    if (game.state !== STATE.PLAYING) break;
  }

  game.draw();
  input.endFrame();
  requestAnimationFrame(frame);
}

refreshHiscore();
game.audio.setMuted(false);
requestAnimationFrame(frame);

// 自动化测试/调试入口（不影响正常游玩）
window.__LT = { game, input, STATE, get hiscore() { return Number(localStorage.getItem(STORAGE_KEY)) || 0; } };
