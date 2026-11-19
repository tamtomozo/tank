(function (global) {
  'use strict';

  // Medal ceremony: after a completed operation, the planet select (js/planetSelect.js) opens with
  // this notice cutting in over it — the medal earned (js/medal.js) shown large, with a fanfare.
  // 了解 (or Enter / Esc) dismisses it, then the screen carries on as usual.
  // award = { rank, score, planetName, operationName, prevRank } (js/game/mission.js)
  // Built inside the given <dialog> so it sits in the same top layer. Colours: css/medalAward.css.

  const { el } = global.TankUtil;

  class MedalAward {
    constructor(dialog, audio) {
      this.dialog = dialog;
      this.audio = audio;
      this._timer = null;
      this._onDone = null;

      this.layer = el('div', 'award-layer');
      this.layer.hidden = true;
      this.panel = el('div', 'award-panel');
      this.panel.setAttribute('role', 'alertdialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-labelledby', 'award-heading');
      this.panel.setAttribute('aria-describedby', 'award-text');
      this.layer.append(this.panel);
      dialog.append(this.layer);

      // Esc while it is up only dismisses it (registered after MioCall, which ignores Esc while
      // it is hidden)
      dialog.addEventListener('cancel', (e) => {
        if (!this.isShown) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.dismiss();
      });
    }

    // Up on screen (not while still waiting to cut in: Esc then must not cancel it)
    get isShown() {
      return !this.layer.hidden;
    }

    // Cut in after delayMs; onDone runs once it has been dismissed
    show(award, delayMs, onDone) {
      this.stop();
      this._onDone = onDone;
      this._build(award);
      this._timer = setTimeout(() => {
        this._timer = null;
        this.layer.hidden = false;
        this._setBackgroundInert(true);
        if (this.audio && this.audio.playFanfare) this.audio.playFanfare(award.rank === 'S');
        const ok = this.panel.querySelector('.award-ok');
        if (ok) ok.focus();
      }, delayMs);
    }

    dismiss() {
      if (this.layer.hidden) return;
      this.layer.hidden = true;
      this._setBackgroundInert(false);
      const cb = this._onDone;
      this._onDone = null;
      if (cb) cb();
    }

    // Take it down without carrying on (window closing)
    stop() {
      if (this._timer != null) clearTimeout(this._timer);
      this._timer = null;
      this._onDone = null;
      this.layer.hidden = true;
      this._setBackgroundInert(false);
    }

    // The screen underneath can't be reached (Tab / clicks) while the notice is up
    _setBackgroundInert(on) {
      for (const child of this.dialog.children) {
        if (child !== this.layer) child.inert = on;
      }
    }

    _build(a) {
      const Medal = global.Medal;
      const name = Medal.name(a.rank);
      this.panel.dataset.rank = a.rank;

      const medal = el('div', 'award-medal');
      medal.append(el('span', 'award-rays'), Medal.create(a.rank, 'is-award'));

      const improved = a.prevRank && Medal.isBetter(a.rank, a.prevRank);
      const ok = el('button', 'btn-primary-lg award-ok', L('了解', 'Roger'));
      ok.type = 'button';
      ok.addEventListener('click', () => this.dismiss());

      const heading = el('h3', 'award-name', name);
      heading.id = 'award-heading';
      const text = el('p', 'award-text', L(`${a.planetName}「${a.operationName}」作戦の完遂を称え、\nここに${name}を授与する。`,
        `For completing Operation "${a.operationName}" on ${a.planetName},\nyou are hereby awarded the ${name}.`));
      text.id = 'award-text';

      this.panel.replaceChildren(
        el('div', 'dialog-badge success award-badge', L('DECORATION — 勲章授与', 'DECORATION')),
        medal,
        heading,
        el('p', 'award-grade', `${Medal.grade(a.rank)}　SCORE ${a.score}`),
        text,
        // First medal of this operation, or a better one than before
        ...(!a.prevRank ? [el('p', 'award-note is-first', L('★ 初受章', '★ First decoration'))] : []),
        ...(improved ? [el('p', 'award-note', L(`▲ 最高評価を更新（${Medal.name(a.prevRank)} → ${name}）`, `▲ New best (${Medal.name(a.prevRank)} → ${name})`))] : []),
        ok
      );
    }
  }

  global.MedalAward = MedalAward;
})(window);
