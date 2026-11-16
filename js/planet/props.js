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
      // Distance fog: tall boulders near the horizon poke above the haze band, so the rock itself
      // fades into the haze colour with distance and dissolves just before the horizon.
      const horizonDist = -HORIZON_DY;
      const fogT = Math.max(0, Math.min(1, (-p.dy - horizonDist * 0.4) / (horizonDist * 0.6)));
      const fogMix = 0.92 * Math.pow(fogT, 1.4);
      const fadeT = Math.max(0, Math.min(1, (fogT - 0.78) / 0.22));
      const alpha = 1 - fadeT * fadeT * (3 - 2 * fadeT);
      if (alpha <= 0.01) return;
      const haze = fogMix > 0.001 ? this.getHazeRgb() : null;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * alpha;

      // Any part of a distant rock rising above the horizon dissolves upward into the sky haze
      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.24;
      const fadeTopY = horizonY - 46;
      const fadeBotY = horizonY + 8;
      const edgeStroke = `rgba(28, 22, 16, ${(0.16 * (1 - fogMix)).toFixed(3)})`;

      // Project every distinct vertex once with the real projection (exact on the curved ground).
      // The facets share their corners, so this is a fraction of projecting facet by facet; the
      // screen positions go into a reused array instead of one object per vertex.
      const mesh = obs._mesh || (obs._mesh = buildMesh(obs));
      const verts = mesh.verts;
      const nVerts = verts.length;
      if (vertOk.length < nVerts + 1) {
        vertXY = new Float64Array((nVerts + 1) * 4);
        vertOk = new Uint8Array((nVerts + 1) * 2);
      }
      for (let i = 0; i < nVerts; i++) {
        const v = verts[i];
        vertOk[i] = this.projectDeltaInto(vertXY, i, p.dx + v[0], p.dy + v[1], v[2], viewW, viewH) ? 1 : 0;
      }

      // Ground shadow cast toward the south-east (thins out with distance as well)
      const sOffX = obs.radius * 0.22;
      const sOffY = obs.radius * 0.16;
      const tmp = nVerts; // spare slot after the vertices
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.30 * (1 - fogMix)).toFixed(3)})`;
      ctx.beginPath();
      let started = false;
      for (const v of obs.base) {
        if (!this.projectDeltaInto(vertXY, tmp, p.dx + v[0] + sOffX, p.dy + v[1] + sOffY, v[2], viewW, viewH)) continue;
        if (!started) {
          ctx.moveTo(vertXY[tmp * 2], vertXY[tmp * 2 + 1]);
          started = true;
        } else {
          ctx.lineTo(vertXY[tmp * 2], vertXY[tmp * 2 + 1]);
        }
      }
      if (started) {
        ctx.closePath();
        ctx.fill();
      }

      // Faceted body: draw only facets facing the camera (positive screen-space winding)
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1;
      ctx.strokeStyle = edgeStroke;
      const facets = obs.facets;
      for (let k = 0; k < facets.length; k++) {
        const idx = mesh.facets[k];
        const n = idx.length;
        let area = 0;
        let minSy = Infinity;
        let complete = true;
        for (let i = 0; i < n; i++) {
          if (!vertOk[idx[i]]) {
            complete = false;
            break;
          }
          const a = idx[i] * 2;
          const b = idx[(i + 1) % n] * 2;
          area += vertXY[a] * vertXY[b + 1] - vertXY[b] * vertXY[a + 1];
          if (vertXY[a + 1] < minSy) minSy = vertXY[a + 1];
        }
        if (!complete || area <= 0.5) continue;

        // Colour: the facet's own, mixed toward the haze with distance; a facet reaching above
        // the horizon fades out upward instead (and gets no edge line, which would stay crisp
        // against the sky)
        const f = facets[k];
        let skyFade = false;
        if (haze) {
          const r = Math.round(f.rgb[0] + (haze[0] - f.rgb[0]) * fogMix);
          const g = Math.round(f.rgb[1] + (haze[1] - f.rgb[1]) * fogMix);
          const b = Math.round(f.rgb[2] + (haze[2] - f.rgb[2]) * fogMix);
          if (minSy < fadeBotY) {
            skyFade = true;
            const grad = ctx.createLinearGradient(0, fadeTopY, 0, fadeBotY);
            grad.addColorStop(0, `rgba(${haze[0]}, ${haze[1]}, ${haze[2]}, 0)`);
            grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.55)`);
            grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
            ctx.fillStyle = grad;
          } else {
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          }
        } else {
          ctx.fillStyle = f.color;
        }
        ctx.beginPath();
        ctx.moveTo(vertXY[idx[0] * 2], vertXY[idx[0] * 2 + 1]);
        for (let i = 1; i < n; i++) ctx.lineTo(vertXY[idx[i] * 2], vertXY[idx[i] * 2 + 1]);
        ctx.closePath();
        ctx.fill();
        if (!skyFade) ctx.stroke();
      }
      ctx.lineJoin = 'miter';
      ctx.globalAlpha = prevAlpha;
    }
  }

  // Distinct vertices of a rock / solid and, for each facet, the indices of its corners in that
  // list (facets share their corner arrays; found once per object and kept on it)
  function buildMesh(obs) {
    const index = new Map();
    const verts = [];
    const idOf = (v) => {
      let i = index.get(v);
      if (i === undefined) {
        i = verts.length;
        index.set(v, i);
        verts.push(v);
      }
      return i;
    };
    return { verts, facets: obs.facets.map((f) => f.verts.map(idOf)) };
  }

  // Reused per-frame storage for projected vertices (screen x, y pairs) and whether each projected
  let vertXY = new Float64Array(128);
  let vertOk = new Uint8Array(64);

  global.TankUtil.mixin(global.HorizonWorld, WorldProps);
})(window);
