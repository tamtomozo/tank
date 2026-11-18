(function (global) {
  'use strict';

  // Ground texture: pre-rendered hardpan / gravel sprites stamped into a world-space texture
  // (plus compound pads), and drawing it onto the curved ground strip by strip.
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { HORIZON_DY, WORLD_H, WORLD_W, screenYForDy, wrapCoord } = global.HorizonWorld.shared;

  // World-space ground texture resolution (texture pixels per world unit)
  const GROUND_TEX_RES = 0.75; // 4800-unit world -> 3600 x 3600 texture pixels in all
  // The texture is kept as GROUND_TILES x GROUND_TILES separate canvases (1200 x 1200 px each).
  // One 3600 x 3600 canvas is above the area browsers keep on the GPU (~8.3 M px in Chromium,
  // less on phones), and every strip drawn from such a canvas takes a slow path: the per-frame
  // ground cost was several times higher. Small tiles always stay on the fast path.
  const GROUND_TILES = 3;
  const TILE_W = WORLD_W / GROUND_TILES; // world units per tile
  const TILE_H = WORLD_H / GROUND_TILES;
  const GROUND_ROW_STEP = 2; // screen px per projected ground strip (near the horizon)
  const GROUND_ROW_MAX = 8; // tallest strip, where the projection changes slowly (see _getGroundRows)
  const GROUND_ROW_SHEAR = 0.5; // screen px a strip's edge may be off at the side of the screen

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
      this.groundTiles = null;
      if (typeof document === 'undefined') return;
      const R = GROUND_TEX_RES;
      const W = WORLD_W;
      const H = WORLD_H;
      // Tile (tx, ty) covers world x in [tx * TILE_W, (tx + 1) * TILE_W) and likewise for y.
      // Each tile's context works in world coordinates, so decals are drawn as on one big canvas.
      // (A rebuild — new sortie — reuses the canvases instead of allocating 52 MB again.)
      const tiles = [];
      const tw = Math.round(TILE_W * R);
      const th = Math.round(TILE_H * R);
      for (let ty = 0; ty < GROUND_TILES; ty++) {
        for (let tx = 0; tx < GROUND_TILES; tx++) {
          const old = this._groundTileStore && this._groundTileStore[tiles.length];
          const canvas = old ? old.canvas : document.createElement('canvas');
          if (canvas.width !== tw || canvas.height !== th) {
            canvas.width = tw;
            canvas.height = th;
          }
          const g = old ? old.g : canvas.getContext('2d');
          if (!g) return;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, tw, th);
          g.setTransform(R, 0, 0, R, -tx * TILE_W * R, -ty * TILE_H * R);
          g.setLineDash([]);
          g.lineCap = 'butt';
          tiles.push({ canvas, g, x0: tx * TILE_W, y0: ty * TILE_H });
        }
      }
      this._groundTileStore = tiles;

      // Draw fn(g) at (x, y) plus wrapped copies wherever its bounding radius crosses a world edge
      const stamp = (x, y, r, fn) => this._stampTiles(tiles, x, y, r, fn);

      // Snow planet: the same layout drawn as snowfields — drifts instead of earth patches,
      // frozen creeks instead of gullies, wind-carved snow instead of dust streaks; no mud flats,
      // fissures or brush (js/planet/planet.js THEMES)
      // Industrial planet ('ash'): oil stains and soot instead of earth patches, concrete drains
      // instead of gullies, ash streaks; no mud flats or brush (cracks stay: broken concrete)
      const snow = this.theme.snow;
      const ash = this.theme.ground === 'ash';
      const SNOW_PATCH = ['rgba(255, 255, 255, 0.34)', 'rgba(160, 182, 210, 0.26)', 'rgba(232, 240, 250, 0.3)', 'rgba(140, 162, 190, 0.22)'];
      const ASH_PATCH = ['rgba(20, 18, 18, 0.26)', 'rgba(150, 140, 126, 0.2)', 'rgba(40, 34, 30, 0.22)', 'rgba(110, 96, 80, 0.2)'];

      // Terrain colour patches (ragged outline + inner tone)
      for (const [pi, patch] of this.patches.entries()) {
        const shape = patch.shape;
        stamp(patch.x, patch.y, Math.max(patch.rx, patch.ry) * 1.35, (g) => {
          g.rotate(patch.rot);
          g.fillStyle = snow ? SNOW_PATCH[pi % 4] : ash ? ASH_PATCH[pi % 4] : patch.color;
          g.beginPath();
          g.moveTo(shape[0], shape[1]);
          for (let i = 2; i < shape.length; i += 2) g.lineTo(shape[i], shape[i + 1]);
          g.closePath();
          g.fill();
          const ix = patch.rx * 0.12;
          const iy = -patch.ry * 0.08;
          g.fillStyle = snow ? 'rgba(255, 255, 255, 0.18)' : ash ? 'rgba(12, 10, 10, 0.16)' : patch.innerColor;
          g.beginPath();
          g.moveTo(ix + shape[0] * 0.56, iy + shape[1] * 0.56);
          for (let i = 2; i < shape.length; i += 2) g.lineTo(ix + shape[i] * 0.56, iy + shape[i + 1] * 0.56);
          g.closePath();
          g.fill();
        });
      }

      // Cracked dry-mud hardpan flats
      for (const hp of snow || ash ? [] : this.hardpans) {
        const sprite = this.hardpanSprites[hp.variant];
        if (!sprite) break;
        stamp(hp.x, hp.y, hp.size * 0.75, (g) => {
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
        stamp(this.wrapX(x0), this.wrapY(y0), bound, (g) => {
          g.lineCap = 'round';
          for (let i = 1; i < gully.length; i++) {
            const a = gully[i - 1];
            const b = gully[i];
            g.beginPath();
            g.moveTo(a.ux - x0, a.uy - y0);
            g.lineTo(b.ux - x0, b.uy - y0);
            g.strokeStyle = snow ? 'rgba(110, 140, 175, 0.42)' : ash ? 'rgba(24, 22, 22, 0.5)' : 'rgba(52, 38, 28, 0.48)';
            g.lineWidth = b.w * 1.15;
            g.stroke();
            g.strokeStyle = snow ? 'rgba(200, 225, 245, 0.5)' : ash ? 'rgba(70, 90, 80, 0.35)' : 'rgba(34, 24, 16, 0.32)';
            g.lineWidth = b.w * 0.42;
            g.stroke();
          }
        });
      }

      // Windblown dust streaks
      for (const rp of this.ripples) {
        stamp(rp.x, rp.y, 220, (g) => {
          g.strokeStyle = snow
            ? `rgba(255, 255, 255, ${(rp.alpha * 1.6).toFixed(2)})`
            : ash
              ? `rgba(30, 28, 28, ${(rp.alpha * 0.9).toFixed(2)})`
              : `rgba(206, 186, 152, ${(rp.alpha * 0.8).toFixed(2)})`;
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(0, 0);
          g.quadraticCurveTo(rp.cx, rp.cy, rp.dx, rp.dy);
          g.stroke();
        });
      }

      // Dry earth fissures & pebbles
      for (const ck of snow ? [] : this.cracks) {
        stamp(ck.x, ck.y, 70, (g) => {
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
        stamp(gv.x, gv.y, gv.size * 0.6, (g) => {
          g.drawImage(sprite, -gv.size * 0.5, -gv.size * 0.5, gv.size, gv.size);
        });
      }

      // Dead branching brush
      for (const sc of snow || ash ? [] : this.scrubs) {
        stamp(sc.x, sc.y, 24 * sc.scale, (g) => {
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

      this.groundTiles = tiles;
      // Operations HQ pad (always there, unlike the compounds below)
      if (this.hq) this._stampGround(this.hq.x, this.hq.y, this.hq.radius + 40, (gg) => this._drawHqPad(gg));
      // Areas of the current operation (salt flat, old town: js/planet/zones.js)
      for (const z of this.zones) {
        this._stampGround(z.x, z.y, z.radius + 120, (gg) => this._drawZoneGround(gg, z));
      }
      // Re-stamp compounds that were already revealed (if the texture is ever rebuilt mid-game)
      for (const id of this.revealedBases) {
        const b = this.sites.find((s) => s.id === id);
        if (b) this._stampGround(b.x, b.y, b.radius + 40, (gg) => this._drawBasePad(gg, b));
      }
    }

    // Stamp a decal onto the baked ground texture (with wrapped copies across world edges)
    _stampGround(x, y, r, fn) {
      if (this.groundTiles) this._stampTiles(this.groundTiles, x, y, r, fn);
    }

    // Run fn(g) with the origin at (x, y) in every tile the decal's bounding radius r touches,
    // including the wrapped copies across the world edges
    _stampTiles(tiles, x, y, r, fn) {
      const W = WORLD_W;
      const H = WORLD_H;
      for (const ox of [-W, 0, W]) {
        const cx = x + ox;
        if (cx + r < 0 || cx - r > W) continue;
        for (const oy of [-H, 0, H]) {
          const cy = y + oy;
          if (cy + r < 0 || cy - r > H) continue;
          for (const tile of tiles) {
            if (cx + r < tile.x0 || cx - r > tile.x0 + TILE_W) continue;
            if (cy + r < tile.y0 || cy - r > tile.y0 + TILE_H) continue;
            const g = tile.g;
            g.save();
            g.translate(cx, cy);
            fn(g);
            g.restore();
          }
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
    // Depends only on the viewport size and the canvas pixel ratio, so it is cached until those
    // change. Strips are a whole number of canvas pixels tall and start on a canvas pixel, so
    // neighbouring strips never blend along their shared edge (at any render resolution).
    _getGroundRows(viewW, viewH, pixelRatio = 1) {
      if (this._rows && this._rowsKeyW === viewW && this._rowsKeyH === viewH && this._rowsKeyR === pixelRatio) {
        return this._rows;
      }
      this._rowsKeyW = viewW;
      this._rowsKeyH = viewH;
      this._rowsKeyR = pixelRatio;

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

      // A strip is drawn with one horizontal scale (that of its middle), so its top and bottom
      // edges are slightly off; the error is largest at the left / right screen edge. Toward the
      // bottom of the screen the scale changes slowly, so strips there can be taller for the same
      // error: each strip grows from GROUND_ROW_STEP up to GROUND_ROW_MAX while that edge error
      // stays within GROUND_ROW_SHEAR — roughly a third fewer strips to draw on a landscape
      // phone, two thirds fewer in portrait.
      const scaleAt = (dy) => this.projectDelta(0, dy, 0, viewW, viewH, true).scale;
      const edgeShear = (dyTop, dyBottom) => {
        const mid = scaleAt((dyTop + dyBottom) * 0.5);
        return (Math.max(Math.abs(scaleAt(dyTop) - mid), Math.abs(scaleAt(dyBottom) - mid)) / mid) * viewW * 0.5;
      };

      const rows = [];
      const minPx = Math.max(1, Math.round(GROUND_ROW_STEP * pixelRatio)); // canvas px per strip
      const maxPx = Math.max(minPx, Math.round(GROUND_ROW_MAX * pixelRatio));
      const startPx = Math.max(0, Math.floor(horizonY * pixelRatio));
      let prevDy = dyAtScreenY(startPx / pixelRatio);
      let stepPx = minPx;
      for (let px = startPx; px / pixelRatio < viewH; px += stepPx) {
        const sy = px / pixelRatio;
        stepPx = minPx;
        let nextDy = dyAtScreenY(Math.min(viewH, sy + stepPx / pixelRatio));
        while (stepPx < maxPx) {
          const tryDy = dyAtScreenY(Math.min(viewH, sy + (stepPx + 1) / pixelRatio));
          if (edgeShear(prevDy, tryDy) > GROUND_ROW_SHEAR) break;
          stepPx += 1;
          nextDy = tryDy;
        }
        const h = Math.min(stepPx / pixelRatio, viewH - sy);
        const midP = this.projectDelta(0, (prevDy + nextDy) * 0.5, 0, viewW, viewH, true);
        if (midP && nextDy > prevDy) {
          rows.push({ sy, h, dyTop: prevDy, dyH: nextDy - prevDy, scale: midP.scale });
        }
        prevDy = nextDy;
      }
      this._rows = rows;
      return rows;
    }

    // pixelRatio: canvas pixels per CSS pixel of ctx (seams between tiles are snapped to it)
    _drawGroundTexture(ctx, camX, camY, viewW, viewH, pixelRatio = 1) {
      const tiles = this.groundTiles;
      if (!tiles) return;
      const R = GROUND_TEX_RES;
      const rows = this._getGroundRows(viewW, viewH, pixelRatio);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const spanW = viewW / row.scale;
        const wx = wrapCoord(camX - spanW * 0.5, WORLD_W);
        const pxPerWorld = viewW / spanW;
        const txStart = Math.min(GROUND_TILES - 1, Math.floor(wx / TILE_W));

        // Split the strip wherever its depth span crosses a tile edge (the north/south world seam
        // is one of them), then each piece wherever it crosses a tile edge sideways
        let wy = wrapCoord(camY + row.dyTop, WORLD_H);
        let ty = Math.min(GROUND_TILES - 1, Math.floor(wy / TILE_H));
        let doneH = 0;
        let destY = row.sy;
        const destBottom = row.sy + row.h;
        while (doneH < row.dyH - 1e-6) {
          const segH = Math.min(row.dyH - doneH, (ty + 1) * TILE_H - wy);
          doneH += segH;
          // Inner seams are snapped to whole canvas pixels so no anti-aliased seam line appears
          const destEndY = doneH >= row.dyH - 1e-6
            ? destBottom
            : Math.round((row.sy + row.h * (doneH / row.dyH)) * pixelRatio) / pixelRatio;
          const destH = destEndY - destY;
          if (destH > 0 && segH > 1e-4) {
            const srcY = (wy - ty * TILE_H) * R;
            const srcH = segH * R;
            let x = wx;
            let tx = txStart;
            let doneW = 0;
            let destX = 0;
            while (doneW < spanW - 1e-6) {
              const seg = Math.min(spanW - doneW, (tx + 1) * TILE_W - x);
              doneW += seg;
              const destEndX = doneW >= spanW - 1e-6
                ? viewW
                : Math.round(doneW * pxPerWorld * pixelRatio) / pixelRatio;
              const dw = destEndX - destX;
              if (dw > 0 && seg > 1e-3) {
                ctx.drawImage(
                  tiles[ty * GROUND_TILES + tx].canvas,
                  (x - tx * TILE_W) * R, srcY, seg * R, srcH,
                  destX, destY, dw, destH
                );
              }
              destX = destEndX;
              tx = (tx + 1) % GROUND_TILES; // next tile east (wraps across the east/west seam)
              x = tx * TILE_W;
            }
          }
          destY = destEndY;
          ty = (ty + 1) % GROUND_TILES; // next tile south (wraps across the north/south seam)
          wy = ty * TILE_H;
        }
      }
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldGround);
})(window);
