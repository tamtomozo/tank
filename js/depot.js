(function (global) {
  'use strict';

  // Supply-depot menu (#garage-dialog), opened on the white flag of a compound in a secured
  // district (js/game/mission.js). Two services: a free full resupply and wingman reinforcement
  // for scrap. Tanks are no longer upgraded here — they are tuned before the sortie on the
  // briefing's radar charts (js/tuningPanel.js).

  const { el } = global.TankUtil;

  const REINFORCE_COST = 70; // scrap per replacement wingman

  class DepotMenu {
    constructor(dialogEl, audio) {
      this.dialog = dialogEl;
      this.audio = audio;
      this.gridEl = document.getElementById('depot-grid');
      this.scrapEl = document.getElementById('garage-scrap');
      this.bodyEl = dialogEl.querySelector('.garage-body');
      this.cards = null;

      this._setupDialogBehavior();
    }

    _setupDialogBehavior() {
      // ✕ / Esc / backdrop click play the HUD frame's closing sequence before the window closes
      global.HudFrame.animateCloses(this.dialog);

      // Fallback for browsers without native closedby="any" (e.g. Safari)
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        const outside = (e) => {
          const r = this.dialog.getBoundingClientRect();
          return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        };
        let pressedOutside = false;
        this.dialog.addEventListener('pointerdown', (e) => {
          pressedOutside = outside(e);
        });
        this.dialog.addEventListener('pointerup', (e) => {
          if (pressedOutside && outside(e)) this.close();
        });
      }

      this.dialog.addEventListener('close', () => {
        // Reset returnValue to prevent stale values across openings
        this.dialog.returnValue = '';
      });
    }

    open(player, combat, squad, onChange) {
      this.player = player;
      this.combat = combat;
      this.squad = squad;
      this.onChange = onChange;
      // The cards are built once per opening and then only updated in place, so using a service
      // never reflows the window or drops keyboard focus.
      this._build();
      this.render();
      if (!this.dialog.open) {
        if (this.bodyEl) this.bodyEl.scrollTop = 0;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
      }
    }

    close() {
      global.HudFrame.closeDialog(this.dialog, '');
    }

    _card(cls, title, desc, onClick) {
      const card = el('article', `upgrade-card ${cls}`);
      const top = el('div', 'upgrade-card-top');
      const badge = el('span', 'upgrade-lv');
      top.append(el('h3', '', title), badge);
      const btn = el('button', 'btn-upgrade');
      btn.type = 'button';
      btn.addEventListener('click', onClick);
      const footer = el('div');
      footer.appendChild(btn);
      card.append(top, el('p', 'upgrade-desc', desc), footer);
      return { card, badge, btn };
    }

    _build() {
      const supply = this._card('is-supply', '補給（全回復）',
        '自機と全僚機の装甲を全回復し、主砲の装填も完了する。スクラップ不要。',
        () => this._resupply());
      const reinforce = this._card('is-squad', '僚機補充',
        `撃破された僚機を1両補充する（⚙ ${REINFORCE_COST}）。小隊は自機を含め最大5両。補充機も僚機の車両調整を引き継ぐ。`,
        () => this._reinforce());
      this.cards = { supply, reinforce };
      this.gridEl.replaceChildren(supply.card, reinforce.card);
    }

    _resupply() {
      if (!this.combat.needsResupply(this.player)) return;
      this.combat.resupply(this.player);
      this._afterUse();
    }

    _reinforce() {
      if (!this.squad.canReinforce() || this.combat.scrap < REINFORCE_COST) return;
      this.combat.scrap -= REINFORCE_COST;
      this.squad.spawnAlly(this.player);
      this.audio.playUpgrade();
      this._afterUse();
    }

    _afterUse() {
      if (this.onChange) this.onChange();
      this.render();
    }

    // Refresh every value in place (the DOM built by _build stays as it is)
    render() {
      const { player, combat, squad, cards } = this;
      if (!player || !combat || !cards) return;
      this.scrapEl.textContent = String(combat.scrap);

      const needs = combat.needsResupply(player);
      cards.supply.badge.textContent = `HP ${Math.ceil(player.hp)}/${player.maxHp}`;
      cards.supply.btn.disabled = !needs;
      cards.supply.btn.textContent = needs ? '補給する（無料）' : '全車両 満タンです';

      const canAdd = squad.canReinforce();
      cards.reinforce.badge.textContent = `小隊 ${squad.size}/${squad.maxSize}`;
      cards.reinforce.btn.disabled = !canAdd || combat.scrap < REINFORCE_COST;
      cards.reinforce.btn.textContent = canAdd ? `補充する (⚙ ${REINFORCE_COST})` : '小隊は満員です';
    }
  }

  global.DepotMenu = DepotMenu;
})(window);
