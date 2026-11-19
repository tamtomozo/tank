(function (global) {
  'use strict';

  // Enemy compounds: garrisons, alerts and captures, and the operation's objectives.
  // The compounds and their garrisons come from the operation (js/data/operations.js) and are all
  // garrisoned from the start. The objectives, all of which must be met:
  //   compounds  every compound not marked `optional` captured
  //   survey     every survey point visited (drive onto it)
  //   feint      be spotted by the feint compound, then get `distance` away from it: its
  //              garrison gives up the chase and returns to its post
  //   hold       after the others: hold the area around a compound (or a fixed point) for its
  //              duration while enemy reinforcements arrive in waves (and maybe a boss)
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
  const SURVEY_RADIUS = 80; // the player this close to a survey point has surveyed it
  const RETREAT_DESPAWN_DIST = 1300; // retreating tanks vanish this far from the player

  class CombatBases {
    // Build runtime state for every compound of the operation, garrison it and draw it on the ground
    spawnBases() {
      this.bases = [];
      this.hold = null;
      this.survey = null;
      this.feint = null;
      this.pendingSites = []; // compounds that appear later (site.after)
      this.sweep = null;
      if (!this.enemiesEnabled || !this.operation) {
        this._setupCity();
        return;
      }
      // Sweep operation: waves of compounds instead of the usual objectives (js/combat/sweep.js)
      if (this.operation.sweep) {
        this._setupSweep();
        this._setupCity();
        return;
      }
      const defs = this.operation.sites || [];
      for (const site of this.world.sites) {
        if (defs[site.id].after != null) this.pendingSites.push(site);
        else this._addBase(site);
      }
      const op = this.operation;
      if (op.survey) {
        this.survey = op.survey.map((pt) => ({ x: this.world.wrapX(pt.x), y: this.world.wrapY(pt.y), name: pt.name, done: false }));
      }
      if (op.feint) this.feint = { ...op.feint, spotted: false, done: false };
      const h = op.hold;
      if (h) {
        this.hold = {
          ...h,
          active: false,
          done: false,
          progress: 0,
          waveTimer: HOLD_FIRST_WAVE,
          inside: true,
          halfReported: false,
          bossSpawned: false
        };
      }
      this._setupCity(); // turrets, tunnels, IEDs, escort, finale (js/combat/city.js)
    }

    // Runtime state of one compound, garrisoned and drawn on the ground (index == compound id)
    _addBase(site) {
      const def = this.operation.sites[site.id];
      const base = {
        id: site.id,
        name: site.name,
        x: site.x,
        y: site.y,
        radius: site.radius,
        garrison: def.garrison,
        optional: !!def.optional, // need not be captured (e.g. the target of a feint)
        alerted: false,
        cleared: false,
        total: 0
      };
      this.bases.push(base);
      this._garrisonBase(base, site);
      if (this.world.revealBase) this.world.revealBase(site.id);
      return base;
    }

    // Parked (idle) tanks and manned bunkers for one compound, scaled by its garrison tier
    _garrisonBase(base, site) {
      const tpl = base.garrison;
      const tier = tpl.tier || 0;
      const add = (kind, slot, angle) => {
        const tank = this._makeEnemy(kind, slot.x, slot.y, angle, tier);
        tank.baseId = base.id;
        tank.state = 'idle'; // parked until the compound is alerted
        tank.home = { x: slot.x, y: slot.y, angle }; // post it returns to after a feint
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
        if (global.GameLoadout.has('filter')) k *= 0.85; // equipment: less dust thrown up
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
          if (this.sweep) {
            this.sweep.captured += 1;
            this.sweep.lastBase = base;
          }
          this.stats.baseClock[base.id] = this._clockStamp();
          this.scrap += BASE_CLEAR_BONUS;
          this.stats.scrapEarned += BASE_CLEAR_BONUS;
          // Capturing a compound hauls in every scattered item. No automatic resupply: repairs are
          // only available at captured compounds (garage menu "補給").
          const collected = this._vacuumAllPickups();
          this.audio.playWaveClear();
          this.events.push({ type: 'cleared', base, bonus: BASE_CLEAR_BONUS, collected });
          // The power plant: the turrets on its grid go dark (js/combat/city.js)
          if (this.operation && this.operation.sites[base.id].power) this._powerDown();
        }
      }

      // A compound that holds out after another has fallen (site.after) shows up now
      for (const site of this.pendingSites.slice()) {
        const after = this.bases[this.operation.sites[site.id].after];
        if (!after || !after.cleared) continue;
        this.pendingSites.splice(this.pendingSites.indexOf(site), 1);
        this.events.push({ type: 'siteAppears', base: this._addBase(site) });
      }

      if (this.sweep) {
        this._updateSweep();
        return;
      }
      if (!this.operation || this.missionComplete) return;
      const surveyFinished = this._updateSurvey(player);
      this._updateFeint(player);
      if (!this.bases.every((b) => b.cleared || b.optional)) return;
      if (this.survey && !this.survey.every((p) => p.done)) return;
      if (this.feint && !this.feint.done) return;
      if (this.pendingSites.length > 0) return;
      const esc = this.escort;
      if (esc && esc.stage !== 'done' && esc.stage !== 'lost') return;
      if (this._updateFinale()) return; // the boss of the finale is still out there
      const hold = this.hold;
      if (hold && !hold.done) {
        if (!hold.active) {
          hold.active = true;
          this.events.push({ type: 'holdStart' });
        }
        this._updateHold(dt, player);
        if (!hold.done) return;
      }
      // Objective done: the mission clock stops right here
      this.missionComplete = true;
      this.stats.endClock = this._clockStamp();
      // bySurvey: the last survey point finished it (the player is out on the ice)
      this.events.push({ type: 'areaSecured', bySurvey: surveyFinished });
    }

    // ---- survey points / feint ------------------------------------------------------------------
    // Returns true on the frame the last survey point is visited
    _updateSurvey(player) {
      if (!this.survey || !player.alive) return false;
      let finished = false;
      for (const [i, p] of this.survey.entries()) {
        if (p.done) continue;
        if (Math.hypot(this.world.deltaX(p.x, player.x), this.world.deltaY(p.y, player.y)) > SURVEY_RADIUS) continue;
        p.done = true;
        const left = this.survey.filter((q) => !q.done).length;
        this.audio.playWaveClear();
        this.events.push({ type: 'surveyed', point: p, index: i, left });
        if (left === 0) finished = true;
      }
      return finished;
    }

    _updateFeint(player) {
      const f = this.feint;
      if (!f || f.done) return;
      const base = this.bases[f.site];
      if (!f.spotted && base.alerted) {
        f.spotted = true;
        this.events.push({ type: 'feintSpotted', base });
      }
      if (!f.spotted || !player.alive) return;
      const d = Math.hypot(this.world.deltaX(base.x, player.x), this.world.deltaY(base.y, player.y));
      if (d < f.distance) return;
      f.done = true;
      // The garrison gives up the chase and goes back to guard its compound
      for (const e of this.enemies) {
        if (e.alive && e.baseId === base.id && !e.isBunker && e.state === 'active') e.state = 'return';
      }
      base.alerted = false;
      this.events.push({ type: 'feintDone', base });
    }

    // ---- hold the area ---------------------------------------------------------------------------
    // Centre of the area to hold: a compound (hold.site) or a fixed point (hold.at)
    holdCenter() {
      const h = this.hold;
      if (!h) return null;
      if (h.at) return { x: this.world.wrapX(h.at.x), y: this.world.wrapY(h.at.y) };
      return this.bases[h.site];
    }

    // The timer runs while the player stays inside the circle; reinforcements arrive in waves from
    // outside it until the time is up, then the ones still around fall back.
    _updateHold(dt, player) {
      const h = this.hold;
      const base = this.holdCenter();
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
      // A boss joins the attack part-way through (hold.boss = { kind, at: share of the time })
      if (h.boss && !h.bossSpawned && h.progress >= h.duration * h.boss.at) {
        h.bossSpawned = true;
        const e = this._spawnAround(base, h.boss.kind, h.spawnDist);
        if (e) this.events.push({ type: 'bossArrived', kind: h.boss.kind });
      }

      if (h.progress >= h.duration) {
        h.done = true;
        for (const e of this.enemies) {
          if (e.alive && e.wave) e.state = 'retreat';
        }
      }
    }

    // Reinforcements: waveSize tanks (waveSizeLate in the second half) at clear spots spawnDist
    // from the held area, already on the move
    _spawnWave(base, h) {
      const size = h.waveSizeLate && h.progress >= h.duration * 0.5 ? h.waveSizeLate : h.waveSize;
      for (let n = 0; n < size; n++) {
        this._spawnAround(base, h.kinds[Math.floor(Math.random() * h.kinds.length)], h.spawnDist);
      }
      this.events.push({ type: 'holdWave' });
    }

    // One reinforcement of `kind` at a clear spot [minD, maxD] from the centre (null if none found;
    // the ice of a frozen lake doesn't count as clear)
    _spawnAround(center, kind, [minD, maxD]) {
      const r = ENEMY_SPECS[kind].scale * 24;
      for (let tries = 0; tries < 30; tries++) {
        const a = Math.random() * Math.PI * 2;
        const dist = minD + Math.random() * (maxD - minD);
        const x = this.world.wrapX(center.x + Math.cos(a) * dist);
        const y = this.world.wrapY(center.y + Math.sin(a) * dist);
        if (!this.world.isClearSpot(x, y, r + 12) || this.world.iceAt(x, y)) continue;
        const e = this._makeEnemy(kind, x, y, a + Math.PI, 1);
        e.baseId = -1;
        e.wave = true;
        e.state = 'active';
        e.aiTimer = Math.random() * 0.6;
        e.reactTimer = 0.6;
        this.enemies.push(e);
        return e;
      }
      return null;
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
