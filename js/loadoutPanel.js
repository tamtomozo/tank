(function (global) {
  'use strict';

  // 装備・整備 step of the briefing: what the campaign carries into this sortie (js/campaign.js)
  // and what can still be changed before it —
  //   platoon  crew level (extra tuning points), wear of the player's tank (repair for scrap),
  //            wingmen left (replace lost ones for scrap), scrap banked from the last operation
  //   gear     EQUIP_SLOTS items fitted from the list (js/data/equipment.js); the planet's own
  //            pair is marked 推奨. Picking one more than the slots allow drops the oldest.
  // Every change is reported through onChange (the platoon on the HQ pad is refitted).

  const { EQUIPMENT, EQUIP_SLOTS } = global.GameData;
  const { el } = global.TankUtil;

  class LoadoutPanel {
    constructor(container, { audio = null, onChange = null } = {}) {
      this.container = container;
      this.audio = audio;
      this.onChange = onChange;
      this.planet = null;
    }

    open(planet) {
      this.planet = planet;
      this.render();
    }

    // key: the control that made the change (focused again after the panel is rebuilt)
    _changed(key) {
      if (this.audio && this.audio.playTune) this.audio.playTune();
      if (this.onChange) this.onChange();
      this.render();
      const again = key && this.container.querySelector(`[data-key="${key}"]`);
      if (again) again.focus();
    }

    render() {
      if (!this.planet) return;
      this.container.replaceChildren(this._platoonCard(), this._gearCard());
    }

    _platoonCard() {
      const c = global.Campaign;
      const card = el('article', 'loadout-card is-platoon');
      card.append(el('h4', '', '小隊の状態（前の作戦から持ち越し）'));

      const row = (label, value, note = '', action = null) => {
        const r = el('div', 'loadout-row');
        const text = el('div', 'loadout-row-text');
        text.append(el('span', 'loadout-row-label', label), el('strong', 'loadout-row-value', value));
        if (note) text.append(el('span', 'loadout-row-note', note));
        r.append(text);
        if (action) r.append(action);
        return r;
      };
      const button = (key, label, enabled, onClick) => {
        const b = el('button', 'btn-hud loadout-action', label);
        b.type = 'button';
        b.dataset.key = key;
        b.disabled = !enabled;
        b.addEventListener('click', onClick);
        return b;
      };

      // Crew level: experience bar toward the next level
      const next = c.nextLevelXp;
      const crew = row(`練度 Lv${c.crewLevel}`, next ? `経験値 ${c.xp} / ${next}` : `経験値 ${c.xp}（最大）`,
        c.tuningBonus > 0 ? `車両調整ポイント +${c.tuningBonus}` : '作戦を重ねると練度が上がり、車両調整ポイントが増える');
      const bar = el('div', 'loadout-xp');
      const fill = el('div', 'loadout-xp-fill');
      fill.style.inlineSize = `${next ? Math.min(100, (c.xp / next) * 100) : 100}%`;
      bar.append(fill);
      crew.querySelector('.loadout-row-text').append(bar);

      // Wear of the player's tank
      const wearPct = Math.round(c.wear * 100);
      const eff = global.GameLoadout.wearEffect(c.wear);
      const wear = row('自機の損耗', `${wearPct}%`,
        wearPct > 0 ? `最大装甲 −${eff.hp}% ／ 最高速度 −${eff.speed}%` : '整備済み',
        button('repair', wearPct > 0 ? `修理する (⚙ ${c.repairCost})` : '修理不要', wearPct > 0 && c.scrap >= c.repairCost, () => {
          if (c.repair()) this._changed('repair');
        }));

      // Wingmen
      const missing = c.maxAllies - c.allies;
      const allies = row('僚機', `${c.allies} / ${c.maxAllies} 両`,
        missing > 0 ? '失った僚機は補充するまで戻らない' : '全機そろっている',
        button('reinforce', missing > 0 ? `補充する (⚙ ${c.reinforceCost})` : '補充不要', missing > 0 && c.scrap >= c.reinforceCost, () => {
          if (c.reinforce()) this._changed('reinforce');
        }));

      const scrap = row('保有スクラップ', `⚙ ${c.scrap}`, '残りは出撃に持っていき、補給拠点での僚機補充にも使える');
      card.append(crew, wear, allies, scrap);
      return card;
    }

    _gearCard() {
      const c = global.Campaign;
      const fitted = c.equipment(this.planet);
      const recommended = this.planet.gear || [];
      const card = el('article', 'loadout-card is-gear');
      const head = el('header', 'loadout-gear-head');
      head.append(el('h4', '', `装備（${EQUIP_SLOTS}枠）`), el('span', 'loadout-gear-count', `装着 ${fitted.length} / ${EQUIP_SLOTS}`));
      card.append(head, el('p', 'loadout-gear-note', `${EQUIP_SLOTS}枠まで。もう1つ選ぶと、先に選んだほうが外れます。`));
      const list = el('div', 'loadout-gear-list');
      for (const item of EQUIPMENT) {
        const on = fitted.includes(item.id);
        const b = el('button', `loadout-gear${on ? ' is-on' : ''}`);
        b.type = 'button';
        b.dataset.key = `gear-${item.id}`;
        b.setAttribute('aria-pressed', String(on));
        const top = el('div', 'loadout-gear-top');
        top.append(el('span', 'loadout-gear-icon', item.icon), el('strong', '', item.name));
        if (recommended.includes(item.id)) top.append(el('span', 'loadout-gear-badge', '推奨'));
        top.append(el('span', 'loadout-gear-state', on ? '装着中' : ''));
        b.append(top, el('span', 'loadout-gear-desc', item.desc));
        b.addEventListener('click', () => {
          let ids = fitted.slice();
          if (on) ids = ids.filter((id) => id !== item.id);
          else {
            ids.push(item.id);
            if (ids.length > EQUIP_SLOTS) ids.shift();
          }
          c.setEquipment(this.planet, ids);
          this._changed(`gear-${item.id}`);
        });
        list.append(b);
      }
      card.append(list);
      return card;
    }
  }

  global.LoadoutPanel = LoadoutPanel;
})(window);
