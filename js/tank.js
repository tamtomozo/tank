(function (global) {
  'use strict';

  const { wrapAngle } = global.TankUtil;

  class Tank2D {
    constructor(world, options = {}) {
      this.world = world;
      this.isPlayer = Boolean(options.isPlayer);
      this.isAlly = Boolean(options.isAlly); // AI wingman in the player's platoon
      this.isBunker = Boolean(options.isBunker);
      this.isBoss = Boolean(options.boss); // boss health bar, bigger shells (js/data/enemies.js)
      this.camo = Boolean(options.camo); // snow camouflage: faint from afar (js/game/render.js)
      // A fire team on foot (anti-tank infantry, or the collaborator on an escort): drawn as
      // soldiers, leaves no tread marks, run over by friendly tanks (js/combat/city.js)
      this.isInfantry = Boolean(options.isInfantry);
      this.perched = false; // turret standing on a highway deck (z = deck height)
      this.powerOff = false; // turret whose power plant has fallen
      this.kind = options.kind || (this.isPlayer ? 'player' : 'medium');
      this.scale = options.scale || 1.0;

      this.hullColor = options.hullColor || '#4d6b45';
      this.hullDark = options.hullDark || '#32472c';
      this.turretColor = options.turretColor || '#5c7f52';
      this.accentColor = options.accentColor || '#f59e0b';

      // Toroidal world coordinates (x, y) & vertical jump height (z)
      this.x = world.wrapX(options.x ?? world.width * 0.5);
      this.y = world.wrapY(options.y ?? world.height * 0.5);
      this.z = 0;
      this.vz = 0;
      this.grounded = true;

      // Angles in 2D top-down plane (0 = +X right, -PI/2 = -Y up/north)
      this.hullAngle = options.hullAngle ?? -Math.PI * 0.5;
      this.turretLocalAngle = 0; // Relative angle to hullAngle (0 = straight ahead)
      this.speed = 0;
      this.turnRate = 0;

      // Visual animation states
      this.leftTrackPhase = 0;
      this.rightTrackPhase = 0;
      this.treadMarkAccum = 0;
      this.dustAccum = 0;
      this.vibPhase = Math.random() * 100; // engine vibration clock (random start so tanks don't shake in sync)
      this.recoil = 0;
      // Turret sliding back on the hull when the main gun fires (damped spring; + = backwards)
      this.turretKick = 0;
      this.turretKickV = 0;
      this.muzzleFlashTimer = 0;
      this.antennaLag = 0;

      // Combat stats
      // Use ?? so explicit 0 values (e.g. stationary bunker speed/turn) are respected
      this.maxHp = options.maxHp ?? 120;
      this.hp = this.maxHp;
      this.maxSpeed = options.maxSpeed ?? 225;
      this.speedLimit = 1; // share of maxSpeed currently allowed (engine overheat: js/game/hazards.js)
      this.accel = options.accel ?? 460;
      this.turnSpeed = options.turnSpeed ?? 2.8;
      this.damage = options.damage ?? 40;
      this.reloadTime = options.reloadTime ?? 1.35;
      this.reloadTimer = 0;
      this.shellSpeed = options.shellSpeed ?? 560;
      this.cannonRange = options.cannonRange ?? 460;
      this.splashRadius = options.splashRadius ?? 54;
      this.armorReduction = 0;
      this.turretTraverseSpeed = options.turretTraverseSpeed ?? 6.5;
      this.traverseLimit = 1; // share of the turret traverse speed available (cold: js/game/hazards.js)

      // Visual levels from the tuning (gun barrel, ERA, track width)
      this.cannonLevel = 1;
      this.armorLevel = 1;
      this.engineLevel = 1;

      this._velX = 0;
      this._velY = 0;
      // Shove from cannon recoil / incoming blasts, added on top of normal driving and decaying away
      this.knockVx = 0;
      this.knockVy = 0;

      this.radius = 24 * this.scale;
      this.alive = true;

      // Enemy AI state
      this.aiTimer = Math.random() * 2;
      this.aiStrafeDir = Math.random() < 0.5 ? 1 : -1;
      this.scrapValue = options.scrapValue ?? 30;

      // "!" spotted mark (enemies), shown for a moment when the unit notices the player
      this.alertMarkTimer = 0;
      this.alertMarkDelay = 0;
    }

    tickAlertMark(dt) {
      if (this.alertMarkDelay > 0) {
        this.alertMarkDelay = Math.max(0, this.alertMarkDelay - dt);
      } else if (this.alertMarkTimer > 0) {
        this.alertMarkTimer = Math.max(0, this.alertMarkTimer - dt);
      }
    }

    // Red speech bubble with "!" popping up above the tank
    drawAlertMark(ctx, camX, camY, viewW, viewH) {
      if (this.alertMarkTimer <= 0 || this.alertMarkDelay > 0) return;
      const p = this.world.project(this.x, this.y, this.z, camX, camY, viewW, viewH);
      if (!p) return;

      const elapsed = Tank2D.ALERT_MARK_DURATION - this.alertMarkTimer;
      // Pop in with a small overshoot, then a gentle bob; fade out at the end
      let pop = 1;
      if (elapsed < 0.16) pop = 0.3 + (elapsed / 0.16) * 0.95;
      else if (elapsed < 0.28) pop = 1.25 - ((elapsed - 0.16) / 0.12) * 0.25;
      const bob = Math.sin(elapsed * 9) * 1.5;
      const alpha = Math.min(1, this.alertMarkTimer / 0.3);

      const s = Math.max(0.85, p.scale) * pop;
      const lift = (this.hp < this.maxHp ? 50 : 42) * p.scale * this.scale;
      const mx = p.sx;
      const my = p.sy - lift - 6 + bob;
      if (mx < -30 || mx > viewW + 30 || my < -40 || my > viewH + 40) return;

      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(mx, my);
      ctx.scale(s, s);

      // Bubble + pointer
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#fff7ed';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-9.5, -24, 19, 22, 5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-4.5, -2.5);
      ctx.lineTo(4.5, -2.5);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();

      // Exclamation mark
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 17px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, -12.5);
      ctx.restore();
    }

    // Stats from the radar-chart tuning (TankTuning.playerStats / allyStats, js/tuning.js).
    // refill: fill armour to the new maximum (a fresh tank before the sortie);
    // otherwise HP is only clamped to the new maximum.
    applyStats(st, refill = false) {
      for (const key of Tank2D.TUNED_STATS) {
        if (st[key] !== undefined) this[key] = st[key];
      }
      this.cannonLevel = st.visual.cannon;
      this.armorLevel = st.visual.armor;
      this.engineLevel = st.visual.engine;
      this.hp = refill ? this.maxHp : Math.min(this.hp, this.maxHp);
    }

    get turretAngle() {
      return this.hullAngle + this.turretLocalAngle;
    }

    _traverseTurretTowardLocal(desiredLocal, dt) {
      const diff = wrapAngle(desiredLocal - this.turretLocalAngle);
      const maxStep = this.turretTraverseSpeed * this.traverseLimit * dt;
      if (Math.abs(diff) <= maxStep) {
        this.turretLocalAngle = wrapAngle(desiredLocal);
      } else {
        this.turretLocalAngle = wrapAngle(this.turretLocalAngle + Math.sign(diff) * maxStep);
      }
    }

    aimAtWorldPoint(targetX, targetY, dt) {
      const dx = this.world.deltaX(this.x, targetX);
      const dy = this.world.deltaY(this.y, targetY);
      if (dx * dx + dy * dy < 4) return;

      const targetWorldAngle = Math.atan2(dy, dx);
      const desiredLocal = wrapAngle(targetWorldAngle - this.hullAngle);
      this._traverseTurretTowardLocal(desiredLocal, dt);
    }

    isCannonReady() {
      return this.alive && this.reloadTimer <= 0;
    }

    isAimedAt(targetX, targetY, tolerance = 0.07) {
      const dx = this.world.deltaX(this.x, targetX);
      const dy = this.world.deltaY(this.y, targetY);
      if (dx * dx + dy * dy < 4) return true;
      const targetWorldAngle = Math.atan2(dy, dx);
      return Math.abs(wrapAngle(targetWorldAngle - this.turretAngle)) <= tolerance;
    }

    returnTurretStraight(dt) {
      this._traverseTurretTowardLocal(0, dt);
    }

    getMuzzleWorld() {
      const barrelLen = (34 + (this.cannonLevel - 1) * 4) * this.scale;
      const cos = Math.cos(this.turretAngle);
      const sin = Math.sin(this.turretAngle);
      return {
        x: this.world.wrapX(this.x + cos * barrelLen),
        y: this.world.wrapY(this.y + sin * barrelLen),
        z: this.z + 18 * this.scale,
        dirX: cos,
        dirY: sin
      };
    }

    // Push the hull along (dirX, dirY) (normalised here) with an initial speed of `strength` px/s.
    // Heavier (larger) tanks are shoved less. Total travel ≈ strength / KNOCKBACK_DECAY.
    applyKnockback(dirX, dirY, strength) {
      if (!this.alive || this.isBunker) return;
      const len = Math.hypot(dirX, dirY);
      if (len < 0.0001) return;
      const s = strength / Math.max(1, this.scale);
      this.knockVx += (dirX / len) * s;
      this.knockVy += (dirY / len) * s;
      const sp = Math.hypot(this.knockVx, this.knockVy);
      if (sp > Tank2D.KNOCKBACK_MAX) {
        this.knockVx *= Tank2D.KNOCKBACK_MAX / sp;
        this.knockVy *= Tank2D.KNOCKBACK_MAX / sp;
      }
    }

    _stepKnockback(dt) {
      if (this.knockVx === 0 && this.knockVy === 0) return;
      this.x = this.world.wrapX(this.x + this.knockVx * dt);
      this.y = this.world.wrapY(this.y + this.knockVy * dt);
      const decay = Math.exp(-Tank2D.KNOCKBACK_DECAY * dt);
      this.knockVx *= decay;
      this.knockVy *= decay;
      if (Math.hypot(this.knockVx, this.knockVy) < 2) {
        this.knockVx = 0;
        this.knockVy = 0;
      }
    }

    triggerFireEffects() {
      this.recoil = 9.5;
      this.muzzleFlashTimer = 0.085;
      // Kick the turret backwards off its seat on the hull; bigger guns kick harder
      this.turretKickV += Tank2D.TURRET_KICK_IMPULSE + (this.cannonLevel - 1) * 25;
    }

    // Damped spring pulling the turret back onto the hull after a shot (slight overshoot, then settles).
    // Sub-stepped so it stays stable on long frames.
    _stepTurretKick(dt) {
      if (this.turretKick === 0 && this.turretKickV === 0) return;
      const k = Tank2D.TURRET_KICK_STIFFNESS;
      const c = Tank2D.TURRET_KICK_DAMPING;
      const steps = Math.max(1, Math.ceil(dt * 120));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.turretKickV += (-k * this.turretKick - c * this.turretKickV) * h;
        this.turretKick += this.turretKickV * h;
      }
      // Don't let it slide forward past its seat by more than a hair
      if (this.turretKick < -2) {
        this.turretKick = -2;
        this.turretKickV = Math.max(0, this.turretKickV);
      }
      if (Math.abs(this.turretKick) < 0.02 && Math.abs(this.turretKickV) < 0.5) {
        this.turretKick = 0;
        this.turretKickV = 0;
      }
    }

    _tickTimers(dt) {
      this.vibPhase += dt;
      if (this.reloadTimer > 0) this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 42);
      this._stepTurretKick(dt);
      if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    }

    stepPhysics(throttle, steer, dt, dustCb) {
      if (!this.alive) return;
      this._tickTimers(dt);
      if (this.isBunker) return;

      const targetSpeed = throttle * this.maxSpeed * this.speedLimit;
      const rate = Math.abs(throttle) > 0.05 ? this.accel : this.accel * 1.4;
      if (this.speed < targetSpeed) {
        this.speed = Math.min(targetSpeed, this.speed + rate * dt);
      } else {
        this.speed = Math.max(targetSpeed, this.speed - rate * dt);
      }

      const turnInput = steer * this.turnSpeed * (throttle < -0.1 ? -1 : 1);
      this.turnRate = turnInput;
      this.hullAngle += turnInput * dt;

      // Move on toroidal map (seamless top-bottom & left-right wrap!)
      const cos = Math.cos(this.hullAngle);
      const sin = Math.sin(this.hullAngle);
      this._velX = cos * this.speed;
      this._velY = sin * this.speed;
      this.x = this.world.wrapX(this.x + this._velX * dt);
      this.y = this.world.wrapY(this.y + this._velY * dt);
      this._stepKnockback(dt);

      this._postStepMotion(dt, dustCb);
    }

    // Directional control mode: move directly toward pressed (moveX, moveY) while rotating tank hull smoothly
    stepPhysicsDirectional(moveX, moveY, dt, dustCb) {
      if (!this.alive) return;
      this._tickTimers(dt);
      if (this.isBunker) return;

      const inputLen = Math.hypot(moveX, moveY);
      const hasInput = inputLen > 0.05;

      let targetVx = 0;
      let targetVy = 0;
      if (hasInput) {
        const dirX = moveX / inputLen;
        const dirY = moveY / inputLen;
        targetVx = dirX * this.maxSpeed * this.speedLimit;
        targetVy = dirY * this.maxSpeed * this.speedLimit;

        const targetAngle = Math.atan2(dirY, dirX);
        const diff = wrapAngle(targetAngle - this.hullAngle);
        const maxTurnRate = this.turnSpeed * 2.8;
        const turnRate = Math.max(-maxTurnRate, Math.min(maxTurnRate, diff / Math.max(0.001, dt)));
        this.turnRate = turnRate;
        this.hullAngle = wrapAngle(this.hullAngle + turnRate * dt);
      } else {
        this.turnRate = 0;
      }

      const rate = hasInput ? this.accel * 1.45 : this.accel * 1.6;
      const dvx = targetVx - this._velX;
      const dvy = targetVy - this._velY;
      const dv = Math.hypot(dvx, dvy);
      const step = rate * dt;
      if (dv <= step || dv < 0.001) {
        this._velX = targetVx;
        this._velY = targetVy;
      } else {
        this._velX += (dvx / dv) * step;
        this._velY += (dvy / dv) * step;
      }

      this.speed = Math.hypot(this._velX, this._velY);
      this.x = this.world.wrapX(this.x + this._velX * dt);
      this.y = this.world.wrapY(this.y + this._velY * dt);
      this._stepKnockback(dt);

      this._postStepMotion(dt, dustCb);
    }

    _postStepMotion(dt, dustCb) {
      const cos = Math.cos(this.hullAngle);
      const sin = Math.sin(this.hullAngle);

      // Jump pads check
      if (this.grounded) {
        for (const ramp of this.world.ramps) {
          const dx = this.world.deltaX(this.x, ramp.x);
          const dy = this.world.deltaY(this.y, ramp.y);
          if (dx * dx + dy * dy < ramp.radius * ramp.radius && Math.abs(this.speed) > 110) {
            this.vz = 210 + Math.abs(this.speed) * 0.3;
            this.grounded = false;
            break;
          }
        }
      } else {
        this.vz -= 520 * dt;
        this.z += this.vz * dt;
        if (this.z <= 0) {
          this.z = 0;
          this.vz = 0;
          this.grounded = true;
          if (dustCb) dustCb(this.x, this.y, 6);
        }
      }

      // Solid obstacle collision (wrapped delta): boulders, the HQ's tent / crates and the
      // buildings of an old town (boxes: pushed out through the nearest side)
      for (const obs of this.world.colliders) {
        const dx = this.world.deltaX(obs.x, this.x);
        const dy = this.world.deltaY(obs.y, this.y);
        const reach = this.radius + obs.radius;
        if (dx * dx + dy * dy >= reach * reach) continue;
        const s = this.world.surfaceGap(obs, this.x, this.y);
        if (s.gap >= this.radius) continue;
        const push = this.radius - s.gap;
        this.x = this.world.wrapX(this.x + s.nx * push);
        this.y = this.world.wrapY(this.y + s.ny * push);
        this.speed *= 0.7;
        this._velX *= 0.7;
        this._velY *= 0.7;
      }

      // Differential left/right caterpillar tread animation
      const leftSpeed = this.speed + this.turnRate * 42;
      const rightSpeed = this.speed - this.turnRate * 42;
      this.leftTrackPhase += leftSpeed * dt * 0.18;
      this.rightTrackPhase += rightSpeed * dt * 0.18;
      this.antennaLag += (this.speed * 0.018 - this.antennaLag) * Math.min(1, dt * 8);

      // Leave dual caterpillar tread marks on terrain
      if (this.grounded && !this.isInfantry && (Math.abs(this.speed) > 12 || Math.abs(this.turnRate) > 0.35)) {
        this.treadMarkAccum += (Math.abs(this.speed) + Math.abs(this.turnRate) * 28) * dt;
        if (this.treadMarkAccum > 13) {
          this.treadMarkAccum = 0;
          const rx = -sin * 16 * this.scale;
          const ry = cos * 16 * this.scale;
          this.world.addTreadMark(this.x - rx, this.y - ry, this.hullAngle);
          this.world.addTreadMark(this.x + rx, this.y + ry, this.hullAngle);
        }
        // Sand kicked up by the tracks is emitted by CombatManager._emitTrackDust (all tanks)
      }
    }

    draw(ctx, camX, camY, viewW, viewH, nightFactor = 0) {
      if (!this.alive) return;
      const groundProj = this.world.project(this.x, this.y, 0, camX, camY, viewW, viewH);
      const bodyProj = this.world.project(this.x, this.y, this.z, camX, camY, viewW, viewH);
      if (!groundProj || !bodyProj) return;
      if (bodyProj.sx < -90 || bodyProj.sx > viewW + 90) return;
      if (this.isInfantry) {
        this._drawInfantry(ctx, bodyProj);
        return;
      }

      // 1. Ground Shadow (stays on terrain even when jumping!; a turret on a deck has none there)
      if (!this.perched) {
      ctx.save();
      ctx.translate(groundProj.sx, groundProj.sy);
      ctx.scale(groundProj.scale * this.scale, groundProj.scale * this.scale * groundProj.tiltCos);
      ctx.rotate(this.hullAngle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(2, 4, 29, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      }

      // 1b. Ground-projected forward headlight beam (player: shows auto lock-on range up to
      //     cannonRange; wingmen at 80%). Dimmed with the time of day, off in daylight.
      const lightLevel = this.isPlayer || this.isAlly ? this.world.getHeadlightLevel(this) : 0;
      if (lightLevel > 0.01) {
        const poly = this.world.getHeadlightConePolygon(
          this.x, this.y, this.hullAngle, this.cannonRange,
          camX, camY, viewW, viewH
        );
        if (poly) {
          const beamAlpha = (0.14 + nightFactor * 0.34) * lightLevel;
          const beamGrad = ctx.createLinearGradient(
            poly.originPt.sx, poly.originPt.sy,
            poly.tipPt.sx, poly.tipPt.sy
          );
          beamGrad.addColorStop(0, `rgba(254, 249, 195, ${beamAlpha.toFixed(2)})`);
          beamGrad.addColorStop(0.75, `rgba(254, 249, 195, ${(beamAlpha * 0.35).toFixed(2)})`);
          beamGrad.addColorStop(1, 'rgba(254, 249, 195, 0)');
          ctx.fillStyle = beamGrad;
          ctx.beginPath();
          ctx.moveTo(poly.leftPts[0].sx, poly.leftPts[0].sy);
          for (let i = 1; i < poly.leftPts.length; i++) {
            ctx.lineTo(poly.leftPts[i].sx, poly.leftPts[i].sy);
          }
          for (let i = poly.rightPts.length - 1; i >= 0; i--) {
            ctx.lineTo(poly.rightPts[i].sx, poly.rightPts[i].sy);
          }
          ctx.closePath();
          ctx.fill();
        }
      }

      // 2. Main 2D Tank Body (uniform perspective scale, no vertical ground squash)
      const s = bodyProj.scale * this.scale;
      ctx.save();
      ctx.translate(bodyProj.sx, bodyProj.sy);
      ctx.scale(s, s);

      // The still parts (track bases, hull, turret) come from sprites, see _spriteSet()
      this._drawScale = s;
      const sprites = this._spriteSet();
      const vib = this._engineVibration();
      if (this.isBunker) {
        this._drawBunkerBase(ctx);
      } else {
        ctx.save();
        ctx.rotate(this.hullAngle);
        stamp(ctx, sprites.tracks, TRACKS_BOX);
        this._paintTrackMotion(ctx);
        this._shakeWithEngine(ctx, vib);
        stamp(ctx, sprites.hull, HULL_BOX);
        ctx.restore();
      }

      // 3. Rotating 2D Turret (rides on the vibrating hull, slides back along the barrel on firing)
      ctx.save();
      ctx.translate(
        vib.x - Math.cos(this.turretAngle) * this.turretKick,
        vib.y - Math.sin(this.turretAngle) * this.turretKick
      );
      if (this.recoil > 0 || this.muzzleFlashTimer > 0) {
        // Just fired: barrel recoil and muzzle flash are drawn live
        this._drawTurret(ctx);
      } else {
        ctx.rotate(this.turretAngle);
        stamp(ctx, sprites.turret, TURRET_BOX);
        this._paintAntenna(ctx);
      }
      ctx.restore();
      if (this.powerOff) {
        // No power: the turret is dark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // 4. Health Bar above damaged enemies / wingmen
      if (!this.isPlayer && this.hp < this.maxHp) {
        const barW = 38 * bodyProj.scale * this.scale;
        const barH = 5;
        const bx = bodyProj.sx - barW * 0.5;
        const by = bodyProj.sy - 34 * bodyProj.scale * this.scale;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = this.isAlly ? '#22c55e' : this.isBoss ? '#f59e0b' : '#ef4444';
        ctx.fillRect(bx, by, barW * Math.max(0, this.hp / this.maxHp), barH);
      }

      // 5. Friendly marker: small blue chevron above each wingman
      if (this.isAlly) {
        const mx = bodyProj.sx;
        const my = bodyProj.sy - (this.hp < this.maxHp ? 44 : 36) * bodyProj.scale;
        const ms = 5 * bodyProj.scale;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.beginPath();
        ctx.moveTo(mx - ms, my - ms * 0.6);
        ctx.lineTo(mx + ms, my - ms * 0.6);
        ctx.lineTo(mx, my + ms * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }

    // A fire team on foot at its projected position (enemy infantry, or the collaborator)
    _drawInfantry(ctx, bodyProj) {
      const s = bodyProj.scale * this.scale;
      ctx.save();
      ctx.translate(bodyProj.sx, bodyProj.sy);
      ctx.scale(s, s);
      this._paintInfantry(ctx);
      ctx.restore();
      if (this.isEscort) {
        // Collaborator: armour bar and a blue chevron, like a wingman
        const k = bodyProj.scale;
        const barW = 30 * k;
        const bx = bodyProj.sx - barW * 0.5;
        const by = bodyProj.sy - 26 * k;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, 6);
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(bx, by, barW * Math.max(0, this.hp / this.maxHp), 4);
        const my = by - 8 * k;
        const ms = 5 * k;
        ctx.fillStyle = 'rgba(96, 165, 250, 0.95)';
        ctx.beginPath();
        ctx.moveTo(bodyProj.sx - ms, my - ms * 0.6);
        ctx.lineTo(bodyProj.sx + ms, my - ms * 0.6);
        ctx.lineTo(bodyProj.sx, my + ms * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Three soldiers in a wedge facing the aim direction (local units, origin = team centre).
    // Enemy infantry carry rocket tubes; a back-blast shows right after a shot.
    _paintInfantry(ctx) {
      const moving = Math.abs(this.speed) > 6;
      const bob = moving ? Math.sin(this.vibPhase * 11) * 1.6 : 0;
      ctx.save();
      ctx.rotate(this.turretAngle);
      const team = [[10, 0, 0], [-8, -17, 1], [-8, 17, 2]];
      for (const [px, py, i] of team) {
        const b = i === 0 ? bob : -bob;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(px + 2, py + 3, 9, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.hullColor;
        ctx.strokeStyle = this.hullDark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(px + b * 0.4, py, 6.5, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (!this.isEscort && i !== 2) {
          // Rocket launcher over the shoulder
          ctx.strokeStyle = '#27272a';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(px - 10, py + 4);
          ctx.lineTo(px + 15, py + 4);
          ctx.stroke();
          ctx.fillStyle = this.accentColor;
          ctx.fillRect(px + 13, py + 2, 4, 4);
        }
        ctx.fillStyle = this.turretColor;
        ctx.beginPath();
        ctx.arc(px + 1 + b * 0.4, py, 4.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.muzzleFlashTimer > 0 && !this.isEscort) {
        ctx.fillStyle = 'rgba(253, 186, 116, 0.9)';
        ctx.beginPath();
        ctx.arc(28, 4, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(214, 211, 209, 0.7)';
        ctx.beginPath();
        ctx.arc(-6, 4, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawBunkerBase(ctx) {
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const px = Math.cos(a) * 24;
        const py = Math.sin(a) * 24;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Small screen-space offset (unscaled tank units) for the idling / running engine shake.
    // Layered sines at mismatched frequencies give an irregular buzz. Only while moving (driving or
    // turning in place); fades in over the first few units of speed so starting/stopping isn't a pop.
    _engineVibration() {
      if (this.isBunker) return { x: 0, y: 0 };
      const motion = Math.abs(this.speed) + Math.abs(this.turnRate) * 28;
      if (motion < 2) return { x: 0, y: 0 };
      let amp = Math.min(1, motion / 40) *
        (0.35 + Math.min(1, Math.abs(this.speed) / 200) * 0.55);
      if (!this.grounded) amp *= 0.3;
      const t = this.vibPhase;
      return {
        x: (Math.sin(t * 71) * 0.6 + Math.sin(t * 113 + 1.3) * 0.4) * amp,
        y: (Math.sin(t * 83 + 0.7) * 0.6 + Math.sin(t * 127 + 2.1) * 0.4) * amp
      };
    }

    // Hull and tracks drawn directly (vector). The battlefield uses sprites for the still parts
    // instead (see draw()); this is the same picture, used for previews (briefing).
    _drawHullAndTracks(ctx, nightFactor = 0, vib = null) {
      ctx.save();
      ctx.rotate(this.hullAngle);
      this._paintTrackBases(ctx);
      this._paintTrackMotion(ctx);
      this._shakeWithEngine(ctx, vib);
      this._paintHull(ctx);
      ctx.restore();
    }

    _trackWidth() {
      return 10 + (this.engineLevel - 1) * 0.9;
    }

    // Rubber base of the left and right track (hull-local axes, like every _paint* below)
    _paintTrackBases(ctx) {
      const trackWidth = this._trackWidth();
      ctx.fillStyle = '#181b20';
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1.5;
      for (const ySign of [-1, 1]) {
        const ty = ySign * TRACK_OFFSET_Y - trackWidth * 0.5;
        ctx.fillRect(-TRACK_LEN * 0.5, ty, TRACK_LEN, trackWidth);
        ctx.strokeRect(-TRACK_LEN * 0.5, ty, TRACK_LEN, trackWidth);
      }
    }

    // What moves on the tracks: the tread cleats running along them, with the sprocket wheel
    // highlights at both ends on top
    _paintTrackMotion(ctx) {
      const trackWidth = this._trackWidth();
      const half = TRACK_LEN * 0.5;

      // Cleats: 3 units wide every 7 units, starting `offset` behind the rear end of the track.
      // Both tracks are one dashed stroke (each sub-path starts its own dash pattern).
      const spacing = 7;
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = trackWidth - 2;
      ctx.lineCap = 'butt';
      ctx.setLineDash([3, spacing - 3]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      for (const ySign of [-1, 1]) {
        const phase = ySign < 0 ? this.leftTrackPhase : this.rightTrackPhase;
        const offset = ((phase % spacing) + spacing) % spacing;
        const start = -half + offset;
        const count = Math.ceil((half - 2 - start) / spacing); // cleats that start before the front end
        if (count <= 0) continue;
        ctx.moveTo(start, ySign * TRACK_OFFSET_Y);
        ctx.lineTo(start + (count - 1) * spacing + 3, ySign * TRACK_OFFSET_Y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Front & rear sprocket wheel highlights
      ctx.fillStyle = this.accentColor;
      for (const ySign of [-1, 1]) {
        const ty = ySign * TRACK_OFFSET_Y - trackWidth * 0.5;
        ctx.fillRect(half - 4, ty + 2, 3, trackWidth - 4);
        ctx.fillRect(-half + 1, ty + 2, 3, trackWidth - 4);
      }
    }

    // Everything above the tracks shakes with the engine (offset rotated into hull-local axes)
    _shakeWithEngine(ctx, vib) {
      if (!vib) return;
      const c = Math.cos(this.hullAngle);
      const sn = Math.sin(this.hullAngle);
      ctx.translate(vib.x * c + vib.y * sn, -vib.x * sn + vib.y * c);
    }

    // The hull itself: nothing here moves, it only depends on the tank's colours and armour level
    _paintHull(ctx) {
      // Main armored hull
      ctx.fillStyle = this.hullColor;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-22, -13.5, 45, 27, 4);
      ctx.fill();
      ctx.stroke();

      // Sloped front glacis armor highlight
      ctx.fillStyle = this.turretColor;
      ctx.fillRect(12, -11.5, 10, 23);

      // Rear engine deck & exhaust pipes
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(-20, -9.5, 11, 19);
      ctx.fillStyle = '#4b5563';
      for (let i = -6; i <= 6; i += 4) {
        ctx.fillRect(-19, i - 1, 9, 2);
      }

      // Headlights & Tail lights
      ctx.fillStyle = this.isPlayer ? '#fef08a' : '#f87171';
      ctx.fillRect(21, -11, 3, 4);
      ctx.fillRect(21, 7, 3, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-23, -10, 2.5, 4);
      ctx.fillRect(-23, 6, 2.5, 4);

      // ERA Reactive Armor Blocks (Armor Lv 2-4)
      if (this.armorLevel >= 2) {
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = this.accentColor;
        ctx.lineWidth = 1;
        const count = this.armorLevel >= 3 ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const bx = -12 + i * 8;
          ctx.fillRect(bx, -16, 6, 3.5);
          ctx.strokeRect(bx, -16, 6, 3.5);
          ctx.fillRect(bx, 12.5, 6, 3.5);
          ctx.strokeRect(bx, 12.5, 6, 3.5);
        }
      }
      if (this.armorLevel >= 4) {
        ctx.fillStyle = this.accentColor;
        ctx.fillRect(22, -10, 3.5, 20);
      }
    }

    // Turret drawn directly (vector), with barrel recoil, muzzle flash and the swaying antenna
    _drawTurret(ctx) {
      ctx.save();
      ctx.rotate(this.turretAngle);
      this._paintTurret(ctx, true);
      ctx.restore();
    }

    // Turret in its own axes (barrel along +x). live: with what changes from frame to frame (barrel
    // recoil, muzzle flash, antenna); without it this is the still picture kept as a sprite.
    _paintTurret(ctx, live) {
      // Turret shadow on hull
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(-2, 3, 14, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cannon Barrel(s) with Recoil!
      const rx = live ? -this.recoil : 0;
      ctx.save();
      ctx.translate(rx, 0);

      if (this.cannonLevel >= 5) {
        // Lv5: Glowing Plasma Rail-Cannon
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(8, -5.5, 34, 3.2);
        ctx.fillRect(8, 2.3, 34, 3.2);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(10, -1.5, 30, 3);
      } else if (this.cannonLevel === 4) {
        // Lv4: Twin-Barrel Heavy Siege Cannon
        ctx.fillStyle = '#262b33';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.2;
        for (const by of [-4.5, 1.5]) {
          ctx.fillRect(8, by, 30, 3.2);
          ctx.strokeRect(8, by, 30, 3.2);
          ctx.fillStyle = this.accentColor;
          ctx.fillRect(35, by - 0.6, 4, 4.4);
          ctx.fillStyle = '#262b33';
        }
      } else {
        // Lv1-3: Single barrel scaling length + muzzle brake
        const len = 24 + (this.cannonLevel - 1) * 5;
        ctx.fillStyle = '#262b33';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.3;
        ctx.fillRect(8, -2.6, len, 5.2);
        ctx.strokeRect(8, -2.6, len, 5.2);

        if (this.cannonLevel >= 2) {
          ctx.fillStyle = this.hullDark;
          ctx.fillRect(16, -3.6, 7, 7.2);
        }
        if (this.cannonLevel >= 3) {
          ctx.fillStyle = '#1f2937';
          ctx.fillRect(8 + len - 3, -4.4, 5.5, 8.8);
        }
      }

      // Muzzle Flash
      if (live && this.muzzleFlashTimer > 0) {
        const tipX = 36 + (this.cannonLevel - 1) * 3;
        ctx.fillStyle = this.cannonLevel >= 5 ? 'rgba(56, 189, 248, 0.9)' : 'rgba(254, 240, 138, 0.92)';
        ctx.beginPath();
        ctx.ellipse(tipX + 6, 0, 11, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Turret main body
      ctx.fillStyle = this.turretColor;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-13, -10.5, 24, 21, 5);
      ctx.fill();
      ctx.stroke();

      // Turret cheek armor (Armor Lv 5)
      if (this.armorLevel >= 5) {
        ctx.fillStyle = this.accentColor;
        ctx.fillRect(-3, -12.8, 12, 2.5);
        ctx.fillRect(-3, 10.3, 12, 2.5);
      }

      // Commander cupola & hatch
      ctx.fillStyle = this.hullDark;
      ctx.beginPath();
      ctx.arc(-2, -4, 4.5, 0, Math.PI * 2);
      ctx.fill();

      if (live) this._paintAntenna(ctx);
    }

    // Swaying whip antenna
    _paintAntenna(ctx) {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-9, -6);
      ctx.lineTo(-16 - this.antennaLag, -9);
      ctx.stroke();
    }

    // ---- Sprites (battlefield drawing) ----------------------------------------------------------
    // Track bases, hull and turret are a few dozen small shapes that only change with the tank's
    // colours and tuning levels. On the battlefield they are painted once per look into sprites and
    // stamped from there every frame (three stamps instead of ~80 canvas calls per tank).

    // Sprites for this tank's look at the resolution it is currently shown at
    _spriteSet() {
      // Canvas pixels per tank unit right now -> sprite resolution (2, 4 or 8 px per unit)
      const density = (this._drawScale || 1) * Tank2D.pixelRatio;
      const res = density <= 2 ? 2 : density <= 4 ? 4 : 8;
      const cur = this._sprites;
      if (cur && cur.res === res && cur.cannon === this.cannonLevel && cur.armor === this.armorLevel
        && cur.engine === this.engineLevel) {
        return cur;
      }
      const key = [
        res, this.hullColor, this.hullDark, this.turretColor, this.accentColor, this.isPlayer ? 1 : 0,
        this.cannonLevel, this.armorLevel, this.engineLevel
      ].join('|');
      let set = spriteCache.get(key);
      if (!set) {
        set = {
          res,
          cannon: this.cannonLevel,
          armor: this.armorLevel,
          engine: this.engineLevel,
          tracks: makeSprite(TRACKS_BOX, res, (g) => this._paintTrackBases(g)),
          hull: makeSprite(HULL_BOX, res, (g) => this._paintHull(g)),
          turret: makeSprite(TURRET_BOX, res, (g) => this._paintTurret(g, false))
        };
        spriteCache.set(key, set);
      }
      this._sprites = set;
      return set;
    }
  }

  const TRACK_LEN = 48;
  const TRACK_OFFSET_Y = 16;

  // Sprite bounds in tank units (the painted shapes plus a little margin for their outlines)
  const TRACKS_BOX = { x: -26, y: -26, w: 52, h: 52 };
  const HULL_BOX = { x: -27, y: -19, w: 55, h: 38 };
  const TURRET_BOX = { x: -18, y: -17, w: 65, h: 35 };
  const spriteCache = new Map(); // look + resolution -> { tracks, hull, turret }

  function makeSprite(box, res, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(box.w * res);
    canvas.height = Math.ceil(box.h * res);
    const g = canvas.getContext('2d');
    g.setTransform(res, 0, 0, res, -box.x * res, -box.y * res);
    paint(g);
    return canvas;
  }

  const stamp = (ctx, sprite, box) => ctx.drawImage(sprite, box.x, box.y, box.w, box.h);

  // Canvas pixels per CSS pixel of the battlefield canvas (set by js/game/render.js every frame);
  // picks the sprite resolution
  Tank2D.pixelRatio = 1;

  // Numeric fields set by applyStats (the tuning's stat objects may leave some out)
  Tank2D.TUNED_STATS = [
    'damage', 'splashRadius', 'shellSpeed', 'cannonRange', 'reloadTime',
    'maxSpeed', 'accel', 'turnSpeed', 'maxHp', 'armorReduction'
  ];
  Tank2D.ALERT_MARK_DURATION = 1.8; // seconds the "!" spotted mark stays up
  // Turret recoil slide: ~6 units back at peak, ~5 Hz spring with light damping (one small overshoot)
  Tank2D.TURRET_KICK_IMPULSE = 300; // units/s backwards when the main gun fires
  Tank2D.TURRET_KICK_STIFFNESS = 900; // spring constant (ω ≈ 30 rad/s)
  Tank2D.TURRET_KICK_DAMPING = 24; // damping (ζ ≈ 0.4)
  Tank2D.KNOCKBACK_DECAY = 7; // 1/s: how fast a knockback shove dies out
  Tank2D.KNOCKBACK_MAX = 420; // px/s cap so stacked blasts can't fling a tank across the map
  global.Tank2D = Tank2D;
})(window);
