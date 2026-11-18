(function (global) {
  'use strict';

  // Sortie select, shown before the briefing of every sortie. Two separate screens:
  //   ① planet select    (#planet-dialog,    js/planetSelect.js)
  //   ② operation select (#operation-dialog, js/operationSelect.js)
  // Picking a planet closes ① and opens ② for that planet; ◀ / Esc on ② goes back to ①.
  // Picking an operation closes ② and hands { planet, operation } to the caller, which opens the
  // briefing (js/game/mission.js). Mio guides each screen in a call floating at the centre.
  // The operations-meeting BGM (js/bgm.js) starts with the first screen and runs until the briefing
  // closes with 作戦開始. Until the first click / key press the browser keeps audio muted, so the
  // first opening waits behind the "click to connect" screen (#audio-gate) for that gesture.

  const { PLANETS } = global.GameData; // js/data/operations.js

  const GATE_FADE_MS = 1200; // the black "click to connect" screen fades out this slowly (see .audio-gate.is-leaving)
  const OPEN_DELAY_MS = 900; // pause on the empty battlefield before the first screen starts drawing
  const SWITCH_DELAY_MS = 250; // pause between one screen closing and the next one drawing
  const BOOT_INTRO_MS = 1450; // boot-up sequence length before Mio starts talking (css/hudframe.css)

  // One sortie-select window: HUD-frame boot / close sequences, Mio's typed line, and a result
  // handed to onClose(result) once the closing sequence has finished. result is null when the
  // browser closed the modal by itself (e.g. repeated Esc): the caller shows the screen again.
  class SortieScreen {
    constructor(dialog, audio) {
      this.dialog = dialog;
      this.audio = audio;
      // Mio's call floats at the screen centre until clicked (js/mioCall.js). Created before any
      // other `cancel` listener so Esc while it is up only dismisses it.
      this.mio = new global.MioCall(dialog, audio);
      this.onClose = null;
      this._openTimer = null;
      this._closing = false; // closing sequence running: still counts as open (game stays paused)
      this._result = null;

      // Esc never closes these windows by itself (screens that want Esc handle `cancel`)
      global.HudFrame.animateCloses(dialog, { allowEsc: false });
      dialog.addEventListener('close', () => {
        this.mio.stop();
        const result = this._result;
        this._result = null;
        this._closing = false;
        if (this.onClose) this.onClose(result);
      });
    }

    // True while the window is shown, closing, or waiting to appear
    get isOpen() {
      return this.dialog.open || this._openTimer != null || this._closing;
    }

    // Boot the window after delayMs; onShown(sayDelayMs) runs once it is up (focus, Mio's line)
    show(delayMs, onShown) {
      if (this._openTimer != null) clearTimeout(this._openTimer);
      this._openTimer = setTimeout(() => {
        this._openTimer = null;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
        this.audio.startBriefingBgm(); // keeps playing on into the briefing
        onShown(BOOT_INTRO_MS);
      }, delayMs);
    }

    // Play the closing sequence, then hand `result` to onClose
    finish(result) {
      if (!this.dialog.open || this.dialog.classList.contains('is-closing')) return;
      this._result = result;
      this._closing = true;
      global.HudFrame.closeDialog(this.dialog, 'done');
    }

    say(text, delayMs = 0) {
      this.mio.say(text, delayMs);
    }
  }

  class SortieSelect {
    constructor({ planetDialog, operationDialog, audio }) {
      this.audio = audio;
      this.planets = new global.PlanetSelectScene(planetDialog, audio);
      this.operations = new global.OperationSelectScene(operationDialog, audio);
      this.onSelect = null;
      this._gateCleanup = null; // set while the "click to connect" screen waits for the first gesture
      this.gate = document.getElementById('audio-gate');
      this._gateFadeTimer = null;

      this.planets.onClose = (result) => {
        if (result) this.operations.open(result.planet, SWITCH_DELAY_MS);
        else this.planets.open(this.planets.focusId, 0);
      };
      this.operations.onClose = (result) => {
        const planet = this.operations.planet;
        if (!result) {
          this.operations.open(planet, 0);
        } else if (result.back) {
          this.planets.open(planet.id, SWITCH_DELAY_MS);
        } else {
          const cb = this.onSelect;
          this.onSelect = null;
          if (cb) cb({ planet, operation: result.operation });
        }
      };
    }

    // True while either screen is shown OR waiting to appear (the game stays paused either way)
    get isOpen() {
      return this.planets.isOpen || this.operations.isOpen || this._gateCleanup != null;
    }

    // onSelect({ planet, operation }) runs once an operation has been picked.
    // options.planetId reopens straight on that planet's operation list (back from the briefing).
    open(onSelect, { planetId = null, delayMs = OPEN_DELAY_MS } = {}) {
      this.onSelect = onSelect;
      // The browser keeps audio muted until the first click / key press (autoplay policy), so the
      // very first sortie waits on a "click to connect" screen: the BGM then starts with the window.
      if (this.audio.ctx && !this.audio.unlocked) {
        this._waitForAudioUnlock(() => this._show(planetId, delayMs));
        return;
      }
      this._hideGate(); // shown from page load: not needed this time
      this._show(planetId, delayMs);
    }

    _show(planetId, delayMs) {
      const planet = planetId != null ? PLANETS.find((p) => p.id === planetId && p.available) : null;
      if (planet) this.operations.open(planet, delayMs);
      else this.planets.open(null, delayMs);
    }

    // ---------------------------------------------------------------- audio unlock gate
    // Shows the "click to connect" screen until a user gesture (or the browser itself) lets the
    // AudioContext run, then calls proceed() once. Escape does not count as a gesture for the
    // browser's autoplay rules, so it is ignored here.
    _waitForAudioUnlock(proceed) {
      if (this._gateCleanup) this._gateCleanup();
      const ctx = this.audio.ctx;
      const finish = () => {
        cleanup();
        proceed();
      };
      const onGesture = (e) => {
        if (e.type === 'keydown' && (e.key === 'Escape' || e.repeat)) return;
        this.audio.init(); // resume() inside the gesture: the BGM is audible from here on
        finish();
      };
      const onStateChange = () => {
        if (this.audio.unlocked) finish();
      };
      const cleanup = () => {
        window.removeEventListener('pointerup', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        ctx.removeEventListener('statechange', onStateChange);
        this._hideGate();
        this._gateCleanup = null;
      };
      this._gateCleanup = cleanup;
      // pointerup (not pointerdown): on touch screens only the release counts as a user gesture
      window.addEventListener('pointerup', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
      // Some browsers start the context on their own a moment later (autoplay allowed for the site)
      ctx.addEventListener('statechange', onStateChange);
      this._showGate();
    }

    _showGate() {
      if (!this.gate) return;
      clearTimeout(this._gateFadeTimer);
      this._gateFadeTimer = null;
      this.gate.classList.remove('is-leaving');
      this.gate.hidden = false;
    }

    // Fade the black screen out slowly to reveal the operations room, then remove it
    _hideGate() {
      if (!this.gate || this.gate.hidden || this._gateFadeTimer != null) return;
      this.gate.classList.add('is-leaving');
      this._gateFadeTimer = setTimeout(() => {
        this._gateFadeTimer = null;
        this.gate.hidden = true;
        this.gate.classList.remove('is-leaving');
      }, GATE_FADE_MS);
    }
  }

  global.SortieScreen = SortieScreen;
  global.SortieSelect = SortieSelect;
})(window);
