(function (global) {
  'use strict';

  // Staff credits (.title-credits in #title-screen, css/credits.css), opened from the title's
  // STAFF CREDITS link (js/titleScreen.js). Over the title's starfield the credits roll up like the
  // end of a film: the cast (operator, commander), the operations taken on each planet, the medals
  // earned, the developers, and last "THANK YOU FOR PLAYING", where the roll stops in the middle
  // of the screen. The campaign parts are built from the saved progress (js/campaign.js) on every
  // opening. The wheel, a drag or the arrow keys move the roll by hand; Esc or ✕ closes it.

  const ROLL_BOX_SEC = 11; // seconds to move one screen height
  const START_DELAY_MS = 500;
  const KEY_STEP = 80; // px per arrow key press

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  class TitleCredits {
    constructor(root) {
      this.root = root;
      this.viewport = root.querySelector('.credits-viewport');
      this.track = root.querySelector('.credits-track');
      this.progress = root.querySelector('.credits-progress');
      this.endBox = root.querySelector('.credits-end');
      this.closeBtn = root.querySelector('.credits-close');
      this.backBtn = root.querySelector('.credits-back');
      this.onClose = null;
      this.rolled = 0; // px the text has risen since its top was at the bottom of the box
      this._raf = null;
      this._last = null;
      this._startAt = 0;
      this._drag = null;
      this._returnFocus = null;
      this._loop = (now) => this._frame(now);

      this.closeBtn.addEventListener('click', () => this.close());
      this.backBtn.addEventListener('click', () => this.close());
      // On the window: a click on the roll leaves the focus on the page, not in the credits
      window.addEventListener('keydown', (e) => {
        if (this.isOpen) this._onKey(e);
      });
      this.viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._nudge(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
      }, { passive: false });
      this.viewport.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        this._drag = { id: e.pointerId, y: e.clientY };
        this.viewport.setPointerCapture(e.pointerId);
      });
      this.viewport.addEventListener('pointermove', (e) => {
        if (!this._drag || this._drag.id !== e.pointerId) return;
        this._nudge(this._drag.y - e.clientY);
        this._drag.y = e.clientY;
      });
      const endDrag = (e) => {
        if (this._drag && this._drag.id === e.pointerId) this._drag = null;
      };
      this.viewport.addEventListener('pointerup', endDrag);
      this.viewport.addEventListener('pointercancel', endDrag);
    }

    get isOpen() {
      return !this.root.hidden;
    }

    open() {
      if (this.isOpen) return;
      this._returnFocus = document.activeElement;
      this._build();
      this.root.hidden = false;
      this.rolled = 0;
      this._last = null;
      this._startAt = performance.now() + START_DELAY_MS;
      this.endBox.classList.remove('is-shown');
      this._place();
      this._raf = requestAnimationFrame(this._loop);
      this.closeBtn.focus({ preventScroll: true });
    }

    close() {
      if (!this.isOpen) return;
      this.root.hidden = true;
      cancelAnimationFrame(this._raf);
      this._raf = null;
      this._drag = null;
      if (this.onClose) this.onClose(); // first: it makes the link focusable again
      if (this._returnFocus && this._returnFocus.focus) this._returnFocus.focus({ preventScroll: true });
      this._returnFocus = null;
    }

    _onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        this._nudge(e.key === 'PageDown' ? this.viewport.clientHeight * 0.8 : KEY_STEP);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        this._nudge(-(e.key === 'PageUp' ? this.viewport.clientHeight * 0.8 : KEY_STEP));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        this.rolled = e.key === 'Home' ? 0 : this._end();
        this._place();
      }
    }

    // ------------------------------------------------------------------ roll
    // The roll ends with the closing line in the middle of the box
    _end() {
      const box = this.viewport.clientHeight;
      const last = this.track.lastElementChild;
      if (!last) return 0;
      return Math.max(0, box / 2 + last.offsetTop + last.offsetHeight / 2);
    }

    _nudge(dy) {
      this.rolled = Math.max(0, Math.min(this._end(), this.rolled + dy));
      this._startAt = 0; // moved by hand: roll on from here at once
      this._place();
    }

    _frame(now) {
      const dt = this._last != null ? Math.min(0.05, (now - this._last) / 1000) : 0;
      this._last = now;
      if (!this._drag && now >= this._startAt) {
        const box = this.viewport.clientHeight;
        this.rolled = Math.min(this._end(), this.rolled + (box / ROLL_BOX_SEC) * dt);
      }
      this._place();
      this._raf = requestAnimationFrame(this._loop);
    }

    _place() {
      const box = this.viewport.clientHeight;
      const end = this._end();
      this.track.style.transform = `translateY(${(box - this.rolled).toFixed(2)}px)`;
      if (this.progress) this.progress.style.setProperty('--p', end ? (this.rolled / end).toFixed(4) : 0);
      // "Back to title" comes up once the closing line has settled
      this.endBox.classList.toggle('is-shown', end > 0 && this.rolled >= end - 1);
    }

    // ------------------------------------------------------------------ content
    _build() {
      this._buildOperations(this.root.querySelector('.credits-ops'));
      this._buildMedals(this.root.querySelector('.credits-medals'));
    }

    // Operations taken, planet by planet (a planet with none yet says so)
    _buildOperations(box) {
      if (!box) return;
      box.replaceChildren();
      const campaign = global.Campaign;
      for (const planet of global.GameData.PLANETS) {
        const block = el('div', 'credits-planet');
        const head = el('div', 'credits-planet-head');
        if (global.PlanetGlobe) head.append(global.PlanetGlobe.create(planet));
        const name = el('strong', 'credits-planet-name', planet.name);
        name.style.color = planet.globe.glow;
        head.append(name);
        block.append(head);
        const cleared = planet.operations.filter((op) => campaign && campaign.isCleared(op.id));
        if (cleared.length) {
          const list = el('ul', 'credits-op-list');
          for (const op of cleared) {
            list.append(el('li', 'credits-op', L(`「${op.name}」`, `"${op.name}"`)));
          }
          block.append(list);
        } else {
          block.append(el('p', 'credits-none', L('— 未制圧 —', '— Not yet taken —')));
        }
        box.append(block);
      }
    }

    // Every medal earned, in campaign order, and how many of each metal
    _buildMedals(box) {
      if (!box) return;
      box.replaceChildren();
      const campaign = global.Campaign;
      const Medal = global.Medal;
      if (!campaign || !Medal) return;
      const row = el('div', 'credits-medal-row');
      const counts = {};
      for (const planet of global.GameData.PLANETS) {
        for (const op of planet.operations) {
          const rank = campaign.bestRank(op.id);
          if (!rank) continue;
          counts[rank] = (counts[rank] || 0) + 1;
          const medal = Medal.create(rank);
          const label = L(`${planet.name}「${op.name}」— ${Medal.name(rank)}`, `${planet.name} "${op.name}" — ${Medal.name(rank)}`);
          medal.setAttribute('aria-label', label);
          const item = el('span', 'credits-medal');
          item.title = label;
          item.append(medal);
          row.append(item);
        }
      }
      if (!row.childElementCount) {
        box.append(el('p', 'credits-none', L('— まだ勲章はありません —', '— No medals yet —')));
        return;
      }
      const tally = el('p', 'credits-medal-tally');
      for (const rank of Medal.RANKS) {
        if (!counts[rank]) continue;
        const part = el('span', 'credits-medal-count', `${Medal.name(rank)} ×${counts[rank]}`);
        part.dataset.rank = rank;
        tally.append(part);
      }
      box.append(row, tally);
    }
  }

  global.TitleCredits = TitleCredits;
})(window);
