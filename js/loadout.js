(function (global) {
  'use strict';

  // What the platoon carries into the current sortie: the fitted equipment (js/data/equipment.js)
  // and the wear of the player's tank (js/campaign.js). fit() is applied to every friendly tank
  // right after its radar-chart stats (js/game/mission.js applyTuning, js/squad.js); the other
  // effects are read where they act (has(id): hazards.js, combat.js, bases.js).

  const WEAR_HP = 0.5; // share of the wear taken off the max armour (40% wear → −20%)
  const WEAR_SPEED = 0.15; // share of the wear taken off the top speed (40% wear → −6%)

  const GameLoadout = {
    equipment: [], // ids fitted for this sortie
    wear: 0, // wear of the player's tank for this sortie

    set(equipment, wear) {
      this.equipment = equipment.slice();
      this.wear = wear;
    },

    has(id) {
      return this.equipment.includes(id);
    },

    // Equipment + wear on top of a tank's tuned stats; refill: fresh tank (full armour)
    fit(tank, refill) {
      if (this.has('addArmor')) {
        tank.maxHp = Math.round(tank.maxHp * 1.25);
        tank.maxSpeed *= 0.92;
      }
      if (tank.isPlayer && this.wear > 0) {
        tank.maxHp = Math.round(tank.maxHp * (1 - this.wear * WEAR_HP));
        tank.maxSpeed *= 1 - this.wear * WEAR_SPEED;
      }
      tank.splashGuard = this.has('cage') ? 0.35 : 0; // near-miss damage taken off (js/combat/weapons.js)
      tank.iceLoadScale = this.has('wideTracks') ? 0.5 : 1; // load on the ice (js/combat/ice.js)
      tank.hp = refill ? tank.maxHp : Math.min(tank.hp, tank.maxHp);
    },

    // Effect of the wear on the player's tank, in whole percent (for the briefing / report)
    wearEffect(wear = this.wear) {
      return { hp: Math.round(wear * WEAR_HP * 100), speed: Math.round(wear * WEAR_SPEED * 100) };
    }
  };

  global.GameLoadout = GameLoadout;
})(window);
