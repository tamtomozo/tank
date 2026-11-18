(function (global) {
  'use strict';

  // HQ operator radio: every on-screen report (mission flow, alerts, supply notices, control-mode
  // changes) is delivered as a typed-out radio message from the operator, shown at upper centre.
  // Driven by the game loop (update(dt) only runs while the game runs), so messages never play out
  // unseen behind a modal menu; they simply resume when the menu closes.

  const CHARS_PER_SEC = global.Typewriter.CHARS_PER_SEC; // Mio's typing speed (typewriter.js)
  const BASE_HOLD = 2.6; // seconds a finished message stays up (+ a little per character)
  const HOLD_PER_CHAR = 0.035;
  const HOLD_WHEN_QUEUED = 1.3; // shorter hold when more reports are waiting
  // Panel appearing from hidden: its HUD frame draws first (css/hudframe.css, --bt 0.5); typing starts after
  const BOOT_TIME = 0.7;
  // Closing sequence length at the panel's --bt 0.5 (HudFrame.CLOSE_MS is for --bt 1)
  const CLOSE_TIME = 0.35;

  const { pick } = global.TankUtil;

  class RadioComms {
    constructor(panelEl, audio) {
      this.panel = panelEl || null;
      this.audio = audio;
      this.textEl = this.panel ? this.panel.querySelector('.radio-text') : null;
      this.srEl = this.panel ? this.panel.querySelector('.radio-sr') : null;
      this.queue = [];
      this.current = null;
      this.shown = 0;
      this.hold = 0;
      this.bootWait = 0;
      this.closeWait = 0;
    }

    // opts.priority === 'high': jump ahead of waiting reports (alerts)
    // opts.key: only the newest report with this key is kept (e.g. repeated control-mode toggles)
    // opts.onDone: called once this report has been fully shown and its hold time has passed
    // opts.lockControls: the player can't drive or fire while this report is waiting or on screen
    say(text, opts = {}) {
      if (!this.panel || !text) {
        if (opts.onDone) opts.onDone(); // no radio panel: don't block what follows the report
        return;
      }
      const msg = { text, key: opts.key || null, onDone: opts.onDone || null, lockControls: !!opts.lockControls };
      if (msg.key) {
        this.queue = this.queue.filter((m) => m.key !== msg.key);
        if (this.current && this.current.key === msg.key) this.current = null; // replace on screen
      }
      if (opts.priority === 'high') this.queue.unshift(msg);
      else this.queue.push(msg);
    }

    // Nothing being transmitted and nothing waiting
    get isIdle() {
      return !this.current && this.queue.length === 0;
    }

    // A control-locking report (area secured / back at the HQ) is on screen or still queued
    get controlsLocked() {
      return (!!this.current && this.current.lockControls) || this.queue.some((m) => m.lockControls);
    }

    clear() {
      this.queue = [];
      this.current = null;
      this.bootWait = 0;
      this.closeWait = 0;
      if (!this.panel) return;
      this.panel.classList.remove('is-visible', 'is-typing', 'is-booting', 'is-closing', 'is-locked');
      if (this.textEl) this.textEl.textContent = '';
      if (this.srEl) this.srEl.textContent = '';
    }

    update(dt) {
      if (!this.panel || !this.textEl) return;

      // Closing sequence playing: let it finish before the panel hides (or shows the next report)
      if (this.closeWait > 0) {
        this.closeWait -= dt;
        if (this.closeWait > 0) return;
        // Keep `is-closing` until the next boot-up: it holds the panel invisible with no slide-out
        this.panel.classList.remove('is-visible', 'is-locked');
      }

      if (!this.current) {
        if (this.queue.length === 0) return;
        this.current = this.queue.shift();
        this.shown = 0; // every report is always typed out one character at a time
        this.hold = BASE_HOLD + this.current.text.length * HOLD_PER_CHAR;
        this.textEl.textContent = '';
        if (this.srEl) this.srEl.textContent = this.current.text; // screen readers get the full line at once
        if (!this.panel.classList.contains('is-visible')) {
          // Popping up from hidden: replay the HUD frame boot-up, then start typing
          global.HudFrame.boot(this.panel);
          this.bootWait = BOOT_TIME;
        }
        this.panel.classList.add('is-visible', 'is-typing');
        if (this.audio && this.audio.playRadio) this.audio.playRadio();
      }
      this.panel.classList.toggle('is-locked', this.controlsLocked);

      if (this.bootWait > 0) {
        this.bootWait -= dt;
        return;
      }

      const text = this.current.text;
      if (this.shown < text.length) {
        const before = Math.floor(this.shown);
        this.shown = Math.min(text.length, this.shown + CHARS_PER_SEC * dt);
        // Only touch the text when another character has appeared (not on every frame: each
        // write makes the browser lay the panel out again)
        if (Math.floor(this.shown) !== before) this.textEl.textContent = text.slice(0, Math.floor(this.shown));
        if (this.shown < text.length) return;
      }
      if (this.textEl.textContent !== text) this.textEl.textContent = text;
      this.panel.classList.remove('is-typing');

      if (this.queue.length > 0) this.hold = Math.min(this.hold, HOLD_WHEN_QUEUED);
      this.hold -= dt;
      if (this.hold > 0) return;
      const done = this.current.onDone;
      this.current = null;
      if (done) done();
      // Keep the panel up when another report is waiting; otherwise play the closing sequence
      if (this.queue.length === 0) {
        this.panel.classList.remove('is-locked');
        global.HudFrame.shutDown(this.panel);
        this.closeWait = CLOSE_TIME;
      }
    }
  }

  // Report scripts (original lines for this game's HQ operator, Mio)
  RadioComms.script = {
    // Sortie begins (selection = { planet, operation }): the operation's own lines, in order
    missionStart(selection) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.start) return op.radio.start;
      const n = op && op.sites ? op.sites.length : 0;
      return [`こちら作戦本部、オペレーターのミオです。作戦を開始します。敵拠点は全${n}か所、すべて制圧してください。`];
    },

    controlMode(isDirect) {
      return isDirect
        ? '操縦モードを「方向移動」に切り替えました。押した方向へそのまま進みます。'
        : '操縦モードを「戦車操縦」に戻しました。前後進と旋回で操作してください。';
    },

    baseAlert(baseName) {
      return pick([
        `警報！ 敵拠点${baseName}がこちらに気づきました。待機車両が出撃してきます、注意してください！`,
        `敵拠点${baseName}に動きあり！ 待機していた車両が出撃しました。迎撃してください！`
      ]);
    },

    // Compound captured: one short line in the form "◯は△です"
    baseCaptured(baseName) {
      return `拠点${baseName}は制圧完了です。`;
    },

    // After the first capture of a sortie: captured compounds serve as supply depots
    supplyAvailable(baseName) {
      return `制圧した拠点では、白旗まわりの円に入ると補給と僚機の補充が可能です。拠点${baseName}も利用できます。`;
    },

    // Objective done: separate transmissions, in order (returns an array of lines).
    // The platoon is ordered back to the operations HQ.
    areaSecured(selection, planetName) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.complete) return op.radio.complete;
      return [
        `${planetName}の目標は全拠点制圧です。現刻をもって作戦行動完了です。`,
        '作戦本部へ帰還してください、隊長。本部の位置を送ります。'
      ];
    },

    // ---- hold the area (operation.hold) ----
    holdStart(selection, hold) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.holdStart) return op.radio.holdStart;
      return [`拠点を確保しました。${hold.duration}秒間、まわりの円から離れずに守り抜いてください！`];
    },

    holdLeft() {
      return '封鎖線から離れています！ 黄色い円の中に戻ってください。カウントが止まっています！';
    },

    holdBack() {
      return '封鎖線に戻りました。カウントを再開します。';
    },

    holdHalf(left) {
      return `あと${left}秒です！ 持ちこたえてください！`;
    },

    holdWave() {
      return '敵の増援を確認！ 四方から接近してきます！';
    },

    // ---- environment (js/game/hazards.js) ----
    stormIncoming() {
      return pick([
        '砂嵐が来ます！ 視界がほぼなくなります。敵からもこちらは見えません、接近するなら今です。',
        '砂嵐、接近中です！ 嵐の中なら気づかれずに拠点へ近づけます。'
      ]);
    },

    stormPassing() {
      return '砂嵐が抜けていきます。視界が戻ります。敵にも見つかりやすくなりますよ。';
    },

    heatWarning() {
      return 'エンジン温度が上がっています。少し速度を落としてください。';
    },

    overheat() {
      return 'オーバーヒートです！ エンジンが冷えるまで速度が落ちます！';
    },

    heatRecovered() {
      return 'エンジン温度、正常に戻りました。';
    },

    // The player has driven back onto the HQ pad after securing the planet
    hqReturned() {
      return '作戦本部への帰還を確認しました。お疲れさまでした、隊長。';
    },

    supplyBlocked(baseName) {
      return `交戦中です。補給は敵を退けてからにしてください。拠点${baseName}で待っています。`;
    }
  };

  global.RadioComms = RadioComms;
})(window);
