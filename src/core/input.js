/**
 * 输入层：键盘 + 指针/触摸。
 * 对外暴露的是「意图」而不是原始事件：axes / focus / 边沿触发的动作。
 * 边沿动作必须在每帧末尾通过 endFrame() 清空，避免重复消费。
 */
import { VIEW } from '../config.js';

const KEY_ACTIONS = {  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'focus', ShiftRight: 'focus',
  Space: 'bomb', KeyX: 'bomb', KeyJ: 'bomb',
  KeyE: 'overdrive', KeyK: 'overdrive',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  Enter: 'confirm', NumpadEnter: 'confirm',
  KeyR: 'retry',
};

export class Input {
  constructor(target = window, canvas = null) {
    this.held = new Set();
    this.pressed = new Set();
    this.wasHeld = new Set();

    this.pointerActive = false;
    this.pointerDelta = { x: 0, y: 0 };
    this.pointerDown = false;
    this.tapTimes = [];
    this.onFirstGesture = null;
    this._gestureFired = false;

    this._bindKeyboard(target);
    if (canvas) this._bindPointer(canvas);

    this._onBlur = () => this.held.clear();
    window.addEventListener('blur', this._onBlur);
  }

  _fireGesture() {
    if (this._gestureFired || !this.onFirstGesture) return;
    this._gestureFired = true;
    this.onFirstGesture();
  }

  _bindKeyboard(target) {
    target.addEventListener('keydown', (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      // 阻止空格/方向键滚动页面
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this._fireGesture();
      if (e.repeat) return;
      this.held.add(action);
      this.pressed.add(action);
    });

    target.addEventListener('keyup', (e) => {
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      this.held.delete(action);
    });
  }

  _bindPointer(canvas) {
    const rectScale = () => {
      const r = canvas.getBoundingClientRect();
      return { r, sx: canvas.width / r.width, sy: canvas.height / r.height };
    };

    let lastX = 0, lastY = 0;
    let pressAt = 0;
    let pressMoved = 0;

    canvas.addEventListener('pointerdown', (e) => {
      this._fireGesture();
      canvas.setPointerCapture?.(e.pointerId);
      this.pointerDown = true;
      this.pointerActive = true;
      const { r } = rectScale();
      lastX = e.clientX - r.left;
      lastY = e.clientY - r.top;
      pressAt = performance.now();
      pressMoved = 0;

      // 双击（400ms 内）→ 炸弹
      const now = performance.now();
      this.tapTimes = this.tapTimes.filter((t) => now - t < 400);
      this.tapTimes.push(now);
      if (this.tapTimes.length >= 2) {
        this.tapTimes.length = 0;
        this.pressed.add('bomb');
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerActive) return;
      const { r } = rectScale();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.pointerDelta.x += ((x - lastX) / r.width) * VIEW.w;
      this.pointerDelta.y += ((y - lastY) / r.height) * VIEW.h;
      pressMoved += Math.abs(x - lastX) + Math.abs(y - lastY);
      lastX = x;
      lastY = y;
    });

    const release = (e) => {
      if (e && e.pointerId !== undefined) canvas.releasePointerCapture?.(e.pointerId);
      // 长按（>380ms 且几乎没移动）→ 爆发；避免与拖动移动、双击炸弹冲突
      if (this.pointerDown && pressAt && performance.now() - pressAt > 380 && pressMoved < 14) {
        this.pressed.add('overdrive');
      }
      this.pointerDown = false;
      pressAt = 0;
      // 保留 pointerActive 一小段以免手指抬起瞬间产生跳变；由 endFrame 统一复位
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { this.pointerDown = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 归一化方向轴，对角不加速 */
  get axes() {
    let x = 0, y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  get focus() { return this.held.has('focus'); }

  /** 边沿动作：同一帧内只会返回一次 true */
  consume(action) {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** 触控位移（已在逻辑像素空间），消费后清零 */
  takePointerDelta() {
    const d = { x: this.pointerDelta.x, y: this.pointerDelta.y };
    this.pointerDelta.x = 0;
    this.pointerDelta.y = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    if (!this.pointerDown) this.pointerActive = false;
  }

  destroy() {
    window.removeEventListener('blur', this._onBlur);
  }
}
