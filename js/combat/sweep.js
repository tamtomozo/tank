(function (global) {
  'use strict';

  // Sweep operation (js/sweep.js): the running state of the waves.
  //   sweep.round     wave being fought (0-based)
  //   sweep.phase     'fight' (its compounds stand) | 'rest' (all taken: recover / next wave at the
  //                   white flag of restBase) | 'done' (the last wave fell)
  //   sweep.lap       seconds since the wave appeared (pauses and frozen clock excluded)
  //   sweep.laps      lap time of every wave completed
  //   sweep.captured  compounds captured over the whole run
  // The next wave is laid out by js/game/mission.js (sweepNextRound), which then calls
  // startSweepRound. Part of CombatManager (js/combat/combat.js).

  class CombatSweep {
    _setupSweep() {
      const op = this.operation;
      this.sweep = {
        rounds: op.sweep.rounds,
        total: op.sweep.total,
        round: 0,
        phase: 'fight',
        lap: 0,
        laps: [],
        captured: 0,
        lastBase: null, // compound captured last (the recovery point once the wave is done)
        restBase: null
      };
      for (const site of this.world.sites) this._addBase(site);
    }

    // The next wave: world.sites already hold its compounds (world.replaceSites)
    startSweepRound() {
      const s = this.sweep;
      s.round += 1;
      s.phase = 'fight';
      s.lap = 0;
      s.lastBase = null;
      s.restBase = null;
      this.bases = [];
      this.pendingSites = [];
      for (const site of this.world.sites) this._addBase(site);
      this.events.push({ type: 'sweepRoundStart', round: s.round });
    }

    // Seconds over the whole run: completed laps + the wave under way
    get sweepTime() {
      const s = this.sweep;
      if (!s) return 0;
      return s.laps.reduce((sum, t) => sum + t, 0) + (s.phase === 'fight' ? s.lap : 0);
    }

    // Called by _updateBases once per frame (instead of the usual objectives)
    _updateSweep() {
      const s = this.sweep;
      if (s.phase !== 'fight' || this.bases.length === 0) return;
      if (!this.bases.every((b) => b.cleared)) return;
      s.laps.push(s.lap);
      s.restBase = s.lastBase || this.bases[this.bases.length - 1];
      if (s.round >= s.rounds - 1) {
        s.phase = 'done';
        this.missionComplete = true;
        this.stats.endClock = this._clockStamp();
        this.events.push({ type: 'sweepComplete', time: this.sweepTime });
      } else {
        s.phase = 'rest';
        this.events.push({ type: 'sweepRoundClear', round: s.round, lap: s.lap, base: s.restBase });
      }
    }

    // Recovery between waves: armour and reload (player + wingmen), ammo, and lost wingmen replaced
    sweepRecover(player, squad) {
      this._resupply(player);
      if (this.ammoMax != null) this.ammo = this.ammoMax;
      while (squad.canReinforce()) squad.spawnAlly(player);
      this.audio.playUpgrade();
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatSweep);
})(window);
