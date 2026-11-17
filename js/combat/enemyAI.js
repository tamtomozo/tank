(function (global) {
  'use strict';

  // Enemy tank behaviour: wait in the compound, react to alerts, close in / keep distance and fire,
  // and keep tanks from overlapping.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { ENEMY_SPECS } = global.GameData;

  class CombatEnemyAI {
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
          for (const obs of this.world.colliders) {
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

        e.stepPhysics(throttle, steer, dt, null);

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
  }

  global.TankUtil.mixin(global.CombatManager, CombatEnemyAI);
})(window);
