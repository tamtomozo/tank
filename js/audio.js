(function (global) {
  'use strict';

  class TankAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.noiseBuffer = null;
      this.engineGain = null;
      this.engineOsc = null;
      this.clatterGain = null;
      this.clatterOsc = null;
      this.bgm = null; // operations-meeting BGM (js/bgm.js), built on first use
      this._bgmWanted = false; // asked to play before the AudioContext existed
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.master.connect(this.ctx.destination);

      // Pre-build white noise buffer for explosions, gunshots, and dirt clatter
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Diesel engine idle/drive oscillator
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 38;

      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 145;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.04;

      this.engineOsc.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();

      // Caterpillar clatter pulse
      this.clatterOsc = this.ctx.createOscillator();
      this.clatterOsc.type = 'triangle';
      this.clatterOsc.frequency.value = 18;
      this.clatterGain = this.ctx.createGain();
      this.clatterGain.gain.value = 0;
      this.clatterOsc.connect(this.clatterGain);
      this.clatterGain.connect(this.master);
      this.clatterOsc.start();

      if (this._bgmWanted) this.startBriefingBgm();
    }

    // True once the AudioContext is actually producing sound. Browsers keep a context created
    // before the first click / key press suspended (autoplay policy) until a user gesture resumes it.
    get unlocked() {
      return !!this.ctx && this.ctx.state === 'running';
    }

    // Operations-meeting BGM: plays while the sortie-select screen / briefing are open.
    // Both calls are safe to repeat (start while playing / stop while stopped do nothing).
    startBriefingBgm() {
      this._bgmWanted = true;
      if (!this.ctx || !global.BriefingBgm) return;
      if (!this.bgm) this.bgm = new global.BriefingBgm(this);
      this.bgm.start();
    }

    stopBriefingBgm(fadeSec) {
      this._bgmWanted = false;
      if (this.bgm) this.bgm.stop(fadeSec);
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.04);
      }
    }

    updateEngine(speedRatio, active) {
      if (!this.ctx || !this.engineGain) return;
      const now = this.ctx.currentTime;
      if (!active || this.muted) {
        this.engineGain.gain.setTargetAtTime(0, now, 0.08);
        this.clatterGain.gain.setTargetAtTime(0, now, 0.08);
        return;
      }
      const absSpeed = Math.min(1.4, Math.abs(speedRatio));
      const targetFreq = 36 + absSpeed * 44;
      const targetVol = 0.055 + absSpeed * 0.085;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
      this.engineGain.gain.setTargetAtTime(targetVol, now, 0.08);

      // Track link clatter scales with speed
      this.clatterOsc.frequency.setTargetAtTime(14 + absSpeed * 28, now, 0.08);
      this.clatterGain.gain.setTargetAtTime(absSpeed > 0.05 ? 0.03 + absSpeed * 0.045 : 0, now, 0.06);
    }

    playCannon(power = 1) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;

      // Sub-bass cannon thump
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135 * (0.95 + power * 0.08), now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.32);
      gain.gain.setValueAtTime(0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.38);

      // Blast noise tail
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.42);
      filter.Q.value = 0.9;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.55, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.master);
      noise.start(now);
      noise.stop(now + 0.46);
    }

    playExplosion(size = 1) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      // Barrel chain reactions can trigger many explosions in one frame; cap overlapping voices
      if (this._lastExplosionAt !== undefined && now - this._lastExplosionAt < 0.03) return;
      this._lastExplosionAt = now;
      const dur = 0.45 + size * 0.25;

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, now);
      filter.frequency.exponentialRampToValueAtTime(65, now + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.min(0.75, 0.35 + size * 0.18), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      noise.start(now);
      noise.stop(now + dur + 0.02);
    }

    playHit() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      // Throttle: ramming / splash chains can call this every frame for many targets
      if (this._lastHitAt !== undefined && now - this._lastHitAt < 0.05) return;
      this._lastHitAt = now;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.16);
    }

    playPickup(isRepair = false) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const base = isRepair ? 520 : 660;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.setValueAtTime(base * 1.25, now + 0.05);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.17);
    }

    playUpgrade() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      [440, 554, 659, 880].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        const t = now + idx * 0.055;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    }

    // Tuning click on the briefing's radar charts: one short, soft blip
    playTune() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.1);
    }

    // Radio squelch: a short burst of band-passed static followed by a two-tone chirp
    playRadio() {
      if (!this.ctx || this.muted || !this.noiseBuffer) return;
      const now = this.ctx.currentTime;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1900;
      band.Q.value = 1.3;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.13, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      noise.connect(band);
      band.connect(nGain);
      nGain.connect(this.master);
      noise.start(now);
      noise.stop(now + 0.14);

      [1320, 1760].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        const t = now + 0.13 + idx * 0.065;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.06);
      });
    }

    // Two-tone alarm when an enemy compound goes on alert
    playAlert() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      [0, 1, 2, 3].forEach((idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        const t = now + idx * 0.16;
        osc.frequency.setValueAtTime(idx % 2 === 0 ? 660 : 494, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.16);
      });
    }

    // Bugle charge call when an enemy compound sorties (G C E G - E G, played on the natural
    // bugle notes). Brassy tone: sawtooth through a lowpass that opens on each attack, a slight
    // scoop up into the pitch and vibrato on the held notes. Overlapping calls are skipped.
    playBugle(delay = 0) {
      if (!this.ctx || this.muted) return;
      const start = this.ctx.currentTime + delay;
      if (this._bugleUntil && start < this._bugleUntil) return;
      const S = 0.12; // short note
      const L = 0.42; // held note
      const notes = [
        [392.0, S], [523.25, S], [659.25, S], [783.99, L],
        [659.25, S], [783.99, L * 1.9]
      ];
      const bus = this.ctx.createGain();
      bus.gain.value = 0.5;
      bus.connect(this.master);
      let t = start;
      for (const [freq, dur] of notes) {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 0.96, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
        filter.type = 'lowpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(freq * 1.5, t);
        filter.frequency.exponentialRampToValueAtTime(freq * 5, t + 0.05);
        const end = t + dur;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.16, t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.11, t + 0.09);
        gain.gain.setValueAtTime(0.11, end - 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        if (dur > 0.3) {
          const lfo = this.ctx.createOscillator();
          const depth = this.ctx.createGain();
          lfo.frequency.value = 5.5;
          depth.gain.setValueAtTime(0, t);
          depth.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.6);
          lfo.connect(depth);
          depth.connect(osc.frequency);
          lfo.start(t);
          lfo.stop(end);
        }
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        osc.start(t);
        osc.stop(end + 0.02);
        t = end + 0.025; // tongued gap between notes
      }
      this._bugleUntil = t;
    }

    playWaveClear() {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      [392, 493.88, 587.33, 783.99].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1600;
        const t = now + idx * 0.08;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    }
  }

  global.TankAudio = TankAudio;
})(window);

