(function (global) {
  'use strict';

  // Staff-credits BGM: a slow, sorrowful piece in A minor, synthesized with Web Audio (no audio
  // files), for the credits roll on the title screen (js/credits.js; started / stopped through
  // TankAudio: startCreditsBgm / stopCreditsBgm). Four voices, all into a long hall reverb:
  //   arp    soft piano-like broken chords on every 8th note
  //   pad    slow-swelling string pad holding each bar's chord
  //   bass   low sine on the root
  //   lead   a flute-like melody with gentle vibrato and an echo
  // 16-bar loop at 66 BPM (about 58 s): the theme over Am–F–C–G / Am–F–Dm–E, then a rising answer
  // over F–G–C–Am that falls back through Dm–Am to the unresolved E, which leads into the next loop.
  // Notes are scheduled slightly ahead of time on the AudioContext clock (lookahead scheduler).

  const BPM = 66;
  const STEPS_PER_BAR = 8; // 8th notes (4/4 time)
  const STEP_SEC = 60 / BPM / 2;
  const BAR_SEC = STEP_SEC * STEPS_PER_BAR;
  const VOLUME = 0.9; // bus level (before the master gain 0.45)
  const FADE_IN_SEC = 2.5;
  const LOOKAHEAD_SEC = 0.3;
  const TICK_MS = 50;

  // Chords: bass = MIDI root of the bass line, pad = sustained voicing, arp = the bar's 8 broken-chord notes
  const CHORDS = {
    Am: { bass: 45, pad: [57, 60, 64], arp: [45, 52, 57, 60, 64, 60, 57, 52] },
    F: { bass: 41, pad: [57, 60, 65], arp: [41, 48, 53, 57, 60, 57, 53, 48] },
    C: { bass: 48, pad: [55, 60, 64], arp: [48, 55, 60, 64, 67, 64, 60, 55] },
    G: { bass: 43, pad: [55, 59, 62], arp: [43, 50, 55, 59, 62, 59, 55, 50] },
    Dm: { bass: 38, pad: [57, 62, 65], arp: [38, 45, 50, 53, 57, 53, 50, 45] },
    E: { bass: 40, pad: [56, 59, 64], arp: [40, 47, 52, 56, 59, 56, 52, 47] }
  };
  const PROGRESSION = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E', 'F', 'G', 'C', 'Am', 'Dm', 'Am', 'E', 'E'];

  // Melody per bar: [step, MIDI note, length in steps]
  const MELODY = [
    [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 71, 1], [7, 72, 1]], // Am  E D C B C
    [[0, 69, 6]], //                                                  F   A —
    [[0, 67, 2], [2, 72, 2], [4, 76, 3], [7, 74, 1]], //              C   G C E D
    [[0, 74, 6], [6, 71, 2]], //                                      G   D — B
    [[0, 72, 3], [3, 71, 1], [4, 69, 2], [6, 72, 2]], //              Am  C B A C
    [[0, 77, 4], [4, 76, 2], [6, 72, 2]], //                          F   F — E C
    [[0, 74, 3], [3, 72, 1], [4, 69, 2], [6, 74, 2]], //              Dm  D C A D
    [[0, 71, 4], [4, 68, 4]], //                                      E   B — G# —
    [[0, 69, 2], [2, 72, 2], [4, 77, 4]], //                          F   A C F —
    [[0, 74, 3], [3, 76, 1], [4, 79, 4]], //                          G   D E G —
    [[0, 76, 3], [3, 74, 1], [4, 72, 4]], //                          C   E D C —
    [[0, 72, 2], [2, 71, 2], [4, 69, 4]], //                          Am  C B A —
    [[0, 77, 3], [3, 76, 1], [4, 74, 2], [6, 72, 2]], //              Dm  F E D C
    [[0, 76, 6], [6, 72, 2]], //                                      Am  E — C
    [[0, 71, 3], [3, 69, 1], [4, 68, 4]], //                          E   B A G# —
    [] //                                                             E   (rest)
  ];
  const LOOP_STEPS = STEPS_PER_BAR * PROGRESSION.length;

  const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  class CreditsBgm {
    constructor(audio) {
      this.audio = audio; // TankAudio: provides ctx and master
      this.bus = null;
      this.dry = null;
      this.wet = null;
      this.echo = null;
      this.timer = null;
      this.step = 0;
      this.nextTime = 0;
      this._impulse = null;
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

      // Voices go to `dry` (straight) and `wet` (hall reverb); the lead also feeds `echo`
      const dry = ctx.createGain();
      dry.gain.value = 0.75;
      dry.connect(bus);
      const reverb = ctx.createConvolver();
      reverb.buffer = this._hallImpulse();
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      wet.connect(reverb);
      reverb.connect(bus);

      const echo = ctx.createGain();
      echo.gain.value = 0.28;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = STEP_SEC * 1.5; // dotted quarter
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      const echoTone = ctx.createBiquadFilter();
      echoTone.type = 'lowpass';
      echoTone.frequency.value = 1800;
      echo.connect(delay);
      delay.connect(echoTone);
      echoTone.connect(feedback);
      feedback.connect(delay);
      echoTone.connect(wet);
      echoTone.connect(dry);

      this.bus = bus;
      this.dry = dry;
      this.wet = wet;
      this.echo = echo;
      this.step = 0;
      this.nextTime = now + 0.15;
      this.timer = setInterval(() => this._schedule(), TICK_MS);
      this._schedule();
    }

    stop(fadeSec = 1.8) {
      if (this.timer == null) return;
      clearInterval(this.timer);
      this.timer = null;
      const ctx = this.audio.ctx;
      const bus = this.bus;
      this.bus = this.dry = this.wet = this.echo = null;
      const now = ctx.currentTime;
      const g = bus.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
      }
      g.setTargetAtTime(0, now, fadeSec / 4);
      setTimeout(() => bus.disconnect(), (fadeSec + 1) * 1000);
    }

    // Stereo decaying noise: a long, dark hall
    _hallImpulse() {
      if (this._impulse) return this._impulse;
      const ctx = this.audio.ctx;
      const sec = 3.6;
      const len = Math.floor(ctx.sampleRate * sec);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const k = i / len;
          lp += ((Math.random() * 2 - 1) - lp) * (0.55 - k * 0.4); // darker as it fades
          data[i] = lp * Math.pow(1 - k, 2.6);
        }
      }
      this._impulse = buf;
      return buf;
    }

    // ------------------------------------------------------------------ scheduler
    _schedule() {
      const ctx = this.audio.ctx;
      if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05;
      while (this.nextTime < ctx.currentTime + LOOKAHEAD_SEC) {
        this._playStep(this.step, this.nextTime);
        this.step = (this.step + 1) % LOOP_STEPS;
        this.nextTime += STEP_SEC;
      }
    }

    _playStep(step, t) {
      const bar = Math.floor(step / STEPS_PER_BAR);
      const s = step % STEPS_PER_BAR;
      const chord = CHORDS[PROGRESSION[bar]];
      if (s === 0) {
        for (const n of chord.pad) this._pad(t, freq(n), BAR_SEC);
        this._bass(t, freq(chord.bass - 12), BAR_SEC);
      }
      // Broken chord: a little louder on the beat, softer off it
      this._arp(t, freq(chord.arp[s]), s % 2 === 0 ? 0.075 : 0.055);
      for (const [ms, note, len] of MELODY[bar]) {
        if (ms === s) this._lead(t, freq(note), len * STEP_SEC);
      }
    }

    // ------------------------------------------------------------------ voices
    _out(node, dryLevel, wetLevel) {
      const ctx = this.audio.ctx;
      const d = ctx.createGain();
      d.gain.value = dryLevel;
      node.connect(d);
      d.connect(this.dry);
      const w = ctx.createGain();
      w.gain.value = wetLevel;
      node.connect(w);
      w.connect(this.wet);
    }

    // Piano-like: quick attack, long fading tail, a soft octave overtone
    _arp(t, f, level) {
      const ctx = this.audio.ctx;
      const decay = 2.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.setValueAtTime(2600, t);
      tone.frequency.exponentialRampToValueAtTime(700, t + decay);
      for (const [mult, type, lv] of [[1, 'triangle', 1], [2, 'sine', 0.25]]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.value = lv;
        osc.connect(g);
        g.connect(tone);
        osc.start(t);
        osc.stop(t + decay + 0.05);
      }
      tone.connect(gain);
      this._out(gain, 0.8, 0.6);
    }

    // String pad: two detuned saws through a soft filter, swelling in and out over the bar
    _pad(t, f, dur) {
      const ctx = this.audio.ctx;
      const end = t + dur;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.022, t + dur * 0.4);
      gain.gain.setValueAtTime(0.022, end - 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + 1.2);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 900;
      tone.Q.value = 0.4;
      for (const cents of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = cents;
        osc.connect(tone);
        osc.start(t);
        osc.stop(end + 1.3);
      }
      tone.connect(gain);
      this._out(gain, 0.6, 0.9);
    }

    _bass(t, f, dur) {
      const ctx = this.audio.ctx;
      const end = t + dur;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.07, end - 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.5);
      osc.connect(gain);
      osc.start(t);
      osc.stop(end + 0.55);
      this._out(gain, 1, 0.2);
    }

    // Flute-like lead: sine with a breath of triangle, vibrato that grows as the note is held
    _lead(t, f, dur) {
      const ctx = this.audio.ctx;
      const end = t + dur;
      const release = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.085, end);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + release);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vibDepth = ctx.createGain();
      vibDepth.gain.setValueAtTime(0, t);
      vibDepth.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.8, dur));
      vib.connect(vibDepth);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2400;
      for (const [type, lv] of [['sine', 1], ['triangle', 0.3]]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        vibDepth.connect(osc.frequency);
        const g = ctx.createGain();
        g.gain.value = lv;
        osc.connect(g);
        g.connect(tone);
        osc.start(t);
        osc.stop(end + release + 0.05);
      }
      vib.start(t);
      vib.stop(end + release + 0.05);
      tone.connect(gain);
      this._out(gain, 0.9, 0.6);
      gain.connect(this.echo);
    }
  }

  global.CreditsBgm = CreditsBgm;
})(window);
