(function (global) {
  'use strict';

  // Ground texture: pre-rendered hardpan / gravel sprites stamped into one big world texture
  // (plus compound pads), and drawing it onto the curved ground strip by strip.
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { HORIZON_DY, WORLD_H, WORLD_W, screenYForDy, wrapCoord } = global.HorizonWorld.shared;

  // World-space ground texture resolution (texture pixels per world unit)
  const GROUND_TEX_RES = 0.75; // 4800-unit world -> 3600 x 3600 texture
  const GROUND_ROW_STEP = 2; // screen px per projected ground strip

  class WorldGround {
    // Pre-render reusable ground textures once (cheap drawImage per frame afterwards)
    _buildGroundSprites() {
      this.hardpanSprites = [];
      this.gravelSprites = [];
      if (typeof document === 'undefined') return;
      let seed = 4711;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      for (let v = 0; v < 4; v++) this.hardpanSprites.push(this._makeHardpanSprite(rand));
      for (let v = 0; v < 4; v++) this.gravelSprites.push(this._makeGravelSprite(rand));
    }

    // Voronoi-cell cracked mud with dark fissures, curled bright lips and a ragged faded edge
    _makeHardpanSprite(rand) {
      const S = 384;
      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const g = canvas.getContext('2d');
      const img = g.createImageData(S, S);
      const d = img.data;

      const cell = 30 + rand() * 16;
      const gn = Math.ceil(S / cell) + 2;
      const seeds = [];
      for (let gy = 0; gy < gn; gy++) {
        for (let gx = 0; gx < gn; gx++) {
          seeds.push({
            x: (gx - 1 + 0.12 + rand() * 0.76) * cell,
            y: (gy - 1 + 0.12 + rand() * 0.76) * cell,
            tone: rand()
          });
        }
      }

      const half = S * 0.5;
      const ph1 = rand() * Math.PI * 2;
      const ph2 = rand() * Math.PI * 2;
      const ph3 = rand() * Math.PI * 2;

      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          const dx = px - half;
          const dy = py - half;
          const r = Math.hypot(dx, dy) / half;
          const ang = Math.atan2(dy, dx);
          const edge = 0.8 + Math.sin(ang * 3 + ph1) * 0.08 + Math.sin(ang * 7 + ph2) * 0.05 + Math.sin(ang * 13 + ph3) * 0.025;
          if (r >= edge) continue;
          const fall = Math.min(1, (edge - r) / 0.24);

          const gx = Math.floor(px / cell) + 1;
          const gy = Math.floor(py / cell) + 1;
          let d1 = Infinity;
          let d2 = Infinity;
          let best = null;
          for (let oy = -1; oy <= 1; oy++) {
            const sy = gy + oy;
            if (sy < 0 || sy >= gn) continue;
            for (let ox = -1; ox <= 1; ox++) {
              const sx = gx + ox;
              if (sx < 0 || sx >= gn) continue;
              const s = seeds[sy * gn + sx];
              const dd = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py);
              if (dd < d1) {
                d2 = d1;
                d1 = dd;
                best = s;
              } else if (dd < d2) {
                d2 = dd;
              }
            }
          }
          const gap = Math.sqrt(d2) - Math.sqrt(d1);

          let R;
          let G;
          let B;
          let A;
          if (gap < 2.6) {
            // Deep dark fissure
            R = 50; G = 37; B = 28; A = 0.58;
          } else if (gap < 5.2) {
            // Sun-bleached curled lip of each mud plate
            R = 226; G = 206; B = 172; A = 0.28;
          } else {
            // Plate surface: slightly concave (darker toward the cracks), per-plate tone variation
            const t = Math.min(1, gap / (cell * 0.55));
            const tone = best.tone;
            R = 176 + tone * 30 - (1 - t) * 20;
            G = 154 + tone * 26 - (1 - t) * 18;
            B = 120 + tone * 20 - (1 - t) * 16;
            A = 0.24 + t * 0.1;
          }
          const i4 = (py * S + px) * 4;
          d[i4] = R;
          d[i4 + 1] = G;
          d[i4 + 2] = B;
          d[i4 + 3] = Math.round(A * fall * 255);
        }
      }
      g.putImageData(img, 0, 0);
      return canvas;
    }

    // Cluster of small shaded stones and grit
    _makeGravelSprite(rand) {
      const S = 96;
      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const g = canvas.getContext('2d');
      const stoneColors = ['rgba(122, 110, 98, 0.95)', 'rgba(92, 78, 66, 0.95)', 'rgba(152, 134, 112, 0.95)', 'rgba(110, 84, 64, 0.95)'];
      const count = 26 + Math.floor(rand() * 20);
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * S * 0.42;
        const x = S * 0.5 + Math.cos(a) * rr;
        const y = S * 0.5 + Math.sin(a) * rr;
        const big = rand() < 0.14;
        const s = big ? 3 + rand() * 3.2 : 0.8 + rand() * 1.8;

        g.fillStyle = 'rgba(30, 22, 16, 0.45)';
        g.beginPath();
        g.ellipse(x + s * 0.45, y + s * 0.55, s * 1.05, s * 0.8, 0, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = stoneColors[Math.floor(rand() * stoneColors.length)];
        g.beginPath();
        const verts = 5 + Math.floor(rand() * 3);
        const rot = rand() * Math.PI * 2;
        for (let v = 0; v < verts; v++) {
          const va = rot + (v / verts) * Math.PI * 2;
          const vr = s * (0.75 + rand() * 0.35);
          const vx = x + Math.cos(va) * vr;
          const vy = y + Math.sin(va) * vr * 0.85;
          if (v === 0) g.moveTo(vx, vy);
          else g.lineTo(vx, vy);
        }
        g.closePath();
        g.fill();

        if (s > 1.6) {
          g.fillStyle = 'rgba(236, 222, 196, 0.32)';
          g.beginPath();
          g.ellipse(x - s * 0.3, y - s * 0.32, s * 0.45, s * 0.28, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      return canvas;
    }

    // Bake every static ground decal into one seamless world-space texture. Drawing it per screen
    // row with the exact projection keeps all ground layers locked together while scrolling
    // (previously large decals were projected only at their centre and slid against the rest).
    _buildGroundTexture() {
      this.groundTex = null;
      if (typeof document === 'undefined') return;
      const R = GROUND_TEX_RES;
      const W = WORLD_W;
      const H = WORLD_H;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(W * R);
      canvas.height = Math.round(H * R);
      const g = canvas.getContext('2d');
      if (!g) return;
      g.scale(R, R);

      // Draw fn at (x, y) plus wrapped copies wherever its bounding radius crosses a world edge
      const stamp = (x, y, r, fn) => {
        for (const ox of [-W, 0, W]) {
          if (x + ox + r < 0 || x + ox - r > W) continue;
          for (const oy of [-H, 0, H]) {
            if (y + oy + r < 0 || y + oy - r > H) continue;
            g.save();
            g.translate(x + ox, y + oy);
            fn();
            g.restore();
          }
        }
      };

      // Terrain colour patches (ragged outline + inner tone)
      for (const patch of this.patches) {
        const shape = patch.shape;
        stamp(patch.x, patch.y, Math.max(patch.rx, patch.ry) * 1.35, () => {
          g.rotate(patch.rot);
          g.fillStyle = patch.color;
          g.beginPath();
          g.moveTo(shape[0], shape[1]);
          for (let i = 2; i < shape.length; i += 2) g.lineTo(shape[i], shape[i + 1]);
          g.closePath();
          g.fill();
          const ix = patch.rx * 0.12;
          const iy = -patch.ry * 0.08;
          g.fillStyle = patch.innerColor;
          g.beginPath();
          g.moveTo(ix + shape[0] * 0.56, iy + shape[1] * 0.56);
          for (let i = 2; i < shape.length; i += 2) g.lineTo(ix + shape[i] * 0.56, iy + shape[i + 1] * 0.56);
          g.closePath();
          g.fill();
        });
      }

      // Cracked dry-mud hardpan flats
      for (const hp of this.hardpans) {
        const sprite = this.hardpanSprites[hp.variant];
        if (!sprite) break;
        stamp(hp.x, hp.y, hp.size * 0.75, () => {
          g.scale(hp.flip ? -1 : 1, 1);
          g.rotate(hp.rot);
          g.drawImage(sprite, -hp.size * 0.5, -hp.size * 0.5, hp.size, hp.size);
        });
      }

      // Dried gullies (continuous polylines using unwrapped coordinates)
      for (const gully of this.gullies) {
        const x0 = gully[0].ux;
        const y0 = gully[0].uy;
        let bound = 0;
        for (const pt of gully) bound = Math.max(bound, Math.hypot(pt.ux - x0, pt.uy - y0) + pt.w);
        stamp(this.wrapX(x0), this.wrapY(y0), bound, () => {
          g.lineCap = 'round';
          for (let i = 1; i < gully.length; i++) {
            const a = gully[i - 1];
            const b = gully[i];
            g.beginPath();
            g.moveTo(a.ux - x0, a.uy - y0);
            g.lineTo(b.ux - x0, b.uy - y0);
            g.strokeStyle = 'rgba(52, 38, 28, 0.48)';
            g.lineWidth = b.w * 1.15;
            g.stroke();
            g.strokeStyle = 'rgba(34, 24, 16, 0.32)';
            g.lineWidth = b.w * 0.42;
            g.stroke();
          }
        });
      }

      // Windblown dust streaks
      for (const rp of this.ripples) {
        stamp(rp.x, rp.y, 220, () => {
          g.strokeStyle = `rgba(206, 186, 152, ${(rp.alpha * 0.8).toFixed(2)})`;
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(0, 0);
          g.quadraticCurveTo(rp.cx, rp.cy, rp.dx, rp.dy);
          g.stroke();
        });
      }

      // Dry earth fissures & pebbles
      for (const ck of this.cracks) {
        stamp(ck.x, ck.y, 70, () => {
          if (ck.isPebble) {
            g.fillStyle = 'rgba(64, 46, 32, 0.55)';
            g.beginPath();
            g.ellipse(0, 0, ck.r, ck.r, 0, 0, Math.PI * 2);
            g.ellipse(ck.r * 1.4, ck.r * 0.5, ck.r * 0.55, ck.r * 0.55, 0, 0, Math.PI * 2);
            g.fill();
          } else {
            g.strokeStyle = 'rgba(54, 38, 26, 0.42)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(ck.dx1, ck.dy1);
            g.lineTo(ck.dx2, ck.dy2);
            g.stroke();
          }
        });
      }

      // Gravel & stone clusters
      for (const gv of this.gravel) {
        const sprite = this.gravelSprites[gv.variant];
        if (!sprite) break;
        stamp(gv.x, gv.y, gv.size * 0.6, () => {
          g.drawImage(sprite, -gv.size * 0.5, -gv.size * 0.5, gv.size, gv.size);
        });
      }

      // Dead branching brush
      for (const sc of this.scrubs) {
        stamp(sc.x, sc.y, 24 * sc.scale, () => {
          g.scale(sc.scale, sc.scale);
          g.rotate(sc.rot);
          g.fillStyle = 'rgba(34, 24, 16, 0.32)';
          g.beginPath();
          g.ellipse(2, 3, 13, 9, 0, 0, Math.PI * 2);
          g.fill();
          const tw = sc.twigs;
          g.lineCap = 'round';
          g.beginPath();
          for (let i = 0; i < tw.length; i += 4) {
            g.moveTo(tw[i], tw[i + 1]);
            g.lineTo(tw[i + 2], tw[i + 3]);
          }
          g.strokeStyle = 'rgba(40, 28, 18, 0.55)';
          g.lineWidth = 2.6;
          g.stroke();
          g.strokeStyle = sc.tone;
          g.lineWidth = 1.25;
          g.stroke();
        });
      }

      // District borders: dashed survey line along each band edge (x = 0/4800, 1600, 3200)
      g.lineCap = 'butt';
      for (const d of this.districts) {
        for (const bx of d.x0 === 0 ? [0, W] : [d.x0]) {
          g.setLineDash([22, 16]);
          g.strokeStyle = 'rgba(30, 22, 16, 0.32)';
          g.lineWidth = 7;
          g.beginPath();
          g.moveTo(bx, 0);
          g.lineTo(bx, H);
          g.stroke();
          g.strokeStyle = 'rgba(236, 222, 190, 0.42)';
          g.lineWidth = 3;
          g.stroke();
        }
      }
      g.setLineDash([]);

      this._groundCtx = g;
      this.groundTex = canvas;
      // Re-stamp compounds that were already revealed (if the texture is ever rebuilt mid-game)
      for (const id of this.revealedBases) {
        const b = this.enemyBases.find((s) => s.id === id);
        if (b) this._stampGround(b.x, b.y, b.radius + 40, (gg) => this._drawBasePad(gg, b));
      }
    }

    // Stamp a decal onto the baked ground texture (with wrapped copies across world edges)
    _stampGround(x, y, r, fn) {
      const g = this._groundCtx;
      if (!g) return;
      const W = WORLD_W;
      const H = WORLD_H;
      for (const ox of [-W, 0, W]) {
        if (x + ox + r < 0 || x + ox - r > W) continue;
        for (const oy of [-H, 0, H]) {
          if (y + oy + r < 0 || y + oy - r > H) continue;
          g.save();
          g.translate(x + ox, y + oy);
          fn(g);
          g.restore();
        }
      }
    }

    // Enemy compound: packed scorched earth, track ruts, sandbag ring with entrances, bunker pits
    _drawBasePad(g, b) {
      const pad = g.createRadialGradient(0, 0, b.radius * 0.15, 0, 0, b.radius + 30);
      pad.addColorStop(0, 'rgba(58, 46, 38, 0.46)');
      pad.addColorStop(0.7, 'rgba(70, 56, 44, 0.34)');
      pad.addColorStop(1, 'rgba(70, 56, 44, 0)');
      g.fillStyle = pad;
      g.beginPath();
      g.arc(0, 0, b.radius + 30, 0, Math.PI * 2);
      g.fill();

      // Bunker pits (dug-in dark circles)
      for (const slot of b.bunkerSlots) {
        const sx = this.deltaX(b.x, slot.x);
        const sy = this.deltaY(b.y, slot.y);
        g.fillStyle = 'rgba(30, 24, 20, 0.5)';
        g.beginPath();
        g.arc(sx, sy, 40, 0, Math.PI * 2);
        g.fill();
      }

      g.rotate(b.rot);
      // Track ruts leading out of the three entrances
      g.strokeStyle = 'rgba(32, 24, 18, 0.28)';
      g.lineWidth = 5;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        for (const off of [-11, 11]) {
          g.beginPath();
          g.moveTo(c * 60 - s * off, s * 60 + c * off);
          g.lineTo(c * (b.radius + 25) - s * off, s * (b.radius + 25) + c * off);
          g.stroke();
        }
      }

      // Sandbag ring with three entrance gaps
      const R = 115;
      const bagLen = 17;
      const n = Math.floor((Math.PI * 2 * R) / (bagLen + 2));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        let inGap = false;
        for (let e = 0; e < 3; e++) {
          const ga = (e / 3) * Math.PI * 2;
          let d = Math.abs(a - ga) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < 0.2) inGap = true;
        }
        if (inGap) continue;
        g.save();
        g.rotate(a);
        g.translate(R, 0);
        g.fillStyle = k % 2 === 0 ? '#a8916a' : '#9a8460';
        g.strokeStyle = 'rgba(58, 44, 28, 0.85)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.roundRect(-5, -bagLen * 0.5, 10, bagLen, 3.5);
        g.fill();
        g.stroke();
        g.restore();
      }
    }

    // Screen-row strips of the visible ground with their world depth span and horizontal scale.
    // Depends only on the viewport size, so it is cached until a resize.
    _getGroundRows(viewW, viewH) {
      if (this._rowsKeyW === viewW && this._rowsKeyH === viewH && this._rows) return this._rows;
      this._rowsKeyW = viewW;
      this._rowsKeyH = viewH;

      const focal = this.getFocal(viewH);
      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.24;
      let hiBound = 540;
      while (screenYForDy(hiBound, viewH, focal) < viewH + 2 && hiBound < 1100) hiBound += 60;

      const dyAtScreenY = (sy) => {
        let lo = HORIZON_DY;
        let hi = hiBound;
        for (let i = 0; i < 26; i++) {
          const mid = (lo + hi) * 0.5;
          if (screenYForDy(mid, viewH, focal) < sy) lo = mid;
          else hi = mid;
        }
        return (lo + hi) * 0.5;
      };

      const rows = [];
      const start = Math.max(0, Math.floor(horizonY));
      let prevDy = dyAtScreenY(start);
      for (let sy = start; sy < viewH; sy += GROUND_ROW_STEP) {
        const h = Math.min(GROUND_ROW_STEP, viewH - sy);
        const nextDy = dyAtScreenY(sy + h);
        const midP = this.projectDelta(0, (prevDy + nextDy) * 0.5, 0, viewW, viewH, true);
        if (midP && nextDy > prevDy) {
          rows.push({ sy, h, dyTop: prevDy, dyH: nextDy - prevDy, scale: midP.scale });
        }
        prevDy = nextDy;
      }
      this._rows = rows;
      return rows;
    }

    _drawGroundTexture(ctx, camX, camY, viewW, viewH) {
      const tex = this.groundTex;
      if (!tex) return;
      const rows = this._getGroundRows(viewW, viewH);
      for (const row of rows) {
        const wy = wrapCoord(camY + row.dyTop, WORLD_H);
        const spanW = viewW / row.scale;
        const wx = camX - spanW * 0.5;
        if (wy + row.dyH <= WORLD_H) {
          this._blitGroundSpan(ctx, tex, wx, wy, spanW, row.dyH, row.sy, viewW, row.h);
        } else {
          // Strip crosses the north/south world seam: split it in two
          const h1 = WORLD_H - wy;
          const d1 = row.h * (h1 / row.dyH);
          this._blitGroundSpan(ctx, tex, wx, wy, spanW, h1, row.sy, viewW, d1);
          this._blitGroundSpan(ctx, tex, wx, 0, spanW, row.dyH - h1, row.sy + d1, viewW, row.h - d1);
        }
      }
    }

    // Copy one horizontal world span to a screen strip, wrapping across the east/west seam
    _blitGroundSpan(ctx, tex, wx, wy, spanW, spanH, destY, destW, destH) {
      const R = GROUND_TEX_RES;
      const srcH = Math.min(spanH, WORLD_H - wy);
      if (srcH <= 1e-4 || destH <= 0) return;
      const pxPerWorld = destW / spanW;
      let x = wrapCoord(wx, WORLD_W);
      let done = 0;
      let destX = 0;
      while (done < spanW - 1e-6) {
        const seg = Math.min(spanW - done, WORLD_W - x);
        done += seg;
        // Snap internal seam boundaries to whole pixels so no anti-aliased seam line appears
        const destEnd = done >= spanW - 1e-6 ? destW : Math.round(done * pxPerWorld);
        const dw = destEnd - destX;
        if (dw > 0 && seg > 1e-3) {
          ctx.drawImage(tex, x * R, wy * R, seg * R, srcH * R, destX, destY, dw, destH);
        }
        destX = destEnd;
        x = 0;
      }
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldGround);
})(window);
