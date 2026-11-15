(function (global) {
  'use strict';

  // Drawing of objects standing on the ground: white flags over captured compounds,
  // crates / barrels (props) and rocks / jump pads (obstacles).
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { HORIZON_DY } = global.HorizonWorld.shared;

  class WorldProps {
    // White surrender flag on a pole planted in a small stone cairn.
    // raise: 0..1 hoisting progress; the cloth ripples in the wind.
    drawWhiteFlag(ctx, p, raise, timeSec) {
      const poleH = 78;
      const W = 32;
      const H = 20;
      const segs = 8;
      const FLAG_SCALE = 1.4; // overall size of the flag, pole and cairn
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(p.scale * FLAG_SCALE, p.scale * FLAG_SCALE);

      // Ground shadow of pole + flag (flattened onto the terrain)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(14, 2, 22, Math.max(1.5, 5 * p.tiltCos), 0, 0, Math.PI * 2);
      ctx.fill();

      // Supply depot: a small stack of green supply crates beside the pole (gently pulsing)
      const glow = 0.55 + 0.45 * Math.sin(timeSec * 3);
      ctx.fillStyle = `rgba(74, 222, 128, ${(0.2 * glow).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(-20, -4, 20, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      const crate = (cx, cy, size) => {
        ctx.fillStyle = '#3f6b3a';
        ctx.strokeStyle = '#1f3a1c';
        ctx.lineWidth = 1;
        ctx.fillRect(cx - size / 2, cy - size, size, size);
        ctx.strokeRect(cx - size / 2, cy - size, size, size);
        ctx.fillStyle = '#f8fafc';
        const t = size * 0.16;
        ctx.fillRect(cx - t / 2, cy - size * 0.8, t, size * 0.6);
        ctx.fillRect(cx - size * 0.3, cy - size / 2 - t / 2, size * 0.6, t);
      };
      crate(-26, 2, 12);
      crate(-14, 3, 12);
      crate(-20, -9, 11);

      // Stone cairn at the foot of the pole
      ctx.fillStyle = '#5f564d';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#857a6e';
      ctx.beginPath();
      ctx.ellipse(-1.5, -2.5, 6.5, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pole with a light edge highlight and a round finial
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3f3a35';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(0, -poleH);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214, 211, 209, 0.7)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-0.7, -4);
      ctx.lineTo(-0.7, -poleH + 2);
      ctx.stroke();
      ctx.fillStyle = '#d6d3d1';
      ctx.beginPath();
      ctx.arc(0, -poleH - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Cloth: hoisted from low on the pole to the top with an ease-out
      const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, raise)), 3);
      const topY = -poleH + 2 + (1 - eased) * poleH * 0.6;
      const phase = timeSec * 5.2;
      const wave = (u) => Math.sin(phase - u * 4.2) * 2.8 * u; // larger ripple toward the free end

      const shade = ctx.createLinearGradient(0, 0, W, 0);
      for (let k = 0; k <= 4; k++) {
        const u = k / 4;
        const light = 0.5 + 0.5 * Math.cos(phase - u * 4.2);
        const c = Math.round(204 + light * 51);
        shade.addColorStop(u, `rgb(${c}, ${Math.min(255, c + 2)}, ${Math.min(255, c + 6)})`);
      }
      ctx.fillStyle = shade;
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
      ctx.lineWidth = 0.9;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const x = u * W;
        const y = topY + wave(u);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = segs; i >= 0; i--) {
        const u = i / segs;
        ctx.lineTo(u * W, topY + H + wave(u) * 1.1 + u * 1.6);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    drawProp(ctx, prop, p, timeSec) {
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(p.scale, p.scale);

      // Ground shadow (flat on curved ground)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(4, 6, prop.radius * 0.95, prop.radius * 0.65 * p.tiltCos, 0, 0, Math.PI * 2);
      ctx.fill();

      if (prop.type === 'crate') {
        ctx.fillStyle = '#b45309';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeRect(-15, -15, 30, 30);
        ctx.beginPath();
        ctx.moveTo(-15, -15);
        ctx.lineTo(15, 15);
        ctx.stroke();
      } else if (prop.type === 'crystal') {
        const glow = 0.65 + 0.35 * Math.sin(timeSec * 4 + prop.x);
        ctx.fillStyle = `rgba(56, 189, 248, ${glow})`;
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(14, 0);
        ctx.lineTo(0, 14);
        ctx.lineTo(-14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (prop.type === 'barrel') {
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawObstacle(ctx, obs, p, camX, camY, viewW, viewH) {
      // Project every rock vertex with the real projection (exact on the curved ground)
      const projV = (v, offX = 0, offY = 0) =>
        this.projectDelta(p.dx + v[0] + offX, p.dy + v[1] + offY, v[2], viewW, viewH, true);

      // Distance fog: tall boulders near the horizon poke above the haze band, so the rock itself
      // fades into the haze colour with distance and dissolves just before the horizon.
      const horizonDist = -HORIZON_DY;
      const fogT = Math.max(0, Math.min(1, (-p.dy - horizonDist * 0.4) / (horizonDist * 0.6)));
      const fogMix = 0.92 * Math.pow(fogT, 1.4);
      const fadeT = Math.max(0, Math.min(1, (fogT - 0.78) / 0.22));
      const alpha = 1 - fadeT * fadeT * (3 - 2 * fadeT);
      if (alpha <= 0.01) return;
      const haze = fogMix > 0.001 ? this.getHazeRgb() : null;
      const fogColor = (rgb) => {
        if (!haze) return null;
        const r = Math.round(rgb[0] + (haze[0] - rgb[0]) * fogMix);
        const g = Math.round(rgb[1] + (haze[1] - rgb[1]) * fogMix);
        const b = Math.round(rgb[2] + (haze[2] - rgb[2]) * fogMix);
        return `rgb(${r}, ${g}, ${b})`;
      };
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * alpha;

      // Any part of a distant rock rising above the horizon dissolves upward into the sky haze
      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.24;
      const fadeTopY = horizonY - 46;
      const fadeBotY = horizonY + 8;
      const rgbStr = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
      const skyFadeFill = (rgb, minSy) => {
        if (!haze || minSy >= fadeBotY) return null;
        const r = Math.round(rgb[0] + (haze[0] - rgb[0]) * fogMix);
        const g = Math.round(rgb[1] + (haze[1] - rgb[1]) * fogMix);
        const b = Math.round(rgb[2] + (haze[2] - rgb[2]) * fogMix);
        const grad = ctx.createLinearGradient(0, fadeTopY, 0, fadeBotY);
        grad.addColorStop(0, rgbStr(haze, 0));
        grad.addColorStop(0.55, rgbStr([r, g, b], 0.55));
        grad.addColorStop(1, rgbStr([r, g, b], 1));
        return grad;
      };
      const edgeStroke = `rgba(28, 22, 16, ${(0.16 * (1 - fogMix)).toFixed(3)})`;

      // Ground shadow cast toward the south-east (thins out with distance as well)
      const sOffX = obs.radius * 0.22;
      const sOffY = obs.radius * 0.16;
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.30 * (1 - fogMix)).toFixed(3)})`;
      ctx.beginPath();
      let started = false;
      for (const v of obs.base) {
        const sp = projV(v, sOffX, sOffY);
        if (!sp) continue;
        if (!started) {
          ctx.moveTo(sp.sx, sp.sy);
          started = true;
        } else {
          ctx.lineTo(sp.sx, sp.sy);
        }
      }
      if (started) {
        ctx.closePath();
        ctx.fill();
      }

      // Faceted body: draw only facets facing the camera (positive screen-space winding)
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      for (const f of obs.facets) {
        const pts = [];
        for (const v of f.verts) {
          const sp = projV(v);
          if (!sp) break;
          pts.push(sp);
        }
        if (pts.length !== f.verts.length) continue;
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          area += a.sx * b.sy - b.sx * a.sy;
        }
        if (area <= 0.5) continue;
        let minSy = Infinity;
        for (const sp of pts) minSy = Math.min(minSy, sp.sy);
        const skyFade = skyFadeFill(f.rgb, minSy);
        ctx.fillStyle = skyFade || fogColor(f.rgb) || f.color;
        // Facet edge lines would stay crisp against the sky, so skip them on fading facets
        ctx.strokeStyle = skyFade ? 'rgba(0, 0, 0, 0)' : edgeStroke;
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.lineJoin = 'miter';
      ctx.globalAlpha = prevAlpha;
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldProps);
})(window);
