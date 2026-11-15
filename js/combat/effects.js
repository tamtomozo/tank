(function (global) {
  'use strict';

  // Particles (dust, smoke, sparks), pickups (scrap / items) and resupply, and drawing them.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { compactInPlace } = global.CombatManager.shared;

  class CombatEffects {
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

  global.TankUtil.mixin(global.CombatManager, CombatEffects);
})(window);
