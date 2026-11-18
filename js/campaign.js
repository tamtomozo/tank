(function (global) {
  'use strict';

  // Campaign state, carried from one operation to the next (and across planets). Kept in
  // localStorage (this browser only).
  //   cleared    completed operations: an operation with `requires` (js/data/operations.js)
  //              opens once that one is done, so each planet is played stage by stage
  //   xp         platoon experience → crew level (CREW_LEVELS); every level above 1 adds a
  //              tuning point to the radar charts (js/tuning.js)
  //   wear       wear of the player's tank (0..WEAR_MAX): less armour and top speed until repaired
  //   allies     wingmen the platoon has (lost ones stay lost until replaced)
  //   scrap      scrap banked from the last operation, spent on repairs / replacements and in the field
  //   equipment  fitted equipment ids per planet (js/data/equipment.js); a planet not set up yet
  //              starts with its recommended gear (planet.gear)
  // Only a completed operation changes it (recordSuccess); a failed sortie is simply retried.
  // URL options: ?unlock opens every stage, ?reset starts a fresh campaign.

  const STORAGE_KEY = 'planet-panzer.campaign.v1';
  const CREW_LEVELS = [0, 60, 140, 240, 360]; // xp needed for Lv1..Lv5
  const WEAR_MAX = 0.4;
  const MAX_ALLIES = 4;
  const REPAIR_COST_PER_PCT = 6; // scrap per 1% of wear repaired
  const REINFORCE_COST = 70; // scrap per replacement wingman (same as at a field depot)

  // XP for a completed operation
  const XP_OPERATION = 20;
  const XP_PER_KILL = 2;
  const XP_NO_LOSSES = 10;

  function fresh() {
    return { cleared: [], xp: 0, wear: 0, allies: MAX_ALLIES, scrap: 0, equipment: {} };
  }

  class Campaign {
    constructor() {
      let params = null;
      try {
        params = new URLSearchParams(global.location.search);
      } catch (e) {
        params = null;
      }
      this.unlockAll = !!(params && params.has('unlock'));
      this.state = fresh();
      if (params && params.has('reset')) {
        this._save();
      } else {
        try {
          const raw = global.localStorage.getItem(STORAGE_KEY);
          const data = raw ? JSON.parse(raw) : null;
          if (data && typeof data === 'object') this.state = { ...fresh(), ...data };
        } catch (e) {
          // Storage blocked or unreadable: start a fresh campaign
        }
      }
      this.state.cleared = Array.isArray(this.state.cleared) ? this.state.cleared.map(String) : [];
      if (!this.state.equipment || typeof this.state.equipment !== 'object' || Array.isArray(this.state.equipment)) {
        this.state.equipment = {};
      }
    }

    _save() {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        // Not saved: progress lasts until the page is closed
      }
    }

    // ---- progress ----
    get cleared() {
      return new Set(this.state.cleared);
    }

    isCleared(opId) {
      return this.state.cleared.includes(opId);
    }

    isUnlocked(op) {
      return this.unlockAll || !op.requires || this.state.cleared.includes(op.requires);
    }

    // ---- crew ----
    get xp() {
      return this.state.xp;
    }

    get crewLevel() {
      let lv = 1;
      CREW_LEVELS.forEach((need, i) => {
        if (this.state.xp >= need) lv = i + 1;
      });
      return lv;
    }

    // xp of the next level (null at the top)
    get nextLevelXp() {
      const lv = this.crewLevel;
      return lv < CREW_LEVELS.length ? CREW_LEVELS[lv] : null;
    }

    get tuningBonus() {
      return this.crewLevel - 1;
    }

    // ---- vehicles ----
    get wear() {
      return this.state.wear;
    }

    get allies() {
      return this.state.allies;
    }

    get maxAllies() {
      return MAX_ALLIES;
    }

    get scrap() {
      return this.state.scrap;
    }

    get repairCost() {
      return Math.ceil(this.state.wear * 100 * REPAIR_COST_PER_PCT);
    }

    get reinforceCost() {
      return REINFORCE_COST;
    }

    // Repair all wear for scrap. Returns true if done.
    repair() {
      const cost = this.repairCost;
      if (cost <= 0 || this.state.scrap < cost) return false;
      this.state.scrap -= cost;
      this.state.wear = 0;
      this._save();
      return true;
    }

    // One replacement wingman for scrap. Returns true if done.
    reinforce() {
      if (this.state.allies >= MAX_ALLIES || this.state.scrap < REINFORCE_COST) return false;
      this.state.scrap -= REINFORCE_COST;
      this.state.allies += 1;
      this._save();
      return true;
    }

    // ---- equipment ----
    // Ids fitted for the planet; one not set up yet starts with its recommended gear
    equipment(planet) {
      if (!planet) return [];
      const slots = global.GameData.EQUIP_SLOTS;
      const chosen = this.state.equipment[planet.id];
      return (Array.isArray(chosen) ? chosen : planet.gear || []).slice(0, slots);
    }

    setEquipment(planet, ids) {
      this.state.equipment[planet.id] = ids.slice(0, global.GameData.EQUIP_SLOTS);
      this._save();
    }

    // ---- end of an operation ----
    // A completed operation: progress, experience, wear and what is left of the platoon carry over.
    // r = { opId, kills, alliesLost, alliesLeft, damageRatio, scrap }. Returns the changes for the report.
    recordSuccess(r) {
      const s = this.state;
      const before = { level: this.crewLevel, wear: s.wear, xp: s.xp };
      const xpGain = XP_OPERATION + r.kills * XP_PER_KILL + (r.alliesLost === 0 ? XP_NO_LOSSES : 0);
      s.xp += xpGain;
      s.wear = Math.min(WEAR_MAX, s.wear + Math.min(0.15, 0.03 + r.damageRatio * 0.08));
      s.allies = Math.max(0, Math.min(MAX_ALLIES, r.alliesLeft));
      s.scrap = Math.max(0, Math.round(r.scrap));
      if (!s.cleared.includes(r.opId)) s.cleared.push(r.opId);
      this._save();
      return {
        xpGain,
        xp: s.xp,
        levelBefore: before.level,
        level: this.crewLevel,
        nextLevelXp: this.nextLevelXp,
        wearBefore: before.wear,
        wear: s.wear,
        allies: s.allies,
        scrap: s.scrap
      };
    }
  }

  global.Campaign = new Campaign();
})(window);
