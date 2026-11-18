(function (global) {
  'use strict';

  // World generation (run once by the constructor): backdrop stars & ridges, rocks, jump pads, crates,
  // the enemy compound sites and the wasteland detail (patches, ripples, scrub, gullies).
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { AREA_SCALE, BASE_WORLD, WORLD_H, WORLD_W, scaled } = global.HorizonWorld.shared;

  const SPAWN_X = WORLD_W * 0.5; // player spawn point (map centre) = the operations HQ (hq.js)
  const SPAWN_Y = WORLD_H * 0.5;

  // Compound placement: the wrapped map is split into three vertical bands (1600 wide each) and
  // two compounds are placed in each — the centre band around the HQ first (α, β), then east (γ, δ),
  // then west across the wrap (ε, ζ). Layout only: the bands have no meaning in play.
  const SITE_BAND_WIDTH = WORLD_W / 3;
  const SITE_BANDS = [SITE_BAND_WIDTH, SITE_BAND_WIDTH * 2, 0]; // left edge x of each band
  const BASES_PER_BAND = 2;

  class WorldTerrain {
    _initBackdrop() {
      let seed = 4242;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < 140; i++) {
        this.stars.push({
          nx: rand(),
          ny: rand() * 0.52,
          size: 0.8 + rand() * 1.9,
          twinklePhase: rand() * Math.PI * 2,
          color: rand() > 0.7 ? '#bae6fd' : rand() > 0.4 ? '#fef9c3' : '#e2e8f0'
        });
      }

      // Seamless periodic distant badlands mesas & ridges along the horizon
      const buildMesaLayer = (samples, baseH, amp, flatChance) => {
        const pts = [];
        let plateau = baseH;
        for (let i = 0; i < samples; i++) {
          const theta = (i / samples) * Math.PI * 2;
          const wave = Math.sin(theta * 3) * 0.45 + Math.cos(theta * 7 + 0.8) * 0.35 + Math.sin(theta * 13) * 0.2;
          if (rand() < flatChance) {
            plateau = baseH + Math.max(0, wave + 0.5) * amp;
          }
          pts.push(plateau);
        }
        return pts;
      };
      this.horizonRidges = [
        { parallax: 0.08, points: buildMesaLayer(72, 12, 26, 0.42), skyMix: 0.62 },
        { parallax: 0.16, points: buildMesaLayer(84, 5, 16, 0.5), skyMix: 0.36 }
      ];
    }

    _initTerrainAndProps() {
      let seed = 1337;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      // Wasteland terrain color patches (parched earth, windblown sand drifts, rocky badlands)
      for (let i = 0; i < scaled(72); i++) {
        this.patches.push({
          x: rand() * WORLD_W,
          y: rand() * WORLD_H,
          rx: 90 + rand() * 185,
          ry: 65 + rand() * 140,
          rot: rand() * Math.PI,
          color: i % 4 === 0
            ? 'rgba(146, 94, 64, 0.30)'
            : i % 4 === 1
              ? 'rgba(88, 72, 58, 0.36)'
              : i % 4 === 2
                ? 'rgba(186, 166, 134, 0.26)'
                : 'rgba(76, 64, 54, 0.32)',
          innerColor: i % 2 === 0 ? 'rgba(196, 176, 142, 0.16)' : 'rgba(54, 42, 32, 0.20)'
        });
      }

      // Wind-carved desert sand drift streaks
      for (let i = 0; i < scaled(65); i++) {
        const angle = -0.35 + (rand() - 0.5) * 0.4;
        const len = 70 + rand() * 120;
        this.ripples.push({
          x: rand() * WORLD_W,
          y: rand() * WORLD_H,
          dx: Math.cos(angle) * len,
          dy: Math.sin(angle) * len,
          cx: Math.cos(angle) * len * 0.5 - Math.sin(angle) * (10 + rand() * 14),
          cy: Math.sin(angle) * len * 0.5 + Math.cos(angle) * (10 + rand() * 14),
          alpha: 0.16 + rand() * 0.14
        });
      }

      // Dry wasteland scrub bushes & dead desert tufts (purely ground visual detail)
      for (let i = 0; i < scaled(64); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        if (Math.hypot(x - SPAWN_X, y - SPAWN_Y) < 110) continue;
        this.scrubs.push({
          x,
          y,
          scale: 0.75 + rand() * 0.7,
          rot: rand() * Math.PI * 2,
          tone: i % 3 === 0 ? '#786842' : i % 3 === 1 ? '#685b3b' : '#856e43'
        });
      }

      // Wasteland dry cracks (2-segment jagged fissures) & gravel clusters
      this.cracks = [];
      for (let i = 0; i < scaled(110); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        const angle = rand() * Math.PI * 2;
        const len1 = 16 + rand() * 28;
        const bend = angle + (rand() - 0.5) * 1.1;
        const len2 = 12 + rand() * 26;
        this.cracks.push({
          x,
          y,
          dx1: Math.cos(angle) * len1,
          dy1: Math.sin(angle) * len1,
          dx2: Math.cos(angle) * len1 + Math.cos(bend) * len2,
          dy2: Math.sin(angle) * len1 + Math.sin(bend) * len2,
          isPebble: i % 3 === 0,
          r: 2.5 + rand() * 4.5
        });
      }


      // Destructible Supply Crates & Glowing Crystals
      for (let i = 0; i < scaled(36); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        if (Math.hypot(x - SPAWN_X, y - SPAWN_Y) < 160) continue;
        const isCrystal = i % 3 === 0;
        const propHp = isCrystal ? 32 : 25;
        this.props.push({
          type: isCrystal ? 'crystal' : 'crate',
          x,
          y,
          radius: 20,
          hp: propHp,
          maxHp: propHp,
          scrap: isCrystal ? 22 : 16,
          alive: true
        });
      }

      // Explosive Fuel Barrels
      for (let i = 0; i < scaled(22); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        if (Math.hypot(x - SPAWN_X, y - SPAWN_Y) < 160) continue;
        this.props.push({
          type: 'barrel',
          x,
          y,
          radius: 16,
          hp: 15,
          maxHp: 15,
          scrap: 8,
          alive: true
        });
      }

      // Jump Pads (launch tank into 2D airborne arc!)
      const rampCoords = [
        [820, 920], [1580, 920], [820, 1520], [1580, 1520],
        [400, 420], [2000, 420], [400, 1980], [2000, 1980]
      ];
      for (let ox = 0; ox < WORLD_W; ox += BASE_WORLD) {
        for (let oy = 0; oy < WORLD_H; oy += BASE_WORLD) {
          for (const [rx, ry] of rampCoords) {
            this.ramps.push({ x: rx + ox, y: ry + oy, radius: 34 });
          }
        }
      }

      // Large solid boulders (radius ~100-160). Spaced so tanks can always drive between them,
      // and kept clear of the spawn point and jump pads.
      const MAX_ROCKS = scaled(14);
      const ROCK_SCALE = 4.5;
      const dist = (ax, ay, bx, by) => Math.hypot(this.deltaX(ax, bx), this.deltaY(ay, by));
      for (let tries = 0; this.obstacles.length < MAX_ROCKS && tries < 600 * AREA_SCALE; tries++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        const radius = (22 + rand() * 14) * ROCK_SCALE;
        const rot = rand() * Math.PI * 2;
        if (dist(x, y, SPAWN_X, SPAWN_Y) < radius + 170) continue;
        if (this.ramps.some((r) => dist(x, y, r.x, r.y) < radius + r.radius + 90)) continue;
        if (this.obstacles.some((o) => dist(x, y, o.x, o.y) < radius + o.radius + 140)) continue;
        this.obstacles.push(this._makeRock(x, y, radius, rot, rand));
      }

      // Drop crates/barrels that would be buried inside a boulder
      this.props = this.props.filter((pr) =>
        !this.obstacles.some((o) => dist(pr.x, pr.y, o.x, o.y) < o.radius + pr.radius + 8));
    }

    // Enemy strongholds: fixed compound sites with bunker emplacements (inner ring) and parking
    // spots for idle tanks (outer ring). Combat spawns the garrison; the world only owns the layout.
    _initEnemyBases() {
      let seed = 2718;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const dist = (ax, ay, bx, by) => Math.hypot(this.deltaX(ax, bx), this.deltaY(ay, by));
      const names = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι'];

      // Per band: place compounds fully inside the band. Strict spacing first, then
      // progressively relaxed until they fit among the boulders.
      const passes = [
        { margin: 230, spawn: 720, clear: 230, sep: 760 },
        { margin: 215, spawn: 700, clear: 215, sep: 660 },
        { margin: 200, spawn: 690, clear: 200, sep: 600 }
      ];
      const placed = [];
      for (const x0 of SITE_BANDS) {
        const sites = [];
        for (const pass of passes) {
          const span = SITE_BAND_WIDTH - pass.margin * 2;
          for (let tries = 0; sites.length < BASES_PER_BAND && tries < 4000; tries++) {
            const x = this.wrapX(x0 + pass.margin + rand() * span);
            const y = rand() * WORLD_H;
            if (dist(x, y, SPAWN_X, SPAWN_Y) < pass.spawn) continue;
            if (this.obstacles.some((o) => dist(x, y, o.x, o.y) < o.radius + pass.clear)) continue;
            if (this.ramps.some((r) => dist(x, y, r.x, r.y) < r.radius + pass.clear)) continue;
            if ([...placed, ...sites].some((s) => dist(x, y, s.x, s.y) < pass.sep)) continue;
            sites.push({ x, y });
          }
          if (sites.length >= BASES_PER_BAND) break;
        }
        placed.push(...sites);
      }

      this.enemyBases = placed.map((s, i) => {
        const rot = rand() * Math.PI * 2;
        const bunkerSlots = [];
        for (let k = 0; k < 2; k++) {
          const a = rot + k * Math.PI + 0.4;
          bunkerSlots.push({ x: this.wrapX(s.x + Math.cos(a) * 70), y: this.wrapY(s.y + Math.sin(a) * 70), angle: a });
        }
        const parkingSlots = [];
        for (let k = 0; k < 6; k++) {
          const a = rot + (k / 6) * Math.PI * 2 + 0.52;
          parkingSlots.push({ x: this.wrapX(s.x + Math.cos(a) * 158), y: this.wrapY(s.y + Math.sin(a) * 158), angle: a });
        }
        return {
          id: i,
          name: names[i] || String(i + 1),
          x: s.x,
          y: s.y,
          radius: 200,
          rot,
          bunkerSlots,
          parkingSlots
        };
      });

      // Keep crates/barrels out of the compounds
      this.props = this.props.filter((pr) =>
        !this.enemyBases.some((b) => dist(pr.x, pr.y, b.x, b.y) < b.radius + 10));
    }

    // Low-poly 3D boulder: jagged base ring, raised mid ring and a peak. Facet shading is baked
    // once from a fixed sun direction so drawing is just projected polygon fills.
    _makeRock(x, y, radius, rot, rand) {
      const n = 9;
      const h = radius * (0.48 + rand() * 0.2);
      const base = [];
      const mid = [];
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        const jag = 0.84 + rand() * 0.24;
        base.push([Math.cos(a) * radius * jag, Math.sin(a) * radius * jag, 0]);
        // Irregular shoulder ring: varied reach and height gives a weathered, lumpy silhouette
        const ma = a + (rand() - 0.5) * 0.5;
        const mj = 0.42 + rand() * 0.32;
        mid.push([Math.cos(ma) * radius * mj, Math.sin(ma) * radius * mj, h * (0.45 + rand() * 0.42)]);
      }
      const top = [(rand() - 0.5) * radius * 0.4, (rand() - 0.5) * radius * 0.4, h];

      // Sun from the north-west, high in the sky (world: +x east, +y south, +z up)
      const L = [-0.45, -0.55, 0.7];
      const lLen = Math.hypot(L[0], L[1], L[2]);
      // Mix of weathered grey-brown rock and reddish desert sandstone
      const tone = rand();
      const baseRgb = rand() < 0.4
        ? [130 + tone * 18, 118 + tone * 14, 104 + tone * 12]
        : [164 + tone * 20, 126 + tone * 16, 96 + tone * 12];

      const facets = [];
      const addFacet = (verts) => {
        const [a, b, c] = verts;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        // Orient outward (away from the rock's core)
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const v of verts) {
          cx += v[0];
          cy += v[1];
          cz += v[2];
        }
        cx /= verts.length;
        cy /= verts.length;
        cz /= verts.length;
        if (nx * cx + ny * cy + nz * (cz - h * 0.3) < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nLen = Math.hypot(nx, ny, nz) || 1;
        const lambert = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / (nLen * lLen));
        const k = 0.36 + lambert * 0.78;
        const r = Math.min(255, Math.round(baseRgb[0] * k));
        const g = Math.min(255, Math.round(baseRgb[1] * k));
        const bl = Math.min(255, Math.round(baseRgb[2] * k));
        facets.push({ verts, rgb: [r, g, bl], color: `rgb(${r}, ${g}, ${bl})` });
      };
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        addFacet([base[i], base[j], mid[j], mid[i]]);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        addFacet([mid[i], mid[j], top]);
      }

      return {
        x,
        y,
        radius: radius * 0.94, // collision radius ~ average of the jagged base ring
        height: h,
        rot,
        base,
        facets
      };
    }

    // Extra wasteland surface detail. Uses its own RNG so the layout of props/obstacles is unchanged.
    _initWastelandDetail() {
      let seed = 9001;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const nearSpawn = (x, y, r) => Math.hypot(x - SPAWN_X, y - SPAWN_Y) < r;

      // Ragged, irregular outlines for terrain colour patches (instead of perfect ellipses)
      for (const patch of this.patches) {
        const n = 20;
        const f1 = 2 + Math.floor(rand() * 3);
        const f2 = 5 + Math.floor(rand() * 4);
        const ph1 = rand() * Math.PI * 2;
        const ph2 = rand() * Math.PI * 2;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r = 1 + Math.sin(a * f1 + ph1) * 0.17 + Math.sin(a * f2 + ph2) * 0.09 + (rand() - 0.5) * 0.16;
          pts.push(Math.cos(a) * patch.rx * r, Math.sin(a) * patch.ry * r);
        }
        patch.shape = pts;
      }

      // More dead brush on top of the original tufts
      const scrubTones = ['#8a7b5c', '#76694c', '#9a8462', '#6b5f49'];
      for (let i = 0; i < scaled(70); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        if (nearSpawn(x, y, 110)) continue;
        this.scrubs.push({ x, y, scale: 0.7 + rand() * 0.9, rot: rand() * Math.PI * 2, tone: scrubTones[i % 4] });
      }
      // Branching dead twigs for every scrub (precomputed segment list: x1,y1,x2,y2,...)
      for (const sc of this.scrubs) {
        sc.tone = scrubTones[Math.floor(rand() * scrubTones.length)];
        const segs = [];
        const branches = 5 + Math.floor(rand() * 4);
        for (let b = 0; b < branches; b++) {
          const a = (b / branches) * Math.PI * 2 + (rand() - 0.5) * 0.7;
          const len = 8 + rand() * 8;
          const x1 = Math.cos(a) * len;
          const y1 = Math.sin(a) * len;
          segs.push(0, 0, x1, y1);
          const forks = 1 + Math.floor(rand() * 2);
          for (let f = 0; f < forks; f++) {
            const t = 0.4 + rand() * 0.45;
            const fa = a + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.55);
            const fl = len * (0.3 + rand() * 0.3);
            segs.push(x1 * t, y1 * t, x1 * t + Math.cos(fa) * fl, y1 * t + Math.sin(fa) * fl);
          }
        }
        sc.twigs = segs;
      }

      // Cracked dry-mud hardpan flats (drawn from pre-rendered sprites)
      this.hardpans = [];
      for (let i = 0; i < scaled(18); i++) {
        const x = rand() * WORLD_W;
        const y = rand() * WORLD_H;
        const size = 230 + rand() * 180;
        const rot = rand() * Math.PI * 2;
        const flip = rand() < 0.5;
        this.hardpans.push({ x, y, size, rot, flip, variant: i % 4 });
      }

      // Scattered gravel / stone clusters (ground grain)
      this.gravel = [];
      for (let i = 0; i < scaled(320); i++) {
        this.gravel.push({
          x: rand() * WORLD_W,
          y: rand() * WORLD_H,
          size: 38 + rand() * 52,
          variant: i % 4
        });
      }

      // Dried-up gullies / wadis meandering across the plain
      this.gullies = [];
      for (let g = 0; g < scaled(8); g++) {
        let x = rand() * WORLD_W;
        let y = rand() * WORLD_H;
        let a = rand() * Math.PI * 2;
        const n = 12 + Math.floor(rand() * 9);
        const w0 = 9 + rand() * 8;
        const pts = [];
        for (let i = 0; i < n; i++) {
          pts.push({ x: this.wrapX(x), y: this.wrapY(y), ux: x, uy: y, w: w0 * (1 - (i / n) * 0.7) });
          a += (rand() - 0.5) * 0.75;
          const step = 36 + rand() * 26;
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
        }
        this.gullies.push(pts);
      }
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldTerrain);
})(window);
