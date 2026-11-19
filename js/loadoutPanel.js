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

    // operation: the one being briefed (a sweep shows its own platoon card)
    open(planet, operation = null) {
      this.planet = planet;
      this.operation = operation;
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
      if (this.operation && this.operation.sweep) return this._sweepPlatoonCard(c);
      const card = el('article', 'loadout-card is-platoon');
      card.append(el('h4', '', L('小隊の状態（前の作戦から持ち越し）', 'Platoon status (carried over from the last operation)')));

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
      const crew = row(L(`練度 Lv${c.crewLevel}`, `Crew Lv${c.crewLevel}`), next ? L(`経験値 ${c.xp} / ${next}`, `XP ${c.xp} / ${next}`) : L(`経験値 ${c.xp}（最大）`, `XP ${c.xp} (max)`),
        c.tuningBonus > 0 ? L(`車両調整ポイント +${c.tuningBonus}`, `Tuning points +${c.tuningBonus}`) : L('作戦を重ねると練度が上がり、車両調整ポイントが増える', 'Each operation raises the crew level and adds tuning points'));
      const bar = el('div', 'loadout-xp');
      const fill = el('div', 'loadout-xp-fill');
      fill.style.inlineSize = `${next ? Math.min(100, (c.xp / next) * 100) : 100}%`;
      bar.append(fill);
      crew.querySelector('.loadout-row-text').append(bar);

      // Wear of the player's tank
      const wearPct = Math.round(c.wear * 100);
      const eff = global.GameLoadout.wearEffect(c.wear);
      const wear = row(L('自機の損耗', 'Wear on your tank'), `${wearPct}%`,
        wearPct > 0 ? L(`最大装甲 −${eff.hp}% ／ 最高速度 −${eff.speed}%`, `Max armor −${eff.hp}% · Top speed −${eff.speed}%`) : L('整備済み', 'Fully serviced'),
        button('repair', wearPct > 0 ? L(`修理する (⚙ ${c.repairCost})`, `Repair (⚙ ${c.repairCost})`) : L('修理不要', 'No repair needed'), wearPct > 0 && c.scrap >= c.repairCost, () => {
          if (c.repair()) this._changed('repair');
        }));

      // Wingmen
      const missing = c.maxAllies - c.allies;
      const allies = row(L('僚機', 'Wingmen'), L(`${c.allies} / ${c.maxAllies} 両`, `${c.allies} / ${c.maxAllies}`),
        missing > 0 ? L('失った僚機は補充するまで戻らない', 'Lost wingmen stay lost until replaced') : L('全機そろっている', 'Full strength'),
        button('reinforce', missing > 0 ? L(`補充する (⚙ ${c.reinforceCost})`, `Reinforce (⚙ ${c.reinforceCost})`) : L('補充不要', 'No replacements needed'), missing > 0 && c.scrap >= c.reinforceCost, () => {
          if (c.reinforce()) this._changed('reinforce');
        }));

      const scrap = row(L('保有スクラップ', 'Scrap on hand'), `⚙ ${c.scrap}`, L('残りは出撃に持っていき、補給拠点での僚機補充にも使える', 'What is left goes with you, and also pays for replacements at depots'));
      card.append(crew, wear, allies, scrap);
      // Industrial planet: the people's cooperation and the collaborator (js/campaign.js)
      if (this.planet.hazards && this.planet.hazards.civilians) {
        const who = c.collaborator === true ? L('協力者は無事（トンネルの地図あり）', 'The collaborator is safe (tunnel map in hand).')
          : c.collaborator === false ? L('協力者を失った（トンネルの地図なし）', 'The collaborator was lost (no tunnel map).')
            : L('協力者とはまだ接触していない', 'No contact with the collaborator yet.');
        card.append(row(L('住民の協力度', 'Civilian support'), `${c.support}%`, L(`民間の建物を壊すと下がる。最後の段階のゲリラの数が変わる。${who}`, `Drops when civilian buildings are destroyed; decides how many guerrillas the final stage meets. ${who}`)));
      }
      return card;
    }

    // Sweep operation (js/sweep.js): kept apart from the campaign — only the crew level and the
    // equipment come along; the tank is fresh, the platoon full, and nothing is carried back
    _sweepPlatoonCard(c) {
      const card = el('article', 'loadout-card is-platoon');
      card.append(el('h4', '', L('小隊の状態（掃討作戦）', 'Platoon status (sweep)')));
      const row = (label, value, note) => {
        const r = el('div', 'loadout-row');
        const text = el('div', 'loadout-row-text');
        text.append(el('span', 'loadout-row-label', label), el('strong', 'loadout-row-value', value), el('span', 'loadout-row-note', note));
        r.append(text);
        return r;
      };
      card.append(
        row(L(`練度 Lv${c.crewLevel}`, `Crew Lv${c.crewLevel}`), c.tuningBonus > 0 ? L(`車両調整ポイント +${c.tuningBonus}`, `Tuning points +${c.tuningBonus}`) : L('ボーナスなし', 'No bonus'),
          L('本編の練度をそのまま使う', 'The crew level from the campaign')),
        row(L('自機の損耗', 'Wear on your tank'), '0%', L('新品の車両で出撃する', 'You sortie in a fresh tank')),
        row(L('僚機', 'Wingmen'), L(`${c.maxAllies} / ${c.maxAllies} 両`, `${c.maxAllies} / ${c.maxAllies}`), L('全機そろって出撃する', 'Full strength')),
        row(L('キャンペーンへの影響', 'Campaign'), L('なし', 'None'), L('スクラップ・経験値・損耗は持ち帰らない。記録（到達拠点数とタイム）だけが残る', 'No scrap, XP or wear carries back. Only the record (compounds and time) is kept'))
      );
      return card;
    }

    _gearCard() {
      const c = global.Campaign;
      const fitted = c.equipment(this.planet);
      const recommended = this.planet.gear || [];
      const card = el('article', 'loadout-card is-gear');
      const head = el('header', 'loadout-gear-head');
      head.append(el('h4', '', L(`装備（${EQUIP_SLOTS}枠）`, `Equipment (${EQUIP_SLOTS} slots)`)), el('span', 'loadout-gear-count', L(`装着 ${fitted.length} / ${EQUIP_SLOTS}`, `Fitted ${fitted.length} / ${EQUIP_SLOTS}`)));
      card.append(head, el('p', 'loadout-gear-note', L(`${EQUIP_SLOTS}枠まで。もう1つ選ぶと、先に選んだほうが外れます。`, `Up to ${EQUIP_SLOTS}. Choosing another removes the one picked first.`)));
      const list = el('div', 'loadout-gear-list');
      for (const item of EQUIPMENT) {
        const on = fitted.includes(item.id);
        const b = el('button', `loadout-gear${on ? ' is-on' : ''}`);
        b.type = 'button';
        b.dataset.key = `gear-${item.id}`;
        b.setAttribute('aria-pressed', String(on));
        const top = el('div', 'loadout-gear-top');
        top.append(el('span', 'loadout-gear-icon', item.icon), el('strong', '', item.name));
        if (recommended.includes(item.id)) top.append(el('span', 'loadout-gear-badge', L('推奨', 'Recommended')));
        top.append(el('span', 'loadout-gear-state', on ? L('装着中', 'Fitted') : ''));
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
