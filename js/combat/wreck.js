(function (global) {
  'use strict';

  // The player's tank lost: a few seconds on the battlefield before the game-over window, so it is
  // clear what happened. Destroyed: a slow-motion blast throws the turret off, the ammunition
  // cooks off in a few more explosions and the charred hull keeps burning under a column of smoke.
  // Sunk through the ice: the splash settles for a moment. js/main.js runs updateAfterLoss() every
  // frame until lossSequenceDone(); js/game/mission.js then opens the game-over window.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const LOSS_TIME = 4.2; // seconds from the blast to the game-over window (destroyed)
  const SUNK_LOSS_TIME = 2.6; // (sunk through the ice)
  const SLOWMO = 0.3; // time scale right after the blast, easing back to 1 by SLOWMO_END
  const SLOWMO_HOLD = 0.55;
  const SLOWMO_END = 1.3;
  const COOK_OFF = [0.7, 1.25, 1.9, 2.8]; // seconds (battlefield time) of the secondary explosions
  const GRAVITY = 520;
  const MAX_PARTICLES = 2400;

  // Picture of the tank painted into a canvas and charred (box in tank units)
  const HULL_BOX = { x: -32, y: -28, w: 64, h: 56 };
  const TURRET_BOX = { x: -32, y: -20, w: 90, h: 40 };
  const RES = 4;

  function charred(box, paint) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(box.w * RES);
    c.height = Math.ceil(box.h * RES);
    const g = c.getContext('2d');
    g.setTransform(RES, 0, 0, RES, -box.x * RES, -box.y * RES);
    paint(g);
    // Burnt: dark soot over everything painted, with blackened blotches
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(28, 20, 15, 0.78)';
    g.fillRect(box.x, box.y, box.w, box.h);
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(box.x + Math.random() * box.w, box.y + Math.random() * box.h, 3 + Math.random() * 6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  class CombatWreck {
    // The player's tank has just been destroyed (hp to 0) or has gone through the ice
    startLoss(tank, sunk = false) {
      this.lossTime = 0;
      this.lossSunk = sunk;
      this.wreck = null;
      if (sunk) return;
      const s = tank.scale;
      const dir = Math.random() * Math.PI * 2;
      const fling = rand(70, 105);
      this.wreck = {
        x: tank.x,
        y: tank.y,
        scale: s,
        hullAngle: tank.hullAngle,
        t: 0, // battlefield time since the blast (slowed down at first)
        booms: COOK_OFF.slice(),
        flameAcc: 0,
        smokeAcc: 0,
        sparkAcc: 0,
        hull: charred(HULL_BOX, (g) => {
          tank._paintTrackBases(g);
          tank._paintTrackMotion(g);
          tank._paintHull(g);
          // Torn-open turret ring where the turret was
          g.fillStyle = '#0c0a09';
          g.beginPath();
          g.arc(-1, 0, 9.5, 0, Math.PI * 2);
          g.fill();
        }),
        turretImg: charred(TURRET_BOX, (g) => tank._paintTurret(g, false)),
        // The turret, blown off and tumbling through the air (world units, hull-independent)
        turret: {
          x: tank.x,
          y: tank.y,
          z: 16 * s,
          vx: Math.cos(dir) * fling,
          vy: Math.sin(dir) * fling,
          vz: rand(300, 340),
          angle: tank.turretAngle,
          spin: rand(5, 8) * (Math.random() < 0.5 ? -1 : 1),
          bounces: 0,
          resting: false
        }
      };
      this.shakeIntensity = 1.2;
      this.damageFlash = 1;
      // Hot fragments thrown out by the blast
      this.spawnDustOrSmoke(tank.x, tank.y, 16, 22, '#fbbf24');
      this.spawnDustOrSmoke(tank.x, tank.y, 10, 12, '#f97316');
    }

    // Time scale of the battlefield during the loss sequence (slow motion right after the blast)
    lossTimeScale() {
      if (this.lossSunk || this.lossTime == null) return 1;
      const t = this.lossTime;
      if (t < SLOWMO_HOLD) return SLOWMO;
      if (t >= SLOWMO_END) return 1;
      const u = (t - SLOWMO_HOLD) / (SLOWMO_END - SLOWMO_HOLD);
      return SLOWMO + (1 - SLOWMO) * u * u;
    }

    lossSequenceDone() {
      if (this.lossTime == null) return true;
      return this.lossTime >= (this.lossSunk ? SUNK_LOSS_TIME : LOSS_TIME);
    }

    // One frame of the loss sequence: only what is already in the air plays on (shells in flight,
    // explosions, smoke, the wreck); the other tanks hold still. realDt: frame time (sequence length)
    updateAfterLoss(realDt, player) {
      if (this.lossTime == null) this.startLoss(player, !!player.sunk);
      const dt = realDt * this.lossTimeScale();
      this.lossTime += realDt;
      this.time += dt;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.6);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.4);
      this._updateProjectiles(dt, player);
      this._updateWreck(dt, player);
      this._updateParticles(dt);
    }

    _updateWreck(dt, player) {
      const w = this.wreck;
      if (!w) return;
      w.t += dt;
      const s = w.scale;

      // Ammunition cooking off
      while (w.booms.length > 0 && w.t >= w.booms[0]) {
        w.booms.shift();
        const a = Math.random() * Math.PI * 2;
        const r = rand(4, 14) * s;
        this.explodeAt(w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, rand(48, 66) * s, 0, true, player, true);
        this.spawnDustOrSmoke(w.x, w.y, 14, 10, '#fbbf24');
      }

      // The hull burns: flames out of the turret ring, thick black smoke, sparks now and then
      if (this.particles.length < MAX_PARTICLES) {
        const heat = Math.max(0.45, 1 - w.t / 6);
        w.flameAcc += dt * 34 * heat;
        w.smokeAcc += dt * 11;
        w.sparkAcc += dt * 4;
        while (w.flameAcc >= 1) {
          w.flameAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = rand(0, 9) * s;
          const life = rand(0.3, 0.6);
          this.particles.push({
            fire: true,
            x: this.world.wrapX(w.x + Math.cos(a) * r),
            y: this.world.wrapY(w.y + Math.sin(a) * r),
            z: rand(8, 16) * s,
            vx: rand(-12, 12), vy: rand(-12, 12), vz: rand(40, 80),
            drag: 2.0, buoy: 80,
            life, maxLife: life,
            size: rand(6, 11) * s * heat
          });
        }
        while (w.smokeAcc >= 1) {
          w.smokeAcc -= 1;
          const life = rand(1.8, 2.8);
          this.particles.push({
            dust: true,
            x: this.world.wrapX(w.x + rand(-6, 6) * s),
            y: this.world.wrapY(w.y + rand(-6, 6) * s),
            z: rand(18, 28) * s,
            vx: rand(-10, 10), vy: rand(-10, 10), vz: rand(35, 60),
            drag: 1.1, buoy: 16,
            life, maxLife: life,
            size: rand(8, 12) * s,
            grow: 2.8,
            alpha: 0.6,
            color: Math.random() < 0.5 ? '#1c1917' : '#3f3a36'
          });
        }
        while (w.sparkAcc >= 1) {
          w.sparkAcc -= 1;
          this.spawnDustOrSmoke(w.x, w.y, 14 * s, 3, Math.random() < 0.5 ? '#fde68a' : '#fb923c');
        }
      }

      // The turret falls back to the ground, bounces once and comes to rest
      const tr = w.turret;
      if (!tr.resting) {
        tr.x = this.world.wrapX(tr.x + tr.vx * dt);
        tr.y = this.world.wrapY(tr.y + tr.vy * dt);
        tr.vz -= GRAVITY * dt;
        tr.z += tr.vz * dt;
        tr.angle += tr.spin * dt;
        if (tr.z <= 0) {
          tr.z = 0;
          this.spawnDustOrSmoke(tr.x, tr.y, 2, 10, '#78716c');
          this.audio.playExplosion(0.25);
          this.shakeIntensity = Math.max(this.shakeIntensity, 0.45);
          if (tr.bounces === 0 && tr.vz < -120) {
            tr.bounces = 1;
            tr.vz = -tr.vz * 0.28;
            tr.vx *= 0.45;
            tr.vy *= 0.45;
            tr.spin *= 0.4;
          } else {
            tr.resting = true;
            this.world.addScorchMark(tr.x, tr.y, 14 * w.scale);
          }
        }
      }
    }

    // Wreck pieces for the depth-sorted render queue: [{ dy, draw }]
    wreckDrawItems(ctx, camX, camY, viewW, viewH) {
      const w = this.wreck;
      if (!w) return [];
      const items = [];
      const hp = this.world.project(w.x, w.y, 0, camX, camY, viewW, viewH);
      if (hp) {
        items.push({
          dy: hp.dy,
          draw: () => {
            ctx.save();
            ctx.translate(hp.sx, hp.sy);
            ctx.scale(hp.scale * w.scale, hp.scale * w.scale);
            ctx.rotate(w.hullAngle);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.beginPath();
            ctx.ellipse(2, 4, 29, 22, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(w.hull, HULL_BOX.x, HULL_BOX.y, HULL_BOX.w, HULL_BOX.h);
            // Glowing heat inside the torn turret ring
            const glow = 0.55 + 0.25 * Math.sin(w.t * 13) + 0.2 * Math.sin(w.t * 29);
            const g = ctx.createRadialGradient(-1, 0, 0, -1, 0, 10);
            g.addColorStop(0, `rgba(254, 215, 170, ${glow})`);
            g.addColorStop(0.5, `rgba(249, 115, 22, ${glow * 0.7})`);
            g.addColorStop(1, 'rgba(127, 29, 29, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(-1, 0, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });
      }
      const tr = w.turret;
      const gp = this.world.project(tr.x, tr.y, 0, camX, camY, viewW, viewH);
      const tp = this.world.project(tr.x, tr.y, tr.z, camX, camY, viewW, viewH);
      if (gp && tp) {
        items.push({
          // In the air it is drawn over everything near it
          dy: gp.dy + (tr.z > 1 ? 10000 : 0),
          draw: () => {
            const k = gp.scale * w.scale;
            // Shadow on the ground, smaller and fainter the higher the turret flies
            const lift = Math.min(1, tr.z / 160);
            ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * (1 - lift * 0.6)})`;
            ctx.beginPath();
            ctx.ellipse(gp.sx, gp.sy, 15 * k * (1 - lift * 0.4), 12 * k * gp.tiltCos * (1 - lift * 0.4), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.save();
            ctx.translate(tp.sx, tp.sy);
            // A little bigger high in the air (closer to the camera)
            const up = 1 + lift * 0.25;
            ctx.scale(tp.scale * w.scale * up, tp.scale * w.scale * up);
            ctx.rotate(tr.angle);
            ctx.drawImage(w.turretImg, TURRET_BOX.x, TURRET_BOX.y, TURRET_BOX.w, TURRET_BOX.h);
            ctx.restore();
          }
        });
      }
      return items;
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatWreck);
})(window);
