(function (global) {
  'use strict';

  // Draws one frame of the battlefield: ground & sky, depth-sorted props / rocks / tanks / flags,
  // effects, night darkness, then the UI layer (compound icons, "!" marks, aim reticle, radar).

  const { FortIcon } = global;

  function create(game) {
    const { world, combat, ctx } = game;
    // Per-frame snapshot (set at the start of render(); the helpers below are only called from it)
    let player = null;
    let viewW = 0;
    let viewH = 0;

    function drawAimReticleAndArc(drawCamX, drawCamY) {
      const activeTarget = game.activeTarget;
      const targetPos = activeTarget ? { x: activeTarget.x, y: activeTarget.y } : game.controls.barrelForwardTarget(340);
      const rp = world.project(targetPos.x, targetPos.y, 0, drawCamX, drawCamY, viewW, viewH);
      if (rp) {
        ctx.save();
        ctx.translate(rp.sx, rp.sy);
        ctx.scale(rp.scale, rp.scale * rp.tiltCos);
        if (activeTarget) {
          // Target Lock-On Diamond
          ctx.rotate(Math.PI * 0.25);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
          ctx.lineWidth = 2.4;
          ctx.strokeRect(-16, -16, 32, 32);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Straight-ahead turret aim ring
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Dotted parabolic trajectory arc from muzzle along turretAngle
      const muzzle = player.getMuzzleWorld();
      const dx = world.deltaX(muzzle.x, targetPos.x);
      const dy = world.deltaY(muzzle.y, targetPos.y);
      const dirX = Math.cos(player.turretAngle);
      const dirY = Math.sin(player.turretAngle);
      const isRail = player.cannonLevel >= 5;
      const gScale = isRail ? 0.3 : 1.0;
      // Same ballistic solution as CombatManager.fireMainCannon so the preview matches the real shell
      const launch = global.CombatManager.computeShellLaunch(muzzle.z, Math.hypot(dx, dy), player.shellSpeed, gScale);
      const T = launch.flightT;
      const vz0 = launch.vz;
      const gravity = global.CombatManager.SHELL_GRAVITY * gScale;

      ctx.fillStyle = activeTarget
        ? 'rgba(248, 113, 113, 0.8)'
        : isRail ? 'rgba(56, 189, 248, 0.55)' : 'rgba(251, 191, 36, 0.45)';
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * T;
        const px = world.wrapX(muzzle.x + dirX * player.shellSpeed * t);
        const py = world.wrapY(muzzle.y + dirY * player.shellSpeed * t);
        const pz = Math.max(0, muzzle.z + vz0 * t - 0.5 * gravity * t * t);
        const sp = world.project(px, py, pz, drawCamX, drawCamY, viewW, viewH);
        if (!sp) continue;
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, 2.2 * sp.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fort icon hovering above a compound centre, tethered to the ground by a dashed line.
    // Red while the garrison waits; pulses red/orange once the compound is on alert.
    function drawBaseFortIcon(base, p, timeSec) {
      const s = Math.max(1.1, Math.min(1.55, p.scale * 1.5));
      const bob = Math.sin(timeSec * 2.2 + base.id * 1.3) * 2.5;
      const iconY = p.sy - (84 * p.scale + 26) + bob;
      if (p.sx < -40 || p.sx > viewW + 40 || iconY < -40 || p.sy > viewH + 60) return;

      const pulse = base.alerted ? 0.5 + 0.5 * Math.sin(timeSec * 9) : 0;
      const fill = base.alerted
        ? `rgb(${Math.round(239 + (249 - 239) * pulse)}, ${Math.round(68 + (115 - 68) * pulse)}, ${Math.round(68 - (68 - 22) * pulse)})`
        : '#ef4444';

      ctx.save();
      // Tether from the icon down to the compound's ground point
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.sx, iconY + 12 * s);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Soft dark disc behind the icon for contrast on bright sand
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.beginPath();
      ctx.ellipse(p.sx, iconY - 3 * s, 21 * s, 18 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(p.sx, iconY);
      ctx.scale(s * (1 + pulse * 0.08), s * (1 + pulse * 0.08));
      FortIcon.draw(ctx, fill);

      // Compound name to the right of the icon
      ctx.font = '800 11px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeText(base.name, 17, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(base.name, 17, 2);
      ctx.restore();
    }

    function render(timeSec, timeInfo) {
      player = game.player;
      viewW = game.view.w;
      viewH = game.view.h;
      ctx.setTransform(game.view.dpr, 0, 0, game.view.dpr, 0, 0);

      // Apply subtle camera shake
      const shakeX = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const shakeY = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const drawCamX = world.wrapX(game.cam.x + shakeX);
      const drawCamY = world.wrapY(game.cam.y + shakeY);

      world.drawBackdropAndGround(ctx, drawCamX, drawCamY, viewW, viewH, timeSec, game.cam.starOffsetX);

      // Collect visible 2D entities and sort back-to-front by depth (dy)
      const renderQueue = [];

      // Off-viewport cull (vertical too: roughly half the wrapped map projects below the screen)
      const offView = (p, m) => p.sx < -m || p.sx > viewW + m || p.sy < -m || p.sy > viewH + m;

      for (const prop of world.props) {
        if (!prop.alive) continue;
        const p = world.project(prop.x, prop.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 60)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawProp(ctx, prop, p, timeSec) });
      }

      for (const obs of world.obstacles) {
        const p = world.project(obs.x, obs.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, obs.radius * 1.25 * p.scale + 20)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawObstacle(ctx, obs, p, drawCamX, drawCamY, viewW, viewH) });
      }

      for (const e of combat.enemies) {
        if (!e.alive) continue;
        const p = world.project(e.x, e.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 120)) continue;
        renderQueue.push({ dy: p.dy, draw: () => e.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
      }

      for (const a of combat.allies) {
        if (!a.alive) continue;
        const p = world.project(a.x, a.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 120)) continue;
        renderQueue.push({ dy: p.dy, draw: () => a.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
      }

      // White flags over captured enemy compounds
      for (const b of combat.bases) {
        if (!b.cleared) continue;
        const p = world.project(b.x, b.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 110 * p.scale + 20)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawWhiteFlag(ctx, p, b.flagRaise || 0, timeSec) });
      }

      if (player.alive) {
        const p = world.project(player.x, player.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (p) {
          renderQueue.push({ dy: p.dy, draw: () => player.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
        }
      }

      renderQueue.sort((a, b) => a.dy - b.dy);
      for (const item of renderQueue) {
        item.draw();
      }

      combat.drawEffectsAndPickups(ctx, drawCamX, drawCamY, viewW, viewH);
      world.drawHorizonHaze(ctx, viewW, viewH);

      const playerGroundProj = player.alive
        ? world.project(player.x, player.y, 0, drawCamX, drawCamY, viewW, viewH)
        : null;
      world.drawNightVisibility(
        ctx, playerGroundProj, player.hullAngle, player.cannonRange,
        player.x, player.y, drawCamX, drawCamY, viewW, viewH
      );

      // Fort icons floating over enemy-held compounds (UI layer: above the night darkness)
      for (const b of combat.bases) {
        if (b.cleared || b.locked) continue;
        const p = world.project(b.x, b.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p) continue;
        drawBaseFortIcon(b, p, timeSec);
      }

      // "!" spotted marks are UI: drawn above the night darkness so they stay readable
      for (const e of combat.enemies) {
        if (e.alive && e.alertMarkTimer > 0) e.drawAlertMark(ctx, drawCamX, drawCamY, viewW, viewH);
      }

      if (game.started && player.alive && !game.dialogs.garage.open) {
        drawAimReticleAndArc(drawCamX, drawCamY);
      }

      game.radar.update(drawCamX, drawCamY);
    }

    return { render };
  }

  global.GameRenderer = { create };
})(window);
