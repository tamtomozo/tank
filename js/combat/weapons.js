(function (global) {
  'use strict';

  // Shooting and damage: main cannon, shells in flight, explosions with knockback,
  // and damage to the player, wingmen, enemies and props.
  // Part of CombatManager (js/combat/combat.js): the methods below are mixed into its prototype.

  const CombatManager = global.CombatManager;
  const { SHELL_GRAVITY } = global.CombatManager.shared;

  const CANNON_RECOIL_KNOCKBACK = 150; // px/s backwards shove when a tank fires its main gun (~21px)
  const HIT_KNOCKBACK_BASE = 110; // px/s shove from being caught in a blast…
  const HIT_KNOCKBACK_PER_DAMAGE = 3.2; // …plus this much per point of damage taken
  const AMMO_PER_KILL = 2; // shells salvaged from a destroyed enemy tank (limited-ammo operation)

  class CombatWeapons {
    // A shot by the player for the accuracy statistic (final once the area is secured, so firing
    // on the drive back to HQ doesn't lower the accuracy)
    _countShot() {
      if (!this.missionComplete) this.stats.shotsFired += 1;
    }

    // targetZ: height of the target (a turret on a highway deck)
    fireMainCannon(tank, targetX, targetY, targetZ = 0) {
      if (tank.reloadTimer > 0 || !tank.alive) return false;
      // Limited ammunition (operation.ammo): the player's gun stays silent once it runs dry
      if (tank.isPlayer && this.ammo != null) {
        if (this.ammo <= 0) {
          if (!this._dryReported) {
            this._dryReported = true;
            this.events.push({ type: 'outOfAmmo' });
          }
          return false;
        }
        this.ammo -= 1;
        this._dryReported = false;
      }
      tank.reloadTimer = tank.reloadTime;
      tank.triggerFireEffects();

      const muzzle = tank.getMuzzleWorld();
      // Firing shock: the whole tank is shoved back opposite the barrel (not a soldier's rocket)
      if (!tank.isInfantry) tank.applyKnockback(-muzzle.dirX, -muzzle.dirY, CANNON_RECOIL_KNOCKBACK);
      else tank.muzzleFlashTimer = 0.22; // longer back-blast
      const isRail = tank.isPlayer && tank.cannonLevel >= 5;

      // Calculate exact parabolic vz to land at target distance
      let rawDist = 360;
      if (targetX !== undefined && targetY !== undefined) {
        const dx = this.world.deltaX(muzzle.x, targetX);
        const dy = this.world.deltaY(muzzle.y, targetY);
        rawDist = Math.hypot(dx, dy);
      }
      const gScale = isRail ? 0.3 : 1.0;
      const launch = CombatManager.computeShellLaunch(muzzle.z, rawDist, tank.shellSpeed, gScale, targetZ);

      const friendly = tank.isPlayer || tank.isAlly;
      if (tank.isPlayer) this._countShot();
      this.projectiles.push({
        kind: 'cannon',
        fromPlayer: friendly, // "player side": player and wingmen
        source: tank.isPlayer ? 'player' : tank.isAlly ? 'ally' : 'enemy',
        rocket: !!tank.isInfantry, // anti-tank rocket (cage armour stops much of it)

        x: muzzle.x,
        y: muzzle.y,
        z: muzzle.z,
        vx: muzzle.dirX * tank.shellSpeed,
        vy: muzzle.dirY * tank.shellSpeed,
        vz: launch.vz,
        gScale,
        damage: tank.damage,
        splashRadius: tank.splashRadius,
        color: tank.isPlayer ? (isRail ? '#38bdf8' : '#fbbf24') : tank.isAlly ? '#a3e635' : tank.isInfantry ? '#fb923c' : '#f87171',
        radius: tank.isBoss ? 7 : tank.isInfantry ? 3.5 : 5,
        life: 2.6,
        trailTimer: 0
      });

      this.spawnDustOrSmoke(muzzle.x, muzzle.y, muzzle.z, 5, friendly ? '#fef08a' : '#fca5a5');

      if (tank.isPlayer) {
        this.audio.playCannon(1 + (tank.damage - 40) / 100);
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.45);
      } else {
        this.audio.playCannon(tank.isAlly ? 0.5 : 0.6);
      }
      return true;
    }

    // source: 'player' | 'ally' | 'enemy' | 'rocket' (an infantry rocket) | null (who caused the
    // blast). Returns enemies damaged.
    explodeAt(x, y, radius, damage, fromPlayer, player, isDirect = false, source = null) {
      const wx = this.world.wrapX(x);
      const wy = this.world.wrapY(y);
      this.world.addScorchMark(wx, wy, Math.max(12, radius * 0.42));

      this.shockwaves.push({
        x: wx,
        y: wy,
        radius: 6,
        targetRadius: radius * 1.05,
        color: fromPlayer ? '#fbbf24' : '#f87171',
        life: 0.26,
        maxLife: 0.26
      });

      this.spawnImpactBlast(wx, wy, radius, isDirect);

      if (player) {
        const dx = this.world.deltaX(wx, player.x);
        const dy = this.world.deltaY(wy, player.y);
        const distToPlayer = Math.hypot(dx, dy);
        if (distToPlayer < 420) {
          this.shakeIntensity = Math.max(this.shakeIntensity, Math.max(0.2, (1 - distToPlayer / 420) * 0.85));
        }
      }
      this.audio.playExplosion(radius * 0.02);

      // Purely cosmetic death blasts (damage 0) must not "hit" nearby tanks/props (avoids hit-sound spam)
      if (damage <= 0) return 0;

      // The platoon's shells set off the IEDs they reach (js/combat/city.js)
      if (fromPlayer && this.ieds && this.ieds.length > 0) this._blastIeds(wx, wy, radius);

      // Cage armour (equipment): takes the edge off near misses (not direct hits) and stops much
      // of an infantry rocket, direct hits included
      const guardOf = (t) => {
        if (!t.splashGuard) return 1;
        if (source === 'rocket') return 0.45;
        return isDirect ? 1 : 1 - t.splashGuard;
      };

      let enemiesHit = 0;
      if (fromPlayer) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const dx = this.world.deltaX(wx, e.x);
          const dy = this.world.deltaY(wy, e.y);
          const d = Math.hypot(dx, dy);
          if (d < radius + e.radius) {
            const falloff = Math.max(0.35, 1 - d / (radius + e.radius + 8));
            this.damageEnemy(e, damage * falloff, source);
            this._blastKnockback(e, dx, dy, damage * falloff);
            enemiesHit += 1;
          }
        }
      }

      for (const prop of this.world.props) {
        if (!prop.alive) continue;
        const dx = this.world.deltaX(wx, prop.x);
        const dy = this.world.deltaY(wy, prop.y);
        if (Math.hypot(dx, dy) < radius + prop.radius) {
          this.damageProp(prop, damage, player, source);
        }
      }

      if (!fromPlayer && player && player.alive) {
        const dx = this.world.deltaX(wx, player.x);
        const dy = this.world.deltaY(wy, player.y);
        const d = Math.hypot(dx, dy);
        if (d < radius + player.radius) {
          const falloff = Math.max(0.35, 1 - d / (radius + player.radius + 8));
          this.damagePlayer(player, damage * falloff * guardOf(player));
          this._blastKnockback(player, dx, dy, damage * falloff);
        }
      }

      if (!fromPlayer) {
        for (const a of this.allies) {
          if (!a.alive) continue;
          const adx = this.world.deltaX(wx, a.x);
          const ady = this.world.deltaY(wy, a.y);
          const d = Math.hypot(adx, ady);
          if (d < radius + a.radius) {
            const falloff = Math.max(0.35, 1 - d / (radius + a.radius + 8));
            this.damageAlly(a, damage * falloff * guardOf(a));
            this._blastKnockback(a, adx, ady, damage * falloff);
          }
        }
        // The collaborator on the way to the tunnel (js/combat/city.js)
        const eu = this.escortUnit();
        if (eu) {
          const d = Math.hypot(this.world.deltaX(wx, eu.x), this.world.deltaY(wy, eu.y));
          if (d < radius + eu.radius) this._damageEscort(damage * Math.max(0.35, 1 - d / (radius + eu.radius + 8)));
        }
      }
      return enemiesHit;
    }

    // Shove a tank caught in a blast away from its centre; (dx, dy) = blast → tank.
    // A dead-centre hit has no direction, so pick a random one.
    _blastKnockback(tank, dx, dy, damage) {
      if (!tank || !tank.alive || !tank.applyKnockback) return;
      if (Math.hypot(dx, dy) < 2) {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a);
      }
      tank.applyKnockback(dx, dy, HIT_KNOCKBACK_BASE + damage * HIT_KNOCKBACK_PER_DAMAGE);
    }

    damageAlly(ally, amount) {
      if (!ally.alive) return;
      ally.hp = Math.max(0, ally.hp - amount * (1 - ally.armorReduction));
      this.audio.playHit();
      if (ally.hp <= 0) {
        ally.alive = false;
        this.stats.alliesLost += 1;
        this.explodeAt(ally.x, ally.y, 80, 0, true, this._playerRef, true);
      }
    }

    // Nearest living friendly (player, wingman or the collaborator being escorted) to (x, y)
    nearestFriendly(x, y, player) {
      let best = player && player.alive ? player : null;
      let bestD = best ? Math.hypot(this.world.deltaX(x, best.x), this.world.deltaY(y, best.y)) : Infinity;
      const eu = this.escortUnit();
      for (const a of eu ? [...this.allies, eu] : this.allies) {
        if (!a.alive) continue;
        const d = Math.hypot(this.world.deltaX(x, a.x), this.world.deltaY(y, a.y));
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    }

    damagePlayer(player, amount) {
      if (!player.alive) return;
      const mitigated = amount * (1 - player.armorReduction);
      this.stats.damageTaken += Math.min(player.hp, mitigated);
      player.hp = Math.max(0, player.hp - mitigated);
      this.damageFlash = 1.0;
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.75);
      this.audio.playHit();
      if (player.hp <= 0) {
        player.alive = false;
        this.explodeAt(player.x, player.y, 90, 0, true, player, true);
      }
    }

    damageEnemy(enemy, amount, source = null) {
      if (!enemy.alive) return;
      // Attacking a parked unit alerts its whole compound
      if (enemy.state === 'idle') this.alertBase(this.bases[enemy.baseId]);
      enemy.hp -= amount;
      this.audio.playHit();
      if (enemy.hp <= 0) {
        enemy.alive = false;
        this.kills += 1;
        this.stats.killsByKind[enemy.kind] = (this.stats.killsByKind[enemy.kind] || 0) + 1;
        const by = source === 'player' ? 'player' : source === 'ally' ? 'ally' : 'other';
        this.stats.killsBy[by] += 1;
        this.explodeAt(enemy.x, enemy.y, 68 * enemy.scale, 0, true, this._playerRef, true);
        this.spawnPickup(enemy.x, enemy.y, 'scrap', enemy.scrapValue);
        // No repair kits on an operation without supply (operation.noSupply)
        const noSupply = this.operation && this.operation.noSupply;
        if (!noSupply && (Math.random() < 0.35 || enemy.isBoss)) {
          this.spawnPickup(enemy.x, enemy.y, 'repair', enemy.isBoss ? 45 : 22);
        }
        this._onEnemyKilled(enemy);
      }
    }

    // Any enemy lost (shot or through the ice): with limited ammunition, shells are salvaged from it
    _onEnemyKilled(enemy) {
      if (this.ammo != null && !enemy.isBunker) {
        this.ammo = Math.min(this.ammoMax, this.ammo + AMMO_PER_KILL);
      }
    }

    damageProp(prop, amount, player, source = null) {
      if (!prop.alive) return;
      prop.hp -= amount;
      if (prop.hp <= 0) {
        prop.alive = false;
        if (prop.type === 'barrel') {
          this.explodeAt(prop.x, prop.y, 92, 55, true, player, true, source);
          if (player && player.alive) {
            const d = Math.hypot(this.world.deltaX(prop.x, player.x), this.world.deltaY(prop.y, player.y));
            if (d < 92) {
              this.damagePlayer(player, 24 * (1 - d / 92));
              this._blastKnockback(player, this.world.deltaX(prop.x, player.x), this.world.deltaY(prop.y, player.y), 24 * (1 - d / 92));
            }
          }
        } else {
          this.spawnDustOrSmoke(prop.x, prop.y, 8, 8, prop.type === 'crystal' ? '#38bdf8' : '#f59e0b');
          this.spawnPickup(prop.x, prop.y, 'scrap', prop.scrap);
          if (prop.type === 'crate' && Math.random() < 0.45) {
            this.spawnPickup(prop.x, prop.y, 'repair', 20);
          }
          this.audio.playExplosion(0.5);
        }
      }
    }

    _updateProjectiles(dt, player) {
      const keep = [];

      for (const p of this.projectiles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        const src = p.rocket ? 'rocket' : p.source; // who the blast is from (cage armour vs rockets)

        p.vz -= SHELL_GRAVITY * p.gScale * dt;
        p.x = this.world.wrapX(p.x + p.vx * dt);
        p.y = this.world.wrapY(p.y + p.vy * dt);
        p.z += p.vz * dt;

        p.trailTimer += dt;
        if (p.trailTimer > 0.055) {
          p.trailTimer = 0;
          this.spawnDustOrSmoke(p.x, p.y, p.z, 1, p.color);
        }

        let hit = false;

        // Enemy collision (a turret on a highway deck stands at the deck height)
        if (p.fromPlayer) {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const ez = e.z || 0;
            if (p.z > ez + 46 || p.z < ez - 30) continue;
            const dx = this.world.deltaX(p.x, e.x);
            const dy = this.world.deltaY(p.y, e.y);
            if (Math.hypot(dx, dy) < e.radius + 9) {
              hit = true;
              if (p.source === 'player') this.stats.shotsHit += 1;
              this.explodeAt(p.x, p.y, p.splashRadius, p.damage, true, player, true, p.source);
              break;
            }
          }
        } else if (!p.fromPlayer) {
          const struck = (t) => t.alive && p.z < t.z + 34 &&
            Math.hypot(this.world.deltaX(p.x, t.x), this.world.deltaY(p.y, t.y)) < t.radius + 8;
          const eu = this.escortUnit();
          if (struck(player) || this.allies.some(struck) || (eu && struck(eu))) {
            hit = true;
            this.explodeAt(p.x, p.y, p.splashRadius, p.damage, false, player, true, src);
          }
        }

        // Prop collision
        if (!hit && p.fromPlayer && p.z < 34) {
          for (const prop of this.world.props) {
            if (!prop.alive) continue;
            const dx = this.world.deltaX(p.x, prop.x);
            const dy = this.world.deltaY(p.y, prop.y);
            if (Math.hypot(dx, dy) < prop.radius + 8) {
              hit = true;
              if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, true, player, false, p.source) > 0 &&
                  p.source === 'player') {
                this.stats.shotsHit += 1;
              }
              break;
            }
          }
        }

        // Boulder impact (rocks are big now, so shells must not fly straight through them)
        if (!hit) {
          for (const obs of this.world.obstacles) {
            const dx = this.world.deltaX(obs.x, p.x);
            const dy = this.world.deltaY(obs.y, p.y);
            const rSq = obs.radius * obs.radius;
            const dSq = dx * dx + dy * dy;
            if (dSq >= rSq) continue;
            const surfaceZ = obs.height * (1 - dSq / rSq); // dome-shaped hit profile
            if (p.z < surfaceZ) {
              hit = true;
              if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, p.fromPlayer, player, false, src) > 0 &&
                  p.source === 'player') {
                this.stats.shotsHit += 1;
              }
              break;
            }
          }
        }

        // Building impact (towns, highway, factory): walls stop shells below the roof line. The
        // platoon's shells wear civilian buildings down; any shell can set off a fuel tank
        // (js/combat/city.js)
        if (!hit && this.world.structures.length > 0) {
          const st = this.world.structureHit(p.x, p.y, p.z);
          if (st) {
            hit = true;
            if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, p.fromPlayer, player, false, src) > 0 &&
                p.source === 'player') {
              this.stats.shotsHit += 1;
            }
            if (st.hp != null && (p.fromPlayer || st.fuel)) this._damageStructure(st, p.damage, p.source);
          }
        }

        // Ground impact
        if (!hit && p.z <= 0) {
          hit = true;
          if (this.explodeAt(p.x, p.y, p.splashRadius, p.damage, p.fromPlayer, player, false, src) > 0 &&
              p.source === 'player') {
            this.stats.shotsHit += 1; // near miss whose splash still caught an enemy
          }
        }

        if (!hit) keep.push(p);
      }

      this.projectiles = keep;
    }
  }

  global.TankUtil.mixin(global.CombatManager, CombatWeapons);
})(window);
