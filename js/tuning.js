(function (global) {
  'use strict';

  // Tuning state of the platoon (radar chart levels per unit) and the tank stats they give.
  // Axes, budget and names: js/data/tuning.js. Edited on the briefing (js/tuningPanel.js) and
  // kept across sorties; applied to the tanks by GameMission.applyTuning (js/game/mission.js).

  const { TUNING_AXES, TUNING_RULES, CANNON_TITLES } = global.GameData;

  class TankTuning {
    constructor() {
      this.levels = {
        player: { ...TUNING_RULES.standard },
        ally: { ...TUNING_RULES.standard }
      };
    }

    get budget() {
      return TUNING_RULES.budget;
    }

    used(unit) {
      const lv = this.levels[unit];
      return TUNING_AXES.reduce((sum, a) => sum + lv[a.id], 0);
    }

    remaining(unit) {
      return TUNING_RULES.budget - this.used(unit);
    }

    // Highest level `axis` can be raised to with the points left
    maxFor(unit, axis) {
      return Math.min(TUNING_RULES.max, this.levels[unit][axis] + this.remaining(unit));
    }

    // Set an axis level (clamped to min..max and to the points left). Returns true if it changed.
    set(unit, axis, level) {
      const lv = this.levels[unit];
      const next = Math.max(TUNING_RULES.min, Math.min(this.maxFor(unit, axis), Math.round(level)));
      if (next === lv[axis]) return false;
      lv[axis] = next;
      return true;
    }

    // Back to the standard spread (all axes Lv3). Returns true if anything changed.
    reset(unit) {
      const lv = this.levels[unit];
      const std = TUNING_RULES.standard;
      const changed = TUNING_AXES.some((a) => lv[a.id] !== std[a.id]);
      Object.assign(lv, std);
      return changed;
    }

    isStandard(unit) {
      const lv = this.levels[unit];
      return TUNING_AXES.every((a) => lv[a.id] === TUNING_RULES.standard[a.id]);
    }

    // ---- stats (fields understood by Tank2D.applyStats) ------------------------------------------
    playerStats() {
      const { cannon, reload, engine, armor } = this.levels.player;
      return {
        damage: 40 + (cannon - 1) * 18,
        splashRadius: 54 + (cannon - 1) * 10,
        shellSpeed: 560 + (cannon - 1) * 65,
        cannonRange: 460 + (cannon - 1) * 45,
        reloadTime: Math.max(0.45, 1.35 - (reload - 1) * 0.2),
        maxSpeed: 225 + (engine - 1) * 34,
        accel: 460 + (engine - 1) * 75,
        turnSpeed: 2.8 + (engine - 1) * 0.26,
        maxHp: 120 + (armor - 1) * 45,
        armorReduction: (armor - 1) * 0.08,
        visual: { cannon, armor, engine }
      };
    }

    // Shared by every wingman (a bit faster than the leader so they can catch up with the formation)
    allyStats() {
      const { cannon, reload, engine, armor } = this.levels.ally;
      return {
        damage: 26 + (cannon - 1) * 12,
        shellSpeed: 520 + (cannon - 1) * 50,
        splashRadius: 44 + (cannon - 1) * 6,
        reloadTime: Math.max(1.0, 2.0 - (reload - 1) * 0.2),
        maxSpeed: 255 + (engine - 1) * 36,
        accel: 470 + (engine - 1) * 60,
        turnSpeed: 2.9 + (engine - 1) * 0.2,
        maxHp: 130 + (armor - 1) * 40,
        armorReduction: 0.1 + (armor - 1) * 0.06,
        visual: { cannon: Math.min(4, cannon), armor, engine } // wingmen never mount the rail gun
      };
    }

    stats(unit) {
      return unit === 'player' ? this.playerStats() : this.allyStats();
    }

    // Item pickup (magnet) radius grows with the player's armour level, as before
    pickupRadius() {
      return 110 + (this.levels.player.armor - 1) * 18;
    }

    cannonName() {
      return CANNON_TITLES[this.levels.player.cannon - 1] || CANNON_TITLES[0];
    }
  }

  global.TankTuning = TankTuning;
})(window);
