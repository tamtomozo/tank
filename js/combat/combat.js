(function (global) {
  'use strict';

  // CombatManager: everything that fights. This file holds the battle state, the per-frame update
  // order and the event queue; the rest of the class is mixed in from the other files in js/combat/:
  //   bases.js    enemy compounds & districts     weapons.js  firing, shells, explosions, damage
  //   enemyAI.js  enemy tank behaviour            effects.js  particles, pickups, resupply

  const { ENEMY_SPECS, DISTRICT_TEMPLATES } = global.GameData; // js/data/enemies.js

  const SHELL_GRAVITY = 380;
  const MIN_SHELL_DIST = 80;
  const MAX_SHELL_DIST = 820;

  // Remove items in place where keepFn returns false (O(n), no per-item splice)
  function compactInPlace(arr, keepFn) {
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
      const item = arr[r];
      if (keepFn(item)) arr[w++] = item;
    }
    arr.length = w;
  }

  class CombatManager {
    // Battle statistics collected during a sortie (shown on the after-action report)
    static freshStats() {
      return {
        elapsed: 0, // seconds of tactical play (paused time excluded)
        killsByKind: { light: 0, medium: 0, bunker: 0 },
        killsBy: { player: 0, ally: 0, other: 0 },
        shotsFired: 0, // player's shells / rounds / missiles
        shotsHit: 0, // player's projectiles that damaged at least one enemy
        damageTaken: 0, // armour the player's tank lost
        alliesLost: 0,
        scrapEarned: 0,
        itemsCollected: 0,
        districtTimes: {}, // district id -> elapsed seconds when secured
        startClock: null, // in-game time when the tactical phase began { day, clock }
        districtClock: {} // district id -> in-game time when secured { day, clock }
      };
    }

    // Current in-game time as { day, clock } (for the after-action report)
    _clockStamp() {
      const t = this.world.getTimeInfo();
      return { day: t.day, clock: t.clockText };
    }

    // Shared ballistic solution used by both actual firing and the aim-preview arc
    static computeShellLaunch(muzzleZ, rawDist, shellSpeed, gScale) {
      const dist = Math.max(MIN_SHELL_DIST, Math.min(MAX_SHELL_DIST, rawDist));
      const flightT = dist / shellSpeed;
      const vz = (0.5 * SHELL_GRAVITY * gScale * flightT * flightT - muzzleZ) / Math.max(0.15, flightT);
      return { dist, flightT, vz: Math.min(260, Math.max(-40, vz)) };
    }

    constructor(world, audio) {
      this.world = world;
      this.audio = audio;
      this.enemiesEnabled = true;

      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.fires = []; // short-lived burning patches left where shells explode
      this.shockwaves = [];
      this.pickups = [];
      this.allies = []; // friendly wingman tanks (managed by SquadManager)

      this.shakeIntensity = 0;
      this.damageFlash = 0;
      this.scrap = 0;
      this.kills = 0;
      this.bases = []; // runtime state of each enemy compound (index == compound id)
      this.districts = []; // runtime state of each district (unlocked / secured)
      this.events = []; // UI events (base alerted / cleared), drained by main.js
      this.stats = CombatManager.freshStats(); // battle statistics for the after-action report
      this.missionTimer = 0;
      this.missionComplete = false; // set once every enemy compound is cleared
      this.magnetRadius = 110;
      this.repairBonus = 1.0;
      this._playerRef = null;
    }

    reset(player) {
      this._playerRef = player;
      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.fires = []; // short-lived burning patches left where shells explode
      this.shockwaves = [];
      this.pickups = [];
      this.allies = []; // friendly wingman tanks (managed by SquadManager)

      this.scrap = 0;
      this.kills = 0;
      this.events = [];
      this.stats = CombatManager.freshStats();
      this.missionTimer = 0;
      this.missionComplete = false;
      if (this.world.hideAllBases) this.world.hideAllBases();
      this.shakeIntensity = 0;
      this.damageFlash = 0;
      this.magnetRadius = 110;
      this.repairBonus = 1.0;

      this.spawnBases();
    }

    drainEvents() {
      const ev = this.events;
      this.events = [];
      return ev;
    }

    // countTime: false while the clock is frozen (Mio's district report) -> mission time stands still
    update(dt, player, countTime = true) {
      this._playerRef = player;
      if (!this.stats.startClock) this.stats.startClock = this._clockStamp();
      if (countTime) this.stats.elapsed += dt;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.0);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 2.8);

      this._updateEnemies(dt, player);
      this._updateProjectiles(dt, player);
      this._emitTrackDust(player, dt, player);
      for (const a of this.allies) this._emitTrackDust(a, dt, player);
      for (const e of this.enemies) this._emitTrackDust(e, dt, player);
      this._updateParticles(dt);
      this._updatePickups(dt, player);

      compactInPlace(this.enemies, (e) => e.alive);
      compactInPlace(this.allies, (a) => a.alive);
      this._updateBases(dt, player);
    }
  }

  // Module-level constants / helpers that the CombatManager parts in other files use
  CombatManager.shared = {
    SHELL_GRAVITY,
    compactInPlace
  };

  CombatManager.SHELL_GRAVITY = SHELL_GRAVITY;
  global.CombatManager = CombatManager;
})(window);
