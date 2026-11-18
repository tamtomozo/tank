(function (global) {
  'use strict';

  // Operation layer over the generated map: every operation (js/data/operations.js) picks its own
  // enemy compounds and may lay areas over the map —
  //   saltflat  a flat white salt plain: the rocks and jump pads inside are cleared
  //   city      a town: a grid of narrow streets between solid buildings (they block tanks and
  //             shells), an open square in the middle. style 'oasis' (adobe, a pond by the west
  //             road), 'snow' (grey stone, snow on the roofs) or 'industrial': light-coloured homes
  //             and shops (civilian: they can be destroyed, js/combat/city.js), dark factory halls
  //             and warehouses (indestructible) and farms of fuel tanks (red tops: they explode)
  //   lake      a frozen lake: smooth ice with darker patches of thin ice (js/combat/ice.js)
  //   highway   elevated roads: straight legs (axis-aligned) of a raised deck on a solid
  //             embankment, with gaps to pass through; they block tanks and shells. Gun turrets
  //             can stand on the deck (deckHeightAt)
  //   factory   a walled hall with doors in the middle of the given sides and production lines inside
  // A zone listed earlier keeps its ground: the buildings of a later town stay clear of it.
  // Compounds at a fixed position also get the rocks around them cleared.
  // Also: the collision helpers shared by tanks, the AI and shells (round rocks + box buildings).
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { makeSolid } = global.HorizonWorld.shared;

  const SITE_CLEAR_RADIUS = 240; // rocks this close to a fixed compound centre are cleared
  const CITY_CELL = 200; // town block pitch; streets run along the block edges
  const CITY_STREET = 100; // narrowest street width between two buildings
  const BUILDING_SITE_CLEAR = 190; // no building this close to a compound centre (parked tanks)

  // Wall colours per town style; roofs: adobe a shade lighter, snow towns white
  const WALLS = {
    oasis: [[204, 178, 136], [190, 162, 122], [214, 196, 158], [178, 150, 112]],
    snow: [[118, 126, 140], [104, 112, 126], [132, 138, 150], [96, 100, 112]]
  };
  const SNOW_ROOF = [236, 242, 250];

  // Industrial town: civilian homes / shops (light walls, warm roofs) and industry (dark, rusty)
  const CIVIL_WALLS = [[178, 170, 154], [166, 170, 178], [186, 174, 158], [160, 158, 150]];
  const CIVIL_ROOFS = [[198, 160, 120], [186, 146, 108], [206, 176, 138]];
  const INDUSTRY_WALLS = [[92, 88, 84], [104, 86, 72], [84, 86, 90], [98, 94, 88]];
  const INDUSTRY_ROOF = [66, 64, 62];
  const CIVIL_HP = 150; // armour of a civilian building (about four direct hits)
  const FUEL_HP = 45;

  const DECK_H = 46; // height of an elevated highway deck
  const DECK_HALF = 34; // half its width
  const DECK_PIECE = 170; // longest straight piece of deck (long solids bend badly on the curved ground)
  const FACTORY_WALL = 22; // factory wall thickness
  const FACTORY_H = 64;
  const FACTORY_DOOR = 210;
  const HQ_KEEP_CLEAR = 330; // no building this close to the operations HQ

  // Box building (same data shape as a boulder, see makeSolid in js/planet/hq.js)
  // Fuel tank: an octagonal drum with a red top (a circle for collisions and shells)
  function makeFuelTank(x, y, r, h) {
    const b = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      b.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
    }
    const t = b.map(([px, py]) => [px, py, h]);
    const faces = [];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      faces.push({ verts: [b[i], b[j], t[j], t[i]], rgb: [200, 196, 188] });
    }
    faces.push({ verts: t, rgb: [178, 58, 44] });
    const solid = makeSolid(x, y, r, h, b, faces, [0, 0, h * 0.5]);
    solid.kind = 'fuel';
    solid.fuel = true;
    solid.hp = solid.maxHp = FUEL_HP;
    return solid;
  }

  function makeBuilding(x, y, hx, hy, h, wall, roof) {
    const b = [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]];
    const t = b.map(([px, py]) => [px, py, h]);
    const faces = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      faces.push({ verts: [b[i], b[j], t[j], t[i]], rgb: wall });
    }
    faces.push({ verts: t, rgb: roof });
    const solid = makeSolid(x, y, Math.hypot(hx, hy), h, b, faces, [0, 0, h * 0.5]);
    solid.box = { hx, hy };
    solid.kind = 'building';
    return solid;
  }

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
    // themeId: the planet's look (planet.theme, js/planet/planet.js THEMES)
    applyOperation(op, themeId = 'desert') {
      this.setTheme(themeId);
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
      this.zones = zones; // (the town builder checks the zones laid before it)
      for (const z of zones) {
        if (z.kind === 'city') this._buildCity(z);
        else if (z.kind === 'saltflat') this._prepareSaltflat(z);
        else if (z.kind === 'lake') this._prepareLake(z);
        else if (z.kind === 'highway') this._buildHighway(z);
        else if (z.kind === 'factory') this._buildFactory(z);
      }
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

    // Frozen lake the point lies on (null if none); thin: on one of its thin-ice patches
    iceAt(x, y) {
      for (const z of this.zones) {
        if (z.kind !== 'lake') continue;
        const dx = this.deltaX(z.x, x);
        const dy = this.deltaY(z.y, y);
        if (Math.hypot(dx, dy) >= z.radius) continue;
        const thin = z.thin.some((t) => Math.hypot(dx - t.dx, dy - t.dy) < t.r);
        return { lake: z, thin };
      }
      return null;
    }

    // ---- frozen lake -----------------------------------------------------------------------------
    // Thin-ice patches (fixed per seed) and the crack pattern of the ice
    _prepareLake(z) {
      const rand = seededRand(z.seed || 5);
      z.thin = [];
      const want = z.thinCount != null ? z.thinCount : 6;
      for (let tries = 0; z.thin.length < want && tries < 300; tries++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * (z.radius - 120);
        const t = { dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: 70 + rand() * 60 };
        // Keep clear of the survey points and of each other
        if ((z.keepClear || []).some(([kx, ky]) => Math.hypot(t.dx - kx, t.dy - ky) < t.r + 70)) continue;
        if (z.thin.some((o) => Math.hypot(t.dx - o.dx, t.dy - o.dy) < t.r + o.r + 40)) continue;
        z.thin.push(t);
      }
      z.cracks = [];
      for (let i = 0; i < 46; i++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * z.radius * 0.92;
        const pts = [Math.cos(a) * d, Math.sin(a) * d];
        let ang = rand() * Math.PI * 2;
        for (let k = 0; k < 3; k++) {
          ang += (rand() - 0.5) * 1.2;
          const len = 30 + rand() * 60;
          pts.push(pts[pts.length - 2] + Math.cos(ang) * len, pts[pts.length - 1] + Math.sin(ang) * len);
        }
        z.cracks.push(pts);
      }
    }

    // ---- old town --------------------------------------------------------------------------------
    // Blocks on a CITY_CELL grid centred on the town; the streets through the centre (east-west
    // and north-south) always stay open, the square in the middle is left empty. Some neighbouring
    // blocks are joined across a side street, which makes dead ends; a few blocks are towers,
    // courtyards or split in two.
    _buildCity(z) {
      const rand = seededRand(z.seed || 7);
      const style = z.style === 'snow' || z.style === 'industrial' ? z.style : 'oasis';
      const industrial = style === 'industrial';
      const walls = industrial ? CIVIL_WALLS : WALLS[style];
      const roofOf = (rgb) => (style === 'snow' ? SNOW_ROOF : rgb.map((c) => c + 16));
      const pick = (list) => list[Math.floor(rand() * list.length)];
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
          // Keep clear of the elevated highway ring around the town centre (z.ring = its half-size)
          if (z.ring && Math.abs(Math.max(Math.abs(cx), Math.abs(cy)) - z.ring) < cell * 0.75) continue;
          free.add(key(i, j));
        }
      }

      const sites = this.sites;
      const earlier = this.structures.slice(); // solids of the zones laid before this town
      // Can a footprint of half-size (hx, hy) stand at (x, y)? Not near a compound (its parked
      // tanks and bunkers), the HQ, a solid laid by an earlier zone (highway, factory walls: a
      // street's width away) or inside a factory hall
      const fits = (x, y, hx, hy) => {
        for (const s of sites) {
          const dx = Math.abs(this.deltaX(x, s.x)) - hx;
          const dy = Math.abs(this.deltaY(y, s.y)) - hy;
          if (Math.hypot(Math.max(0, dx), Math.max(0, dy)) < BUILDING_SITE_CLEAR) return false;
        }
        if (this.hq && Math.hypot(this.deltaX(x, this.hq.x), this.deltaY(y, this.hq.y)) < HQ_KEEP_CLEAR + Math.max(hx, hy)) return false;
        for (const o of earlier) {
          const ohx = o.box ? o.box.hx : o.radius;
          const ohy = o.box ? o.box.hy : o.radius;
          if (Math.abs(this.deltaX(x, o.x)) < hx + ohx + CITY_STREET * 0.6 &&
              Math.abs(this.deltaY(y, o.y)) < hy + ohy + CITY_STREET * 0.6) return false;
        }
        for (const f of this.zones || []) {
          if (f.kind !== 'factory') continue;
          if (Math.abs(this.deltaX(x, f.x)) < hx + f.hx + CITY_STREET && Math.abs(this.deltaY(y, f.y)) < hy + f.hy + CITY_STREET) return false;
        }
        return true;
      };
      // kind: 'civil' (destructible home / shop), 'industry' (factory hall, warehouse) or plain
      const add = (cx, cy, hx, hy, h, rgb, kind = null) => {
        const x = this.wrapX(z.x + cx);
        const y = this.wrapY(z.y + cy);
        if (!fits(x, y, hx, hy)) return;
        let b;
        if (kind === 'industry') {
          const wall = pick(INDUSTRY_WALLS);
          b = makeBuilding(x, y, hx, hy, h, wall, INDUSTRY_ROOF);
          b.industry = true;
        } else if (kind === 'civil') {
          b = makeBuilding(x, y, hx, hy, h, rgb, pick(CIVIL_ROOFS));
          b.civil = true;
          b.hp = b.maxHp = CIVIL_HP;
        } else {
          b = makeBuilding(x, y, hx, hy, h, rgb, roofOf(rgb));
        }
        this.structures.push(b);
      };
      // A farm of fuel tanks in an open block (industrial town)
      const tankFarm = (cx, cy) => {
        const n = 2 + Math.floor(rand() * 2);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rand();
          const r = 22 + rand() * 8;
          const x = this.wrapX(z.x + cx + Math.cos(a) * 42);
          const y = this.wrapY(z.y + cy + Math.sin(a) * 42);
          if (!fits(x, y, r, r)) continue;
          this.structures.push(makeFuelTank(x, y, r, 34 + rand() * 12));
        }
      };

      const used = new Set();
      const cellsInOrder = [...free].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [i, j] of cellsInOrder) {
        if (used.has(key(i, j))) continue;
        used.add(key(i, j));
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        const rgb = walls[Math.floor(rand() * walls.length)];
        const shrink = () => rand() * 14;
        const r = rand();

        // Join with the block to the east / south across a side street (never across a street
        // through the centre: those stay open from the edge of town to the square)
        const east = key(i + 1, j);
        const south = key(i, j + 1);
        // Industrial town: joined blocks are factory halls, towers are apartment blocks, open
        // blocks often hold fuel tanks, single blocks are homes or warehouses
        const joinedKind = industrial ? 'industry' : null;
        if (r < 0.2 && i + 1 !== 0 && free.has(east) && !used.has(east)) {
          used.add(east);
          add(cx + half, cy, cell - edge - shrink(), half - edge - shrink(), 30 + rand() * 24, rgb, joinedKind);
          continue;
        }
        if (r < 0.38 && j + 1 !== 0 && free.has(south) && !used.has(south)) {
          used.add(south);
          add(cx, cy + half, half - edge - shrink(), cell - edge - shrink(), 30 + rand() * 24, rgb, joinedKind);
          continue;
        }
        if (r < 0.46) {
          // courtyard / ruin: an open block (fuel tanks in an industrial town)
          if (industrial && rand() < 0.6) tankFarm(cx, cy);
          continue;
        }
        if (r < 0.56) {
          // Watch tower: narrow and tall (an apartment tower in an industrial town)
          if (industrial) add(cx, cy, 34, 34, 96 + rand() * 30, rgb, 'civil');
          else add(cx, cy, 24, 24, 78 + rand() * 18, rgb);
          continue;
        }
        if (r < 0.7) {
          // Two houses side by side with a narrow alley between them (too narrow for a tank)
          const hx = (half - edge) * 0.5 - 4;
          const kind = industrial ? 'civil' : null;
          add(cx - hx - 4, cy, hx, half - edge - shrink(), 26 + rand() * 18, rgb, kind);
          add(cx + hx + 4, cy, hx, half - edge - shrink(), 32 + rand() * 18, walls[Math.floor(rand() * walls.length)], kind);
          continue;
        }
        const kind = industrial ? (rand() < 0.62 ? 'civil' : 'industry') : null;
        add(cx, cy, half - edge - shrink(), half - edge - shrink(), 28 + rand() * (industrial ? 40 : 28), rgb, kind);
      }

      // Oasis pond outside the town by the west road (ground decal only: shallow water)
      if (style === 'oasis') z.pond = { dx: -z.radius * 0.74, dy: z.radius * 0.7, rx: 120, ry: 78 };
    }

    // ---- elevated highway / factory ---------------------------------------------------------------
    // Straight solid pieces along an axis-aligned line from (x0, y0) to (x1, y1) (zone-relative),
    // leaving out the gaps [[a, b], ...] measured along the line from its midpoint; `ext` stretches
    // both ends (so legs meeting at a corner join up)
    _solidLine(z, [x0, y0], [x1, y1], gaps, half, h, ext, make) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      const mx = (x0 + x1) * 0.5;
      const my = (y0 + y1) * 0.5;
      // Solid stretches along the line (from -len/2 - ext to len/2 + ext) between the gaps
      const sorted = (gaps || []).slice().sort((a, b) => a[0] - b[0]);
      const runs = [];
      let from = -len * 0.5 - ext;
      for (const [a, b] of sorted) {
        if (a > from) runs.push([from, a]);
        from = Math.max(from, b);
      }
      if (from < len * 0.5 + ext) runs.push([from, len * 0.5 + ext]);
      for (const [a, b] of runs) {
        const pieces = Math.max(1, Math.ceil((b - a) / DECK_PIECE));
        const step = (b - a) / pieces;
        for (let k = 0; k < pieces; k++) {
          const t = a + step * (k + 0.5);
          const cx = mx + ux * t;
          const cy = my + uy * t;
          const hl = step * 0.5;
          const hx = Math.abs(ux) > 0.5 ? hl : half;
          const hy = Math.abs(ux) > 0.5 ? half : hl;
          this.structures.push(make(this.wrapX(z.x + cx), this.wrapY(z.y + cy), hx, hy, h));
        }
      }
    }

    // Elevated highway: concrete embankment walls, an asphalt deck
    _buildHighway(z) {
      for (const leg of z.legs || []) {
        this._solidLine(z, leg.from, leg.to, leg.gaps, DECK_HALF, DECK_H, DECK_HALF, (x, y, hx, hy, h) => {
          const s = makeBuilding(x, y, hx, hy, h, [132, 128, 122], [62, 60, 60]);
          s.kind = 'highway';
          s.deck = true;
          return s;
        });
      }
    }

    // Factory hall: four walls with doors in the middle of the sides in z.doors ('n' 's' 'w' 'e'),
    // two production lines (north-south, broken in the middle) on either side of the centre
    // and a few machines along the east and west walls
    _buildFactory(z) {
      const doors = new Set(z.doors || []);
      const w = FACTORY_WALL * 0.5;
      const wall = (x, y, hx, hy, h) => {
        const s = makeBuilding(x, y, hx, hy, h, [96, 92, 88], [70, 68, 66]);
        s.kind = 'factory';
        return s;
      };
      const door = (side) => (doors.has(side) ? [[-FACTORY_DOOR * 0.5, FACTORY_DOOR * 0.5]] : []);
      this._solidLine(z, [-z.hx, -z.hy], [z.hx, -z.hy], door('n'), w, FACTORY_H, w, wall);
      this._solidLine(z, [-z.hx, z.hy], [z.hx, z.hy], door('s'), w, FACTORY_H, w, wall);
      this._solidLine(z, [-z.hx, -z.hy], [-z.hx, z.hy], door('w'), w, FACTORY_H, -w, wall);
      this._solidLine(z, [z.hx, -z.hy], [z.hx, z.hy], door('e'), w, FACTORY_H, -w, wall);
      const machine = (x, y, hx, hy, h) => {
        const s = makeBuilding(x, y, hx, hy, h, [150, 128, 60], [92, 84, 60]);
        s.kind = 'machine';
        return s;
      };
      const lineX = z.hx * 0.64;
      const lineY = z.hy - 70;
      for (const sx of [-1, 1]) {
        this._solidLine(z, [sx * lineX, -lineY], [sx * lineX, lineY], [[-70, 70]], 15, 26, 0, machine);
        for (const my of [-0.55, 0.55]) {
          const x = this.wrapX(z.x + sx * (z.hx - 48));
          const y = this.wrapY(z.y + my * z.hy);
          this.structures.push(machine(x, y, 20, 26, 40));
        }
      }
    }

    // Height of the elevated highway deck at (x, y) (0 if none there)
    deckHeightAt(x, y) {
      for (const s of this.structures) {
        if (!s.deck) continue;
        if (Math.abs(this.deltaX(s.x, x)) <= s.box.hx && Math.abs(this.deltaY(s.y, y)) <= s.box.hy) return s.height;
      }
      return 0;
    }

    // A destroyed building / fuel tank: gone from the map (no longer blocks), rubble on the ground
    removeStructure(s) {
      const i = this.structures.indexOf(s);
      if (i >= 0) this.structures.splice(i, 1);
      const j = this.colliders.indexOf(s);
      if (j >= 0) this.colliders.splice(j, 1);
      const hx = s.box ? s.box.hx : s.radius;
      const hy = s.box ? s.box.hy : s.radius;
      const seed = Math.floor(Math.abs(s.x * 7 + s.y * 13)) + 1;
      this._stampGround(s.x, s.y, Math.hypot(hx, hy) + 30, (g) => {
        const rand = seededRand(seed);
        g.fillStyle = s.fuel ? 'rgba(18, 14, 12, 0.7)' : 'rgba(60, 56, 52, 0.75)';
        g.beginPath();
        if (s.box) g.rect(-hx - 6, -hy - 6, hx * 2 + 12, hy * 2 + 12);
        else g.arc(0, 0, hx + 14, 0, Math.PI * 2);
        g.fill();
        const n = Math.round((hx * hy) / 140) + 6;
        for (let k = 0; k < n; k++) {
          const px = (rand() - 0.5) * hx * 2.1;
          const py = (rand() - 0.5) * hy * 2.1;
          const r = 3 + rand() * 7;
          const c = Math.round(70 + rand() * 60);
          g.fillStyle = `rgba(${c}, ${c - 4}, ${c - 8}, 0.9)`;
          g.fillRect(px - r, py - r * 0.7, r * 2, r * 1.4);
        }
      });
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
      if (z.kind === 'lake') {
        // Smooth blue ice with a snowy shore, white cracks, darker thin-ice patches
        const grad = g.createRadialGradient(0, 0, z.radius * 0.5, 0, 0, z.radius + 40);
        grad.addColorStop(0, 'rgba(150, 196, 226, 0.95)');
        grad.addColorStop(0.9, 'rgba(176, 214, 238, 0.92)');
        grad.addColorStop(1, 'rgba(230, 240, 250, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, z.radius + 40, 0, Math.PI * 2);
        g.fill();
        for (const t of z.thin) {
          const tg = g.createRadialGradient(t.dx, t.dy, t.r * 0.2, t.dx, t.dy, t.r);
          tg.addColorStop(0, 'rgba(40, 84, 122, 0.75)');
          tg.addColorStop(1, 'rgba(70, 120, 160, 0.25)');
          g.fillStyle = tg;
          g.beginPath();
          g.arc(t.dx, t.dy, t.r, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgba(240, 248, 255, 0.55)';
        g.lineWidth = 1.6;
        g.lineJoin = 'round';
        g.beginPath();
        for (const pts of z.cracks) {
          g.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        }
        g.stroke();
        return;
      }
      if (z.kind === 'factory') {
        // Concrete floor with hazard stripes along the walls and a painted lane down the middle
        g.fillStyle = 'rgba(70, 68, 66, 0.92)';
        g.fillRect(-z.hx, -z.hy, z.hx * 2, z.hy * 2);
        g.strokeStyle = 'rgba(234, 179, 8, 0.55)';
        g.lineWidth = 6;
        g.setLineDash([18, 14]);
        g.strokeRect(-z.hx + 26, -z.hy + 26, z.hx * 2 - 52, z.hy * 2 - 52);
        g.beginPath();
        g.moveTo(0, -z.hy);
        g.lineTo(0, z.hy);
        g.moveTo(-z.hx, 0);
        g.lineTo(z.hx, 0);
        g.stroke();
        g.setLineDash([]);
        return;
      }
      if (z.kind === 'highway') {
        // Shadowed service road along the foot of the embankment
        g.strokeStyle = 'rgba(30, 28, 28, 0.35)';
        g.lineWidth = DECK_HALF * 2 + 60;
        g.lineCap = 'butt';
        g.beginPath();
        for (const leg of z.legs || []) {
          g.moveTo(leg.from[0], leg.from[1]);
          g.lineTo(leg.to[0], leg.to[1]);
        }
        g.stroke();
        return;
      }
      if (z.kind === 'city' && z.style === 'industrial') {
        // Asphalt between the blocks, lane markings along the streets through the centre
        const grad = g.createRadialGradient(0, 0, z.radius * 0.6, 0, 0, z.radius + 100);
        grad.addColorStop(0, 'rgba(54, 52, 52, 0.9)');
        grad.addColorStop(0.85, 'rgba(62, 60, 58, 0.7)');
        grad.addColorStop(1, 'rgba(62, 60, 58, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, z.radius + 100, 0, Math.PI * 2);
        g.fill();
        const plaza = z.plaza || 0;
        if (plaza > 0) {
          g.fillStyle = 'rgba(120, 114, 106, 0.85)';
          g.fillRect(-plaza, -plaza, plaza * 2, plaza * 2);
        }
        g.strokeStyle = 'rgba(230, 226, 210, 0.35)';
        g.lineWidth = 3;
        g.setLineDash([26, 22]);
        g.beginPath();
        g.moveTo(-z.radius - 80, 0);
        g.lineTo(z.radius + 80, 0);
        g.moveTo(0, -z.radius - 80);
        g.lineTo(0, z.radius + 80);
        g.stroke();
        g.setLineDash([]);
        return;
      }
      if (z.kind === 'city') {
        // Packed streets, a paved square, wheel ruts along the main streets
        const snowTown = z.style === 'snow';
        const grad = g.createRadialGradient(0, 0, z.radius * 0.6, 0, 0, z.radius + 100);
        grad.addColorStop(0, snowTown ? 'rgba(168, 178, 192, 0.85)' : 'rgba(196, 170, 128, 0.9)');
        grad.addColorStop(0.8, snowTown ? 'rgba(186, 196, 210, 0.65)' : 'rgba(184, 156, 116, 0.7)');
        grad.addColorStop(1, snowTown ? 'rgba(186, 196, 210, 0)' : 'rgba(184, 156, 116, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, z.radius + 100, 0, Math.PI * 2);
        g.fill();

        const plaza = z.plaza || 250;
        g.fillStyle = snowTown ? 'rgba(150, 160, 174, 0.9)' : 'rgba(214, 196, 160, 0.9)';
        g.fillRect(-plaza, -plaza, plaza * 2, plaza * 2);
        g.strokeStyle = snowTown ? 'rgba(90, 100, 116, 0.4)' : 'rgba(150, 126, 92, 0.35)';
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
        const dx = this.deltaX(s.x, x);
        const dy = this.deltaY(s.y, y);
        if (s.box) {
          if (Math.abs(dx) < s.box.hx && Math.abs(dy) < s.box.hy) return s;
        } else if (dx * dx + dy * dy < s.radius * s.radius) {
          return s;
        }
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
