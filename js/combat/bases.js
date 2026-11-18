(function (global) {
  'use strict';

  // Enemy compounds: garrisons, alerts and captures. Every compound is garrisoned from the start;
  // the area is secured once all of them are captured.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { BASE_GARRISONS, ENEMY_SPECS } = global.GameData;

  const ALERT_RADIUS = 650; // the player this close to a compound puts it on alert
  const ENEMY_REACTION_TIME = 1.0; // s an alerted tank holds still (turret tracking only) before moving/firing

  const ALLY_ALERT_RADIUS = 450; // wingmen alone must come closer before they are spotted
  const BASE_CLEAR_BONUS = 50; // scrap reward for neutralising a compound

  class CombatBases {
    // Build runtime state for every compound, garrison it and draw it on the ground
    spawnBases() {
      this.bases = [];
      if (!this.enemiesEnabled) return;
      for (const site of this.world.enemyBases || []) {
        const base = {
          id: site.id,
          name: site.name,
          x: site.x,
          y: site.y,
          radius: site.radius,
          alerted: false,
          cleared: false,
          total: 0
        };
        this.bases.push(base);
        this._garrisonBase(base, site);
        if (this.world.revealBase) this.world.revealBase(site.id);
      }
    }

    // Parked (idle) tanks and manned bunkers for one compound, scaled by its garrison tier
    _garrisonBase(base, site) {
      const tpl = BASE_GARRISONS[Math.min(site.id, BASE_GARRISONS.length - 1)];
      const tier = tpl.tier;
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

    _updateBases(dt, player) {
      // Alert compounds that a friendly tank has come close to. At night the garrison can't see
      // an approach: a compound only wakes up once one of its units is hit (see damageEnemy).
      const friendlies = this.world.isNightTime() ? [] : [player, ...this.allies];
      for (const base of this.bases) {
        if (base.alerted || base.cleared) continue;
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

      // The area is secured the instant its last compound falls: the mission clock stops right here
      if (!this.missionComplete && this.bases.length > 0 && this.bases.every((b) => b.cleared)) {
        this.missionComplete = true;
        this.stats.endClock = this._clockStamp();
        this.events.push({ type: 'areaSecured' });
      }
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatBases);
})(window);
