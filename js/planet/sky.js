(function (global) {
  'use strict';

  // Sky, horizon backdrop and ground for one frame (day/night palette), plus the haze along the horizon.
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { lerp } = global.TankUtil;
  const { wrapCoord } = global.HorizonWorld.shared;

  class WorldSky {
    // pixelRatio: canvas pixels per CSS pixel of ctx (its base transform is that uniform scale)
    drawBackdropAndGround(ctx, camX, camY, viewW, viewH, timeSec, starOffsetX = 0, pixelRatio = 1) {
      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.24;
      const pal = this.getPalette();

      // 1. Time-of-Day Sky above horizon
      const skyGrad = ctx.createLinearGradient(0, 0, 0, Math.max(80, horizonY + 30));
      skyGrad.addColorStop(0, pal.skyTop);
      skyGrad.addColorStop(0.62, pal.skyMid);
      skyGrad.addColorStop(1, pal.skyHor);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, viewW, Math.max(0, horizonY + 40));

      // Stars (fade out during bright day, shine at twilight/night)
      if (pal.starAlpha > 0.02) {
        for (const s of this.stars) {
          const sx = wrapCoord(s.nx * viewW - starOffsetX, viewW);
          const sy = s.ny * Math.max(120, horizonY);
          if (sy > horizonY - 4) continue;
          const alpha = (0.45 + 0.5 * Math.sin(timeSec * 2.2 + s.twinklePhase)) * pal.starAlpha;
          ctx.fillStyle = s.color;
          ctx.globalAlpha = Math.max(0.05, alpha);
          ctx.beginPath();
          ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Alternating single Sun (0.23..0.77) and single Moon (0.77..0.23) across the horizon arc
      const isDayArc = this.dayTime >= 0.23 && this.dayTime <= 0.77;
      const bodyProgress = isDayArc
        ? (this.dayTime - 0.23) / 0.54
        : (this.dayTime >= 0.77 ? (this.dayTime - 0.77) / 0.46 : (this.dayTime + 0.23) / 0.46);
      const clampedProg = Math.max(0, Math.min(1, bodyProgress));
      const arcHeight = Math.sin(clampedProg * Math.PI);
      const bx = viewW * (0.14 + clampedProg * 0.72);
      const by = horizonY + 18 - arcHeight * Math.max(92, horizonY * 0.76);

      if (by < horizonY + 20) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, viewW, horizonY);
        ctx.clip();

        if (isDayArc) {
          const haloR = 72 + (1 - arcHeight) * 32;
          const sunGlow = ctx.createRadialGradient(bx, by, 8, bx, by, haloR);
          sunGlow.addColorStop(0, 'rgba(254, 249, 195, 0.96)');
          sunGlow.addColorStop(0.28, arcHeight < 0.25 ? 'rgba(251, 146, 60, 0.55)' : 'rgba(253, 224, 71, 0.42)');
          sunGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
          ctx.fillStyle = sunGlow;
          ctx.beginPath();
          ctx.arc(bx, by, haloR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = arcHeight < 0.22 ? '#fed7aa' : '#fef9c3';
          ctx.beginPath();
          ctx.arc(bx, by, 17, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const moonHaloR = 54 + (1 - arcHeight) * 16;
          const moonGlow = ctx.createRadialGradient(bx, by, 6, bx, by, moonHaloR);
          moonGlow.addColorStop(0, 'rgba(241, 245, 249, 0.55)');
          moonGlow.addColorStop(0.4, 'rgba(186, 230, 253, 0.22)');
          moonGlow.addColorStop(1, 'rgba(148, 163, 184, 0)');
          ctx.fillStyle = moonGlow;
          ctx.beginPath();
          ctx.arc(bx, by, moonHaloR, 0, Math.PI * 2);
          ctx.fill();

          const moonDisc = ctx.createRadialGradient(bx - 5, by - 5, 3, bx, by, 16);
          moonDisc.addColorStop(0, '#f8fafc');
          moonDisc.addColorStop(0.7, '#cbd5e1');
          moonDisc.addColorStop(1, '#94a3b8');
          ctx.fillStyle = moonDisc;
          ctx.beginPath();
          ctx.arc(bx, by, 16, 0, Math.PI * 2);
          ctx.fill();

          // Subtle lunar craters
          ctx.fillStyle = 'rgba(100, 116, 139, 0.32)';
          ctx.beginPath();
          ctx.arc(bx - 4, by - 3, 4.2, 0, Math.PI * 2);
          ctx.arc(bx + 5, by + 4, 3.0, 0, Math.PI * 2);
          ctx.arc(bx + 3, by - 6, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 2. Distant Wasteland Mesas & Atmospheric Horizon Glow
      const [rr, rg, rb] = pal.rim;
      const [fr, fg, fb] = pal.gFarRgb;
      const [shr, shg, shb] = pal.skyHorRgb;
      for (const layer of this.horizonRidges) {
        const mr = Math.round(lerp(fr, shr, layer.skyMix));
        const mg = Math.round(lerp(fg, shg, layer.skyMix));
        const mb = Math.round(lerp(fb, shb, layer.skyMix));
        const pts = layer.points;
        const n = pts.length;
        const shift = wrapCoord(camX * layer.parallax, viewW);

        ctx.fillStyle = `rgb(${mr}, ${mg}, ${mb})`;
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 8);
        const segs = 36;
        for (let i = 0; i <= segs; i++) {
          const sx = (i / segs) * viewW;
          const u = ((sx + shift) % viewW) / viewW;
          const fIdx = u * n;
          const i0 = Math.floor(fIdx) % n;
          const i1 = (i0 + 1) % n;
          const h = lerp(pts[i0], pts[i1], fIdx - Math.floor(fIdx));
          ctx.lineTo(sx, horizonY - h);
        }
        ctx.lineTo(viewW, horizonY + 8);
        ctx.closePath();
        ctx.fill();
      }

      const rimGrad = ctx.createLinearGradient(0, horizonY - 48, 0, horizonY + 26);
      rimGrad.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, 0)`);
      rimGrad.addColorStop(0.68, `rgba(${rr}, ${rg}, ${rb}, 0.30)`);
      rimGrad.addColorStop(1, `rgba(${rr}, ${rg}, ${rb}, 0.06)`);
      ctx.fillStyle = rimGrad;
      ctx.fillRect(0, horizonY - 48, viewW, 74);

      // 3. Wasteland Ground Surface with soft blurred horizon edge (no hard line)
      const groundTop = horizonY - 10;
      const groundGrad = ctx.createLinearGradient(0, groundTop, 0, viewH);
      groundGrad.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, 0)`);
      groundGrad.addColorStop(0.035, pal.gFar);
      groundGrad.addColorStop(0.32, pal.gMid);
      groundGrad.addColorStop(1, pal.gNear);
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundTop, viewW, viewH - groundTop);

      // Clip terrain decals smoothly at the blurred horizon edge
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, horizonY, viewW, viewH - horizonY);
      ctx.clip();

      // 4. All static ground decals (patches, mud flats, gullies, gravel, brush)
      //    drawn from the baked world texture, projected row by row
      this._drawGroundTexture(ctx, camX, camY, viewW, viewH, pixelRatio);

      // 7. Scorch Decals & Caterpillar Tread Marks
      // (hundreds of these are on screen: one fill colour with a per-mark alpha and a directly
      // set transform instead of save / translate / scale / rotate / restore for each)
      const pr = pixelRatio;
      ctx.fillStyle = 'rgb(15, 13, 12)';
      for (const sm of this.scorchMarks) {
        const p = this.project(sm.x, sm.y, 0, camX, camY, viewW, viewH);
        if (!p || this._isOffscreen(p, sm.radius * p.scale + 2, viewW, viewH)) continue;
        ctx.globalAlpha = 0.55 * sm.life;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, sm.radius * p.scale, sm.radius * p.scale * p.tiltCos, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgb(22, 18, 14)';
      for (const tm of this.treadMarks) {
        const p = this.project(tm.x, tm.y, 0, camX, camY, viewW, viewH);
        if (!p || this._isOffscreen(p, 10, viewW, viewH)) continue;
        // translate(p.sx, p.sy) · scale(p.scale, p.scale * p.tiltCos) · rotate(tm.angle)
        const kx = p.scale * pr;
        const ky = p.scale * p.tiltCos * pr;
        ctx.setTransform(kx * tm.cos, ky * tm.sin, -kx * tm.sin, ky * tm.cos, p.sx * pr, p.sy * pr);
        ctx.globalAlpha = 0.46 * tm.life;
        ctx.fillRect(-4, -3, 8, 6);
      }
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      ctx.globalAlpha = 1;

      // 8. Boost Jump Ramps
      for (const ramp of this.ramps) {
        const p = this.project(ramp.x, ramp.y, 0, camX, camY, viewW, viewH);
        if (!p || this._isOffscreen(p, ramp.radius * p.scale + 4, viewW, viewH)) continue;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(p.scale, p.scale * p.tiltCos);
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, ramp.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Pulsing chevron ring
        const pulse = 0.45 + 0.55 * Math.abs(Math.sin(timeSec * 3.5));
        ctx.strokeStyle = `rgba(56, 189, 248, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, ramp.radius * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
      return horizonY;
    }

    // Soft atmospheric dust/mist band along the horizon AND left/right map edges so distant borders blend smoothly day & night
    drawHorizonHaze(ctx, viewW, viewH) {
      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.24;
      const pal = this.getPalette();

      const hr = Math.round(pal.skyHorRgb[0] * 0.55 + pal.gFarRgb[0] * 0.45);
      const hg = Math.round(pal.skyHorRgb[1] * 0.55 + pal.gFarRgb[1] * 0.45);
      const hb = Math.round(pal.skyHorRgb[2] * 0.55 + pal.gFarRgb[2] * 0.45);

      const topY = horizonY - 40;
      const botY = horizonY + 92;
      const hazeGrad = ctx.createLinearGradient(0, topY, 0, botY);
      hazeGrad.addColorStop(0.0, `rgba(${hr}, ${hg}, ${hb}, 0)`);
      hazeGrad.addColorStop(0.26, `rgba(${hr}, ${hg}, ${hb}, 0.62)`);
      hazeGrad.addColorStop(0.36, `rgba(${hr}, ${hg}, ${hb}, 0.74)`);
      hazeGrad.addColorStop(0.62, `rgba(${hr}, ${hg}, ${hb}, 0.30)`);
      hazeGrad.addColorStop(1.0, `rgba(${hr}, ${hg}, ${hb}, 0)`);

      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, topY, viewW, botY - topY);

      // Left & right map edge soft atmospheric blur/mist (active day and night)
      if (typeof document === 'undefined') return;
      const cw = Math.max(1, Math.round(viewW * 0.25));
      const ch = Math.max(1, Math.round(viewH * 0.25));
      if (!this._sideHazeCanvas) {
        this._sideHazeCanvas = document.createElement('canvas');
        this._sideHazeCtx = this._sideHazeCanvas.getContext('2d');
      }
      // The mist only changes with the viewport and the haze colour (which moves a step at a time
      // as the day goes by): repaint it then, otherwise reuse the picture from the last frame
      const hazeKey = `${cw}x${ch}|${hr},${hg},${hb}|${horizonY.toFixed(1)}`;
      if (this._sideHazeKey === hazeKey) {
        ctx.drawImage(this._sideHazeCanvas, 0, 0, viewW, viewH);
        return;
      }
      this._sideHazeKey = hazeKey;
      if (this._sideHazeCanvas.width !== cw || this._sideHazeCanvas.height !== ch) {
        this._sideHazeCanvas.width = cw;
        this._sideHazeCanvas.height = ch;
      }

      const hCtx = this._sideHazeCtx;
      const edgeW = Math.min(210, Math.max(100, viewW * 0.15)) * 0.25;
      const horS = horizonY * 0.25;
      const fadeStart = Math.max(0, horS - 2);
      const fadeEnd = Math.min(ch, horS + 16);

      hCtx.globalCompositeOperation = 'source-over';
      hCtx.clearRect(0, 0, cw, ch);

      const leftGrad = hCtx.createLinearGradient(0, 0, edgeW, 0);
      leftGrad.addColorStop(0.0, `rgba(${hr}, ${hg}, ${hb}, 0.72)`);
      leftGrad.addColorStop(0.42, `rgba(${hr}, ${hg}, ${hb}, 0.32)`);
      leftGrad.addColorStop(1.0, `rgba(${hr}, ${hg}, ${hb}, 0)`);
      hCtx.fillStyle = leftGrad;
      hCtx.fillRect(0, fadeStart, edgeW, ch - fadeStart);

      const rightGrad = hCtx.createLinearGradient(cw, 0, cw - edgeW, 0);
      rightGrad.addColorStop(0.0, `rgba(${hr}, ${hg}, ${hb}, 0.72)`);
      rightGrad.addColorStop(0.42, `rgba(${hr}, ${hg}, ${hb}, 0.32)`);
      rightGrad.addColorStop(1.0, `rgba(${hr}, ${hg}, ${hb}, 0)`);
      hCtx.fillStyle = rightGrad;
      hCtx.fillRect(cw - edgeW, fadeStart, edgeW, ch - fadeStart);

      // Smoothly taper side mist into the horizon haze so no horizontal seam appears
      hCtx.globalCompositeOperation = 'destination-out';
      const topMask = hCtx.createLinearGradient(0, fadeStart, 0, fadeEnd);
      topMask.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
      topMask.addColorStop(0.55, 'rgba(0, 0, 0, 0.45)');
      topMask.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      hCtx.fillStyle = topMask;
      hCtx.fillRect(0, fadeStart, cw, fadeEnd - fadeStart);

      ctx.drawImage(this._sideHazeCanvas, 0, 0, viewW, viewH);
    }

    // Atmospheric haze colour at the horizon (same mix drawHorizonHaze uses)
    getHazeRgb() {
      const pal = this.getPalette();
      return [
        Math.round(pal.skyHorRgb[0] * 0.55 + pal.gFarRgb[0] * 0.45),
        Math.round(pal.skyHorRgb[1] * 0.55 + pal.gFarRgb[1] * 0.45),
        Math.round(pal.skyHorRgb[2] * 0.55 + pal.gFarRgb[2] * 0.45)
      ];
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldSky);
})(window);
