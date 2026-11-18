(function (global) {
  'use strict';

  // Enemy compounds: garrisons, alerts and captures, and the operation's last objective.
  // The compounds and their garrisons come from the operation (js/data/operations.js) and are all
  // garrisoned from the start. The objective is done once every compound is captured — or, on an
  // operation with a `hold` objective, once the platoon has then held the area around one compound
  // for its full duration while enemy reinforcements arrive in waves.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { ENEMY_SPECS } = global.GameData;

  const ALERT_RADIUS = 650; // the player this close to a compound puts it on alert
  const ENEMY_REACTION_TIME = 1.0; // s an alerted tank holds still (turret tracking only) before moving/firing

  const ALLY_ALERT_RADIUS = 450; // wingmen alone must come closer before they are spotted
  const BASE_CLEAR_BONUS = 50; // scrap reward for neutralising a compound

  // Dust (planet rule `dust`): a parked tank is spotted at 72% of the usual distance, one at full
  // speed at 122%. A sandstorm cuts the distance by up to 80%.
  const DUST_SPOT_STILL = 0.72;
  const DUST_SPOT_FULL = 1.22;
  const STORM_SPOT_CUT = 0.8;

  const HOLD_FIRST_WAVE = 4; // s from the start of the hold to the first reinforcements
  const RETREAT_DESPAWN_DIST = 1300; // retreating tanks vanish this far from the player

  class CombatBases {
    // Build runtime state for every compound of the operation, garrison it and draw it on the ground
    spawnBases() {
      this.bases = [];
      this.hold = null;
      if (!this.enemiesEnabled || !this.operation) return;
      const defs = this.operation.sites || [];
      for (const site of this.world.sites) {
        const base = {
          id: site.id,
          name: site.name,
          x: site.x,
          y: site.y,
          radius: site.radius,
          garrison: defs[site.id].garrison,
          alerted: false,
          cleared: false,
          total: 0
        };
        this.bases.push(base);
        this._garrisonBase(base, site);
        if (this.world.revealBase) this.world.revealBase(site.id);
      }
      const h = this.operation.hold;
      if (h) {
        this.hold = {
          ...h,
          active: false,
          done: false,
          progress: 0,
          waveTimer: HOLD_FIRST_WAVE,
          inside: true,
          halfReported: false
        };
      }
    }

    // Parked (idle) tanks and manned bunkers for one compound, scaled by its garrison tier
    _garrisonBase(base, site) {
      const tpl = base.garrison;
      const tier = tpl.tier || 0;
      const add = (kind, slot, angle) => {
        const tank = this._makeEnemy(kind, slot.x, slot.y, angle, tier);
        tank.baseId = base.id;
        tank.state = 'idle'; // parked until the compound is alerted
        this.enemies.push(tank);
        base.total += 1;
      };
      for (let k = 0; k < (tpl.bunkers || 0) && k < site.bunkerSlots.length; k++) {
        add('bunker', site.bunkerSlots[k], site.bunkerSlots[k].angle);
      }
      (tpl.tanks || []).forEach((kind, k) => {
        const slot = site.parkingSlots[k % site.parkingSlots.length];
        add(kind, slot, slot.angle);
      });
    }

    // One enemy unit; tier raises HP and scrap value (+15% per tier)
    _makeEnemy(kind, x, y, angle, tier = 0) {
      const spec = ENEMY_SPECS[kind];
      const tank = new global.Tank2D(this.world, {
        ...spec,
        kind,
        x,
        y,
        hullAngle: angle,
        maxHp: Math.round(spec.maxHp * (1 + tier * 0.15)),
        scrapValue: Math.round(spec.scrapValue * (1 + tier * 0.15))
      });
      tank.reloadTimer = 0.8 + Math.random() * 1.2;
      return tank;
    }

    get basesRemaining() {
      return this.bases.filter((b) => !b.cleared).length;
    }

    // Put a compound on alert: its parked tanks sortie toward the nearest friendly tank
    alertBase(base) {
      if (!base || base.alerted || base.cleared) return;
      base.alerted = true;
      for (const e of this.enemies) {
        if (e.alive && e.baseId === base.id && e.state === 'idle') {
          e.state = 'active';
          e.aiTimer = Math.random() * 0.6;
          // "Spotted you!" mark, slightly staggered so the garrison reacts one by one
          e.alertMarkDelay = Math.random() * 0.25;
          e.alertMarkTimer = global.Tank2D.ALERT_MARK_DURATION;
          // Reaction time: counted from when its own "!" mark pops up
          e.reactTimer = e.alertMarkDelay + ENEMY_REACTION_TIME;
        }
      }
      this.audio.playAlert();
      this.audio.playBugle(0.7); // charge call right after the alarm, as the garrison sorties
      this.events.push({ type: 'alert', base });
    }

    // How far a compound spots this friendly tank, as a share of the usual distance:
    // dust kicked up by a fast tank gives it away, a sandstorm hides it
    _spotFactor(f) {
      let k = 1;
      if (this.rules.dust) {
        const r = Math.max(0, Math.min(1, Math.abs(f.speed) / Math.max(1, f.maxSpeed)));
        k *= DUST_SPOT_STILL + (DUST_SPOT_FULL - DUST_SPOT_STILL) * r;
      }
      k *= 1 - STORM_SPOT_CUT * this.world.storm;
      return k;
    }

    _updateBases(dt, player) {
      // Alert compounds that a friendly tank has come close to. At night the garrison can't see
      // an approach: a compound only wakes up once one of its units is hit (see damageEnemy).
      const friendlies = this.world.isNightTime() ? [] : [player, ...this.allies];
      for (const base of this.bases) {
        if (base.alerted || base.cleared) continue;
        for (const f of friendlies) {
          if (!f.alive) continue;
          const d = Math.hypot(this.world.deltaX(base.x, f.x), this.world.deltaY(base.y, f.y));
          if (d < (f === player ? ALERT_RADIUS : ALLY_ALERT_RADIUS) * this._spotFactor(f)) {
            this.alertBase(base);
            break;
          }
        }
      }

      // A compound is cleared once its whole garrison is destroyed
      for (const base of this.bases) {
        if (base.cleared) {
          // White flag is hoisted up the pole over ~1.2 s after the compound falls
          base.flagRaise = Math.min(1, (base.flagRaise || 0) + dt / 1.2);
          continue;
        }
        if (!this.enemies.some((e) => e.alive && e.baseId === base.id)) {
          base.cleared = true;
          base.flagRaise = 0;
          this.stats.baseClock[base.id] = this._clockStamp();
          this.scrap += BASE_CLEAR_BONUS;
          this.stats.scrapEarned += BASE_CLEAR_BONUS;
          // Capturing a compound hauls in every scattered item. No automatic resupply: repairs are
          // only available at captured compounds (garage menu "補給").
          const collected = this._vacuumAllPickups();
          this.audio.playWaveClear();
          this.events.push({ type: 'cleared', base, bonus: BASE_CLEAR_BONUS, collected });
        }
      }

      if (this.missionComplete || this.bases.length === 0 || !this.bases.every((b) => b.cleared)) return;
      const hold = this.hold;
      if (hold && !hold.done) {
        if (!hold.active) {
          hold.active = true;
          this.events.push({ type: 'holdStart', base: this.bases[hold.site] });
        }
        this._updateHold(dt, player);
        if (!hold.done) return;
      }
      // Objective done: the mission clock stops right here
      this.missionComplete = true;
      this.stats.endClock = this._clockStamp();
      this.events.push({ type: 'areaSecured' });
    }

    // ---- hold the area ---------------------------------------------------------------------------
    // The timer runs while the player stays inside the circle; reinforcements arrive in waves from
    // outside it until the time is up, then the ones still around fall back.
    _updateHold(dt, player) {
      const h = this.hold;
      const base = this.bases[h.site];
      const d = Math.hypot(this.world.deltaX(base.x, player.x), this.world.deltaY(base.y, player.y));
      const inside = player.alive && d < h.radius;
      if (inside !== h.inside) {
        h.inside = inside;
        this.events.push({ type: inside ? 'holdBack' : 'holdLeft' });
      }
      if (inside) h.progress = Math.min(h.duration, h.progress + dt);
      if (!h.halfReported && h.progress >= h.duration * 0.5) {
        h.halfReported = true;
        this.events.push({ type: 'holdHalf', left: Math.ceil(h.duration - h.progress) });
      }

      h.waveTimer -= dt;
      if (h.waveTimer <= 0 && h.progress < h.duration) {
        h.waveTimer = h.waveEvery;
        this._spawnWave(base, h);
      }

      if (h.progress >= h.duration) {
        h.done = true;
        for (const e of this.enemies) {
          if (e.alive && e.wave) e.state = 'retreat';
        }
      }
    }

    // Reinforcements: waveSize tanks at a clear spot spawnDist from the held compound, already on the move
    _spawnWave(base, h) {
      const [minD, maxD] = h.spawnDist;
      for (let n = 0; n < h.waveSize; n++) {
        const kind = h.kinds[Math.floor(Math.random() * h.kinds.length)];
        const r = ENEMY_SPECS[kind].scale * 24;
        for (let tries = 0; tries < 24; tries++) {
          const a = Math.random() * Math.PI * 2;
          const dist = minD + Math.random() * (maxD - minD);
          const x = this.world.wrapX(base.x + Math.cos(a) * dist);
          const y = this.world.wrapY(base.y + Math.sin(a) * dist);
          if (!this.world.isClearSpot(x, y, r + 12)) continue;
          const e = this._makeEnemy(kind, x, y, a + Math.PI, 1);
          e.baseId = -1;
          e.wave = true;
          e.state = 'active';
          e.aiTimer = Math.random() * 0.6;
          e.reactTimer = 0.6;
          this.enemies.push(e);
          break;
        }
      }
      this.events.push({ type: 'holdWave' });
    }

    // Retreating reinforcements disappear once well away from the player (not counted as kills)
    _despawnRetreated(player) {
      for (const e of this.enemies) {
        if (!e.alive || e.state !== 'retreat') continue;
        const d = Math.hypot(this.world.deltaX(player.x, e.x), this.world.deltaY(player.y, e.y));
        if (d > RETREAT_DESPAWN_DIST) e.alive = false;
      }
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatBases);
})(window);
