(function (global) {
  'use strict';

  // Draws one frame of the battlefield: ground & sky, depth-sorted props / rocks / tanks / flags,
  // effects, night darkness, then the UI layer (compound / HQ icons, "!" marks, aim reticle, radar).

  const { FortIcon, HqIcon } = global;

  function create(game) {
    const { world, combat, ctx } = game;
    // Per-frame snapshot (set at the start of render(); the helpers below are only called from it)
    let player = null;
    let viewW = 0;
    let viewH = 0;
    let frameNo = 0;

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

    // Icon glyphs and name labels are painted once into small sprites and stamped from there.
    // They bob and throb, i.e. are drawn at a slightly different size every frame, and outlined
    // text in particular is expensive to rasterise afresh at each size.
    const SPRITE_RES = 6; // sprite pixels per icon unit (fort icons show at up to ~3x on 2x screens)
    const ICON_BOX = { x: -20, y: -24, w: 40, h: 44 }; // glyph bounds incl. outline (icon units)
    const LABEL_FONT = '800 11px system-ui, "Segoe UI", sans-serif';
    const sprites = new Map();

    function iconSprite(icon, fill) {
      const key = `${icon === FortIcon ? 'fort' : 'hq'}|${fill}`;
      let sprite = sprites.get(key);
      if (!sprite) {
        sprite = document.createElement('canvas');
        sprite.width = ICON_BOX.w * SPRITE_RES;
        sprite.height = ICON_BOX.h * SPRITE_RES;
        const g = sprite.getContext('2d');
        g.setTransform(SPRITE_RES, 0, 0, SPRITE_RES, -ICON_BOX.x * SPRITE_RES, -ICON_BOX.y * SPRITE_RES);
        icon.draw(g, fill);
        sprites.set(key, sprite);
      }
      return sprite;
    }

    // White name with a dark outline; drawn with its left edge at x = 17, centred on y = 2
    function labelSprite(text) {
      const key = `label|${text}`;
      let entry = sprites.get(key);
      if (!entry) {
        const pad = 3;
        const h = 18;
        const canvas = document.createElement('canvas');
        let g = canvas.getContext('2d');
        g.font = LABEL_FONT;
        const w = Math.ceil(g.measureText(text).width) + pad * 2;
        canvas.width = w * SPRITE_RES;
        canvas.height = h * SPRITE_RES;
        g = canvas.getContext('2d');
        g.setTransform(SPRITE_RES, 0, 0, SPRITE_RES, pad * SPRITE_RES, (h / 2) * SPRITE_RES);
        g.font = LABEL_FONT;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        g.strokeText(text, 0, 0);
        g.fillStyle = '#ffffff';
        g.fillText(text, 0, 0);
        entry = { canvas, x: 17 - pad, y: 2 - h / 2, w, h };
        sprites.set(key, entry);
      }
      return entry;
    }

    // Icon hovering above a ground point (projection p), tethered to it by a dashed line, with a
    // name to its right. o: { icon (FortIcon / HqIcon), fill, label, lift (world units above the
    // ground), phase (bob offset), pulse (0..1 size throb), fill2 (optional second colour the
    // icon fades to and from with the pulse), size (optional: a size factor that replaces the
    // perspective size, so the icon's size follows only that factor) }
    function drawFloatingIcon(p, timeSec, o) {
      const size = o.size ?? 1;
      // perspective size: at the icon's own point, or (with o.size) at the screen centre, which
      // only depends on the screen size
      const refScale = o.size == null ? p.scale : centreScale();
      const s = Math.max(1.1, Math.min(1.55, refScale * 1.5)) * size;
      const bob = Math.sin(timeSec * 2.2 + o.phase) * 2.5;
      const iconY = p.sy - (o.lift * p.scale + 26 * size) + bob;
      if (p.sx < -40 || p.sx > viewW + 40 || iconY < -40 || p.sy > viewH + 60) return;
      const { pulse, fill } = o;

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
      ctx.drawImage(iconSprite(o.icon, fill), ICON_BOX.x, ICON_BOX.y, ICON_BOX.w, ICON_BOX.h);
      if (o.fill2 && pulse > 0.01) {
        ctx.globalAlpha = pulse;
        ctx.drawImage(iconSprite(o.icon, o.fill2), ICON_BOX.x, ICON_BOX.y, ICON_BOX.w, ICON_BOX.h);
        ctx.globalAlpha = 1;
      }

      // Name to the right of the icon
      const label = labelSprite(o.label);
      ctx.drawImage(label.canvas, label.x, label.y, label.w, label.h);
      ctx.restore();
    }

    // Projection scale at the screen centre (changes only with the screen size)
    let centreScaleCache = { h: -1, scale: 1 };
    function centreScale() {
      if (centreScaleCache.h !== viewH) {
        const c = world.projectDelta(0, 0, 0, viewW, viewH);
        centreScaleCache = { h: viewH, scale: c ? c.scale : 1 };
      }
      return centreScaleCache.scale;
    }

    // Fort icon size by the player's distance to the compound, so two forts can be compared at a
    // glance: largest (FORT_SIZE_MAX) from FORT_PEAK inwards (a little outside the line where the
    // garrison notices the player, ALERT_RADIUS = 650 in combat/bases.js), then linearly smaller
    // outwards, down to FORT_SIZE_FAR at FORT_FAR (about the farthest an on-screen fort can be)
    // and on until the floor FORT_SIZE_MIN
    const FORT_PEAK = 1000;
    const FORT_SIZE_MAX = 1.8;
    const FORT_FAR = 1300;
    const FORT_SIZE_FAR = 0.6;
    const FORT_SIZE_SLOPE = (FORT_SIZE_MAX - FORT_SIZE_FAR) / (FORT_FAR - FORT_PEAK);
    const FORT_SIZE_MIN = 0.45;

    // Fort icon above a compound centre; the closer the player, the bigger.
    // Red while the garrison waits; pulses red/orange once the compound is on alert.
    function drawBaseFortIcon(base, p, timeSec) {
      const pulse = base.alerted ? 0.5 + 0.5 * Math.sin(timeSec * 9) : 0;
      const dist = Math.hypot(world.deltaX(player.x, base.x), world.deltaY(player.y, base.y));
      const beyond = Math.max(0, dist - FORT_PEAK);
      const size = Math.max(FORT_SIZE_MIN, FORT_SIZE_MAX - beyond * FORT_SIZE_SLOPE);
      drawFloatingIcon(p, timeSec, {
        icon: FortIcon,
        fill: '#ef4444',
        fill2: base.alerted ? '#f97316' : null, // rgb(239, 68, 68) <-> rgb(249, 115, 22)
        label: base.name,
        lift: 84,
        phase: base.id * 1.3,
        pulse,
        size
      });
    }

    // Area secured and the player not yet back: the HQ is the place to go
    const isReturning = () => combat.missionComplete && !game.returnedToHq;

    // HQ icon above the command tent of the operations HQ; throbs while the platoon is called home
    function drawHqMarker(timeSec, drawCamX, drawCamY) {
      const m = world.hq.marker;
      const p = world.project(m.x, m.y, 0, drawCamX, drawCamY, viewW, viewH);
      if (!p) return;
      const pulse = isReturning() ? 0.5 + 0.5 * Math.sin(timeSec * 6) : 0;
      drawFloatingIcon(p, timeSec, { icon: HqIcon, fill: HqIcon.COLOR, label: world.hq.name, lift: m.lift, phase: 0.7, pulse });
    }

    // Return circle on the HQ pad (over the painted one), lit while the platoon is called home
    function drawHqReturnZone(timeSec, drawCamX, drawCamY, offView) {
      const hq = world.hq;
      const p = world.project(hq.x, hq.y, 0, drawCamX, drawCamY, viewW, viewH);
      if (!p || offView(p, hq.returnRadius * p.scale + 20)) return;
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(p.scale, p.scale * p.tiltCos);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.10 + 0.08 * pulse})`;
      ctx.strokeStyle = `rgba(125, 211, 252, ${0.6 + 0.35 * pulse})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -timeSec * 14;
      ctx.beginPath();
      ctx.arc(0, 0, hq.returnRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    function render(timeSec, timeInfo) {
      player = game.player;
      viewW = game.view.w;
      viewH = game.view.h;
      ctx.setTransform(game.view.dpr, 0, 0, game.view.dpr, 0, 0);
      global.Tank2D.pixelRatio = game.view.dpr;

      // Apply subtle camera shake
      const shakeX = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const shakeY = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const drawCamX = world.wrapX(game.cam.x + shakeX);
      const drawCamY = world.wrapY(game.cam.y + shakeY);

      world.drawBackdropAndGround(ctx, drawCamX, drawCamY, viewW, viewH, timeSec, game.cam.starOffsetX, game.view.dpr);

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

      // Operations HQ: tent, crates, flag and radio mast (its pad is part of the ground texture);
      // the return circle is drawn now so it lies under everything in the depth-sorted queue
      if (isReturning()) drawHqReturnZone(timeSec, drawCamX, drawCamY, offView);
      for (const part of world.hq.parts) {
        const p = world.project(part.x, part.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 150 * p.scale + 20)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawHqPart(ctx, part, p, timeSec, drawCamX, drawCamY, viewW, viewH) });
      }

      // White flags over captured enemy compounds
      const zoneR = global.GameMission.SUPPLY_ZONE.SUPPLY_PROMPT_RADIUS;
      for (const b of combat.bases) {
        if (!b.cleared) continue;
        const p = world.project(b.x, b.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 110 * p.scale + 20)) continue;
        // Supply-depot zone ring on the ground (secured districts only); drawn now so it lies under
        // everything in the depth-sorted queue. Brighter while the menu is ready to be offered.
        const district = combat.districts[b.districtId];
        if (district && district.secured) {
          const ready = b.supplyArmed !== false;
          const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
          ctx.save();
          ctx.translate(p.sx, p.sy);
          ctx.scale(p.scale, p.scale * p.tiltCos);
          ctx.fillStyle = `rgba(74, 222, 128, ${ready ? 0.10 + 0.06 * pulse : 0.05})`;
          ctx.strokeStyle = `rgba(134, 239, 172, ${ready ? 0.55 + 0.3 * pulse : 0.3})`;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([10, 7]);
          ctx.lineDashOffset = -timeSec * 14;
          ctx.beginPath();
          ctx.arc(0, 0, zoneR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
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
      drawHqMarker(timeSec, drawCamX, drawCamY);

      // "!" spotted marks are UI: drawn above the night darkness so they stay readable
      for (const e of combat.enemies) {
        if (e.alive && e.alertMarkTimer > 0) e.drawAlertMark(ctx, drawCamX, drawCamY, viewW, viewH);
      }

      if (game.started && player.alive && !game.dialogs.garage.open) {
        drawAimReticleAndArc(drawCamX, drawCamY);
      }

      // Radar and off-screen markers move slowly: redrawing them every other frame is enough
      if ((frameNo++ & 1) === 0) game.radar.update(drawCamX, drawCamY);
    }

    return { render };
  }

  global.GameRenderer = { create };
})(window);
