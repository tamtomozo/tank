(function (global) {
  'use strict';

  // Upgrade catalogue: js/data/upgrades.js
  const { UPGRADE_DEFS, UPGRADE_GROUP_TITLES: GROUP_TITLES } = global.GameData;
  const { el } = global.TankUtil;

  function freshLevels() {
    return {
      cannon: 1,
      reload: 1,
      armor: 1,
      engine: 1,
      subweapon: 0,
      allyArmor: 1,
      allyGun: 1,
      allyEngine: 1
    };
  }

  class UpgradeManager {
    constructor(dialogEl, audio) {
      this.dialog = dialogEl;
      this.audio = audio;
      this.gridEl = document.getElementById('upgrade-grid');
      this.scrapEl = document.getElementById('garage-scrap');
      this.bodyEl = dialogEl.querySelector('.garage-body');
      this.cards = [];
      this.supplyCard = null;

      this.levels = freshLevels();

      this._setupDialogBehavior();
    }

    reset() {
      this.levels = freshLevels();
    }

    getCost(def) {
      if (def.isRepair || def.isReinforce) return def.baseCost;
      const lv = this.levels[def.id];
      if (lv >= def.maxLevel) return Infinity;
      const effectiveLv = def.id === 'subweapon' ? lv : lv - 1;
      return def.baseCost + effectiveLv * def.costStep;
    }

    canAffordAny(scrap) {
      return UPGRADE_DEFS.some((def) => {
        if (def.isRepair || def.isReinforce) return false;
        const lv = this.levels[def.id];
        return lv < def.maxLevel && scrap >= this.getCost(def);
      });
    }

    getCannonName() {
      const def = UPGRADE_DEFS[0];
      return def.titles[this.levels.cannon - 1] || def.titles[0];
    }

    getSubWeaponName() {
      const def = UPGRADE_DEFS[4];
      return def.titles[this.levels.subweapon] || '未装備';
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

    // options.depotSupply: opened at a supply depot -> show a free full-resupply card first
    open(player, combat, onUpgradeApplied, squad = null, options = {}) {
      this.squad = squad;
      this.options = options || {};
      this.player = player;
      this.combat = combat;
      this.onUpgradeApplied = onUpgradeApplied;
      // The cards are built once per opening and then only updated in place, so buying an
      // upgrade never reflows the window, loses the scroll position or drops keyboard focus.
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

    _afterPurchase() {
      if (this.onUpgradeApplied) this.onUpgradeApplied();
      this.render();
    }

    _build() {
      this.cards = [];
      this.supplyCard = null;
      const nodes = [];

      // Free full resupply offered when the menu is opened at a captured compound (supply depot)
      if (this.options && this.options.depotSupply) {
        nodes.push(el('h3', 'upgrade-section-title is-supply', '補給所'));
        const card = el('article', 'upgrade-card is-supply');
        const top = el('div', 'upgrade-card-top');
        const badge = el('span', 'upgrade-lv');
        top.append(el('h3', '', '補給（全回復）'), badge);
        const btn = el('button', 'btn-upgrade');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (!this.combat.needsResupply(this.player)) return;
          this.combat.resupply(this.player);
          this._afterPurchase();
        });
        const footer = el('div');
        footer.appendChild(btn);
        card.append(top, el('p', 'upgrade-desc', '自機と全僚機の装甲を全回復し、ブースト・副兵装も回復する。スクラップ不要。'), footer);
        nodes.push(card);
        this.supplyCard = { badge, btn };
      }

      let currentGroup = null;
      for (const def of UPGRADE_DEFS) {
        if (def.group === 'squad' && !this.squad) continue;
        if (def.group !== currentGroup) {
          currentGroup = def.group;
          nodes.push(el('h3', 'upgrade-section-title' + (def.group === 'squad' ? ' is-squad' : ''), GROUP_TITLES[def.group] || ''));
        }

        const isConsumable = Boolean(def.isRepair || def.isReinforce);
        const card = el('article', 'upgrade-card' + (def.group === 'squad' ? ' is-squad' : ''));
        const top = el('div', 'upgrade-card-top');
        const lvBadge = el('span', 'upgrade-lv');
        top.append(el('h3', '', def.name), lvBadge);

        const footer = el('div');
        const pips = [];
        if (!isConsumable) {
          const pipRow = el('div', 'upgrade-pips');
          pipRow.style.marginBlockEnd = '0.5rem';
          for (let i = 1; i <= def.maxLevel; i++) pips.push(pipRow.appendChild(el('span', 'upgrade-pip')));
          footer.appendChild(pipRow);
        }
        const btn = el('button', 'btn-upgrade');
        btn.type = 'button';
        btn.addEventListener('click', () => this._buy(def));
        footer.appendChild(btn);

        card.append(top, el('p', 'upgrade-desc', def.desc), footer);
        nodes.push(card);
        this.cards.push({ def, lvBadge, pips, btn });
      }

      this.gridEl.replaceChildren(...nodes);
    }

    _buy(def) {
      const player = this.player;
      const combat = this.combat;
      const squad = this.squad;
      const cost = this.getCost(def);
      if (combat.scrap < cost) return;
      if (def.isRepair) {
        if (player.hp >= player.maxHp - 0.5) return;
        combat.scrap -= cost;
        player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.55);
      } else if (def.isReinforce) {
        if (!squad || !squad.canReinforce()) return;
        combat.scrap -= cost;
        squad.spawnAlly(player);
      } else {
        if (this.levels[def.id] >= def.maxLevel) return;
        combat.scrap -= cost;
        this.levels[def.id] += 1;
        player.applyPlayerUpgrades(this.levels);
        combat.magnetRadius = 110 + (this.levels.armor - 1) * 18;
      }
      this.audio.playUpgrade();
      this._afterPurchase();
    }

    // Refresh every value in place (the DOM structure built by _build stays as it is)
    render() {
      const player = this.player;
      const combat = this.combat;
      const squad = this.squad;
      if (!player || !combat) return;

      this.scrapEl.textContent = String(combat.scrap);
      document.getElementById('spec-damage').textContent = String(player.damage);
      document.getElementById('spec-reload').textContent = player.reloadTime.toFixed(2) + 's';
      document.getElementById('spec-hp').textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
      document.getElementById('spec-speed').textContent = String(Math.round(player.maxSpeed));
      document.getElementById('spec-sub').textContent = this.getSubWeaponName();
      if (squad) {
        const ally = squad.getAllyStats();
        const allyHpEl = document.getElementById('spec-ally-hp');
        const allyDmgEl = document.getElementById('spec-ally-dmg');
        if (allyHpEl) allyHpEl.textContent = String(ally.maxHp);
        if (allyDmgEl) allyDmgEl.textContent = String(ally.damage);
      }

      if (this.supplyCard) {
        const needs = combat.needsResupply(player);
        this.supplyCard.badge.textContent = `HP ${Math.ceil(player.hp)}/${player.maxHp}`;
        this.supplyCard.btn.disabled = !needs;
        this.supplyCard.btn.textContent = needs ? '補給する（無料）' : '全車両 満タンです';
      }

      for (const { def, lvBadge, pips, btn } of this.cards) {
        const isConsumable = Boolean(def.isRepair || def.isReinforce);
        const curLv = isConsumable ? 0 : this.levels[def.id];
        const isMax = !isConsumable && curLv >= def.maxLevel;
        const cost = this.getCost(def);

        lvBadge.textContent = def.isRepair
          ? `HP ${Math.ceil(player.hp)}/${player.maxHp}`
          : def.isReinforce
            ? `小隊 ${squad.size}/${squad.maxSize}`
            : isMax
              ? `MAX (Lv.${curLv})`
              : `Lv.${curLv} / ${def.maxLevel}`;
        pips.forEach((pip, i) => pip.classList.toggle('is-filled', i + 1 <= curLv));

        if (def.isRepair) {
          const needsHeal = player.hp < player.maxHp - 0.5;
          btn.disabled = !needsHeal || combat.scrap < cost;
          btn.textContent = needsHeal ? `修復する (⚙ ${cost})` : '装甲は満タンです';
        } else if (def.isReinforce) {
          const canAdd = squad.canReinforce();
          btn.disabled = !canAdd || combat.scrap < cost;
          btn.textContent = canAdd ? `補充する (⚙ ${cost})` : '小隊は満員です';
        } else if (isMax) {
          btn.disabled = true;
          btn.textContent = '最大強化済み';
        } else {
          btn.disabled = combat.scrap < cost;
          btn.textContent = `強化する (⚙ ${cost})`;
        }
      }
    }
  }

  global.UpgradeManager = UpgradeManager;
})(window);

