(function (global) {
  'use strict';

  // The industrial planet's battlefield: what an operation (js/data/operations.js) can add on top
  // of its compounds —
  //   turrets   gun turrets on the elevated highway deck (they fire down from above); `powered`
  //             ones go dark once the compound marked `power` is captured
  //   tunnels   manholes / subway exits: infantry climbs out when the platoon passes close by
  //             (ambush.size fighters, at most ambush.uses times each); with the tunnel map (the
  //             collaborator saved, js/campaign.js) they show on the radar
  //   IEDs      hidden bombs on the streets (operation.guerrilla): they light up red once the
  //             player's tank is close, blow up under a friendly tank, or can be shot
  //   escort    meet the collaborator, then bring them to the tunnel entrance on foot
  //   finale    a boss appears once the other objectives are met; destroying it ends the operation
  //   buildings civilian ones crumble under friendly fire (each one lost costs the people's
  //             cooperation, js/campaign.js); fuel tanks explode and set off what is around them
  // Infantry is run over by a friendly tank driving into it.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { ENEMY_SPECS } = global.GameData;

  const AMBUSH_NEAR = 130; // a tunnel opens when the player passes between these distances
  const AMBUSH_FAR = 430;
  const AMBUSH_COOLDOWN = 26; // s before the same tunnel can be used again
  const IED_SPOT = 200; // the player this close sees an IED (red light)
  const IED_TRIGGER = 24; // a friendly tank's edge this close sets it off
  const IED_RADIUS = 96;
  const IED_DAMAGE = 62;
  const IED_KEEP_CLEAR = 260; // no IED this close to the start, a compound or a patrol point (…/2)
  const CRUSH_SPEED = 35; // a friendly tank at least this fast runs infantry over
  const ESCORT_MEET = 100; // the player this close to the meeting point picks the collaborator up
  const ESCORT_ARRIVE = 80; // the collaborator this close to the destination is safe
  const ESCORT_FOLLOW = 95; // the collaborator keeps about this far behind the player
  const ESCORT_HP = 70;
  const FUEL_RADIUS = 175; // blast of an exploding fuel tank
  const FUEL_DAMAGE = 92;

  function seededRand(seed) {
    let s = Math.max(1, Math.floor(seed)) % 2147483647;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  class CombatCity {
    // Everything above for the operation (called once the compounds are garrisoned)
    _setupCity() {
      const op = this.operation;
      this.civilLost = 0; // civilian buildings destroyed by the platoon this sortie
      this.turretsDown = false;
      this.tunnels = [];
      this.ieds = [];
      this.escort = null;
      this.finale = null;
      if (!op) return;
      const campaign = global.Campaign;
      // The people's mood on the last stage: 0 (on our side) .. 1 (cooperation gone, collaborator lost)
      const threat = campaign ? campaign.guerrillaThreat : 0;
      const scaled = ([lo, hi]) => Math.round(lo + (hi - lo) * threat);
      const g = op.guerrilla || null;

      for (const t of op.turrets || []) {
        const x = this.world.wrapX(t.x);
        const y = this.world.wrapY(t.y);
        const e = this._makeEnemy('turret', x, y, Math.PI * 0.5, 1);
        e.z = this.world.deckHeightAt(x, y);
        e.perched = e.z > 0;
        e.powered = !!t.powered;
        e.baseId = -1;
        e.state = 'active';
        e.reactTimer = 0;
        this.enemies.push(e);
      }

      const ambush = op.ambush || { size: 2, uses: 2 };
      this.ambushSize = g ? scaled(g.ambush) : ambush.size;
      this.ambushUses = ambush.uses;
      this.tunnels = (op.tunnels || []).map((t) => ({ x: this.world.wrapX(t.x), y: this.world.wrapY(t.y), cool: 0, uses: 0, open: 0 }));
      // The tunnel map comes from the collaborator: on the escort itself once they are safe
      this.tunnelsKnown = !op.escort && !!(campaign && campaign.collaborator === true);

      if (g) this._placeIeds(scaled(g.ieds), op);
      if (op.escort) {
        const e = op.escort;
        this.escort = {
          name: e.name || '協力者',
          meet: { x: this.world.wrapX(e.meet.x), y: this.world.wrapY(e.meet.y), name: e.meet.name },
          to: { x: this.world.wrapX(e.to.x), y: this.world.wrapY(e.to.y), name: e.to.name },
          stage: 'meet', // → 'follow' → 'done' | 'lost'
          unit: null
        };
      }
      if (op.finale) this.finale = { ...op.finale, spawned: false, done: false, unit: null };
    }

    // IEDs at clear street spots of the operation's first town (fixed per operation)
    _placeIeds(count, op) {
      const town = this.world.zones.find((z) => z.kind === 'city');
      if (!town || count <= 0) return;
      const rand = seededRand((town.seed || 1) * 31 + 7);
      const start = op.startAt || this.world.hq;
      const far = (x, y, px, py, r) => Math.hypot(this.world.deltaX(x, px), this.world.deltaY(y, py)) > r;
      for (let tries = 0; this.ieds.length < count && tries < 600; tries++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * town.radius * 0.92;
        const x = this.world.wrapX(town.x + Math.cos(a) * d);
        const y = this.world.wrapY(town.y + Math.sin(a) * d);
        if (!this.world.isClearSpot(x, y, 36)) continue;
        if (!far(x, y, start.x, start.y, IED_KEEP_CLEAR)) continue;
        if (!this.world.sites.every((s) => far(x, y, s.x, s.y, IED_KEEP_CLEAR))) continue;
        if (!(op.survey || []).every((p) => far(x, y, p.x, p.y, IED_KEEP_CLEAR * 0.5))) continue;
        if (!this.ieds.every((o) => far(x, y, o.x, o.y, 220))) continue;
        this.ieds.push({ x, y, alive: true, seen: false });
      }
    }

    _updateCity(dt, player) {
      this._crushInfantry();
      this._updateTunnels(dt, player);
      this._updateIeds(player);
      this._updateEscort(dt, player);
    }

    // ---- infantry -------------------------------------------------------------------------------
    // Friendly tanks driving into infantry run it over
    _crushInfantry() {
      const friendlies = [this._playerRef, ...this.allies];
      for (const e of this.enemies) {
        if (!e.alive || !e.isInfantry) continue;
        for (const f of friendlies) {
          if (!f || !f.alive || Math.abs(f.speed) < CRUSH_SPEED) continue;
          const d = Math.hypot(this.world.deltaX(e.x, f.x), this.world.deltaY(e.y, f.y));
          if (d > e.radius + f.radius * 0.85) continue;
          this.spawnDustOrSmoke(e.x, e.y, 2, 8, '#57534e');
          this.damageEnemy(e, e.hp + 1, f.isPlayer ? 'player' : 'ally');
          break;
        }
      }
    }

    // ---- tunnels --------------------------------------------------------------------------------
    _updateTunnels(dt, player) {
      for (const t of this.tunnels) {
        t.cool = Math.max(0, t.cool - dt);
        t.open = Math.max(0, t.open - dt);
        if (!player.alive || t.cool > 0 || t.uses >= this.ambushUses || this.missionComplete) continue;
        const d = Math.hypot(this.world.deltaX(t.x, player.x), this.world.deltaY(t.y, player.y));
        if (d < AMBUSH_NEAR || d > AMBUSH_FAR) continue;
        let spawned = 0;
        for (let n = 0; n < this.ambushSize; n++) {
          const a = Math.random() * Math.PI * 2;
          const x = this.world.wrapX(t.x + Math.cos(a) * (14 + n * 9));
          const y = this.world.wrapY(t.y + Math.sin(a) * (14 + n * 9));
          if (!this.world.isClearSpot(x, y, 14)) continue;
          const e = this._makeEnemy('infantry', x, y, Math.atan2(this.world.deltaY(y, player.y), this.world.deltaX(x, player.x)), 0);
          e.baseId = -1;
          e.state = 'active';
          e.reactTimer = 0.9;
          e.alertMarkDelay = n * 0.12;
          e.alertMarkTimer = global.Tank2D.ALERT_MARK_DURATION;
          this.enemies.push(e);
          spawned += 1;
        }
        if (spawned === 0) continue;
        t.uses += 1;
        t.cool = AMBUSH_COOLDOWN;
        t.open = 3;
        this.spawnDustOrSmoke(t.x, t.y, 2, 10, '#78716c');
        this.events.push({ type: 'ambush', count: spawned });
      }
    }

    // ---- IEDs -----------------------------------------------------------------------------------
    _updateIeds(player) {
      if (this.ieds.length === 0) return;
      const friendlies = [player, ...this.allies];
      const escortee = this.escort && this.escort.stage === 'follow' ? this.escort.unit : null;
      if (escortee) friendlies.push(escortee);
      for (const b of this.ieds) {
        if (!b.alive) continue;
        if (!b.seen && player.alive && Math.hypot(this.world.deltaX(b.x, player.x), this.world.deltaY(b.y, player.y)) < IED_SPOT) {
          b.seen = true;
          this.events.push({ type: 'iedSpotted' });
        }
        for (const f of friendlies) {
          if (!f || !f.alive) continue;
          if (Math.hypot(this.world.deltaX(b.x, f.x), this.world.deltaY(b.y, f.y)) > IED_TRIGGER + f.radius) continue;
          this._detonateIed(b, true);
          break;
        }
      }
    }

    // underFoot: set off by a tank driving onto it (otherwise shot from afar)
    _detonateIed(b, underFoot) {
      if (!b.alive) return;
      b.alive = false;
      this.explodeAt(b.x, b.y, IED_RADIUS, IED_DAMAGE, false, this._playerRef, true);
      this.spawnDustOrSmoke(b.x, b.y, 4, 16, '#57534e');
      this.events.push({ type: underFoot ? 'iedBlast' : 'iedCleared' });
    }

    // A blast of the platoon's shells sets off the IEDs it reaches
    _blastIeds(x, y, radius) {
      for (const b of this.ieds) {
        if (!b.alive) continue;
        if (Math.hypot(this.world.deltaX(x, b.x), this.world.deltaY(y, b.y)) < radius + 14) this._detonateIed(b, false);
      }
    }

    // ---- escort ---------------------------------------------------------------------------------
    _updateEscort(dt, player) {
      const esc = this.escort;
      if (!esc) return;
      if (esc.stage === 'meet') {
        if (!player.alive) return;
        if (Math.hypot(this.world.deltaX(esc.meet.x, player.x), this.world.deltaY(esc.meet.y, player.y)) > ESCORT_MEET) return;
        const spec = ENEMY_SPECS.infantry;
        esc.unit = new global.Tank2D(this.world, {
          ...spec,
          kind: 'escort',
          hullColor: '#1e40af',
          hullDark: '#1e3a8a',
          turretColor: '#3b82f6',
          accentColor: '#bae6fd',
          x: esc.meet.x,
          y: esc.meet.y,
          maxHp: ESCORT_HP,
          maxSpeed: 128,
          accel: 420
        });
        esc.unit.isEscort = true;
        esc.stage = 'follow';
        this.events.push({ type: 'escortMet', escort: esc });
        return;
      }
      if (esc.stage !== 'follow') return;
      const u = esc.unit;
      if (!u.alive) {
        esc.stage = 'lost';
        this.events.push({ type: 'escortLost', escort: esc });
        return;
      }
      const toDest = Math.hypot(this.world.deltaX(u.x, esc.to.x), this.world.deltaY(u.y, esc.to.y));
      if (toDest < ESCORT_ARRIVE) {
        esc.stage = 'done';
        u.alive = false; // down into the tunnel
        this.tunnelsKnown = true;
        this.spawnDustOrSmoke(esc.to.x, esc.to.y, 2, 8, '#93c5fd');
        this.events.push({ type: 'escortDone', escort: esc });
        return;
      }
      // Run for the tunnel once the player is near it; otherwise keep close behind the player
      const playerNearDest = Math.hypot(this.world.deltaX(player.x, esc.to.x), this.world.deltaY(player.y, esc.to.y)) < 300;
      const dPlayer = Math.hypot(this.world.deltaX(u.x, player.x), this.world.deltaY(u.y, player.y));
      if (playerNearDest || !player.alive) {
        this._steerToward(u, esc.to.x, esc.to.y, dt, 1);
      } else if (dPlayer > ESCORT_FOLLOW) {
        this._steerToward(u, player.x, player.y, dt, Math.min(1, (dPlayer - ESCORT_FOLLOW) / 120 + 0.3));
      } else {
        u.stepPhysics(0, 0, dt, null);
      }
      u.returnTurretStraight(dt);
    }

    // Walk / drive a unit toward (tx, ty), steering around solids (same steering as the enemy AI)
    _steerToward(e, tx, ty, dt, throttle) {
      const dx = this.world.deltaX(e.x, tx);
      const dy = this.world.deltaY(e.y, ty);
      const dist = Math.max(1, Math.hypot(dx, dy));
      let desiredX = dx / dist;
      let desiredY = dy / dist;
      for (const obs of this.world.colliders) {
        const ox = this.world.deltaX(obs.x, e.x);
        const oy = this.world.deltaY(obs.y, e.y);
        if (Math.hypot(ox, oy) - obs.radius - e.radius > 90) continue;
        const s = this.world.surfaceGap(obs, e.x, e.y);
        const clearance = s.gap - e.radius;
        if (clearance > 70) continue;
        const push = (1 - Math.max(0, clearance) / 70) * 1.4;
        desiredX += s.nx * push;
        desiredY += s.ny * push;
      }
      let angDiff = Math.atan2(desiredY, desiredX) - e.hullAngle;
      while (angDiff > Math.PI) angDiff -= Math.PI * 2;
      while (angDiff < -Math.PI) angDiff += Math.PI * 2;
      e.stepPhysics(Math.abs(angDiff) < 1.8 ? throttle : -0.3, Math.max(-1, Math.min(1, angDiff * 2.4)), dt, null);
    }

    // The collaborator while on the move with the platoon (enemies go for them too)
    escortUnit() {
      const esc = this.escort;
      return esc && esc.stage === 'follow' && esc.unit && esc.unit.alive ? esc.unit : null;
    }

    // ---- turrets / finale -----------------------------------------------------------------------
    // The power plant has fallen: the turrets on its grid go dark
    _powerDown() {
      if (this.turretsDown) return;
      this.turretsDown = true;
      let n = 0;
      for (const e of this.enemies) {
        if (!e.alive || !e.powered) continue;
        e.state = 'off';
        e.powerOff = true;
        n += 1;
      }
      this.events.push({ type: 'powerDown', count: n });
    }

    // Finale (operation.finale): the boss appears once everything else is done. Returns true while
    // it is still out there.
    _updateFinale() {
      const f = this.finale;
      if (!f || f.done) return false;
      if (!f.spawned) {
        f.spawned = true;
        const x = this.world.wrapX(f.at.x);
        const y = this.world.wrapY(f.at.y);
        const e = this._makeEnemy(f.kind, x, y, f.angle != null ? f.angle : Math.PI * 0.5, 1);
        e.baseId = -1;
        e.state = 'active';
        e.reactTimer = 1.6;
        e.alertMarkTimer = global.Tank2D.ALERT_MARK_DURATION;
        this.enemies.push(e);
        f.unit = e;
        this.audio.playAlert();
        this.events.push({ type: 'bossArrived', kind: f.kind });
        return true;
      }
      if (f.unit.alive) return true;
      f.done = true;
      return false;
    }

    // ---- buildings ------------------------------------------------------------------------------
    // A shell or blast hits a destructible building / fuel tank. source: 'player' | 'ally' | 'enemy' | null
    _damageStructure(s, amount, source) {
      if (s.hp == null || s.hp <= 0) return;
      s.hp -= amount;
      if (s.hp > 0) {
        if (s.civil) this.spawnDustOrSmoke(s.x, s.y, s.height * 0.6, 3, '#a8a29e');
        return;
      }
      this.world.removeStructure(s);
      const friendly = source === 'player' || source === 'ally';
      if (s.fuel) {
        this._fuelBlast(s, source);
        return;
      }
      this.spawnDustOrSmoke(s.x, s.y, 10, 22, '#a8a29e');
      this.spawnDustOrSmoke(s.x, s.y, 30, 10, '#78716c');
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.3);
      this.audio.playExplosion(1.1);
      if (s.civil && friendly) {
        this.civilLost += 1;
        this.events.push({ type: 'civilLost', count: this.civilLost });
      }
    }

    // An exploding fuel tank: hits everyone around (both sides) and sets off what stands near it
    _fuelBlast(s, source) {
      const player = this._playerRef;
      this.explodeAt(s.x, s.y, FUEL_RADIUS, FUEL_DAMAGE, true, player, true, source);
      this.spawnDustOrSmoke(s.x, s.y, 20, 26, '#f97316');
      this.spawnDustOrSmoke(s.x, s.y, 50, 16, '#292524');
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.9);
      const hurt = (t, apply) => {
        if (!t || !t.alive) return;
        const dx = this.world.deltaX(s.x, t.x);
        const dy = this.world.deltaY(s.y, t.y);
        const d = Math.hypot(dx, dy);
        if (d > FUEL_RADIUS + t.radius) return;
        const dmg = FUEL_DAMAGE * Math.max(0.35, 1 - d / (FUEL_RADIUS + t.radius + 8));
        apply(t, dmg);
        this._blastKnockback(t, dx, dy, dmg);
      };
      hurt(player, (t, dmg) => this.damagePlayer(t, dmg));
      for (const a of this.allies) hurt(a, (t, dmg) => this.damageAlly(t, dmg));
      hurt(this.escortUnit(), (t, dmg) => this._damageEscort(dmg));
      this.events.push({ type: 'fuelBlast' });
      // Chain reaction: other fuel tanks and buildings caught in the blast
      for (const o of this.world.structures.slice()) {
        if (o.hp == null) continue;
        const ext = o.box ? Math.max(o.box.hx, o.box.hy) : o.radius;
        const d = Math.hypot(this.world.deltaX(s.x, o.x), this.world.deltaY(s.y, o.y)) - ext;
        if (d > FUEL_RADIUS) continue;
        this._damageStructure(o, FUEL_DAMAGE * Math.max(0.4, 1 - d / FUEL_RADIUS), source);
      }
    }

    _damageEscort(amount) {
      const u = this.escortUnit();
      if (!u) return;
      u.hp = Math.max(0, u.hp - amount);
      if (u.hp <= 0) {
        u.alive = false;
        this.spawnDustOrSmoke(u.x, u.y, 2, 8, '#93c5fd');
      }
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatCity);
})(window);
