(function (global) {
  'use strict';

  // Platoon of up to 5 tanks: the player (leader) + up to 4 AI wingmen.
  // Wingmen hold a wedge formation behind the leader; when enemies come near the platoon they
  // fan out around the threat and fight, then fall back into formation once the area is clear.

  const MAX_ALLIES = 4;

  // Wedge formation slots in the leader's frame: f = forward(+)/behind(-), l = right(+)/left(-)
  const FORMATION_SLOTS = [
    { f: -85, l: -80 },
    { f: -85, l: 80 },
    { f: -170, l: -160 },
    { f: -170, l: 160 }
  ];

  // Fan-out angle (relative to the leader->target line) each wingman takes when engaging
  const SPREAD_ANGLES = [-0.75, 0.75, -1.35, 1.35];

  const ENGAGE_RADIUS = 650; // enemy this close to the leader -> platoon breaks formation
  const DISENGAGE_RADIUS = 880; // no enemy within this of the leader -> regroup
  const LEASH_RADIUS = 1050; // a wingman never chases farther than this from the leader
  const ENGAGE_DIST = 260; // stand-off distance from the target's edge
  const FIRE_RANGE = 600;
  const FORMATION_ARRIVE = 40;

  const ALLY_LOOK = {
    hullColor: '#8a7a52',
    hullDark: '#5e5236',
    turretColor: '#9c8a5c',
    accentColor: '#38bdf8'
  };

  function wrapAngle(a) {
    let r = (a + Math.PI) % (Math.PI * 2);
    if (r < 0) r += Math.PI * 2;
    return r - Math.PI;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  class SquadManager {
    constructor(world, combat) {
      this.world = world;
      this.combat = combat;
      this.mode = 'formation'; // 'formation' | 'engage'
      this.formHeading = -Math.PI * 0.5;
      this.levels = null;
      this._time = 0;
    }

    get allies() {
      return this.combat.allies;
    }

    get maxSize() {
      return MAX_ALLIES + 1;
    }

    // Platoon size including the player
    get size() {
      return 1 + this.allies.length;
    }

    canReinforce() {
      return this.allies.length < MAX_ALLIES;
    }

    reset(player, levels) {
      this.allies.length = 0;
      this.mode = 'formation';
      this.formHeading = player.hullAngle;
      this.levels = levels;
      this._time = 0;
      for (let i = 0; i < MAX_ALLIES; i++) this.spawnAlly(player);
      this.reinforcements = 0; // wingmen added later via the garage (for the after-action report)
    }

    spawnAlly(player) {
      if (!this.canReinforce()) return null;
      this.reinforcements = (this.reinforcements || 0) + 1;
      const pos = this._slotWorldPos(player, FORMATION_SLOTS[this.allies.length]);
      const ally = new global.Tank2D(this.world, {
        ...ALLY_LOOK,
        isAlly: true,
        kind: 'ally',
        x: pos.x,
        y: pos.y,
        hullAngle: this.formHeading
      });
      this._applyStats(ally, true);
      ally.reloadTimer = 0.4 + Math.random() * 0.8;
      this.allies.push(ally);
      return ally;
    }

    // Wingmen are upgraded through their own platoon items in the garage
    // (allyArmor / allyGun / allyEngine), independent of the player's tank upgrades.
    applyUpgrades(levels) {
      this.levels = levels;
      for (const a of this.allies) this._applyStats(a, false);
    }

    // Stats a wingman has at the current platoon upgrade levels
    getAllyStats() {
      const lv = this.levels || {};
      const arm = lv.allyArmor || 1;
      const gun = lv.allyGun || 1;
      const eng = lv.allyEngine || 1;
      return {
        maxHp: 130 + (arm - 1) * 40,
        armorReduction: 0.1 + (arm - 1) * 0.06,
        damage: 26 + (gun - 1) * 12,
        shellSpeed: 520 + (gun - 1) * 50,
        splashRadius: 44 + (gun - 1) * 6,
        reloadTime: Math.max(1.0, 2.0 - (gun - 1) * 0.2),
        maxSpeed: 255 + (eng - 1) * 36, // a bit faster than the leader so wingmen can catch up
        accel: 470 + (eng - 1) * 60,
        turnSpeed: 2.9 + (eng - 1) * 0.2,
        maxBoost: 100 + (eng - 1) * 25,
        visual: { cannon: Math.min(4, gun), armor: Math.min(5, arm), engine: Math.min(5, eng) }
      };
    }

    _applyStats(a, fresh) {
      const st = this.getAllyStats();
      const prevMax = a.maxHp;
      a.maxHp = st.maxHp;
      if (fresh) a.hp = a.maxHp;
      else if (a.maxHp > prevMax) a.hp = Math.min(a.maxHp, a.hp + (a.maxHp - prevMax));
      a.armorReduction = st.armorReduction;
      a.damage = st.damage;
      a.shellSpeed = st.shellSpeed;
      a.splashRadius = st.splashRadius;
      a.reloadTime = st.reloadTime;
      a.maxSpeed = st.maxSpeed;
      a.accel = st.accel;
      a.turnSpeed = st.turnSpeed;
      a.maxBoost = st.maxBoost;
      a.cannonLevel = st.visual.cannon;
      a.armorLevel = st.visual.armor;
      a.engineLevel = st.visual.engine;
    }

    update(dt, player) {
      if (!player.alive) return;
      this._time += dt;
      this._updateFormationHeading(dt, player);
      this._updateMode(player);

      const w = this.world;
      this.allies.forEach((a, idx) => {
        if (!a.alive) return;
        const toLeader = Math.hypot(w.deltaX(a.x, player.x), w.deltaY(a.y, player.y));

        let target = null;
        if (this.mode === 'engage' && toLeader < LEASH_RADIUS) {
          target = this._pickTarget(a, player);
        }

        if (target) {
          this._engage(a, idx, target, player, dt);
        } else {
          a.squadTarget = null;
          this._holdFormation(a, idx, player, dt);
        }
      });

      this._separate(player);
    }

    // Formation faces the leader's direction of travel (smoothed so pivot turns don't whip wingmen around)
    _updateFormationHeading(dt, player) {
      if (Math.abs(player.speed) < 35) return;
      const travel = player.speed < 0 ? player.hullAngle : Math.atan2(player._velY, player._velX);
      const diff = wrapAngle(travel - this.formHeading);
      const maxStep = 1.8 * dt;
      this.formHeading = wrapAngle(this.formHeading + clamp(diff, -maxStep, maxStep));
    }

    _updateMode(player) {
      const w = this.world;
      let nearest = Infinity;
      for (const e of this.combat.enemies) {
        // Parked units at an un-alerted compound don't pull the platoon out of formation
        if (!e.alive || e.state === 'idle') continue;
        nearest = Math.min(nearest, Math.hypot(w.deltaX(player.x, e.x), w.deltaY(player.y, e.y)));
      }
      if (this.mode === 'formation' && nearest < ENGAGE_RADIUS) this.mode = 'engage';
      else if (this.mode === 'engage' && nearest > DISENGAGE_RADIUS) this.mode = 'formation';
    }

    // Nearest enemy to this wingman among those threatening the platoon (sticky for a short while)
    _pickTarget(a, player) {
      const w = this.world;
      a.squadRetarget = (a.squadRetarget || 0) - 1;
      if (a.squadTarget && a.squadTarget.alive && a.squadRetarget > 0) return a.squadTarget;
      a.squadRetarget = 30; // ~0.5s at 60fps

      let best = null;
      let bestD = Infinity;
      for (const e of this.combat.enemies) {
        // Never pick a parked unit: wingmen must not start fights at other compounds on their own
        if (!e.alive || e.state === 'idle') continue;
        const fromLeader = Math.hypot(w.deltaX(player.x, e.x), w.deltaY(player.y, e.y));
        if (fromLeader > DISENGAGE_RADIUS) continue;
        const d = Math.hypot(w.deltaX(a.x, e.x), w.deltaY(a.y, e.y));
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      a.squadTarget = best;
      return best;
    }

    _engage(a, idx, target, player, dt) {
      const w = this.world;
      // Fan out on the near side of the target, each wingman on its own flank, slowly drifting
      const base = Math.atan2(w.deltaY(player.y, target.y), w.deltaX(player.x, target.x));
      const spread = SPREAD_ANGLES[idx] + Math.sin(this._time * 0.35 + idx * 1.7) * 0.22;
      const ang = base + Math.PI + spread;
      const standOff = ENGAGE_DIST + target.radius;
      const gx = w.wrapX(target.x + Math.cos(ang) * standOff);
      const gy = w.wrapY(target.y + Math.sin(ang) * standOff);
      const faceAngle = Math.atan2(w.deltaY(a.y, target.y), w.deltaX(a.x, target.x));

      this._driveTo(a, gx, gy, dt, { arriveDist: 36, faceAngle, leader: null });
      this._aimAndFire(a, target, dt);
    }

    _holdFormation(a, idx, player, dt) {
      const pos = this._slotWorldPos(player, FORMATION_SLOTS[idx]);
      this._driveTo(a, pos.x, pos.y, dt, {
        arriveDist: FORMATION_ARRIVE,
        faceAngle: this.formHeading,
        leader: player
      });
      a.returnTurretStraight(dt);
    }

    _slotWorldPos(player, slot) {
      const c = Math.cos(this.formHeading);
      const s = Math.sin(this.formHeading);
      return {
        x: this.world.wrapX(player.x + c * slot.f - s * slot.l),
        y: this.world.wrapY(player.y + s * slot.f + c * slot.l)
      };
    }

    // Tank-style driving controller toward (tx, ty) with obstacle / tank avoidance.
    // With a leader given, it feeds forward the leader's velocity so wingmen keep station while moving.
    _driveTo(a, tx, ty, dt, opts) {
      const w = this.world;
      const dx = w.deltaX(a.x, tx);
      const dy = w.deltaY(a.y, ty);
      const d = Math.hypot(dx, dy);
      const cos = Math.cos(a.hullAngle);
      const sin = Math.sin(a.hullAngle);
      const lead = opts.leader;
      const ff = lead ? (lead._velX * cos + lead._velY * sin) / a.maxSpeed : 0;

      let throttle;
      let steer;
      let boost = false;

      if (d < opts.arriveDist) {
        // On station: align with the formation / face the target and match the leader's speed
        const diff = wrapAngle(opts.faceAngle - a.hullAngle);
        steer = clamp(diff * 2.0, -1, 1);
        const errAlong = dx * cos + dy * sin;
        throttle = clamp(ff + errAlong / 110, -0.5, 1);
      } else {
        const av = this._avoidance(a);
        const desired = Math.atan2(dy / d + av.y, dx / d + av.x);
        const diff = wrapAngle(desired - a.hullAngle);

        const leaderSlow = !lead || Math.hypot(lead._velX, lead._velY) < 60;
        if (Math.abs(diff) > 1.9 && d < 170 && leaderSlow) {
          // Goal is close behind and the platoon is (nearly) stopped: reverse into it instead of a
          // wide U-turn. Never while the leader is moving - reversing can't keep up with a moving slot.
          // (stepPhysics mirrors steering while reversing, hence the sign flip)
          const rearDiff = wrapAngle(desired - (a.hullAngle + Math.PI));
          steer = -clamp(rearDiff * 2.4, -1, 1);
          throttle = -clamp(d / 110, 0.3, 0.7);
        } else {
          steer = clamp(diff * 2.4, -1, 1);
          const align = Math.max(0, Math.cos(diff));
          throttle = clamp(Math.max(0, ff) + (d / 110) * align, 0, 1);
          // Turbo to catch up (e.g. outer wingmen after a turn); boost energy limits overuse
          boost = d > (lead ? 90 : 240) && Math.abs(diff) < 0.5;
        }
      }

      a.stepPhysics(throttle, steer, boost, dt, null);
    }

    _avoidance(a) {
      const w = this.world;
      let ax = 0;
      let ay = 0;
      for (const obs of w.obstacles) {
        const ox = w.deltaX(obs.x, a.x);
        const oy = w.deltaY(obs.y, a.y);
        const od = Math.hypot(ox, oy);
        const clearance = od - obs.radius - a.radius;
        if (clearance > 90 || od < 1) continue;
        const push = (1 - Math.max(0, clearance) / 90) * 1.6;
        ax += (ox / od) * push;
        ay += (oy / od) * push;
      }
      return { x: ax, y: ay };
    }

    _aimAndFire(a, target, dt) {
      const w = this.world;
      const d = Math.hypot(w.deltaX(a.x, target.x), w.deltaY(a.y, target.y));
      const leadT = d / Math.max(1, a.shellSpeed);
      const leadX = w.wrapX(target.x + target._velX * leadT);
      const leadY = w.wrapY(target.y + target._velY * leadT);
      a.aimAtWorldPoint(leadX, leadY, dt);
      if (d < FIRE_RANGE && a.reloadTimer <= 0 && a.isAimedAt(leadX, leadY, 0.12)) {
        this.combat.fireMainCannon(a, leadX, leadY);
      }
    }

    // Keep wingmen from overlapping the leader, each other and enemy tanks
    _separate(player) {
      const w = this.world;
      const push = (a, b, aShare) => {
        const dx = w.deltaX(b.x, a.x);
        const dy = w.deltaY(b.y, a.y);
        const minD = a.radius + b.radius;
        const dSq = dx * dx + dy * dy;
        if (dSq >= minD * minD || dSq < 0.001) return;
        const dd = Math.sqrt(dSq);
        const overlap = minD - dd;
        const nx = dx / dd;
        const ny = dy / dd;
        a.x = w.wrapX(a.x + nx * overlap * aShare);
        a.y = w.wrapY(a.y + ny * overlap * aShare);
        if (aShare < 1) {
          b.x = w.wrapX(b.x - nx * overlap * (1 - aShare));
          b.y = w.wrapY(b.y - ny * overlap * (1 - aShare));
        }
      };

      const list = this.allies;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.alive) continue;
        if (player.alive) push(a, player, 1); // the leader is never shoved by its wingmen
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].alive) push(a, list[j], 0.5);
        }
        for (const e of this.combat.enemies) {
          if (e.alive) push(a, e, e.isBunker ? 1 : 0.5);
        }
      }
    }
  }

  SquadManager.MAX_ALLIES = MAX_ALLIES;
  global.SquadManager = SquadManager;
})(window);
