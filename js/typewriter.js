(function (global) {
  'use strict';

  // Mio's lines typed out one character at a time (regardless of OS reduced-motion settings).
  // Used by the briefing (briefing.js) and the after-action report (results.js); the in-game
  // radio (radio.js) types on the game clock instead but shares the same speed.
  //   textEl: element that shows the visible (typed) text, gets `.is-typing` while typing
  //   srEl:   optional visually hidden element that receives the full line at once (screen readers)

  const CHARS_PER_SEC = 34;
  const TICK_MS = 30;

  class Typewriter {
    constructor(textEl, srEl = null) {
      this.textEl = textEl;
      this.srEl = srEl;
      this._typer = null;
      this._sayTimer = null;
    }

    // Type `text`, optionally after `delayMs` (e.g. once a window's boot-up sequence has finished).
    // Plays the radio blip from `audio` when typing starts.
    say(text, audio, delayMs = 0) {
      this.stop();
      if (this.srEl) this.srEl.textContent = text;
      this.textEl.textContent = '';
      if (delayMs > 0) {
        this._sayTimer = setTimeout(() => {
          this._sayTimer = null;
          this._start(text, audio);
        }, delayMs);
        return;
      }
      this._start(text, audio);
    }

    stop() {
      if (this._sayTimer) {
        clearTimeout(this._sayTimer);
        this._sayTimer = null;
      }
      if (this._typer) {
        clearInterval(this._typer);
        this._typer = null;
      }
      if (this.textEl) this.textEl.classList.remove('is-typing');
    }

    _start(text, audio) {
      if (audio && audio.playRadio) audio.playRadio();
      this.textEl.textContent = '';
      this.textEl.classList.add('is-typing');
      const started = performance.now();
      this._typer = setInterval(() => {
        const shown = Math.min(text.length, Math.floor(((performance.now() - started) / 1000) * CHARS_PER_SEC));
        this.textEl.textContent = text.slice(0, shown);
        if (shown >= text.length) this.stop();
      }, TICK_MS);
    }
  }

  Typewriter.CHARS_PER_SEC = CHARS_PER_SEC;
  global.Typewriter = Typewriter;
})(window);
