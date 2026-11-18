(function (global) {
  'use strict';

  // Frozen lakes (zone kind 'lake', js/planet/zones.js): the ice holds a moving tank, but one that
  // stands (nearly) still loads it until it cracks and then breaks — the tank goes through and is
  // lost. Heavy tanks (heavy / boss / ace: scale >= 1.25) load it faster and break straight
  // through the darker thin-ice patches, so they can be lured across them. Applies to every tank:
  // the player, the wingmen and the enemy.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const ICE_SLOW = 45; // below this speed a tank loads the ice
  const ICE_CRACK = 2.2; // s of load until the ice cracks (warning)
  const ICE_BREAK = 4.0; // s of load until it breaks
  const ICE_RELIEF = 0.8; // load shed per second while moving
  const HEAVY_SCALE = 1.25;

  class CombatIce {
    _updateIce(dt, player) {
      if (!this.world.zones.some((z) => z.kind === 'lake')) return;
      const check = (t) => {
        // Parked garrison tanks stand on solid ground (compounds are never on a lake)
        if (!t.alive || t.isBunker || !t.grounded || t.state === 'idle') return;
        const ice = this.world.iceAt(t.x, t.y);
        if (!ice) {
          t.iceStress = Math.max(0, (t.iceStress || 0) - dt * 2);
          return;
        }
        const heavy = t.scale >= HEAVY_SCALE;
        if (ice.thin && heavy) {
          this._breakIce(t, player);
          return;
        }
        const load = (ice.thin ? 2 : 1) * (heavy ? 1.6 : 1);
        if (Math.abs(t.speed) < ICE_SLOW) t.iceStress = (t.iceStress || 0) + dt * load;
        else t.iceStress = Math.max(0, (t.iceStress || 0) - dt * ICE_RELIEF);
        if (t.iceStress >= ICE_CRACK && !t.iceCracked) {
          t.iceCracked = true;
          this.spawnDustOrSmoke(t.x, t.y, 1, 6, '#e0f2fe');
          if (t === player) {
            this.audio.playHit();
            this.events.push({ type: 'iceCrack' });
          }
        } else if (t.iceStress < ICE_CRACK * 0.5) {
          t.iceCracked = false;
        }
        if (t.iceStress >= ICE_BREAK) this._breakIce(t, player);
      };
      check(player);
      for (const a of this.allies) check(a);
      for (const e of this.enemies) check(e);
    }

    // Share of the load the ice under this tank can take (0..1, for the gauge under the player)
    iceLoad(t) {
      return Math.max(0, Math.min(1, (t.iceStress || 0) / ICE_BREAK));
    }

    // The tank goes through the ice: a hole, a splash, and it is lost (kills / losses counted)
    _breakIce(t, player) {
      this.world.addIceHole(t.x, t.y, 34 * t.scale);
      this.spawnDustOrSmoke(t.x, t.y, 2, 18, '#bfdbfe');
      this.spawnDustOrSmoke(t.x, t.y, 2, 10, '#f8fafc');
      this.audio.playExplosion(0.5);
      t.alive = false;
      t.sunk = true;
      t.hp = 0;
      if (t === player) {
        this.damageFlash = 1;
      } else if (t.isAlly) {
        this.stats.alliesLost += 1;
      } else {
        // Idle garrison tanks never stand on the ice, so this is one that was lured onto it
        this.kills += 1;
        this.stats.killsByKind[t.kind] = (this.stats.killsByKind[t.kind] || 0) + 1;
        this.stats.killsBy.other += 1;
        this._onEnemyKilled(t);
      }
      this.events.push({ type: 'iceBreak', tank: t, isPlayer: t === player });
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatIce);
})(window);
