(function (global) {
  'use strict';

  // Sortie select, shown before the briefing of every sortie. Two separate screens:
  //   ① planet select    (#planet-dialog,    js/planetSelect.js)
  //   ② operation select (#operation-dialog, js/operationSelect.js)
  // Picking a planet closes ① and opens ② for that planet; ◀ / Esc on ② goes back to ①.
  // Picking an operation closes ② and hands { planet, operation } to the caller, which opens the
  // briefing (js/game/mission.js). Mio guides each screen in a call floating at the centre.
  // The operations-meeting BGM (js/bgm.js) starts with the first screen and runs until the briefing
  // closes with 作戦開始. The very first opening waits behind the title screen (js/titleScreen.js):
  // its click / key press is also what lets the browser play sound.

  const { PLANETS } = global.GameData; // js/data/operations.js

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
      this.title = new global.TitleScreen(document.getElementById('title-screen'), audio);
      this._titleShown = false; // the title screen comes up once, on the first opening after page load

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
      return this.planets.isOpen || this.operations.isOpen || this.title.isOpen;
    }

    // onSelect({ planet, operation }) runs once an operation has been picked.
    // options.planetId reopens straight on that planet's operation list (back from the briefing).
    // options.award: a medal to present over the planet select (after a completed operation).
    open(onSelect, { planetId = null, delayMs = OPEN_DELAY_MS, award = null } = {}) {
      this.onSelect = onSelect;
      // First opening after page load: the title screen first. Its gesture also unlocks audio
      // (autoplay policy), so the BGM starts with the window.
      if (!this._titleShown) {
        this._titleShown = true;
        this.title.waitForStart(() => this._show(planetId, delayMs, award));
        return;
      }
      this._show(planetId, delayMs, award);
    }

    _show(planetId, delayMs, award) {
      const planet = planetId != null ? PLANETS.find((p) => p.id === planetId && p.available) : null;
      if (planet) this.operations.open(planet, delayMs);
      else this.planets.open(null, delayMs, award);
    }
  }

  global.SortieScreen = SortieScreen;
  global.SortieSelect = SortieSelect;
})(window);
