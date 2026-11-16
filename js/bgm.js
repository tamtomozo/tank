(function (global) {
  'use strict';

  // Operations-meeting BGM: a powerful 4/4 martial drum loop synthesized with Web Audio (no audio files).
  // Plays while the sortie-select screen and the briefing are open (started / stopped through
  // TankAudio: startBriefingBgm / stopBriefingBgm). Five drum voices:
  //   kick   heavy bass drum  — solid four-on-the-floor low-end anchor
  //   snare  military snare   — crisp backbeat on 2 & 4 and driving pickups
  //   tom    low-mid tom      — weighty martial accents and turnaround fills
  //   hat    closed hi-hat    — steady 8th-note pulse locking in the 4/4 drive
  //   crash  dark cymbal      — phrase-start impact on bar 1 & bar 5
  // 8-bar loop: phrase start – drive – main – short fill – phrase start – drive – main – rolling fill.
  // Notes are scheduled slightly ahead of time on the AudioContext clock (lookahead scheduler).

  const BPM = 106;
  const STEPS_PER_BAR = 16; // 16th notes (4/4 time)
  const STEP_SEC = 60 / BPM / 4;
  const VOLUME = 1.0; // BGM bus level (before the master gain 0.45)
  const FADE_IN_SEC = 1.2;
  const LOOKAHEAD_SEC = 0.25; // how far ahead notes are scheduled
  const TICK_MS = 50; // scheduler interval
  const HUMANIZE = 0.07; // ± random variation of each hit's level

  // One bar = list of [step, voice, level]
  // Steady 8th-note hat pulse + four-on-the-floor kick + snappy snare on beats 2 (4) and 4 (12)
  const PULSE = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'hat', s % 4 === 0 ? 0.55 : 0.34]);
  const MAIN_A = [
    ...PULSE,
    [0, 'kick', 1.0],
    [4, 'kick', 0.78], [4, 'snare', 0.95],
    [8, 'kick', 0.95], [10, 'kick', 0.65],
    [12, 'kick', 0.82], [12, 'snare', 1.0]
  ];
  const PHRASE_START = [
    ...MAIN_A,
    [0, 'crash', 0.85]
  ];
  const MAIN_B = [
    ...PULSE,
    [0, 'kick', 1.0],
    [4, 'kick', 0.78], [4, 'snare', 0.95],
    [8, 'kick', 0.95], [10, 'tom', 0.55],
    [12, 'kick', 0.82], [12, 'snare', 1.0],
    [14, 'tom', 0.62], [15, 'snare', 0.48]
  ];
  const FILL_SHORT = [
    ...PULSE,
    [0, 'kick', 1.0],
    [4, 'kick', 0.78], [4, 'snare', 0.95],
    [8, 'kick', 0.95], [8, 'tom', 0.72],
    [10, 'tom', 0.78],
    [12, 'kick', 0.88], [12, 'snare', 1.0],
    [14, 'snare', 0.68], [15, 'snare', 0.85]
  ];
  const FILL_ROLL = [
    [0, 'hat', 0.55], [2, 'hat', 0.34], [4, 'hat', 0.55], [6, 'hat', 0.34],
    [0, 'kick', 1.0],
    [4, 'kick', 0.8], [4, 'snare', 0.95],
    [8, 'kick', 0.95], [8, 'tom', 0.75],
    [9, 'snare', 0.48], [10, 'tom', 0.82], [11, 'snare', 0.58],
    [12, 'kick', 0.95], [12, 'snare', 1.0],
    [13, 'snare', 0.52], [14, 'tom', 0.88], [15, 'snare', 0.85]
  ];
  const LOOP = [PHRASE_START, MAIN_B, MAIN_A, FILL_SHORT, PHRASE_START, MAIN_B, MAIN_A, FILL_ROLL];
  const VOICE_METHODS = {
    kick: '_kick',
    snare: '_snare',
    tom: '_tom',
    hat: '_hat',
    crash: '_crash'
  };

  class BriefingBgm {
    constructor(audio) {
      this.audio = audio; // TankAudio: provides ctx, master and the noise buffer
      this.bus = null;
      this.timer = null;
      this.step = 0;
      this.nextTime = 0;
    }

    get playing() {
      return this.timer != null;
    }

    start() {
      const ctx = this.audio.ctx;
      if (!ctx || this.timer != null) return;
      const now = ctx.currentTime;

      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, now);
      bus.gain.exponentialRampToValueAtTime(VOLUME, now + FADE_IN_SEC);
      bus.connect(this.audio.master);

      this.bus = bus;
      this.step = 0;
      this.nextTime = now + 0.1;
      this.timer = setInterval(() => this._schedule(), TICK_MS);
      this._schedule();
    }

    stop(fadeSec = 1.2) {
      if (this.timer == null) return;
      clearInterval(this.timer);
      this.timer = null;
      const ctx = this.audio.ctx;
      const bus = this.bus;
      this.bus = null;
      const now = ctx.currentTime;
      const g = bus.gain;
      // Hold wherever the fade-in currently is, then fade out from there
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
      }
      g.setTargetAtTime(0, now, fadeSec / 4);
      setTimeout(() => bus.disconnect(), (fadeSec + 0.6) * 1000);
    }

    // ------------------------------------------------------------------ scheduler
    _schedule() {
      const ctx = this.audio.ctx;
      // Throttled timers (background tab) fall behind: skip ahead instead of bursting notes
      if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05;
      while (this.nextTime < ctx.currentTime + LOOKAHEAD_SEC) {
        this._playStep(this.step, this.nextTime);
        this.step = (this.step + 1) % (STEPS_PER_BAR * LOOP.length);
        this.nextTime += STEP_SEC;
      }
    }

    _playStep(step, t) {
      const bar = LOOP[Math.floor(step / STEPS_PER_BAR)];
      const s = step % STEPS_PER_BAR;
      for (const [hs, voice, level] of bar) {
        if (hs !== s) continue;
        const lv = level * (1 + (Math.random() * 2 - 1) * HUMANIZE);
        const method = VOICE_METHODS[voice];
        if (method) this[method](t, lv);
      }
    }

    // ------------------------------------------------------------------ voices
    // Pitched body: an oscillator that drops in pitch while it decays
    _body(t, from, to, sweep, level, decay, wave = 'sine') {
      const ctx = this.audio.ctx;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + sweep);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gain);
      gain.connect(this.bus);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }

    // Filtered noise burst: the stick / skin attack
    _noise(t, type, freq, q, level, decay) {
      const ctx = this.audio.ctx;
      if (!this.audio.noiseBuffer) return;
      const noise = ctx.createBufferSource();
      noise.buffer = this.audio.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.bus);
      // Random offset into the buffer so consecutive hits don't sound identical
      const maxOffset = Math.max(0, this.audio.noiseBuffer.duration - decay - 0.05);
      noise.start(t, Math.random() * maxOffset);
      noise.stop(t + decay + 0.01);
    }

    _kick(t, lv) {
      this._body(t, 125, 46, 0.08, 0.55 * lv, 0.42);
      this._body(t, 210, 88, 0.05, 0.18 * lv, 0.14, 'triangle');
      this._noise(t, 'lowpass', 850, 0.8, 0.18 * lv, 0.05);
    }

    _snare(t, lv) {
      this._body(t, 200, 125, 0.05, 0.26 * lv, 0.14, 'triangle');
      this._noise(t, 'bandpass', 2200, 0.75, 0.28 * lv, 0.16);
      this._noise(t, 'highpass', 3800, 0.7, 0.14 * lv, 0.07);
    }

    _tom(t, lv) {
      this._body(t, 165, 86, 0.09, 0.36 * lv, 0.26);
      this._body(t, 260, 140, 0.04, 0.10 * lv, 0.10, 'triangle');
      this._noise(t, 'bandpass', 1200, 1.0, 0.12 * lv, 0.05);
    }

    _hat(t, lv) {
      this._noise(t, 'highpass', 5500, 1.0, 0.09 * lv, 0.04);
    }

    _crash(t, lv) {
      this._noise(t, 'highpass', 3200, 0.6, 0.15 * lv, 0.55);
      this._noise(t, 'bandpass', 6200, 1.2, 0.10 * lv, 0.40);
    }
  }

  global.BriefingBgm = BriefingBgm;
})(window);
