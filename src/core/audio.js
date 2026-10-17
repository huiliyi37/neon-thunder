/**
 * 音频引擎：全部音色由 WebAudio 实时合成，不依赖任何音频资源文件。
 * 分两条通道：sfx（音效）与 music（程序化芯片音乐）。
 * 浏览器要求用户手势后才能出声——由 Input.onFirstGesture 触发 init()。
 */

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = {
  normal: [
    { root: 45, triad: [57, 60, 64] }, // Am
    { root: 41, triad: [53, 57, 60] }, // F
    { root: 48, triad: [60, 64, 67] }, // C
    { root: 43, triad: [55, 59, 62] }, // G
  ],
  boss: [
    { root: 45, triad: [57, 60, 64] }, // Am
    { root: 45, triad: [57, 60, 64] },
    { root: 41, triad: [53, 57, 60] }, // F
    { root: 41, triad: [53, 57, 60] },
    { root: 38, triad: [50, 53, 57] }, // Dm
    { root: 38, triad: [50, 53, 57] },
    { root: 40, triad: [52, 56, 59] }, // E
    { root: 40, triad: [52, 56, 59] },
  ],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVolume = 0.9;

    this.musicStep = 0;
    this.nextNoteTime = 0;
    this.bpm = 132;
    this.intensity = 0;         // 0 = 常规，1 = Boss
    this.musicTimer = null;
    this._lastSfx = Object.create(null);
    this._noise = null;
    this._laserNodes = null;
  }

  /** 必须在用户手势内调用 */
  init() {
    if (this.ready) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    const ctx = this.ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.34;

    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this._noise = this._makeNoiseBuffer(1.6);
    this.ready = true;
    this.startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : this.masterVolume, t, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  /** 关卡推进时提升 BPM，制造紧迫感 */
  setStage(stage) {
    this.bpm = Math.min(132 + (stage - 1) * 7, 172);
  }

  // ── 合成原语 ────────────────────────────────────────────

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(gainNode, time, peak, attack, decay, sustain = 0.0001) {
    const g = gainNode.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(peak, time + attack);
    g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), time + attack + decay);
  }

  _tone({ freq, to, type = 'square', time, attack = 0.005, decay = 0.12, peak = 0.1, dest, detune = 0, filter = null }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, time);
    if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), time + attack + decay);

    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.from ?? 2000, time);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(filter.to, 30), time + attack + decay);
      f.Q.value = filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(dest || this.sfxBus);

    this._env(gain, time, peak, attack, decay);
    osc.start(time);
    osc.stop(time + attack + decay + 0.05);
  }

  _noiseBurst({ time, dur = 0.25, peak = 0.22, filter = 'lowpass', from = 4000, to = 200, q = 1, dest }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = 1;

    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(from, time);
    f.frequency.exponentialRampToValueAtTime(Math.max(to, 30), time + dur);
    f.Q.value = q;

    const gain = ctx.createGain();
    this._env(gain, time, peak, 0.004, dur);

    src.connect(f); f.connect(gain); gain.connect(dest || this.sfxBus);
    src.start(time);
    src.stop(time + dur + 0.05);
  }

  /** 简单节流：同一音效在极短时间内不重复触发 */
  _throttled(key, ms) {
    const now = performance.now();
    const last = this._lastSfx[key] || 0;
    if (now - last < ms) return true;
    this._lastSfx[key] = now;
    return false;
  }

  // ── 音效清单 ────────────────────────────────────────────

  shoot(level = 1) {
    if (!this.ready || this._throttled('shoot', 55)) return;
    const t = this.ctx.currentTime;
    const base = 780 + level * 34;
    this._tone({ freq: base, to: base * 0.42, type: 'square', time: t, decay: 0.055, peak: 0.032 });
    this._tone({ freq: base * 2, to: base * 0.9, type: 'triangle', time: t, decay: 0.04, peak: 0.014 });
  }

  optionShot() {
    if (!this.ready || this._throttled('opt', 80)) return;
    const t = this.ctx.currentTime;
    this._tone({ freq: 1180, to: 700, type: 'triangle', time: t, decay: 0.045, peak: 0.018 });
  }

  enemyHit() {
    if (!this.ready || this._throttled('ehit', 40)) return;
    const t = this.ctx.currentTime;
    this._noiseBurst({ time: t, dur: 0.05, peak: 0.05, filter: 'highpass', from: 2400, to: 1200 });
  }

  /** 敌机开火：极轻的高频「咔」，只用于提示威胁已出现 */
  enemyShot() {
    if (!this.ready || this._throttled('eshot', 90)) return;
    const t = this.ctx.currentTime;
    this._tone({ freq: 420, to: 260, type: 'square', time: t, decay: 0.06, peak: 0.022 });
  }

  enemyExplode(big = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const dur = big ? 0.62 : 0.3;
    this._noiseBurst({ time: t, dur, peak: big ? 0.3 : 0.16, from: big ? 2600 : 3200, to: 90, q: 0.7 });
    this._tone({ freq: big ? 130 : 190, to: 34, type: 'sine', time: t, decay: dur * 0.9, peak: big ? 0.24 : 0.1 });
    if (big) {
      this._tone({ freq: 62, to: 28, type: 'sawtooth', time: t, decay: 0.7, peak: 0.12, filter: { type: 'lowpass', from: 900, to: 80 } });
    }
  }

  playerHit() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseBurst({ time: t, dur: 0.7, peak: 0.34, from: 1800, to: 60, q: 0.6 });
    this._tone({ freq: 220, to: 30, type: 'sawtooth', time: t, decay: 0.6, peak: 0.24, filter: { type: 'lowpass', from: 1400, to: 90 } });
    this._tone({ freq: 74, to: 26, type: 'sine', time: t, decay: 0.8, peak: 0.18 });
  }

  pickup(kind) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const seq = kind === 'life' ? [660, 880, 1100, 1320] : kind === 'power' ? [720, 960, 1200] : [520, 780];
    seq.forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', time: t + i * 0.052, decay: 0.1, peak: 0.055 });
    });
  }

  bomb() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone({ freq: 90, to: 900, type: 'sawtooth', time: t, attack: 0.02, decay: 0.5, peak: 0.16, filter: { type: 'lowpass', from: 300, to: 4000 } });
    this._noiseBurst({ time: t + 0.04, dur: 1.0, peak: 0.3, from: 5200, to: 60, q: 0.5 });
    this._tone({ freq: 300, to: 32, type: 'sine', time: t + 0.06, decay: 0.9, peak: 0.22 });
  }

  warning() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this._tone({ freq: 520, type: 'square', time: t + i * 0.34, decay: 0.14, peak: 0.07 });
      this._tone({ freq: 390, type: 'square', time: t + i * 0.34 + 0.16, decay: 0.14, peak: 0.07 });
    }
  }

  bossExplode() {
    if (!this.ready) return;
    for (let i = 0; i < 7; i++) {
      const t = this.ctx.currentTime + i * 0.17 + Math.random() * 0.06;
      this._noiseBurst({ time: t, dur: 0.5, peak: 0.26, from: 3000, to: 70, q: 0.6 });
      this._tone({ freq: 150 - i * 8, to: 28, type: 'sine', time: t, decay: 0.45, peak: 0.2 });
    }
  }

  uiSelect() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone({ freq: 660, to: 990, type: 'square', time: t, decay: 0.08, peak: 0.05 });
  }

  stageClear() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', time: t + i * 0.12, decay: 0.22, peak: 0.07 });
    });
  }

  /** 激光持续音：跟随玩家开火状态开关 */
  setLaser(active) {
    if (!this.ready) return;
    if (active && !this._laserNodes) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 118;
      osc2.type = 'square';
      osc2.frequency.value = 177;
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 2.2;
      gain.gain.value = 0;
      osc.connect(filter); osc2.connect(filter);
      filter.connect(gain); gain.connect(this.sfxBus);
      osc.start(); osc2.start();
      gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.05);
      this._laserNodes = { osc, osc2, gain };
    } else if (!active && this._laserNodes) {
      const { osc, osc2, gain } = this._laserNodes;
      const t = this.ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.03);
      osc.stop(t + 0.2); osc2.stop(t + 0.2);
      this._laserNodes = null;
    }
  }

  // ── 程序化音乐 ──────────────────────────────────────────

  startMusic() {
    if (!this.ready || this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  _scheduleMusic() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') return;
    const stepDur = 60 / this.bpm / 4;   // 十六分音符
    const lookahead = ctx.currentTime + 0.16;

    while (this.nextNoteTime < lookahead) {
      this._playStep(this.musicStep, this.nextNoteTime);
      this.nextNoteTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 64;
    }
  }

  _playStep(step, time) {
    const boss = this.intensity > 0.5;
    const prog = boss ? CHORDS.boss : CHORDS.normal;
    const bar = Math.floor(step / 16) % prog.length;
    const beat = step % 16;
    const chord = prog[bar];
    const out = this.musicBus;

    // 低音：每拍推进
    if (beat % 4 === 0 || beat === 6 || beat === 11) {
      const octave = beat === 8 ? 12 : 0;
      this._tone({
        freq: midiToFreq(chord.root + octave), type: 'square', time,
        decay: 0.16, peak: 0.11, dest: out,
        filter: { type: 'lowpass', from: 700, to: 260, q: 2 },
      });
    }

    // 琶音：八分音符，上下行
    if (beat % 2 === 0) {
      const idx = (beat / 2) % 3;
      const oct = beat % 8 === 6 ? 12 : 0;
      this._tone({
        freq: midiToFreq(chord.triad[idx] + 12 + oct), type: 'triangle', time,
        decay: 0.13, peak: 0.035, dest: out,
      });
    }

    // 鼓组
    if (beat === 0 || beat === 8 || (boss && beat === 14)) {
      this._tone({ freq: 128, to: 42, type: 'sine', time, decay: 0.16, peak: 0.2, dest: out });
    }
    if (beat === 4 || beat === 12) {
      this._noiseBurst({ time, dur: 0.12, peak: 0.09, filter: 'bandpass', from: 1900, to: 900, q: 1.4, dest: out });
    }
    if (beat % 2 === 1) {
      this._noiseBurst({ time, dur: 0.035, peak: 0.028, filter: 'highpass', from: 7200, to: 5200, dest: out });
    }

    // Boss 段落叠加一条持续高音，制造压迫感
    if (boss && beat === 0) {
      this._tone({ freq: midiToFreq(chord.triad[2] + 12), type: 'sawtooth', time, decay: 1.0, peak: 0.022, dest: out, filter: { type: 'lowpass', from: 2200, to: 700 } });
    }
  }
}
