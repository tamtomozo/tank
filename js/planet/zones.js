(function (global) {
  'use strict';

  // Operation layer over the generated map: every operation (js/data/operations.js) picks its own
  // enemy compounds and may lay areas over the map —
  //   saltflat  a flat white salt plain: the rocks and jump pads inside are cleared
  //   city      an old oasis town: a grid of narrow streets between solid buildings (they block
  //             tanks and shells), an open square in the middle, an oasis pond by the west road
  // Compounds at a fixed position also get the rocks around them cleared.
  // Also: the collision helpers shared by tanks, the AI and shells (round rocks + box buildings).
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { makeBox } = global.HorizonWorld.shared;

  const SITE_CLEAR_RADIUS = 240; // rocks this close to a fixed compound centre are cleared
  const CITY_CELL = 200; // town block pitch; streets run along the block edges
  const CITY_STREET = 100; // narrowest street width between two buildings
  const BUILDING_SITE_CLEAR = 190; // no building this close to a compound centre (parked tanks)

  const ADOBE = [
    [204, 178, 136],
    [190, 162, 122],
    [214, 196, 158],
    [178, 150, 112]
  ];

  function seededRand(seed) {
    let s = Math.max(1, Math.floor(seed)) % 2147483647;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // Reused result of surfaceGap (no allocation per call: it runs for every tank and every solid)
  const gapOut = { nx: 0, ny: 0, gap: 0 };

  class WorldZones {
    // Layout of one compound centred on (x, y): two bunker emplacements on the inner ring and six
    // parking spots on the outer ring (or the given parking offsets [[dx, dy], ...])
    _siteLayout(x, y, rot, parking = null) {
      const bunkerSlots = [];
      for (let k = 0; k < 2; k++) {
        const a = rot + k * Math.PI + 0.4;
        bunkerSlots.push({ x: this.wrapX(x + Math.cos(a) * 70), y: this.wrapY(y + Math.sin(a) * 70), angle: a });
      }
      const parkingSlots = [];
      if (parking) {
        for (const [dx, dy] of parking) {
          parkingSlots.push({ x: this.wrapX(x + dx), y: this.wrapY(y + dy), angle: Math.atan2(dy, dx) });
        }
      } else {
        for (let k = 0; k < 6; k++) {
          const a = rot + (k / 6) * Math.PI * 2 + 0.52;
          parkingSlots.push({ x: this.wrapX(x + Math.cos(a) * 158), y: this.wrapY(y + Math.sin(a) * 158), angle: a });
        }
      }
      return { x, y, radius: 200, rot, bunkerSlots, parkingSlots };
    }

    // Set the map up for an operation (null = none): its compounds, areas, buildings and the
    // rocks they clear. Rebuilds the ground texture; compounds are stamped onto it again as they
    // are garrisoned (revealBase).
    applyOperation(op) {
      const dist = (ax, ay, bx, by) => Math.hypot(this.deltaX(ax, bx), this.deltaY(ay, by));
      const zones = op && op.zones ? op.zones.map((z) => ({ ...z, x: this.wrapX(z.x), y: this.wrapY(z.y) })) : [];
      const siteDefs = op && op.sites ? op.sites : [];

      this.sites = siteDefs.map((d, i) => {
        if (d.slot != null) {
          const g = this.enemyBases[d.slot % this.enemyBases.length];
          return { ...g, id: i, name: d.name, fixed: false };
        }
        const layout = this._siteLayout(this.wrapX(d.x), this.wrapY(d.y), d.rot || 0, d.parking || null);
        return { ...layout, id: i, name: d.name, fixed: true };
      });

      // Rocks and jump pads inside an area or around a fixed compound are cleared
      const clear = [
        ...zones.map((z) => ({ x: z.x, y: z.y, r: z.radius + 60 })),
        ...this.sites.filter((s) => s.fixed).map((s) => ({ x: s.x, y: s.y, r: SITE_CLEAR_RADIUS }))
      ];
      const blocked = (x, y, r) => clear.some((c) => dist(x, y, c.x, c.y) < c.r + r);
      this.obstacles = this.allObstacles.filter((o) => !blocked(o.x, o.y, o.radius));
      this.ramps = this.allRamps.filter((r) => !blocked(r.x, r.y, r.radius));

      this.structures = [];
      for (const z of zones) {
        if (z.kind === 'city') this._buildCity(z);
        else if (z.kind === 'saltflat') this._prepareSaltflat(z);
      }
      this.zones = zones;
      this.colliders = [...this.obstacles, ...this.hq.colliders, ...this.structures];

      this.revealedBases.clear();
      this._buildGroundTexture();
    }

    // Zone (if any) the point lies in
    zoneAt(x, y) {
      for (const z of this.zones) {
        if (Math.hypot(this.deltaX(z.x, x), this.deltaY(z.y, y)) < z.radius) return z;
      }
      return null;
    }

    // ---- old town --------------------------------------------------------------------------------
    // Blocks on a CITY_CELL grid centred on the town; the streets through the centre (east-west
    // and north-south) always stay open, the square in the middle is left empty. Some neighbouring
    // blocks are joined across a side street, which makes dead ends; a few blocks are towers,
    // courtyards or split in two.
    _buildCity(z) {
      const rand = seededRand(z.seed || 7);
      const cell = CITY_CELL;
      const half = cell * 0.5;
      const edge = CITY_STREET * 0.5; // a building stays this far from its block edge
      const n = Math.ceil(z.radius / cell) + 1;
      const plaza = z.plaza || 250;
      const free = new Set();
      const key = (i, j) => `${i},${j}`;
      for (let i = -n; i < n; i++) {
        for (let j = -n; j < n; j++) {
          const cx = (i + 0.5) * cell;
          const cy = (j + 0.5) * cell;
          if (Math.hypot(cx, cy) > z.radius) continue;
          if (Math.abs(cx) < plaza && Math.abs(cy) < plaza) continue;
          free.add(key(i, j));
        }
      }

      const sites = this.sites;
      const add = (cx, cy, hx, hy, h, rgb) => {
        const x = this.wrapX(z.x + cx);
        const y = this.wrapY(z.y + cy);
        // Keep clear of compounds (their parked tanks and bunkers)
        for (const s of sites) {
          const dx = Math.abs(this.deltaX(x, s.x)) - hx;
          const dy = Math.abs(this.deltaY(y, s.y)) - hy;
          if (Math.hypot(Math.max(0, dx), Math.max(0, dy)) < BUILDING_SITE_CLEAR) return;
        }
        const solid = makeBox(x, y, hx, hy, h, rgb);
        solid.box = { hx, hy };
        solid.radius = Math.hypot(hx, hy);
        this.structures.push(solid);
      };

      const used = new Set();
      const cellsInOrder = [...free].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [i, j] of cellsInOrder) {
        if (used.has(key(i, j))) continue;
        used.add(key(i, j));
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        const rgb = ADOBE[Math.floor(rand() * ADOBE.length)];
        const shrink = () => rand() * 14;
        const r = rand();

        // Join with the block to the east / south across a side street (never across a street
        // through the centre: those stay open from the edge of town to the square)
        const east = key(i + 1, j);
        const south = key(i, j + 1);
        if (r < 0.2 && i + 1 !== 0 && free.has(east) && !used.has(east)) {
          used.add(east);
          add(cx + half, cy, cell - edge - shrink(), half - edge - shrink(), 30 + rand() * 24, rgb);
          continue;
        }
        if (r < 0.38 && j + 1 !== 0 && free.has(south) && !used.has(south)) {
          used.add(south);
          add(cx, cy + half, half - edge - shrink(), cell - edge - shrink(), 30 + rand() * 24, rgb);
          continue;
        }
        if (r < 0.46) continue; // courtyard / ruin: an open block
        if (r < 0.56) {
          // Watch tower: narrow and tall
          add(cx, cy, 24, 24, 78 + rand() * 18, rgb);
          continue;
        }
        if (r < 0.7) {
          // Two houses side by side with a narrow alley between them (too narrow for a tank)
          const hx = (half - edge) * 0.5 - 4;
          add(cx - hx - 4, cy, hx, half - edge - shrink(), 26 + rand() * 18, rgb);
          add(cx + hx + 4, cy, hx, half - edge - shrink(), 32 + rand() * 18, ADOBE[Math.floor(rand() * ADOBE.length)]);
          continue;
        }
        add(cx, cy, half - edge - shrink(), half - edge - shrink(), 28 + rand() * 28, rgb);
      }

      // Oasis pond outside the town by the west road (ground decal only: shallow water)
      z.pond = { dx: -z.radius * 0.74, dy: z.radius * 0.7, rx: 120, ry: 78 };
    }

    // ---- salt flat -------------------------------------------------------------------------------
    // Polygonal salt-crust pattern (fixed per seed), stamped with the ground
    _prepareSaltflat(z) {
      const rand = seededRand(z.seed || 3);
      const cells = [];
      const step = 74;
      for (let y = -z.radius; y <= z.radius; y += step) {
        for (let x = -z.radius; x <= z.radius; x += step) {
          const px = x + (rand() - 0.5) * step * 0.6;
          const py = y + (rand() - 0.5) * step * 0.6;
          if (Math.hypot(px, py) > z.radius - 30) continue;
          const pts = [];
          const sides = 5 + Math.floor(rand() * 3);
          const rot = rand() * Math.PI;
          for (let k = 0; k < sides; k++) {
            const a = rot + (k / sides) * Math.PI * 2;
            const rr = step * (0.42 + rand() * 0.14);
            pts.push(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
          }
          cells.push(pts);
        }
      }
      z.saltCells = cells;
    }

    // Ground of an area, baked into the ground texture (origin = area centre)
    _drawZoneGround(g, z) {
      if (z.kind === 'saltflat') {
        const grad = g.createRadialGradient(0, 0, z.radius * 0.55, 0, 0, z.radius + 110);
        grad.addColorStop(0, 'rgba(236, 232, 220, 0.94)');
        grad.addColorStop(0.75, 'rgba(226, 220, 204, 0.85)');
        grad.addColorStop(1, 'rgba(226, 220, 204, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, z.radius + 110, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(160, 150, 128, 0.32)';
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.beginPath();
        for (const pts of z.saltCells || []) {
          g.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
          g.closePath();
        }
        g.stroke();
        return;
      }
      if (z.kind === 'city') {
        // Packed sand streets, a paved square, wheel ruts along the main streets
        const grad = g.createRadialGradient(0, 0, z.radius * 0.6, 0, 0, z.radius + 100);
        grad.addColorStop(0, 'rgba(196, 170, 128, 0.9)');
        grad.addColorStop(0.8, 'rgba(184, 156, 116, 0.7)');
        grad.addColorStop(1, 'rgba(184, 156, 116, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, z.radius + 100, 0, Math.PI * 2);
        g.fill();

        const plaza = z.plaza || 250;
        g.fillStyle = 'rgba(214, 196, 160, 0.9)';
        g.fillRect(-plaza, -plaza, plaza * 2, plaza * 2);
        g.strokeStyle = 'rgba(150, 126, 92, 0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let v = -plaza; v <= plaza; v += 40) {
          g.moveTo(v, -plaza);
          g.lineTo(v, plaza);
          g.moveTo(-plaza, v);
          g.lineTo(plaza, v);
        }
        g.stroke();

        g.strokeStyle = 'rgba(96, 74, 50, 0.22)';
        g.lineWidth = 5;
        g.beginPath();
        for (const off of [-14, 14]) {
          g.moveTo(-z.radius - 80, off);
          g.lineTo(z.radius + 80, off);
          g.moveTo(off, -z.radius - 80);
          g.lineTo(off, z.radius + 80);
        }
        g.stroke();

        if (z.pond) {
          const p = z.pond;
          g.fillStyle = 'rgba(92, 120, 64, 0.55)';
          g.beginPath();
          g.ellipse(p.dx, p.dy, p.rx + 26, p.ry + 22, 0.2, 0, Math.PI * 2);
          g.fill();
          const w = g.createRadialGradient(p.dx, p.dy, 10, p.dx, p.dy, p.rx);
          w.addColorStop(0, 'rgba(40, 110, 140, 0.95)');
          w.addColorStop(1, 'rgba(70, 150, 170, 0.85)');
          g.fillStyle = w;
          g.beginPath();
          g.ellipse(p.dx, p.dy, p.rx, p.ry, 0.2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // ---- collision helpers -----------------------------------------------------------------------
    // Distance from point (x, y) to the surface of a solid (rock circle or building box) and the
    // outward direction: { nx, ny, gap } (gap < 0 inside). The returned object is reused.
    surfaceGap(obs, x, y) {
      const dx = this.deltaX(obs.x, x);
      const dy = this.deltaY(obs.y, y);
      const box = obs.box;
      if (box) {
        const qx = Math.max(-box.hx, Math.min(box.hx, dx));
        const qy = Math.max(-box.hy, Math.min(box.hy, dy));
        const vx = dx - qx;
        const vy = dy - qy;
        const d = Math.hypot(vx, vy);
        if (d > 0.0001) {
          gapOut.nx = vx / d;
          gapOut.ny = vy / d;
          gapOut.gap = d;
        } else {
          // Inside: push out through the nearest side
          const px = box.hx - Math.abs(dx);
          const py = box.hy - Math.abs(dy);
          if (px < py) {
            gapOut.nx = dx < 0 ? -1 : 1;
            gapOut.ny = 0;
            gapOut.gap = -px;
          } else {
            gapOut.nx = 0;
            gapOut.ny = dy < 0 ? -1 : 1;
            gapOut.gap = -py;
          }
        }
        return gapOut;
      }
      const d = Math.hypot(dx, dy);
      if (d > 0.0001) {
        gapOut.nx = dx / d;
        gapOut.ny = dy / d;
      } else {
        gapOut.nx = 1;
        gapOut.ny = 0;
      }
      gapOut.gap = d - obs.radius;
      return gapOut;
    }

    // Building a shell at (x, y, z) has flown into, or null
    structureHit(x, y, z) {
      for (const s of this.structures) {
        if (z >= s.height) continue;
        if (Math.abs(this.deltaX(s.x, x)) < s.box.hx && Math.abs(this.deltaY(s.y, y)) < s.box.hy) return s;
      }
      return null;
    }

    // True when (x, y) is clear of every solid by `margin` (spawn points of reinforcements)
    isClearSpot(x, y, margin) {
      for (const obs of this.colliders) {
        if (Math.hypot(this.deltaX(obs.x, x), this.deltaY(obs.y, y)) > obs.radius + margin + 10) continue;
        if (this.surfaceGap(obs, x, y).gap < margin) return false;
      }
      return true;
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldZones);
})(window);
