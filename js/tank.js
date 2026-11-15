(function (global) {
  'use strict';

  const { wrapAngle } = global.TankUtil;

  class Tank2D {
    constructor(world, options = {}) {
      this.world = world;
      this.isPlayer = Boolean(options.isPlayer);
      this.isAlly = Boolean(options.isAlly); // AI wingman in the player's platoon
      this.isBunker = Boolean(options.isBunker);
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
      this.recoil = 0;
      this.muzzleFlashTimer = 0;
      this.antennaLag = 0;

      // Combat stats
      // Use ?? so explicit 0 values (e.g. stationary bunker speed/turn) are respected
      this.maxHp = options.maxHp ?? 120;
      this.hp = this.maxHp;
      this.maxSpeed = options.maxSpeed ?? 225;
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

      // Upgrade visual levels (player)
      this.cannonLevel = 1;
      this.armorLevel = 1;
      this.engineLevel = 1;
      this.subLevel = 0;
      this.subCooldown = 0;
      this.subHeat = 0;
      this.subOverheated = false;

      this.boostEnergy = 100;
      this.maxBoost = 100;
      this.boosting = false;
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

    applyPlayerUpgrades(up) {
      if (!this.isPlayer) return;
      this.cannonLevel = up.cannon;
      this.armorLevel = up.armor;
      this.engineLevel = up.engine;
      this.subLevel = up.subweapon;
      if (this.subLevel > 2) {
        this.subHeat = 0;
        this.subOverheated = false;
      }

      this.damage = 40 + (up.cannon - 1) * 18;
      this.splashRadius = 54 + (up.cannon - 1) * 10;
      this.shellSpeed = 560 + (up.cannon - 1) * 65;
      this.cannonRange = 460 + (up.cannon - 1) * 45;

      this.reloadTime = Math.max(0.45, 1.35 - (up.reload - 1) * 0.2);

      const prevMax = this.maxHp;
      this.maxHp = 120 + (up.armor - 1) * 45;
      if (this.maxHp > prevMax) {
        this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - prevMax));
      }
      this.armorReduction = (up.armor - 1) * 0.08;

      this.maxSpeed = 225 + (up.engine - 1) * 34;
      this.accel = 460 + (up.engine - 1) * 75;
      this.turnSpeed = 2.8 + (up.engine - 1) * 0.26;
      this.maxBoost = 100 + (up.engine - 1) * 25;
    }

    get turretAngle() {
      return this.hullAngle + this.turretLocalAngle;
    }

    _traverseTurretTowardLocal(desiredLocal, dt) {
      const diff = wrapAngle(desiredLocal - this.turretLocalAngle);
      const maxStep = this.turretTraverseSpeed * dt;
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
    }

    _tickTimers(dt) {
      if (this.reloadTimer > 0) this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.subCooldown > 0) this.subCooldown = Math.max(0, this.subCooldown - dt);
      if (this.subOverheated) {
        this.subHeat = Math.max(0, this.subHeat - dt * 0.50);
        if (this.subHeat <= 0) {
          this.subOverheated = false;
        }
      } else if (this.subHeat > 0) {
        const coolRate = this.subCooldown <= 0 ? 0.58 : 0.18;
        this.subHeat = Math.max(0, this.subHeat - dt * coolRate);
      }
      if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 42);
      if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    }

    _updateBoost(wantBoost, isMovingInput, dt) {
      const canBoost = wantBoost && this.boostEnergy > 4 && isMovingInput;
      this.boosting = canBoost;
      if (canBoost) {
        this.boostEnergy = Math.max(0, this.boostEnergy - dt * 36);
      } else {
        this.boostEnergy = Math.min(this.maxBoost, this.boostEnergy + dt * 20);
      }
      return this.maxSpeed * (canBoost ? 1.58 : 1.0);
    }

    stepPhysics(throttle, steer, wantBoost, dt, dustCb) {
      if (!this.alive) return;
      this._tickTimers(dt);
      if (this.isBunker) return;

      const topSpeed = this._updateBoost(wantBoost, Math.abs(throttle) > 0.05, dt);
      const targetSpeed = throttle * topSpeed;
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
    stepPhysicsDirectional(moveX, moveY, wantBoost, dt, dustCb) {
      if (!this.alive) return;
      this._tickTimers(dt);
      if (this.isBunker) return;

      const inputLen = Math.hypot(moveX, moveY);
      const hasInput = inputLen > 0.05;
      const topSpeed = this._updateBoost(wantBoost, hasInput, dt);

      let targetVx = 0;
      let targetVy = 0;
      if (hasInput) {
        const dirX = moveX / inputLen;
        const dirY = moveY / inputLen;
        targetVx = dirX * topSpeed;
        targetVy = dirY * topSpeed;

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

      // Solid obstacle collision (wrapped delta)
      for (const obs of this.world.obstacles) {
        const dx = this.world.deltaX(obs.x, this.x);
        const dy = this.world.deltaY(obs.y, this.y);
        const minDist = this.radius + obs.radius;
        const dSq = dx * dx + dy * dy;
        if (dSq < minDist * minDist && dSq > 0.001) {
          const d = Math.sqrt(dSq);
          const push = minDist - d;
          this.x = this.world.wrapX(this.x + (dx / d) * push);
          this.y = this.world.wrapY(this.y + (dy / d) * push);
          this.speed *= 0.7;
          this._velX *= 0.7;
          this._velY *= 0.7;
        }
      }

      // Differential left/right caterpillar tread animation
      const leftSpeed = this.speed + this.turnRate * 42;
      const rightSpeed = this.speed - this.turnRate * 42;
      this.leftTrackPhase += leftSpeed * dt * 0.18;
      this.rightTrackPhase += rightSpeed * dt * 0.18;
      this.antennaLag += (this.speed * 0.018 - this.antennaLag) * Math.min(1, dt * 8);

      // Leave dual caterpillar tread marks on terrain
      if (this.grounded && (Math.abs(this.speed) > 12 || Math.abs(this.turnRate) > 0.35)) {
        this.treadMarkAccum += (Math.abs(this.speed) + Math.abs(this.turnRate) * 28) * dt;
        if (this.treadMarkAccum > 13) {
          this.treadMarkAccum = 0;
          const rx = -sin * 16 * this.scale;
          const ry = cos * 16 * this.scale;
          this.world.addTreadMark(this.x - rx, this.y - ry, this.hullAngle);
          this.world.addTreadMark(this.x + rx, this.y + ry, this.hullAngle);
        }

        if (this.isPlayer && dustCb) {
          this.dustAccum += Math.abs(this.speed) * dt;
          if (this.dustAccum > (this.boosting ? 18 : 42)) {
            this.dustAccum = 0;
            dustCb(this.x - cos * 22, this.y - sin * 22, this.boosting ? 2 : 1);
          }
        }
      }
    }

    draw(ctx, camX, camY, viewW, viewH, nightFactor = 0) {
      if (!this.alive) return;
      const groundProj = this.world.project(this.x, this.y, 0, camX, camY, viewW, viewH);
      const bodyProj = this.world.project(this.x, this.y, this.z, camX, camY, viewW, viewH);
      if (!groundProj || !bodyProj) return;
      if (bodyProj.sx < -90 || bodyProj.sx > viewW + 90) return;

      // 1. Ground Shadow (stays on terrain even when jumping!)
      ctx.save();
      ctx.translate(groundProj.sx, groundProj.sy);
      ctx.scale(groundProj.scale * this.scale, groundProj.scale * this.scale * groundProj.tiltCos);
      ctx.rotate(this.hullAngle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(2, 4, 29, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 1b. Ground-projected forward headlight beam (shows auto lock-on range up to cannonRange)
      if (this.isPlayer) {
        const poly = this.world.getHeadlightConePolygon(
          this.x, this.y, this.hullAngle, this.cannonRange,
          camX, camY, viewW, viewH
        );
        if (poly) {
          const beamAlpha = 0.14 + nightFactor * 0.34;
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

      if (this.isBunker) {
        this._drawBunkerBase(ctx);
      } else {
        this._drawHullAndTracks(ctx, nightFactor);
      }

      // 3. Rotating 2D Turret
      this._drawTurret(ctx);

      ctx.restore();

      // 4. Health Bar above damaged enemies / wingmen
      if (!this.isPlayer && this.hp < this.maxHp) {
        const barW = 38 * bodyProj.scale * this.scale;
        const barH = 5;
        const bx = bodyProj.sx - barW * 0.5;
        const by = bodyProj.sy - 34 * bodyProj.scale * this.scale;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = this.isAlly ? '#22c55e' : this.kind === 'boss' ? '#f59e0b' : '#ef4444';
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

    _drawHullAndTracks(ctx, nightFactor = 0) {
      ctx.save();
      ctx.rotate(this.hullAngle);

      const trackWidth = 10 + (this.engineLevel - 1) * 0.9;
      const trackLen = 48;
      const trackOffsetY = 16;

      // Draw Left (-1) & Right (+1) 2D Caterpillar Treads
      const drawTrack = (ySign, phase) => {
        const ty = ySign * trackOffsetY - trackWidth * 0.5;
        // Track rubber base
        ctx.fillStyle = '#181b20';
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-trackLen * 0.5, ty, trackLen, trackWidth);
        ctx.strokeRect(-trackLen * 0.5, ty, trackLen, trackWidth);

        // Animated individual caterpillar tread cleats
        ctx.fillStyle = '#4b5563';
        const spacing = 7;
        const offset = ((phase % spacing) + spacing) % spacing;
        for (let tx = -trackLen * 0.5 + offset; tx < trackLen * 0.5 - 2; tx += spacing) {
          ctx.fillRect(tx, ty + 1, 3, trackWidth - 2);
        }

        // Front & rear sprocket wheel highlights
        ctx.fillStyle = this.accentColor;
        ctx.fillRect(trackLen * 0.5 - 4, ty + 2, 3, trackWidth - 4);
        ctx.fillRect(-trackLen * 0.5 + 1, ty + 2, 3, trackWidth - 4);
      };

      drawTrack(-1, this.leftTrackPhase);
      drawTrack(1, this.rightTrackPhase);

      // Turbo boost flame jets
      if (this.boosting) {
        for (const ey of [-7, 7]) {
          const fLen = 14 + Math.random() * 10;
          ctx.fillStyle = 'rgba(56, 189, 248, 0.88)';
          ctx.beginPath();
          ctx.moveTo(-24, ey - 3.5);
          ctx.lineTo(-24 - fLen, ey);
          ctx.lineTo(-24, ey + 3.5);
          ctx.closePath();
          ctx.fill();
        }
      }

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

      ctx.restore();
    }

    _drawTurret(ctx) {
      ctx.save();
      ctx.rotate(this.turretAngle);

      // Turret shadow on hull
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(-2, 3, 14, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cannon Barrel(s) with Recoil!
      const rx = -this.recoil;
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
      if (this.muzzleFlashTimer > 0) {
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

      // Sub-weapon roof mount
      if (this.subLevel >= 1) {
        if (this.subLevel <= 2) {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 5.5, 16, 2.8);
        } else {
          ctx.fillStyle = this.accentColor;
          ctx.fillRect(-5, 4.5, 10, 7.5);
        }
      }

      // Swaying whip antenna
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-9, -6);
      ctx.lineTo(-16 - this.antennaLag, -9);
      ctx.stroke();

      ctx.restore();
    }
  }

  Tank2D.ALERT_MARK_DURATION = 1.8; // seconds the "!" spotted mark stays up
  Tank2D.KNOCKBACK_DECAY = 7; // 1/s: how fast a knockback shove dies out
  Tank2D.KNOCKBACK_MAX = 420; // px/s cap so stacked blasts can't fling a tank across the map
  global.Tank2D = Tank2D;
})(window);
