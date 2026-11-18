(function (global) {
  'use strict';

  // CombatManager: everything that fights. This file holds the battle state, the per-frame update
  // order and the event queue; the rest of the class is mixed in from the other files in js/combat/:
  //   bases.js    enemy compounds                 weapons.js  firing, shells, explosions, damage
  //   enemyAI.js  enemy tank behaviour            effects.js  particles, pickups, resupply
  //   ice.js      frozen lakes                    city.js     turrets, tunnels, IEDs, escort,
  //                                                           finale boss, destructible buildings

  const { ENEMY_SPECS } = global.GameData; // js/data/enemies.js

  const SHELL_GRAVITY = 380;
  const THERMAL_RANGE = 720; // reach of the heat sensor (ice planet)
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
        elapsed: 0, // mission time: seconds of tactical play until the area is secured (pauses excluded)
        killsByKind: { infantry: 0, light: 0, medium: 0, modern: 0, heavy: 0, bunker: 0, turret: 0, boss: 0, ace: 0, proto: 0 },
        killsBy: { player: 0, ally: 0, other: 0 },
        shotsFired: 0, // player's shells / rounds / missiles
        shotsHit: 0, // player's projectiles that damaged at least one enemy
        damageTaken: 0, // armour the player's tank lost
        alliesLost: 0,
        scrapEarned: 0,
        itemsCollected: 0,
        startClock: null, // in-game time when the tactical phase began { day, clock }
        baseClock: {}, // compound id -> in-game time when captured { day, clock }
        endClock: null, // in-game time when the whole area was secured (mission time stops here)
        returnClock: null // in-game time when the platoon was back at the operations HQ
      };
    }

    // Current in-game time as { day, clock } (for the after-action report)
    _clockStamp() {
      const t = this.world.getTimeInfo();
      return { day: t.day, clock: t.clockText };
    }

    // Shared ballistic solution used by both actual firing and the aim-preview arc
    // targetZ: height of the target (a turret on a highway deck), 0 = on the ground
    static computeShellLaunch(muzzleZ, rawDist, shellSpeed, gScale, targetZ = 0) {
      const dist = Math.max(MIN_SHELL_DIST, Math.min(MAX_SHELL_DIST, rawDist));
      const flightT = dist / shellSpeed;
      const vz = (0.5 * SHELL_GRAVITY * gScale * flightT * flightT - muzzleZ + targetZ) / Math.max(0.15, flightT);
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
      this.events = []; // UI events (base alerted / cleared), drained by main.js
      this.stats = CombatManager.freshStats(); // battle statistics for the after-action report
      // Set the moment the last compound is captured: mission time and battle statistics are final
      // from then on (the sortie itself ends back at the operations HQ, see js/game/mission.js)
      this.missionComplete = false;
      this.magnetRadius = 110;
      this.repairBonus = 1.0;
      this._playerRef = null;
      this.operation = null; // operation being fought (js/data/operations.js), null before one is picked
      this.ammo = null; // player's shells left on a limited-ammo operation (null = unlimited)
      this.ammoMax = null;
      this.rules = {}; // the planet's environment rules (planet.hazards)
      this.hold = null; // "hold the area" objective state (js/combat/bases.js)
      this.time = 0; // seconds of battle (drives the mirage shimmer)
    }

    // selection: { planet, operation } picked on the sortie-select screens, or null (no compounds)
    reset(player, selection = null) {
      this._playerRef = player;
      this.operation = selection ? selection.operation : null;
      this.rules = (selection && selection.planet.hazards) || {};
      this.time = 0;
      // Limited ammunition for the player's gun (operation.ammo; null = unlimited)
      this.ammoMax = this.operation && this.operation.ammo ? this.operation.ammo : null;
      this.ammo = this.ammoMax;
      this._dryReported = false;
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

    // countTime: false while the clock is frozen (Mio's area-secured report) -> mission time stands still.
    // Mission time also stops for good once the area is secured (the drive back to HQ isn't counted).
    update(dt, player, countTime = true) {
      this._playerRef = player;
      this.time += dt;
      if (!this.stats.startClock) this.stats.startClock = this._clockStamp();
      if (countTime && !this.missionComplete) this.stats.elapsed += dt;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.0);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 2.8);

      this._updateEnemies(dt, player);
      this._updateCity(dt, player);
      this._updateIce(dt, player);
      this._updateProjectiles(dt, player);
      this._emitTrackDust(player, dt, player);
      for (const a of this.allies) this._emitTrackDust(a, dt, player);
      for (const e of this.enemies) this._emitTrackDust(e, dt, player);
      this._updateParticles(dt);
      this._updatePickups(dt, player);

      this._despawnRetreated(player);
      compactInPlace(this.enemies, (e) => e.alive);
      compactInPlace(this.allies, (a) => a.alive);
      this._updateBases(dt, player);
    }
  }

  // Sight, range and the mirage: how the operation's conditions bend what tanks can see and reach
  class CombatConditions {
    // Enemy fire / aim distances and preferred range are stretched on a long-range operation
    get enemyRangeScale() {
      const lr = this.operation && this.operation.longRange;
      return lr ? lr.enemy || 1 : 1;
    }

    // How far anyone can see a tank right now (a storm closes in to ~210; Infinity = clear)
    sightRange() {
      const storm = this.world.storm;
      return storm > 0.01 ? 900 - 690 * storm : Infinity;
    }

    // Heat sensor (planet rule `thermal`) working: in a storm or in the dark it shows enemies
    // as heat signatures out to THERMAL_RANGE
    thermalActive() {
      return !!this.rules.thermal && (this.world.storm > 0.25 || this.world.getNightDarkStrength() > 0.4);
    }

    // How far the player's lock-on and radar reach: sight, or the heat sensor when that is farther
    sensorRange() {
      let sight = this.sightRange();
      // Equipment: a dust filter keeps the optics clear in a sandstorm
      if (this.world.stormKind === 'sand' && global.GameLoadout.has('filter')) sight *= 1.6;
      return this.thermalActive() ? Math.max(sight, THERMAL_RANGE) : sight;
    }

    // Where an enemy appears to be: on a salt flat in daylight the mirage shifts distant tanks off
    // their real position (drawing, radar and the player's lock-on all use this). Returns the
    // real position when there is no mirage. The returned object is kept on the tank.
    apparentPos(e) {
      const out = e._apparent || (e._apparent = { x: 0, y: 0, shift: 0 });
      out.x = e.x;
      out.y = e.y;
      out.shift = 0;
      const m = this.world.mirage;
      const player = this._playerRef;
      if (m <= 0.01 || !player) return out;
      const d = Math.hypot(this.world.deltaX(player.x, e.x), this.world.deltaY(player.y, e.y));
      const amp = Math.max(0, Math.min(1, (d - 320) / 380)) * 62 * m;
      if (amp <= 0.5) return out;
      const ph = e.miragePhase || (e.miragePhase = 1 + Math.random() * 6);
      const t = this.time;
      out.x = this.world.wrapX(e.x + Math.sin(t * 0.7 + ph) * amp);
      out.y = this.world.wrapY(e.y + Math.cos(t * 0.53 + ph * 1.7) * amp * 0.7);
      out.shift = amp / 62;
      return out;
    }
  }

  global.TankUtil.mixin(CombatManager, CombatConditions);

  // Module-level constants / helpers that the CombatManager parts in other files use
  // (bases.js, weapons.js, enemyAI.js, effects.js, ice.js)
  CombatManager.shared = {
    SHELL_GRAVITY,
    compactInPlace
  };

  CombatManager.SHELL_GRAVITY = SHELL_GRAVITY;
  CombatManager.THERMAL_RANGE = THERMAL_RANGE;
  global.CombatManager = CombatManager;
})(window);
