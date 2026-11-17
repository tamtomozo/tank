(function (global) {
  'use strict';

  // Particles (dust, smoke, sparks), pickups (scrap / items) and resupply, and drawing them.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const { compactInPlace } = global.CombatManager.shared;

  const MAX_PARTICLES = 2400; // impact effects stop adding particles beyond this
  const MAX_FIRES = 40;
  const SAND_COLORS = ['#c9b38c', '#b59d78', '#a88f6a', '#d4c29c'];
  // Flame colour by remaining life (hot white-yellow -> orange -> dull red)
  const flameColor = (t) => (t > 0.75 ? '#fff4c2' : t > 0.5 ? '#fcd34d' : t > 0.28 ? '#f97316' : '#b91c1c');

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

    // Shell impact: a fireball, a ring of sand billowing out along the ground, dark smoke rising,
    // a few clods of dirt, and a small patch left burning on the spot for a moment.
    spawnImpactBlast(x, y, radius, isDirect = false) {
      // Chain reactions can fire many blasts at once: keep the particle count bounded
      if (this.particles.length > MAX_PARTICLES) return;
      const wx = this.world.wrapX(x);
      const wy = this.world.wrapY(y);
      const k = Math.min(1.8, Math.max(0.7, radius / 60)); // blast size factor
      const rand = (a, b) => a + Math.random() * (b - a);
      const at = (dist, ang) => [this.world.wrapX(wx + Math.cos(ang) * dist), this.world.wrapY(wy + Math.sin(ang) * dist)];

      // Fireball
      const flames = Math.round((isDirect ? 14 : 11) * k);
      for (let i = 0; i < flames; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = rand(15, 70) * k;
        const [px, py] = at(rand(0, 8) * k, ang);
        const life = rand(0.3, 0.65);
        this.particles.push({
          fire: true, x: px, y: py, z: rand(2, 10),
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, vz: rand(30, 90) * k,
          drag: 3.2, buoy: 60,
          life, maxLife: life,
          size: rand(7, 13) * k
        });
      }

      // Sand cloud spreading out low over the ground
      const dust = Math.round(14 * k);
      for (let i = 0; i < dust; i++) {
        const ang = (i / dust) * Math.PI * 2 + rand(-0.3, 0.3);
        const spd = rand(70, 170) * k;
        const [px, py] = at(rand(4, 12) * k, ang);
        const life = rand(1.1, 2.0);
        this.particles.push({
          dust: true, x: px, y: py, z: rand(1, 6),
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, vz: rand(8, 30),
          drag: 3.0,
          life, maxLife: life,
          size: rand(8, 13) * k,
          grow: rand(1.8, 2.8),
          alpha: 0.5,
          color: SAND_COLORS[(Math.random() * SAND_COLORS.length) | 0]
        });
      }

      // Dark smoke column above the blast
      const smoke = Math.round(6 * k);
      for (let i = 0; i < smoke; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = rand(5, 30);
        const life = rand(1.3, 2.3);
        this.particles.push({
          dust: true, x: wx, y: wy, z: rand(8, 22) * k,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, vz: rand(25, 55),
          drag: 1.6, buoy: 14,
          life, maxLife: life,
          size: rand(7, 11) * k,
          grow: rand(2.0, 3.0),
          alpha: 0.55,
          color: Math.random() < 0.5 ? '#3f3a36' : '#57504a'
        });
      }

      // Clods of dirt thrown up (fall back under gravity)
      this.spawnDustOrSmoke(wx, wy, 4, Math.round(5 * k), '#6b5a42');

      // Patch left burning for a moment
      if (this.fires.length >= MAX_FIRES) this.fires.shift();
      const burn = rand(1.2, 2.2) * (isDirect ? 0.8 : 1) * Math.min(1.4, k);
      this.fires.push({ x: wx, y: wy, k, life: burn, maxLife: burn, flameAcc: 0, smokeAcc: 0 });
    }

    _updateFires(dt) {
      const rand = (a, b) => a + Math.random() * (b - a);
      compactInPlace(this.fires, (f) => {
        f.life -= dt;
        if (f.life <= 0) return false;
        if (this.particles.length > MAX_PARTICLES) return true;
        const heat = f.life / f.maxLife; // dies down over time
        f.flameAcc += dt * (8 + 22 * heat) * f.k;
        f.smokeAcc += dt * 5 * f.k;
        while (f.flameAcc >= 1) {
          f.flameAcc -= 1;
          const ang = Math.random() * Math.PI * 2;
          const r = rand(0, 14) * f.k;
          const life = rand(0.25, 0.5);
          this.particles.push({
            fire: true,
            x: this.world.wrapX(f.x + Math.cos(ang) * r),
            y: this.world.wrapY(f.y + Math.sin(ang) * r),
            z: rand(0, 3),
            vx: rand(-10, 10), vy: rand(-10, 10), vz: rand(25, 55),
            drag: 2.0, buoy: 70,
            life, maxLife: life,
            size: rand(4, 8) * f.k * (0.6 + 0.4 * heat)
          });
        }
        while (f.smokeAcc >= 1) {
          f.smokeAcc -= 1;
          const life = rand(1.0, 1.8);
          this.particles.push({
            dust: true,
            x: this.world.wrapX(f.x + rand(-6, 6) * f.k),
            y: this.world.wrapY(f.y + rand(-6, 6) * f.k),
            z: rand(10, 18),
            vx: rand(-8, 8), vy: rand(-8, 8), vz: rand(20, 40),
            drag: 1.2, buoy: 12,
            life, maxLife: life,
            size: rand(5, 8) * f.k,
            grow: 2.4,
            alpha: 0.4,
            color: Math.random() < 0.5 ? '#44403c' : '#5b5550'
          });
        }
        return true;
      });
    }

    // Sand thrown up behind both caterpillar tracks of a moving tank. Emission is distance-based
    // (faster tanks kick up more) and limited to tanks near the player to bound cost.
    _emitTrackDust(tank, dt, player) {
      if (!tank || !tank.alive || tank.isBunker || !tank.grounded) return;
      const motion = Math.abs(tank.speed) + Math.abs(tank.turnRate) * 28;
      if (motion < 18) return;
      if (player && tank !== player) {
        const dx = this.world.deltaX(tank.x, player.x);
        const dy = this.world.deltaY(tank.y, player.y);
        if (dx * dx + dy * dy > 1500 * 1500) return;
      }

      tank.dustAccum += motion * dt;
      const spacing = 16;
      if (tank.dustAccum < spacing) return;
      tank.dustAccum = Math.min(tank.dustAccum - spacing, spacing);

      const s = tank.scale || 1;
      const cos = Math.cos(tank.hullAngle);
      const sin = Math.sin(tank.hullAngle);
      // Rear end of the tracks relative to the direction of travel (front end when reversing)
      const fwd = tank._velX * cos + tank._velY * sin;
      const back = (fwd >= 0 ? -1 : 1) * 22 * s;
      const side = 16 * s;
      const sideX = -sin * side;
      const sideY = cos * side;
      const strength = Math.min(1.6, Math.abs(tank.speed) / 160);

      for (const k of [-1, 1]) {
        const x = tank.x + cos * back + sideX * k;
        const y = tank.y + sin * back + sideY * k;
        const spread = 18 + strength * 14;
        this.particles.push({
          dust: true,
          x: this.world.wrapX(x + (Math.random() - 0.5) * 6 * s),
          y: this.world.wrapY(y + (Math.random() - 0.5) * 6 * s),
          z: 1 + Math.random() * 3,
          // Trails behind the tank, drifting outward a little
          vx: -tank._velX * 0.12 + sideX / side * k * 10 + (Math.random() - 0.5) * spread,
          vy: -tank._velY * 0.12 + sideY / side * k * 10 + (Math.random() - 0.5) * spread,
          vz: 10 + Math.random() * 14 + strength * 6,
          life: 0.7 + Math.random() * 0.5,
          maxLife: 1.2,
          size: (4 + Math.random() * 3) * s,
          grow: 1.6 + strength * 0.8,
          color: Math.random() < 0.5 ? '#c9b38c' : '#b59d78'
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
        if (pt.dust || pt.fire) {
          // Light sand / smoke / flame hangs in the air: strong drag, no gravity (hot gas rises)
          const drag = Math.exp(-(pt.drag || 2.6) * dt);
          pt.vx *= drag;
          pt.vy *= drag;
          pt.vz *= drag;
          if (pt.buoy) pt.vz += pt.buoy * dt;
        } else {
          pt.vz -= 120 * dt;
        }
        return true;
      });

      this._updateFires(dt);

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
      if (player.alive && player.hp < player.maxHp - 0.5) return true;
      return this.allies.some((a) => a.alive && a.hp < a.maxHp - 0.5);
    }

    resupply(player) {
      this._resupply(player);
      this.audio.playUpgrade();
    }

    // Full resupply: player and all wingmen back to full armour and main-gun reload
    _resupply(player) {
      if (player.alive) {
        player.hp = player.maxHp;
        player.reloadTimer = 0;
        this.spawnDustOrSmoke(player.x, player.y, 10, 14, '#4ade80');
      }
      for (const a of this.allies) {
        if (!a.alive) continue;
        a.hp = a.maxHp;
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

      // Particles (flames are drawn afterwards in a second, additive pass)
      let hasFire = false;
      for (const pt of this.particles) {
        if (pt.fire) { hasFire = true; continue; }
        const p = this.world.project(pt.x, pt.y, pt.z, camX, camY, viewW, viewH);
        if (!p || off(p, pt.dust ? 80 : 20)) continue;
        const t = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        if (pt.dust) {
          // Billowing puff: grows as it ages and fades out (quick fade-in so it doesn't pop)
          const age = 1 - t;
          ctx.globalAlpha = Math.min(1, age * 8) * t * (pt.alpha || 0.42);
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, pt.size * (1 + age * pt.grow) * p.scale, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.globalAlpha = Math.min(0.88, t * 1.15);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, pt.size * t * p.scale, 0, Math.PI * 2);
        ctx.fill();
      }

      if (hasFire) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const pt of this.particles) {
          if (!pt.fire) continue;
          const p = this.world.project(pt.x, pt.y, pt.z, camX, camY, viewW, viewH);
          if (!p || off(p, 40)) continue;
          const t = Math.max(0, pt.life / pt.maxLife);
          const flicker = 0.85 + Math.random() * 0.3;
          ctx.fillStyle = flameColor(t);
          ctx.globalAlpha = Math.min(1, (1 - t) * 10) * (0.35 + t * 0.55);
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, pt.size * (0.45 + t * 0.7) * flicker * p.scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatEffects);
})(window);
