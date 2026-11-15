(function (global) {
  'use strict';

  // Enemy compounds: garrisons, districts unlocking one after another, alerts and captures.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { DISTRICT_TEMPLATES, ENEMY_SPECS } = global.GameData;

  const ALERT_RADIUS = 650; // the player this close to a compound puts it on alert
  const ENEMY_REACTION_TIME = 0.5; // s an alerted tank holds still (turret tracking only) before moving/firing

  const ALLY_ALERT_RADIUS = 450; // wingmen alone must come closer before they are spotted
  const BASE_CLEAR_BONUS = 50; // scrap reward for neutralising a compound

  class CombatBases {
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

      // The area is secured the instant its last district is: the mission clock stops right here
      if (!this.missionComplete && this.districts.length > 0 && this.districts.every((d) => d.secured)) {
        this.missionComplete = true;
        this.stats.endClock = this._clockStamp();
      }
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatBases);
})(window);
