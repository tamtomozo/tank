(function (global) {
  'use strict';

  // Sortie-select screen, shown before the briefing of every sortie.
  // Two phases in one window: ① pick an area → ② pick an operation in that area.
  // Picking an operation closes the window and hands { area, operation } to the caller,
  // which opens the briefing (js/game/mission.js). Mio guides each phase at the bottom.
  // Esc on the operation list goes back to the area list; on the area list it does nothing.
  // The operations-meeting BGM (js/bgm.js) starts with this window and runs until the briefing
  // closes with 作戦開始.

  const { AREAS } = global.GameData; // js/data/operations.js
  const { el } = global.TankUtil;

  const OPEN_DELAY_MS = 900; // pause on the empty battlefield before the window starts drawing
  const BOOT_INTRO_MS = 1450; // boot-up sequence length before Mio starts talking (css/hudframe.css)

  class AreaSelectScene {
    constructor(dialog, deps) {
      this.dialog = dialog;
      this.audio = deps.audio;

      this.areaPhase = dialog.querySelector('#area-phase-area');
      this.opPhase = dialog.querySelector('#area-phase-op');
      this.areaList = dialog.querySelector('#area-list');
      this.opList = dialog.querySelector('#op-list');
      this.opContext = dialog.querySelector('#area-op-context');
      this.flowSteps = [...dialog.querySelectorAll('.area-flow-step')];
      this.btnBack = dialog.querySelector('#area-back');

      this.mio = new global.Typewriter(
        dialog.querySelector('#area-mio-text'),
        dialog.querySelector('#area-mio-sr')
      );

      this.area = null; // area whose operations are listed (operation phase)
      this.onSelect = null;
      this._openTimer = null;
      this._selection = null;

      this.btnBack.addEventListener('click', () => this.showAreas());
      // Closing sequence + cleanup; Esc is handled below (back to the area list)
      global.HudFrame.animateCloses(dialog, { allowEsc: false });
      dialog.addEventListener('cancel', () => {
        if (this.area) this.showAreas();
      });
      dialog.addEventListener('close', () => {
        this.mio.stop();
        const sel = this._selection;
        const cb = this.onSelect;
        this._selection = null;
        this.onSelect = null;
        if (sel) {
          if (cb) cb(sel);
        } else if (cb) {
          // Closed without a pick (the browser can force-close a modal on repeated Esc):
          // there is no sortie without an operation, so show the screen again
          this.open(cb, { areaId: this.area ? this.area.id : null, delayMs: 0 });
        }
      });
    }

    // True while the window is shown OR waiting to appear (the game stays paused either way)
    get isOpen() {
      return this.dialog.open || this._openTimer != null;
    }

    // onSelect({ area, operation }) runs once an operation has been picked.
    // options.areaId reopens straight on that area's operation list (back from the briefing).
    open(onSelect, { areaId = null, delayMs = OPEN_DELAY_MS } = {}) {
      this.onSelect = onSelect;
      this._selection = null;
      const area = areaId != null ? AREAS.find((a) => a.id === areaId && a.available) : null;
      if (this._openTimer != null) clearTimeout(this._openTimer);
      this._openTimer = setTimeout(() => {
        this._openTimer = null;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
        this.audio.startBriefingBgm(); // keeps playing on into the briefing
        if (area) this.showOperations(area, BOOT_INTRO_MS);
        else this.showAreas(BOOT_INTRO_MS);
      }, delayMs);
    }

    // ---------------------------------------------------------------- phase ① areas
    showAreas(sayDelayMs = 0) {
      const prev = this.area;
      this.area = null;
      this._setPhase(0);
      this.areaList.replaceChildren(...AREAS.map((area) => this._areaCard(area)));
      // Keep keyboard focus on the area the player just came back from
      const focusId = prev ? prev.id : (AREAS.find((a) => a.available) || {}).id;
      const focus = this.areaList.querySelector(`[data-area-id="${focusId}"]`);
      if (focus) focus.focus();
      this._say('隊長、出撃する作戦区域を選択してください。', sayDelayMs);
    }

    _areaCard(area) {
      const card = el('button', `area-card${area.available ? '' : ' is-locked'}`);
      card.type = 'button';
      card.dataset.areaId = String(area.id);
      card.disabled = !area.available;
      const head = el('div', 'area-card-head');
      head.append(
        el('span', 'area-card-code', area.code),
        el('span', `area-card-state${area.available ? '' : ' is-locked'}`, area.available ? '出撃可能' : '未解放')
      );
      card.append(
        head,
        el('strong', 'area-card-name', area.available ? `${area.name}（${area.terrain}）` : area.name),
        el('p', 'area-card-summary', area.summary),
        el('p', 'area-card-ops', area.available ? `作戦 ${area.operations.length} 件` : '作戦なし')
      );
      if (area.available) card.addEventListener('click', () => this.showOperations(area));
      return card;
    }

    // ---------------------------------------------------------------- phase ② operations
    showOperations(area, sayDelayMs = 0) {
      this.area = area;
      this._setPhase(1);
      this.opContext.replaceChildren(
        el('span', 'area-card-code', area.code),
        el('strong', '', `${area.name}（${area.terrain}）の作戦`)
      );
      this.opList.replaceChildren(...area.operations.map((op) => this._opCard(area, op)));
      const first = this.opList.querySelector('button');
      if (first) first.focus();
      this._say(`${area.name}で実行可能な作戦です。作戦名を選んでください。選んだ作戦のブリーフィングに移ります。`, sayDelayMs);
    }

    _opCard(area, op) {
      const card = el('button', 'op-card');
      card.type = 'button';
      const body = el('div', 'op-card-body');
      body.append(
        el('span', 'op-card-label', '作戦名'),
        el('strong', 'op-card-name', `「${op.name}」`),
        el('p', 'op-card-goal', `目標: ${op.goal}`),
        el('p', 'op-card-summary', op.summary)
      );
      card.append(body, el('span', 'op-card-go', 'ブリーフィングへ ▶'));
      card.addEventListener('click', () => {
        if (this.dialog.classList.contains('is-closing')) return;
        this._selection = { area, operation: op };
        global.HudFrame.closeDialog(this.dialog, 'select');
      });
      return card;
    }

    // ---------------------------------------------------------------- helpers
    _setPhase(index) {
      this.areaPhase.hidden = index !== 0;
      this.opPhase.hidden = index !== 1;
      this.btnBack.hidden = index !== 1;
      this.flowSteps.forEach((step, i) => {
        step.classList.toggle('is-active', i === index);
        step.classList.toggle('is-done', i < index);
        if (i === index) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
    }

    _say(text, delayMs = 0) {
      this.mio.say(text, this.audio, delayMs);
    }
  }

  global.AreaSelectScene = AreaSelectScene;
})(window);
