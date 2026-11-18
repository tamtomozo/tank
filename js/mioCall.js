(function (global) {
  'use strict';

  // Mio's call on the HQ screens (planet select, operation select, briefing, after-action report): when she starts
  // talking, her panel floats at the centre of the screen over a light scrim. A click (or Enter /
  // Space / Esc) while she is still typing shows the whole line; once it is read, the next one
  // dismisses the call. Markup inside the dialog (see index.html):
  //   .briefing-mio-sr (live region, outside the layer)
  //   .briefing-mio-layer[hidden] > .briefing-mio-float > … .briefing-mio-text + .briefing-mio-hint
  // Create it before any other `cancel` listener on the dialog, so Esc while the call is up only
  // dismisses the call (and never closes the window).

  class MioCall {
    constructor(dialog, audio) {
      this.dialog = dialog;
      this.audio = audio;
      this.layer = dialog.querySelector('.briefing-mio-layer');
      this.panel = dialog.querySelector('.briefing-mio-float');
      this.typer = new global.Typewriter(
        dialog.querySelector('.briefing-mio-text'),
        dialog.querySelector('.briefing-mio-sr')
      );
      this._showTimer = null;
      this._returnFocus = null;

      this.layer.addEventListener('click', () => this.advance());
      this.layer.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        this.advance();
      });
      dialog.addEventListener('cancel', (e) => {
        if (!this.isShown) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.advance();
      });
    }

    get isShown() {
      return !this.layer.hidden;
    }

    // Type `text`, popping the call up after `delayMs` (e.g. once the window has booted up).
    // `audio` (radio blip) defaults to the one given to the constructor.
    say(text, delayMs = 0, audio = this.audio) {
      this.hide();
      this.typer.say(text, audio, delayMs);
      if (delayMs > 0) {
        this._showTimer = setTimeout(() => {
          this._showTimer = null;
          this._show();
        }, delayMs);
      } else {
        this._show();
      }
    }

    // Still typing → show the whole line; already read → dismiss the call
    advance() {
      if (this.typer.isBusy) {
        this.typer.finish();
        return;
      }
      this.hide();
    }

    // Stop talking and take the call down (window closing)
    stop() {
      this.typer.stop();
      this.hide();
    }

    hide() {
      if (this._showTimer != null) {
        clearTimeout(this._showTimer);
        this._showTimer = null;
      }
      if (this.layer.hidden) return;
      const hadFocus = this.layer.contains(document.activeElement);
      this.layer.hidden = true;
      const back = this._returnFocus;
      this._returnFocus = null;
      if (hadFocus && back && back.isConnected && !back.disabled && !back.hidden) back.focus({ preventScroll: true });
    }

    _show() {
      if (!this.layer.hidden) return;
      const active = document.activeElement;
      this._returnFocus = active && this.dialog.contains(active) ? active : null;
      this.layer.hidden = false;
      this.panel.focus({ preventScroll: true });
    }
  }

  global.MioCall = MioCall;
})(window);
