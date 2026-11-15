(function (global) {
  'use strict';

  const ENEMY_SPECS = {
    light: {
      hullColor: '#991b1b',
      hullDark: '#7f1d1d',
      turretColor: '#b91c1c',
      accentColor: '#fca5a5',
      scale: 0.8,
      maxHp: 55,
      maxSpeed: 245,
      accel: 460,
      turnSpeed: 3.1,
      damage: 11,
      reloadTime: 2.1,
      shellSpeed: 440,
      splashRadius: 38,
      scrapValue: 26,
      preferredDist: 230
    },
    medium: {
      hullColor: '#7f1d1d',
      hullDark: '#450a0a',
      turretColor: '#991b1b',
      accentColor: '#f97316',
      scale: 1.0,
      maxHp: 105,
      maxSpeed: 175,
      accel: 340,
      turnSpeed: 2.1,
      damage: 18,
      reloadTime: 2.5,
      shellSpeed: 470,
      splashRadius: 46,
      scrapValue: 42,
      preferredDist: 290
    },
    heavy: {
      hullColor: '#451a03',
      hullDark: '#271002',
      turretColor: '#78350f',
      accentColor: '#fbbf24',
      scale: 1.28,
      maxHp: 210,
      maxSpeed: 130,
      accel: 260,
      turnSpeed: 1.5,
      damage: 28,
      reloadTime: 3.0,
      shellSpeed: 500,
      splashRadius: 56,
      scrapValue: 75,
      preferredDist: 340
    },
    bunker: {
      hullColor: '#334155',
      hullDark: '#1e293b',
      turretColor: '#475569',
      accentColor: '#ef4444',
      scale: 1.15,
      isBunker: true,
      maxHp: 150,
      maxSpeed: 0,
      accel: 0,
      turnSpeed: 0,
      damage: 22,
      reloadTime: 2.7,
      shellSpeed: 520,
      splashRadius: 52,
      scrapValue: 55,
      preferredDist: 380
    },
    boss: {
      hullColor: '#4c1d95',
      hullDark: '#2e1065',
      turretColor: '#6d28d9',
      accentColor: '#f43f5e',
      scale: 1.75,
      maxHp: 560,
      maxSpeed: 145,
      accel: 280,
      turnSpeed: 1.35,
      damage: 34,
      reloadTime: 1.9,
      shellSpeed: 540,
      splashRadius: 72,
      scrapValue: 220,
      preferredDist: 360
    }
  };

  // Garrison of each compound per district (district 1 -> 3 gets progressively stronger);
  // the second compound of a district is the larger one
  const DISTRICT_TEMPLATES = [
    [
      { bunkers: 1, tanks: ['light', 'light', 'medium'] },
      { bunkers: 1, tanks: ['light', 'light', 'medium', 'medium'] }
    ],
    [
      { bunkers: 1, tanks: ['light', 'medium', 'medium', 'medium'] },
      { bunkers: 2, tanks: ['light', 'light', 'medium', 'medium'] }
    ],
    [
      { bunkers: 2, tanks: ['light', 'medium', 'medium', 'medium'] },
      { bunkers: 2, tanks: ['light', 'light', 'medium', 'medium', 'medium'] }
    ]
  ];
  const ALERT_RADIUS = 650; // the player this close to a compound puts it on alert
  const ENEMY_REACTION_TIME = 0.5; // s an alerted tank holds still (turret tracking only) before moving/firing
  const CANNON_RECOIL_KNOCKBACK = 150; // px/s backwards shove when a tank fires its main gun (~21px)
  const HIT_KNOCKBACK_BASE = 110; // px/s shove from being caught in a blast…
  const HIT_KNOCKBACK_PER_DAMAGE = 3.2; // …plus this much per point of damage taken
  const ALLY_ALERT_RADIUS = 450; // wingmen alone must come closer before they are spotted
  const BASE_CLEAR_BONUS = 50; // scrap reward for neutralising a compound

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

    // Build runtime state for every district and compound. Only district 1 is garrisoned at the
    // start; each later district (and its compounds) appears when the previous one is secured.
    spawnBases() {
      this.bases = [];
      this.districts = [];
      if (!this.enemiesEnabled) return;
      for (const d of this.world.districts || []) {
        this.districts.push({ id: d.id, name: d.name, unlocked: false, secured: false, baseIds: [] });
      }
      for (const site of this.world.enemyBases || []) {
        this.districts[site.districtId].baseIds.push(site.id);
        this.bases.push({
          id: site.id,
          name: site.name,
          districtId: site.districtId,
          slot: site.slot,
          x: site.x,
          y: site.y,
          radius: site.radius,
          locked: true, // its district hasn't been unlocked yet: no garrison, not shown
          alerted: false,
          cleared: false,
          total: 0
        });
      }
      if (this.districts.length) this.unlockDistrict(0, false);
    }

    // Reveal a district: garrison its compounds and draw them on the ground
    unlockDistrict(id, announce) {
      const district = this.districts[id];
      if (!district || district.unlocked) return;
      district.unlocked = true;
      for (const bid of district.baseIds) {
        const base = this.bases[bid];
        const site = this.world.enemyBases[bid];
        base.locked = false;
        this._garrisonBase(base, site);
        if (this.world.revealBase) this.world.revealBase(bid);
      }
      if (announce) this.events.push({ type: 'districtUnlocked', district });
    }

    // Parked (idle) tanks and manned bunkers for one compound, scaled by district tier
    _garrisonBase(base, site) {
      const tier = base.districtId;
      const tpls = DISTRICT_TEMPLATES[Math.min(tier, DISTRICT_TEMPLATES.length - 1)];
      const tpl = tpls[Math.min(site.slot, tpls.length - 1)];
      const hpScale = 1 + tier * 0.15;
      const add = (kind, slot, angle) => {
        const spec = ENEMY_SPECS[kind];
        const tank = new global.Tank2D(this.world, {
          ...spec,
          kind,
          x: slot.x,
          y: slot.y,
          hullAngle: angle,
          maxHp: Math.round(spec.maxHp * hpScale),
          scrapValue: Math.round(spec.scrapValue * (1 + tier * 0.15))
        });
        tank.baseId = base.id;
        tank.state = 'idle'; // parked until the compound is alerted
        tank.reloadTimer = 0.8 + Math.random() * 1.2;
        this.enemies.push(tank);
        base.total += 1;
      };
      for (let k = 0; k < tpl.bunkers && k < site.bunkerSlots.length; k++) {
        add('bunker', site.bunkerSlots[k], site.bunkerSlots[k].angle);
      }
      tpl.tanks.forEach((kind, k) => {
        const slot = site.parkingSlots[k % site.parkingSlots.length];
        add(kind, slot, slot.angle);
      });
    }

    // District currently being fought over (first unlocked, unsecured one)
    get currentDistrict() {
      return this.districts.find((d) => d.unlocked && !d.secured) || null;
    }

    get districtsSecured() {
      return this.districts.filter((d) => d.secured).length;
    }

    districtRemaining(id) {
      const d = this.districts[id];
      return d ? d.baseIds.filter((bid) => !this.bases[bid].cleared).length : 0;
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
      this.events.push({ type: 'alert', base });
    }

    drainEvents() {
      const ev = this.events;
      this.events = [];
      return ev;
    }

    _updateBases(dt, player) {
      // Alert compounds that a friendly tank has come close to
      const friendlies = [player, ...this.allies];
      for (const base of this.bases) {
        if (base.locked || base.alerted || base.cleared) continue;
        for (const f of friendlies) {
          if (!f.alive) continue;
          const d = Math.hypot(this.world.deltaX(base.x, f.x), this.world.deltaY(base.y, f.y));
          if (d < (f === player ? ALERT_RADIUS : ALLY_ALERT_RADIUS)) {
            this.alertBase(base);
            break;
          }
        }
      }

      // A compound is cleared once its whole garrison is destroyed
      for (const base of this.bases) {
        if (base.locked) continue;
        if (base.cleared) {
          // White flag is hoisted up the pole over ~1.2 s after the compound falls
          base.flagRaise = Math.min(1, (base.flagRaise || 0) + dt / 1.2);
          continue;
        }
        if (!this.enemies.some((e) => e.alive && e.baseId === base.id)) {
          base.cleared = true;
          base.flagRaise = 0;
          this.scrap += BASE_CLEAR_BONUS;
          this.stats.scrapEarned += BASE_CLEAR_BONUS;
          // Capturing a compound hauls in every scattered item. No automatic resupply: repairs are
          // only available at compounds in a secured district (garage menu "補給").
          const collected = this._vacuumAllPickups();
          this.audio.playWaveClear();
          this.events.push({ type: 'cleared', base, bonus: BASE_CLEAR_BONUS, collected });
        }
      }

      // A district is secured once all of its compounds are captured. The next district is NOT
      // unlocked here: the UI calls unlockDistrict(next.id) once the operator's report has finished.
      for (const d of this.districts) {
        if (!d.unlocked || d.secured) continue;
        if (d.baseIds.every((bid) => this.bases[bid].cleared)) {
          d.secured = true;
          this.stats.districtTimes[d.id] = this.stats.elapsed;
          this.stats.districtClock[d.id] = this._clockStamp();
          const next = this.districts[d.id + 1] || null;
          this.events.push({ type: 'districtSecured', district: d, next });
        }
      }

      // Area cleared shortly after the last district is secured
      if (!this.missionComplete && this.districts.length > 0 && player.alive &&
          this.districts.every((d) => d.secured)) {
        this.missionTimer += dt;
        if (this.missionTimer > 2.2) this.missionComplete = true;
      }
    }

    fireMainCannon(tank, targetX, targetY) {
      if (tank.reloadTimer > 0 || !tank.alive) return false;
      tank.reloadTimer = tank.reloadTime;
      tank.triggerFireEffects();

      const muzzle = tank.getMuzzleWorld();
      // Firing shock: the whole tank is shoved back opposite the barrel
      tank.applyKnockback(-muzzle.dirX, -muzzle.dirY, CANNON_RECOIL_KNOCKBACK);
      const isRail = tank.isPlayer && tank.cannonLevel >= 5;

      // Calculate exact parabolic vz to land at target distance
      let rawDist = 360;
      if (targetX !== undefined && targetY !== undefined) {
        const dx = this.world.deltaX(muzzle.x, targetX);
        const dy = this.world.deltaY(muzzle.y, targetY);
        rawDist = Math.hypot(dx, dy);
      }
      const gScale = isRail ? 0.3 : 1.0;
      const launch = CombatManager.computeShellLaunch(muzzle.z, rawDist, tank.shellSpeed, gScale);

      const friendly = tank.isPlayer || tank.isAlly;
      if (tank.isPlayer) this.stats.shotsFired += 1;
      this.projectiles.push({
        kind: 'cannon',
        fromPlayer: friendly, // "player side": player and wingmen
        source: tank.isPlayer ? 'player' : tank.isAlly ? 'ally' : 'enemy',

        x: muzzle.x,
        y: muzzle.y,
        z: muzzle.z,
        vx: muzzle.dirX * tank.shellSpeed,
        vy: muzzle.dirY * tank.shellSpeed,
        vz: launch.vz,
        gScale,
        damage: tank.damage,
        splashRadius: tank.splashRadius,
        color: tank.isPlayer ? (isRail ? '#38bdf8' : '#fbbf24') : tank.isAlly ? '#a3e635' : '#f87171',
        radius: tank.kind === 'boss' ? 7 : 5,
        life: 2.6,
        trailTimer: 0
      });

      this.spawnDustOrSmoke(muzzle.x, muzzle.y, muzzle.z, 5, friendly ? '#fef08a' : '#fca5a5');

      if (tank.isPlayer) {
        this.audio.playCannon(1 + (tank.damage - 40) / 100);
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.45);
      } else {
        this.audio.playCannon(tank.isAlly ? 0.5 : 0.6);
      }
      return true;
    }

    fireSubWeapon(player) {
      if (!player.alive || player.subLevel <= 0 || player.subCooldown > 0) return false;

      const subLv = player.subLevel;
      if (subLv <= 2 && player.subOverheated) return false;

      const muzzle = player.getMuzzleWorld();
      const perpX = -muzzle.dirY;
      const perpY = muzzle.dirX;
      const ox = this.world.wrapX(muzzle.x + perpX * 8);
      const oy = this.world.wrapY(muzzle.y + perpY * 8);

      if (subLv <= 2) {
        player.subCooldown = subLv === 1 ? 0.14 : 0.11;
        const heatStep = subLv === 1 ? 0.065 : 0.055;
        player.subHeat = Math.min(1, player.subHeat + heatStep);
        if (player.subHeat >= 1) {
          player.subOverheated = true;
        }
        const jitter = (Math.random() - 0.5) * 0.08;
        const ang = player.turretAngle + jitter;
        const speed = 780;
        this.stats.shotsFired += 1;
        this.projectiles.push({
          kind: 'autocannon',
          fromPlayer: true,
          source: 'player',
          x: ox,
          y: oy,
          z: muzzle.z,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          vz: -10,
          gScale: 0.1,
          damage: subLv === 1 ? 12 : 17,
          splashRadius: 20,
          color: '#34d399',
          radius: 3.2,
          life: 1.15,
          trailTimer: 0
        });
        this.audio.playAutocannon();
      } else {
        player.subCooldown = Math.max(0.55, 1.0 - (subLv - 3) * 0.2);
        const count = subLv >= 5 ? 3 : subLv === 4 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const spread = (i - (count - 1) * 0.5) * 0.22;
          const ang = player.turretAngle + spread;
          this.stats.shotsFired += 1;
          this.projectiles.push({
            kind: 'missile',
            fromPlayer: true,
            source: 'player',
            x: ox,
            y: oy,
            z: muzzle.z + 6,
            vx: Math.cos(ang) * 420,
            vy: Math.sin(ang) * 420,
            vz: 45,
            gScale: 0.15,
            damage: 28 + (subLv - 3) * 9,
            splashRadius: 48,
            color: '#38bdf8',
            radius: 4.5,
            life: 2.8,
            trailTimer: 0
          });
        }
        this.audio.playCannon(0.5);
      }
      return true;
    }

    spawnDustOrSmoke(x, y, z, count = 4, color = '#9ca3af') {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 25 + Math.random() * 85;
        this.particles.push({
          x: this.world.wrapX(x),
          y: this.world.wrapY(y),
          z: z + Math.random() * 8,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          vz: 20 + Math.random() * 65,
          life: 0.32 + Math.random() * 0.42,
          maxLife: 0.74,
          size: 4 + Math.random() * 6,
          color
        });
      }
    }

    // source: 'player' | 'ally' | 'enemy' | null (who caused the blast). Returns enemies damaged.
    explodeAt(x, y, radius, damage, fromPlayer, player, isDirect = false, source = null) {
      const wx = this.world.wrapX(x);
      const wy = this.world.wrapY(y);
      this.world.addScorchMark(wx, wy, Math.max(12, radius * 0.42));

      this.shockwaves.push({
        x: wx,
        y: wy,
        radius: 6,
        targetRadius: radius * 1.05,
        color: fromPlayer ? '#fbbf24' : '#f87171',
        life: 0.26,
        maxLife: 0.26
      });

      this.spawnDustOrSmoke(wx, wy, 4, isDirect ? 12 : 8, '#f97316');
      this.spawnDustOrSmoke(wx, wy, 6, 6, '#4b5563');

      if (player) {
        const dx = this.world.deltaX(wx, player.x);
        const dy = this.world.deltaY(wy, player.y);
        const distToPlayer = Math.hypot(dx, dy);
        if (distToPlayer < 420) {
          this.shakeIntensity = Math.max(this.shakeIntensity, Math.max(0.2, (1 - distToPlayer / 420) * 0.85));
        }
      }
      this.audio.playExplosion(radius * 0.02);

      // Purely cosmetic death blasts (damage 0) must not "hit" nearby tanks/props (avoids hit-sound spam)
      if (damage <= 0) return 0;

      let enemiesHit = 0;
      if (fromPlayer) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const dx = this.world.deltaX(wx, e.x);
          const dy = this.world.deltaY(wy, e.y);
          const d = Math.hypot(dx, dy);
          if (d < radius + e.radius) {
            const falloff = Math.max(0.35, 1 - d / (radius + e.radius + 8));
            this.damageEnemy(e, damage * falloff, source);
            this._blastKnockback(e, dx, dy, damage * falloff);
            enemiesHit += 1;
          }
        }
      }

      for (const prop of this.world.props) {
        if (!prop.alive) continue;
        const dx = this.world.deltaX(wx, prop.x);
        const dy = this.world.deltaY(wy, prop.y);
        if (Math.hypot(dx, dy) < radius + prop.radius) {
          this.damageProp(prop, damage, player, source);
        }
      }

      if (!fromPlayer && player && player.alive) {
        const dx = this.world.deltaX(wx, player.x);
        const dy = this.world.deltaY(wy, player.y);
        const d = Math.hypot(dx, dy);
        if (d < radius + player.radius) {
          const falloff = Math.max(0.35, 1 - d / (radius + player.radius + 8));
          this.damagePlayer(player, damage * falloff);
          this._blastKnockback(player, dx, dy, damage * falloff);
        }
      }

      if (!fromPlayer) {
        for (const a of this.allies) {
          if (!a.alive) continue;
          const adx = this.world.deltaX(wx, a.x);
          const ady = this.world.deltaY(wy, a.y);
          const d = Math.hypot(adx, ady);
          if (d < radius + a.radius) {
            const falloff = Math.max(0.35, 1 - d / (radius + a.radius + 8));
            this.damageAlly(a, damage * falloff);
            this._blastKnockback(a, adx, ady, damage * falloff);
          }
        }
      }
      return enemiesHit;
    }

    // Shove a tank caught in a blast away from its centre; (dx, dy) = blast → tank.
    // A dead-centre hit has no direction, so pick a random one.
    _blastKnockback(tank, dx, dy, damage) {
      if (!tank || !tank.alive || !tank.applyKnockback) return;
      if (Math.hypot(dx, dy) < 2) {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a);
      }
      tank.applyKnockback(dx, dy, HIT_KNOCKBACK_BASE + damage * HIT_KNOCKBACK_PER_DAMAGE);
    }

    damageAlly(ally, amount) {
      if (!ally.alive) return;
      ally.hp = Math.max(0, ally.hp - amount * (1 - ally.armorReduction));
      this.audio.playHit();
      if (ally.hp <= 0) {
        ally.alive = false;
        this.stats.alliesLost += 1;
        this.explodeAt(ally.x, ally.y, 80, 0, true, this._playerRef, true);
      }
    }

    // Nearest living friendly (player or wingman) to (x, y)
    nearestFriendly(x, y, player) {
      let best = player && player.alive ? player : null;
      let bestD = best ? Math.hypot(this.world.deltaX(x, best.x), this.world.deltaY(y, best.y)) : Infinity;
      for (const a of this.allies) {
        if (!a.alive) continue;
        const d = Math.hypot(this.world.deltaX(x, a.x), this.world.deltaY(y, a.y));
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    }

    damagePlayer(player, amount) {
      if (!player.alive) return;
      const mitigated = amount * (1 - player.armorReduction);
      this.stats.damageTaken += Math.min(player.hp, mitigated);
      player.hp = Math.max(0, player.hp - mitigated);
      this.damageFlash = 1.0;
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.75);
      this.audio.playHit();
      if (player.hp <= 0) {
        player.alive = false;
        this.explodeAt(player.x, player.y, 90, 0, true, player, true);
      }
    }

    damageEnemy(enemy, amount, source = null) {
      if (!enemy.alive) return;
      // Attacking a parked unit alerts its whole compound
      if (enemy.state === 'idle') this.alertBase(this.bases[enemy.baseId]);
      enemy.hp -= amount;
      this.audio.playHit();
      if (enemy.hp <= 0) {
        enemy.alive = false;
        this.kills += 1;
        this.stats.killsByKind[enemy.kind] = (this.stats.killsByKind[enemy.kind] || 0) + 1;
        const by = source === 'player' ? 'player' : source === 'ally' ? 'ally' : 'other';
        this.stats.killsBy[by] += 1;
        this.explodeAt(enemy.x, enemy.y, 68 * enemy.scale, 0, true, this._playerRef, true);
        this.spawnPickup(enemy.x, enemy.y, 'scrap', enemy.scrapValue);
        if (Math.random() < 0.35 || enemy.kind === 'boss') {
          this.spawnPickup(enemy.x, enemy.y, 'repair', enemy.kind === 'boss' ? 45 : 22);
        }
      }
    }

    damageProp(prop, amount, player, source = null) {
      if (!prop.alive) return;
      prop.hp -= amount;
      if (prop.hp <= 0) {
        prop.alive = false;
        if (prop.type === 'barrel') {
          this.explodeAt(prop.x, prop.y, 92, 55, true, player, true, source);
          if (player && player.alive) {
            const d = Math.hypot(this.world.deltaX(prop.x, player.x), this.world.deltaY(prop.y, player.y));
            if (d < 92) {
              this.damagePlayer(player, 24 * (1 - d / 92));
              this._blastKnockback(player, this.world.deltaX(prop.x, player.x), this.world.deltaY(prop.y, player.y), 24 * (1 - d / 92));
            }
          }
        } else {
          this.spawnDustOrSmoke(prop.x, prop.y, 8, 8, prop.type === 'crystal' ? '#38bdf8' : '#f59e0b');
          this.spawnPickup(prop.x, prop.y, 'scrap', prop.scrap);
          if (prop.type === 'crate' && Math.random() < 0.45) {
            this.spawnPickup(prop.x, prop.y, 'repair', 20);
          }
          this.audio.playExplosion(0.5);
        }
      }
    }

    spawnPickup(x, y, kind, value) {
      this.pickups.push({
        kind,
        value,
        x: this.world.wrapX(x),
        y: this.world.wrapY(y),
        z: 10,
        phase: Math.random() * Math.PI * 2,
        life: 32
      });
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
      this._updateParticles(dt);
      this._updatePickups(dt, player);

      compactInPlace(this.enemies, (e) => e.alive);
      compactInPlace(this.allies, (a) => a.alive);
      this._updateBases(dt, player);
    }

    _updateEnemies(dt, player) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        e.tickAlertMark(dt);
        // Target the nearest friendly tank (player or wingman); re-evaluated every frame
        const tgt = this.nearestFriendly(e.x, e.y, player) || player;
        const dx = this.world.deltaX(e.x, tgt.x);
        const dy = this.world.deltaY(e.y, tgt.y);
        const dist = Math.hypot(dx, dy);

        let throttle = 0;
        let steer = 0;
        const idle = e.state === 'idle'; // parked at its compound until alerted
        // Just alerted: still reacting — turret swings onto the target but the tank neither moves nor fires
        const reacting = !idle && e.reactTimer > 0;
        if (reacting) e.reactTimer = Math.max(0, e.reactTimer - dt);

        if (!idle && !reacting && !e.isBunker && tgt.alive) {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiTimer = 2.0 + Math.random() * 2.4;
            if (Math.random() < 0.4) e.aiStrafeDir *= -1;
          }

          const spec = ENEMY_SPECS[e.kind];
          const nx = dx / Math.max(1, dist);
          const ny = dy / Math.max(1, dist);
          const px = -ny * e.aiStrafeDir;
          const py = nx * e.aiStrafeDir;

          let desiredX = nx;
          let desiredY = ny;
          if (dist < spec.preferredDist * 0.72) {
            desiredX = -nx * 0.7 + px * 0.7;
            desiredY = -ny * 0.7 + py * 0.7;
          } else if (dist < spec.preferredDist * 1.25) {
            desiredX = px * 0.9 + nx * 0.2;
            desiredY = py * 0.9 + ny * 0.2;
          }

          // Steer around nearby boulders instead of grinding against them
          for (const obs of this.world.obstacles) {
            const ox = this.world.deltaX(obs.x, e.x);
            const oy = this.world.deltaY(obs.y, e.y);
            const od = Math.hypot(ox, oy);
            const clearance = od - obs.radius - e.radius;
            if (clearance > 90 || od < 1) continue;
            const push = (1 - Math.max(0, clearance) / 90) * 1.6;
            desiredX += (ox / od) * push;
            desiredY += (oy / od) * push;
          }

          const desiredAng = Math.atan2(desiredY, desiredX);
          let angDiff = desiredAng - e.hullAngle;
          while (angDiff > Math.PI) angDiff -= Math.PI * 2;
          while (angDiff < -Math.PI) angDiff += Math.PI * 2;

          steer = Math.max(-1, Math.min(1, angDiff * 2.2));
          throttle = Math.abs(angDiff) < 1.8 ? 0.85 : -0.35;
        }

        e.stepPhysics(throttle, steer, false, dt, null);

        if (!idle && tgt.alive && dist < 760) {
          // Lead the target using actual velocity (correct in both tank & directional control modes)
          const leadX = this.world.wrapX(tgt.x + tgt._velX * 0.25);
          const leadY = this.world.wrapY(tgt.y + tgt._velY * 0.25);
          e.aimAtWorldPoint(leadX, leadY, dt);
          if (!reacting && e.reloadTimer <= 0 && dist < 620) {
            this.fireMainCannon(e, leadX, leadY);
          }
        } else {
          e.returnTurretStraight(dt);
        }

        // Tank-to-tank ramming / separation
        if (player.alive && !e.isBunker) {
          const rdx = this.world.deltaX(e.x, player.x);
          const rdy = this.world.deltaY(e.y, player.y);
          const minD = player.radius + e.radius;
          const dSq = rdx * rdx + rdy * rdy;
          if (dSq < minD * minD && dSq > 0.001) {
            const d = Math.sqrt(dSq);
            const push = (minD - d) * 0.5;
            const nx = rdx / d;
            const ny = rdy / d;
            player.x = this.world.wrapX(player.x + nx * push);
            player.y = this.world.wrapY(player.y + ny * push);
            e.x = this.world.wrapX(e.x - nx * push);
            e.y = this.world.wrapY(e.y - ny * push);

            if (player.boosting && Math.abs(player.speed) > 180) {
              this.damageEnemy(e, 24 * dt * 4, 'player');
            }
          }
        }
      }

      this._separateEnemies();
    }

    // Prevent enemy tanks from stacking on top of each other
    _separateEnemies() {
      const list = this.enemies;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!b.alive) continue;
          const dx = this.world.deltaX(a.x, b.x);
          const dy = this.world.deltaY(a.y, b.y);
          const minD = a.radius + b.radius;
          const dSq = dx * dx + dy * dy;
          if (dSq >= minD * minD || dSq < 0.001) continue;
          const d = Math.sqrt(dSq);
          const overlap = minD - d;
          const nx = dx / d;
          const ny = dy / d;
          // Stationary bunkers don't get pushed; the mobile tank takes the full correction
          const aW = a.isBunker ? 0 : b.isBunker ? 1 : 0.5;
          const bW = b.isBunker ? 0 : a.isBunker ? 1 : 0.5;
          a.x = this.world.wrapX(a.x - nx * overlap * aW);
          a.y = this.world.wrapY(a.y - ny * overlap * aW);
          b.x = this.world.wrapX(b.x + nx * overlap * bW);
          b.y = this.world.wrapY(b.y + ny * overlap * bW);
        }
      }
    }

    _updateProjectiles(dt, player) {
      const keep = [];

      for (const p of this.projectiles) {
        p.life -= dt;
        if (p.life <= 0) continue;

        if (p.kind === 'missile' && this.enemies.length > 0) {
          let best = null;
          let bestD = Infinity;
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = this.world.deltaX(p.x, e.x);
            const dy = this.world.deltaY(p.y, e.y);
            const dSq = dx * dx + dy * dy;
            if (dSq < bestD) {
              bestD = dSq;
              best = e;
            }
          }
          if (best && bestD < 700 * 700) {
            const dx = this.world.deltaX(p.x, best.x);
            const dy = this.world.deltaY(p.y, best.y);
            const len = Math.max(1, Math.hypot(dx, dy));
            const desiredVx = (dx / len) * 440;
            const desiredVy = (dy / len) * 440;
            p.vx += (desiredVx - p.vx) * Math.min(1, dt * 5.2);
            p.vy += (desiredVy - p.vy) * Math.min(1, dt * 5.2);
          }
        }

        p.vz -= SHELL_GRAVITY * p.gScale * dt;
        p.x = this.world.wrapX(p.x + p.vx * dt);
        p.y = this.world.wrapY(p.y + p.vy * dt);
        p.z += p.vz * dt;

        p.trailTimer += dt;
        if (p.trailTimer > (p.kind === 'missile' ? 0.03 : 0.055) && p.kind !== 'autocannon') {
          p.trailTimer = 0;
          this.spawnDustOrSmoke(p.x, p.y, p.z, 1, p.color);
        }

        let hit = false;

        // Enemy collision
        if (p.fromPlayer && p.z < 46) {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = this.world.deltaX(p.x, e.x);
            const dy = this.world.deltaY(p.y, e.y);
            if (Math.hypot(dx, dy) < e.radius + 9) {
              hit = true;
              if (p.source === 'player') this.stats.shotsHit += 1;
              if (p.kind === 'autocannon') {
                this.damageEnemy(e, p.damage, p.source);
                this.spawnDustOrSmoke(p.x, p.y, p.z, 3, '#34d399');
              } else {
                this.explodeAt(p.x, p.y, p.splashRadius, p.damage, true, player, true, p.source);
              }
              break;
            }
          }
        } else if (!p.fromPlayer) {
          const struck = (t) => t.alive && p.z < t.z + 34 &&
            Math.hypot(this.world.deltaX(p.x, t.x), this.world.deltaY(p.y, t.y)) < t.radius + 8;
          if (struck(player) || this.allies.some(struck)) {
            hit = true;
            this.explodeAt(p.x, p.y, p.splashRadius, p.damage, false, player, true);
          }
        }

        // Prop collision
        if (!hit && p.fromPlayer && p.z < 34) {
          for (const prop of this.world.props) {
            if (!prop.alive) continue;
            const dx = this.world.deltaX(p.x, prop.x);
            const dy = this.world.deltaY(p.y, prop.y);
            if (Math.hypot(dx, dy) < prop.radius + 8) {
              hit = true;
              if (p.kind === 'autocannon') {
                this.damageProp(prop, p.damage, player, p.source);
              } else if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, true, player, false, p.source) > 0 &&
                  p.source === 'player') {
                this.stats.shotsHit += 1;
              }
              break;
            }
          }
        }

        // Boulder impact (rocks are big now, so shells must not fly straight through them)
        if (!hit) {
          for (const obs of this.world.obstacles) {
            const dx = this.world.deltaX(obs.x, p.x);
            const dy = this.world.deltaY(obs.y, p.y);
            const rSq = obs.radius * obs.radius;
            const dSq = dx * dx + dy * dy;
            if (dSq >= rSq) continue;
            const surfaceZ = obs.height * (1 - dSq / rSq); // dome-shaped hit profile
            if (p.z < surfaceZ) {
              hit = true;
              if (p.kind === 'autocannon') {
                this.spawnDustOrSmoke(p.x, p.y, p.z, 3, '#a8a29e');
              } else if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, p.fromPlayer, player, false, p.source) > 0 &&
                  p.source === 'player') {
                this.stats.shotsHit += 1;
              }
              break;
            }
          }
        }

        // Ground impact
        if (!hit && p.z <= 0) {
          hit = true;
          if (p.kind === 'autocannon') {
            this.spawnDustOrSmoke(p.x, p.y, 0, 2, '#a8a29e');
          } else if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, p.fromPlayer, player, false, p.source) > 0 &&
              p.source === 'player') {
            this.stats.shotsHit += 1; // near miss whose splash still caught an enemy
          }
        }

        if (!hit) keep.push(p);
      }

      this.projectiles = keep;
    }

    _updateParticles(dt) {
      const world = this.world;
      compactInPlace(this.particles, (pt) => {
        pt.life -= dt;
        if (pt.life <= 0) return false;
        pt.x = world.wrapX(pt.x + pt.vx * dt);
        pt.y = world.wrapY(pt.y + pt.vy * dt);
        pt.z = Math.max(0, pt.z + pt.vz * dt);
        pt.vz -= 120 * dt;
        return true;
      });

      compactInPlace(this.shockwaves, (sw) => {
        sw.life -= dt;
        if (sw.life <= 0) return false;
        const t = 1 - sw.life / sw.maxLife;
        sw.radius = 6 + t * sw.targetRadius;
        return true;
      });
    }

    // Mark every item on the map to fly to the player (collected on arrival); returns how many
    _vacuumAllPickups() {
      for (const pk of this.pickups) pk.vacuum = true;
      return this.pickups.length;
    }

    // True when the player or any wingman would benefit from a resupply
    needsResupply(player) {
      if (player.alive && (player.hp < player.maxHp - 0.5 || player.boostEnergy < player.maxBoost - 1)) return true;
      return this.allies.some((a) => a.alive && a.hp < a.maxHp - 0.5);
    }

    resupply(player) {
      this._resupply(player);
      this.audio.playUpgrade();
    }

    // Full resupply: player and all wingmen back to full armour, boost and weapon cooling
    _resupply(player) {
      if (player.alive) {
        player.hp = player.maxHp;
        player.boostEnergy = player.maxBoost;
        player.subHeat = 0;
        player.subOverheated = false;
        player.reloadTimer = 0;
        this.spawnDustOrSmoke(player.x, player.y, 10, 14, '#4ade80');
      }
      for (const a of this.allies) {
        if (!a.alive) continue;
        a.hp = a.maxHp;
        a.boostEnergy = a.maxBoost;
        this.spawnDustOrSmoke(a.x, a.y, 10, 8, '#4ade80');
      }
    }

    _updatePickups(dt, player) {
      if (!player.alive) return;
      compactInPlace(this.pickups, (pk) => {
        if (!pk.vacuum) {
          pk.life -= dt;
          if (pk.life <= 0) return false;
        }
        pk.phase += dt * 3.5;
        const dx = this.world.deltaX(pk.x, player.x);
        const dy = this.world.deltaY(pk.y, player.y);
        const dist = Math.hypot(dx, dy);

        if (pk.vacuum && dist > 1) {
          // Hauled in from anywhere on the map; far items travel faster so all arrive within ~1 s
          const pull = Math.min(dist, Math.max(700, dist * 3) * dt);
          pk.x = this.world.wrapX(pk.x + (dx / dist) * pull);
          pk.y = this.world.wrapY(pk.y + (dy / dist) * pull);
        } else if (dist < this.magnetRadius && dist > 1) {
          const pull = Math.min(dist, 340 * dt);
          pk.x = this.world.wrapX(pk.x + (dx / dist) * pull);
          pk.y = this.world.wrapY(pk.y + (dy / dist) * pull);
        }

        if (dist < player.radius + 18) {
          this.stats.itemsCollected += 1;
          if (pk.kind === 'scrap') {
            this.scrap += pk.value;
            this.stats.scrapEarned += pk.value;
            this.audio.playPickup(false);
          } else {
            player.hp = Math.min(player.maxHp, player.hp + pk.value * this.repairBonus);
            this.audio.playPickup(true);
          }
          return false;
        }
        return true;
      });
    }

    drawEffectsAndPickups(ctx, camX, camY, viewW, viewH) {
      // Cheap screen-bounds cull (most of the wrapped world projects below the viewport)
      const off = (p, m) => p.sx < -m || p.sx > viewW + m || p.sy < -m || p.sy > viewH + m;

      // Shockwaves
      for (const sw of this.shockwaves) {
        const p = this.world.project(sw.x, sw.y, 0, camX, camY, viewW, viewH);
        if (!p || off(p, sw.radius * p.scale + 8)) continue;
        const alpha = sw.life / sw.maxLife;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(p.scale, p.scale * p.tiltCos);
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = alpha * 0.85;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // Pickups
      for (const pk of this.pickups) {
        const bob = Math.sin(pk.phase) * 4;
        const gp = this.world.project(pk.x, pk.y, 0, camX, camY, viewW, viewH);
        const p = this.world.project(pk.x, pk.y, pk.z + bob, camX, camY, viewW, viewH);
        if (!gp || !p || off(gp, 40)) continue;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(gp.sx, gp.sy, 10 * gp.scale, 6 * gp.scale * gp.tiltCos, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(p.scale, p.scale);
        if (pk.kind === 'scrap') {
          ctx.rotate(pk.phase * 0.6);
          ctx.fillStyle = '#fbbf24';
          ctx.strokeStyle = '#fef3c7';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(0, -10);
          ctx.lineTo(9, 0);
          ctx.lineTo(0, 10);
          ctx.lineTo(-9, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = '#22c55e';
          ctx.strokeStyle = '#dcfce7';
          ctx.lineWidth = 1.8;
          ctx.fillRect(-9, -9, 18, 18);
          ctx.strokeRect(-9, -9, 18, 18);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-5, -1.8, 10, 3.6);
          ctx.fillRect(-1.8, -5, 3.6, 10);
        }
        ctx.restore();
      }

      // Projectiles + Ground Shadows
      for (const pr of this.projectiles) {
        const gp = this.world.project(pr.x, pr.y, 0, camX, camY, viewW, viewH);
        const p = this.world.project(pr.x, pr.y, pr.z, camX, camY, viewW, viewH);
        if (!p || off(p, 30)) continue;

        if (gp) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.beginPath();
          ctx.ellipse(gp.sx, gp.sy, pr.radius * gp.scale, pr.radius * 0.6 * gp.scale * gp.tiltCos, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, pr.radius * p.scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles
      for (const pt of this.particles) {
        const p = this.world.project(pt.x, pt.y, pt.z, camX, camY, viewW, viewH);
        if (!p || off(p, 20)) continue;
        const t = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = Math.min(0.88, t * 1.15);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, pt.size * t * p.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  CombatManager.SHELL_GRAVITY = SHELL_GRAVITY;
  // Read-only data for the briefing screen (enemy specs and per-district garrison templates)
  CombatManager.ENEMY_SPECS = ENEMY_SPECS;
  CombatManager.DISTRICT_TEMPLATES = DISTRICT_TEMPLATES;
  global.CombatManager = CombatManager;
})(window);
