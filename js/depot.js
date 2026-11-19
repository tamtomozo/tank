(function (global) {
  'use strict';

  // Supply-depot menu (#garage-dialog), opened on the white flag of a captured compound
  // (js/game/mission.js). Two services: a free full resupply and wingman reinforcement
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
      this._sweepChoice = null;
      this._showScrap(true);
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

    // Sweep operation (js/sweep.js), on the flag of the compound captured last in a wave: recover
    // and go on, or go on as is. onChoose(recover) runs, then the window closes. Closing it with ✕
    // leaves the choice open (it is offered again on the next visit).
    openSweep(player, combat, squad, { wave, rounds, onChoose, onChange = null }) {
      this.player = player;
      this.combat = combat;
      this.squad = squad;
      this.onChange = onChange;
      this.cards = null; // (render() is for the field depot only)
      this._sweepChoice = onChoose;
      const recover = this._card('is-supply', L('回復して次へ', 'Recover & go on'),
        L('自機と全僚機の装甲を全回復し、弾薬と主砲の装填も完了。撃破された僚機も補充して（最大4両）、次の10拠点へ進む。回復は波ごとに1回だけ。',
          'Fully restores the armor of your tank and every wingman, refills ammo and reloads the gun, and replaces lost wingmen (up to 4). Then on to the next 10 compounds. One recovery per wave.'),
        () => this._chooseSweep(true));
      const skip = this._card('is-squad', L('回復せずに次へ', 'Go on as is'),
        L('今の状態のまま、次の10拠点へ進む。', 'Go on to the next 10 compounds as you are.'),
        () => this._chooseSweep(false));
      recover.badge.textContent = `HP ${Math.ceil(player.hp)}/${player.maxHp}`;
      recover.btn.textContent = L('回復して進む', 'Recover & go on');
      skip.badge.textContent = L(`第${wave + 1}波 / 全${rounds}波`, `Wave ${wave + 1} of ${rounds}`);
      skip.btn.textContent = L('このまま進む', 'Go on as is');
      this.gridEl.replaceChildren(recover.card, skip.card);
      this._showScrap(false); // (scrap buys nothing on a sweep)
      if (!this.dialog.open) {
        if (this.bodyEl) this.bodyEl.scrollTop = 0;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
      }
    }

    _showScrap(on) {
      const pill = this.dialog.querySelector('.garage-scrap-pill');
      if (pill) pill.hidden = !on;
    }

    _chooseSweep(recover) {
      const cb = this._sweepChoice;
      this._sweepChoice = null;
      if (!cb) return;
      cb(recover);
      if (this.onChange) this.onChange();
      this.close();
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
      const supply = this._card('is-supply', L('補給（全回復）', 'Resupply (full)'),
        L('自機と全僚機の装甲を全回復し、主砲の装填も完了する。スクラップ不要。', 'Fully restores the armor of your tank and every wingman, and reloads the main gun. Free.'),
        () => this._resupply());
      const reinforce = this._card('is-squad', L('僚機補充', 'Reinforce'),
        L(`撃破された僚機を1両補充する（⚙ ${REINFORCE_COST}）。小隊は自機を含め最大5両。補充機も僚機の車両調整を引き継ぐ。`,
          `Replace one destroyed wingman (⚙ ${REINFORCE_COST}). Up to 5 tanks including yours. Replacements keep the wingmen's tuning.`),
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
      cards.supply.btn.textContent = needs ? L('補給する（無料）', 'Resupply (free)') : L('全車両 満タンです', 'All tanks are full');

      const canAdd = squad.canReinforce();
      cards.reinforce.badge.textContent = L(`小隊 ${squad.size}/${squad.maxSize}`, `Platoon ${squad.size}/${squad.maxSize}`);
      cards.reinforce.btn.disabled = !canAdd || combat.scrap < REINFORCE_COST;
      cards.reinforce.btn.textContent = canAdd ? L(`補充する (⚙ ${REINFORCE_COST})`, `Reinforce (⚙ ${REINFORCE_COST})`) : L('小隊は満員です', 'Platoon is full');
    }
  }

  global.DepotMenu = DepotMenu;
})(window);
