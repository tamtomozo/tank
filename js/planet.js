(function (global) {
  'use strict';

  // World size: 4800 x 4800 (4x the original 2400 x 2400 area). Content counts below are scaled by
  // AREA_SCALE so the density of rocks, terrain detail, crates and jump pads stays the same.
  const BASE_WORLD = 2400;
  const WORLD_W = 4800;
  const WORLD_H = 4800;
  const AREA_SCALE = (WORLD_W * WORLD_H) / (BASE_WORLD * BASE_WORLD); // 4
  const SPAWN_X = WORLD_W * 0.5; // player spawn point (map centre)
  const SPAWN_Y = WORLD_H * 0.5;
  const scaled = (n) => Math.round(n * AREA_SCALE);

  // Cylindrical curvature along depth (Y axis) only -> pitched so player (dy=0) sits at exact vertical midpoint of the visible map area (horizonY .. viewH)
  const CYL_R = 780;
  const CAM_Y = -200;
  const CAM_Z = 740;
  const LOOK_Y = 91.1757;
  const LOOK_Z = 0;

  const FY = LOOK_Y - CAM_Y;
  const FZ = LOOK_Z - CAM_Z;
  const FL = Math.hypot(FY, FZ);
  const DIR_Y = FY / FL;
  const DIR_Z = FZ / FL;
  const UP_Y = -DIR_Z;
  const UP_Z = DIR_Y;

  // Exact tangent horizon angle on the depth cylinder
  const CENTER_TO_CAM_DIST = Math.hypot(CAM_Y, CAM_Z + CYL_R);
  const CAM_ALPHA = Math.atan2(CAM_Y, CAM_Z + CYL_R);
  const HORIZON_THETA = CAM_ALPHA + Math.acos(CYL_R / CENTER_TO_CAM_DIST);
  const HORIZON_DY = -HORIZON_THETA * CYL_R;
  // Beyond this distance behind the camera nothing can be on screen (screen bottom is ~540 behind)
  const MAX_BEHIND_DY = 1150;

  function wrapCoord(v, size) {
    const r = v % size;
    return r < 0 ? r + size : r;
  }

  function wrapDelta(d, size) {
    const half = size * 0.5;
    let r = (d + half) % size;
    if (r < 0) r += size;
    return r - half;
  }

  // World-space ground texture resolution (texture pixels per world unit)
  const GROUND_TEX_RES = 0.75; // 4800-unit world -> 3600 x 3600 texture
  const GROUND_ROW_STEP = 2; // screen px per projected ground strip

  // Area layout: the wrapped map is split into three vertical district bands (800 wide each).
  // District 1 is the centre band with the spawn point, 2 lies east of it, 3 west (across the wrap).
  const DISTRICT_WIDTH = WORLD_W / 3; // 1600
  const DISTRICT_DEFS = [
    { id: 0, name: '第1地区', x0: DISTRICT_WIDTH, dir: '中央' },
    { id: 1, name: '第2地区', x0: DISTRICT_WIDTH * 2, dir: '東' },
    { id: 2, name: '第3地区', x0: 0, dir: '西' }
  ];
  const BASES_PER_DISTRICT = 2;

  // Screen Y of a ground point at depth offset dy (depends only on dy and viewport height)
  function screenYForDy(dy, viewH, focal) {
    const th = -dy / CYL_R;
    const py = CYL_R * Math.sin(th);
    const pz = CYL_R * Math.cos(th) - CYL_R;
    const vy = py - CAM_Y;
    const vz = pz - CAM_Z;
    const depth = vy * DIR_Y + vz * DIR_Z;
    const screenUp = vy * UP_Y + vz * UP_Z;
    return viewH * 0.5 - (screenUp * focal) / depth;
  }

  const DAY_DURATION = 90; // 1 full planetary day in seconds

  const SKY_KEYFRAMES = [
    {
      t: 0.00, // 00:00 Midnight
      skyTop: [3, 5, 13], skyMid: [8, 15, 34], skyHor: [18, 28, 52],
      rim: [56, 189, 248],
      gFar: [30, 27, 29], gMid: [44, 38, 36], gNear: [34, 29, 27],
      star: 1.0, night: 1.0
    },
    {
      t: 0.17, // ~04:05 Late Night
      skyTop: [5, 8, 20], skyMid: [12, 20, 42], skyHor: [24, 34, 58],
      rim: [56, 189, 248],
      gFar: [33, 29, 31], gMid: [48, 41, 38], gNear: [37, 31, 29],
      star: 0.95, night: 0.95
    },
    {
      t: 0.25, // 06:00 Sunrise
      skyTop: [22, 24, 58], skyMid: [110, 62, 82], skyHor: [244, 140, 66],
      rim: [251, 146, 60],
      gFar: [80, 60, 48], gMid: [116, 88, 64], gNear: [94, 70, 52],
      star: 0.25, night: 0.30
    },
    {
      t: 0.32, // ~07:40 Morning
      skyTop: [20, 52, 98], skyMid: [58, 118, 174], skyHor: [158, 200, 224],
      rim: [253, 224, 171],
      gFar: [106, 90, 74], gMid: [140, 114, 86], gNear: [116, 93, 70],
      star: 0.0, night: 0.0
    },
    {
      t: 0.48, // ~11:30 Noon
      skyTop: [24, 62, 112], skyMid: [66, 132, 188], skyHor: [168, 210, 232],
      rim: [253, 224, 171],
      gFar: [114, 98, 82], gMid: [148, 122, 92], gNear: [122, 99, 75],
      star: 0.0, night: 0.0
    },
    {
      t: 0.68, // ~16:20 Late Afternoon
      skyTop: [24, 56, 104], skyMid: [68, 120, 172], skyHor: [176, 202, 218],
      rim: [253, 216, 152],
      gFar: [110, 92, 76], gMid: [144, 116, 86], gNear: [120, 95, 70],
      star: 0.0, night: 0.0
    },
    {
      t: 0.75, // 18:00 Sunset
      skyTop: [26, 20, 56], skyMid: [138, 54, 68], skyHor: [238, 102, 46],
      rim: [249, 115, 22],
      gFar: [84, 58, 46], gMid: [118, 82, 60], gNear: [92, 63, 46],
      star: 0.35, night: 0.40
    },
    {
      t: 0.82, // ~19:40 Nightfall
      skyTop: [6, 9, 22], skyMid: [14, 22, 44], skyHor: [26, 36, 60],
      rim: [56, 189, 248],
      gFar: [33, 29, 31], gMid: [48, 41, 38], gNear: [37, 31, 29],
      star: 0.95, night: 0.95
    },
    {
      t: 1.00, // 24:00 Midnight
      skyTop: [3, 5, 13], skyMid: [8, 15, 34], skyHor: [18, 28, 52],
      rim: [56, 189, 248],
      gFar: [30, 27, 29], gMid: [44, 38, 36], gNear: [34, 29, 27],
      star: 1.0, night: 1.0
    }
  ];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(c1, c2, t) {
    const r = Math.round(lerp(c1[0], c2[0], t));
    const g = Math.round(lerp(c1[1], c2[1], t));
    const b = Math.round(lerp(c1[2], c2[2], t));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function sampleDayPalette(t) {
    let a = SKY_KEYFRAMES[0];
    let b = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
    for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
      if (t >= SKY_KEYFRAMES[i].t && t <= SKY_KEYFRAMES[i + 1].t) {
        a = SKY_KEYFRAMES[i];
        b = SKY_KEYFRAMES[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, b.t - a.t);
    const u = Math.max(0, Math.min(1, (t - a.t) / span));
    return {
      skyTop: lerpRgb(a.skyTop, b.skyTop, u),
      skyMid: lerpRgb(a.skyMid, b.skyMid, u),
      skyHor: lerpRgb(a.skyHor, b.skyHor, u),
      skyHorRgb: [
        Math.round(lerp(a.skyHor[0], b.skyHor[0], u)),
        Math.round(lerp(a.skyHor[1], b.skyHor[1], u)),
        Math.round(lerp(a.skyHor[2], b.skyHor[2], u))
      ],
      rim: [
        Math.round(lerp(a.rim[0], b.rim[0], u)),
        Math.round(lerp(a.rim[1], b.rim[1], u)),
        Math.round(lerp(a.rim[2], b.rim[2], u))
      ],
      gFar: lerpRgb(a.gFar, b.gFar, u),
      gFarRgb: [
        Math.round(lerp(a.gFar[0], b.gFar[0], u)),
        Math.round(lerp(a.gFar[1], b.gFar[1], u)),
        Math.round(lerp(a.gFar[2], b.gFar[2], u))
      ],
      gMid: lerpRgb(a.gMid, b.gMid, u),
      gNear: lerpRgb(a.gNear, b.gNear, u),
      starAlpha: lerp(a.star, b.star, u),
      nightFactor: lerp(a.night, b.night, u)
    };
  }

  class HorizonWorld {
    constructor() {
      this.width = WORLD_W;
      this.height = WORLD_H;
      this.horizonDy = HORIZON_DY;
      this.horizonTheta = HORIZON_THETA;

      // Start at 07:12 AM (morning light) and advance continuously
      this.dayTime = 0.30;
      this.dayCount = 1;
      this.dayDuration = DAY_DURATION; // real seconds per in-game day

      this.stars = [];
      this.horizonRidges = [];
      this.patches = [];
      this.ripples = [];
      this.scrubs = [];
      this.props = [];
      this.obstacles = [];
      this.ramps = [];

      // Ring buffers for tread marks and explosion scorch decals
      this.treadMarks = [];
      this.maxTreadMarks = 320;
      this.scorchMarks = [];
      this.maxScorchMarks = 90;

      this.districts = DISTRICT_DEFS.map((d) => ({ ...d, width: DISTRICT_WIDTH }));
      this.revealedBases = new Set(); // compounds whose ground pad is drawn (unlocked districts)

      this._initBackdrop();
      this._initTerrainAndProps();
      this._initEnemyBases();
      this._initWastelandDetail();
      this._buildGroundSprites();
      this._buildGroundTexture();

      // Per-frame caches (palette depends only on dayTime, horizon only on viewport size)
      this._palCacheT = NaN;
      this._palCache = null;
      this._horizonKeyW = -1;
      this._horizonKeyH = -1;
      this._horizonProj = null;
    }

    // Restore destructible props and clear decals for a fresh sortie
    // District id (0..2) containing world x
    districtAt(x) {
      const wx = wrapCoord(x, WORLD_W);
      for (const d of this.districts) {
        if (wrapCoord(wx - d.x0, WORLD_W) < d.width) return d.id;
      }
      return 0;
    }

    resetDynamic() {
      for (const prop of this.props) {
        prop.hp = prop.maxHp;
        prop.alive = true;
      }
      this.treadMarks.length = 0;
      this.scorchMarks.length = 0;
    }

    getPalette() {
      if (this._palCacheT !== this.dayTime) {
        this._palCacheT = this.dayTime;
        this._palCache = sampleDayPalette(this.dayTime);
      }
      return this._palCache;
    }

    _getHorizonProj(viewW, viewH) {
      if (this._horizonKeyW !== viewW || this._horizonKeyH !== viewH) {
        this._horizonKeyW = viewW;
        this._horizonKeyH = viewH;
        this._horizonProj = this.projectDelta(0, HORIZON_DY, 0, viewW, viewH, true);
      }
      return this._horizonProj;
    }

    wrapX(x) {
      return wrapCoord(x, WORLD_W);
    }

    wrapY(y) {
      return wrapCoord(y, WORLD_H);
    }

    deltaX(fromX, toX) {
      return wrapDelta(toX - fromX, WORLD_W);
    }

    deltaY(fromY, toY) {
      return wrapDelta(toY - fromY, WORLD_H);
    }

    getFocal(viewH) {
      return Math.max(540, viewH * 0.96);
    }

    // Project wrapped world coordinates (wx, wy, wz) onto 2D screen with depth-only planetary horizon
    project(wx, wy, wz, camX, camY, viewW, viewH, allowBehindHorizon = false) {
      const dx = wrapDelta(wx - camX, WORLD_W);
      const dy = wrapDelta(wy - camY, WORLD_H);
      return this.projectDelta(dx, dy, wz, viewW, viewH, allowBehindHorizon);
    }

    projectDelta(dx, dy, wz, viewW, viewH, allowBehindHorizon = false) {
      // Far behind the camera (south) the curved ground wraps round the planet and would project
      // back onto the screen as tiny ghosts; nothing that far behind is ever visible.
      if (dy > MAX_BEHIND_DY) return null;
      const th = -dy / CYL_R;
      if (!allowBehindHorizon && th > HORIZON_THETA + 0.02) {
        return null;
      }
      const r = CYL_R + wz;
      const py = r * Math.sin(th);
      const pz = r * Math.cos(th) - CYL_R;

      const vy = py - CAM_Y;
      const vz = pz - CAM_Z;
      const depth = vy * DIR_Y + vz * DIR_Z;
      if (depth <= 40) return null;

      const screenUp = vy * UP_Y + vz * UP_Z;
      const focal = this.getFocal(viewH);
      const scale = focal / depth;

      // Exact surface foreshortening ratio: cosine of incidence angle between view ray and surface normal
      const toCamDist = Math.hypot(vy, vz);
      const cosIncidence = toCamDist > 0.001
        ? (Math.sin(th) * (-vy) + Math.cos(th) * (-vz)) / toCamDist
        : 1;

      return {
        sx: viewW * 0.5 + dx * scale,
        sy: viewH * 0.5 - screenUp * scale,
        scale,
        tiltCos: Math.max(0.015, Math.min(1, cosIncidence)),
        dy,
        dx,
        depth,
        th
      };
    }

    // Inverse projection from mouse screen coordinates (sx, sy) to wrapped world ground point (wx, wy)
    screenToWorld(sx, sy, camX, camY, viewW, viewH) {
      const focal = this.getFocal(viewH);
      const targetScreenUp = (viewH * 0.5 - sy); // screenUp * scale

      // Binary search dy in [HORIZON_DY, +520] because sy(dy) is strictly monotonic in visible band
      let lo = HORIZON_DY + 4;
      let hi = 540;

      const evalScreenY = (dy) => screenYForDy(dy, viewH, focal);

      const horizonSy = evalScreenY(lo);
      let clampedSy = sy;
      if (clampedSy < horizonSy) clampedSy = horizonSy;

      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) * 0.5;
        if (evalScreenY(mid) < clampedSy) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      const dy = (lo + hi) * 0.5;
      const p = this.projectDelta(0, dy, 0, viewW, viewH, true);
      const dx = p ? (sx - viewW * 0.5) / p.scale : (sx - viewW * 0.5);

      return {
        x: this.wrapX(camX + dx),
        y: this.wrapY(camY + dy),
        dx,
        dy
      };
    }

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

      // Boost Jump Pads (launch tank into 2D airborne arc!)
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

      // Per district: place compounds fully inside the district band. Strict spacing first, then
      // progressively relaxed until they fit among the boulders.
      const passes = [
        { margin: 230, spawn: 720, clear: 230, sep: 760 },
        { margin: 215, spawn: 700, clear: 215, sep: 660 },
        { margin: 200, spawn: 690, clear: 200, sep: 600 }
      ];
      const placed = [];
      for (const d of this.districts) {
        const sites = [];
        for (const pass of passes) {
          const span = d.width - pass.margin * 2;
          for (let tries = 0; sites.length < BASES_PER_DISTRICT && tries < 4000; tries++) {
            const x = this.wrapX(d.x0 + pass.margin + rand() * span);
            const y = rand() * WORLD_H;
            if (dist(x, y, SPAWN_X, SPAWN_Y) < pass.spawn) continue;
            if (this.obstacles.some((o) => dist(x, y, o.x, o.y) < o.radius + pass.clear)) continue;
            if (this.ramps.some((r) => dist(x, y, r.x, r.y) < r.radius + pass.clear)) continue;
            if ([...placed, ...sites].some((s) => dist(x, y, s.x, s.y) < pass.sep)) continue;
            sites.push({ x, y, districtId: d.id });
          }
          if (sites.length >= BASES_PER_DISTRICT) break;
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
        const slot = placed.slice(0, i).filter((o) => o.districtId === s.districtId).length;
        return {
          id: i,
          name: names[i] || String(i + 1),
          districtId: s.districtId,
          slot, // index within its district (0 = smaller garrison)
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

    // Show a compound on the ground (its district was unlocked)
    revealBase(id) {
      if (this.revealedBases.has(id)) return;
      this.revealedBases.add(id);
      const b = (this.enemyBases || []).find((s) => s.id === id);
      if (b) this._stampGround(b.x, b.y, b.radius + 40, (g) => this._drawBasePad(g, b));
    }

    // New sortie: remove every compound from the ground again (rebuilds the baked texture)
    hideAllBases() {
      if (this.revealedBases.size === 0) return;
      this.revealedBases.clear();
      this._buildGroundTexture();
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

    addTreadMark(x, y, angle) {
      if (this.treadMarks.length >= this.maxTreadMarks) {
        this.treadMarks.shift();
      }
      this.treadMarks.push({
        x: this.wrapX(x),
        y: this.wrapY(y),
        angle,
        life: 1.0
      });
    }

    addScorchMark(x, y, radius) {
      if (this.scorchMarks.length >= this.maxScorchMarks) {
        this.scorchMarks.shift();
      }
      this.scorchMarks.push({
        x: this.wrapX(x),
        y: this.wrapY(y),
        radius,
        life: 1.0
      });
    }

    getTimeInfo() {
      const totalMins = Math.floor(this.dayTime * 24 * 60) % (24 * 60);
      const snappedMins = Math.floor(totalMins / 15) * 15;
      const hours = Math.floor(snappedMins / 60);
      const mins = snappedMins % 60;
      const clockText = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      const palette = this.getPalette();

      let phaseName = '夜';
      let phaseIcon = '🌙';
      if (hours >= 5 && hours < 7) {
        phaseName = '夜明け';
        phaseIcon = '🌅';
      } else if (hours >= 7 && hours < 11) {
        phaseName = '朝';
        phaseIcon = '🌤';
      } else if (hours >= 11 && hours < 16) {
        phaseName = '昼';
        phaseIcon = '☀';
      } else if (hours >= 16 && hours < 19) {
        phaseName = '夕方';
        phaseIcon = '🌇';
      }

      return {
        day: this.dayCount,
        hours,
        clockText,
        phaseName,
        phaseIcon,
        nightFactor: palette.nightFactor
      };
    }

    update(dt, advanceDay = true) {
      if (advanceDay) {
        this.dayTime += dt / DAY_DURATION;
        if (this.dayTime >= 1) {
          this.dayTime -= 1;
          this.dayCount += 1;
        }
      }
      this._decayDecals(this.treadMarks, dt * 0.05);
      this._decayDecals(this.scorchMarks, dt * 0.03);
    }

    // Fade decals and drop expired ones in a single O(n) in-place pass
    _decayDecals(arr, amount) {
      let w = 0;
      for (let r = 0; r < arr.length; r++) {
        const d = arr[r];
        d.life -= amount;
        if (d.life > 0) arr[w++] = d;
      }
      arr.length = w;
    }

    // True when a projected point (with pixel margin) lies fully outside the viewport
    _isOffscreen(p, margin, viewW, viewH) {
      return p.sx < -margin || p.sx > viewW + margin || p.sy < -margin || p.sy > viewH + margin;
    }

    drawBackdropAndGround(ctx, camX, camY, viewW, viewH, timeSec, starOffsetX = 0) {
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
      this._drawGroundTexture(ctx, camX, camY, viewW, viewH);

      // 7. Scorch Decals & Caterpillar Tread Marks
      for (const sm of this.scorchMarks) {
        const p = this.project(sm.x, sm.y, 0, camX, camY, viewW, viewH);
        if (!p || this._isOffscreen(p, sm.radius * p.scale + 2, viewW, viewH)) continue;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(p.scale, p.scale * p.tiltCos);
        ctx.fillStyle = `rgba(15, 13, 12, ${0.55 * sm.life})`;
        ctx.beginPath();
        ctx.arc(0, 0, sm.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (const tm of this.treadMarks) {
        const p = this.project(tm.x, tm.y, 0, camX, camY, viewW, viewH);
        if (!p || this._isOffscreen(p, 10, viewW, viewH)) continue;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(p.scale, p.scale * p.tiltCos);
        ctx.rotate(tm.angle);
        ctx.fillStyle = `rgba(22, 18, 14, ${0.46 * tm.life})`;
        ctx.fillRect(-4, -3, 8, 6);
        ctx.restore();
      }

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

    // At night, darken the distant terrain while keeping the player's surroundings and headlight beam clearly visible
    getNightDarkStrength() {
      const pal = this.getPalette();
      return Math.max(0, Math.min(1, (pal.nightFactor - 0.28) / 0.72));
    }

    // Shared forward headlight beam geometry used for ground beam rendering, night cutout, and auto lock-on
    getHeadlightMetrics(range = 460) {
      const pal = this.getPalette();
      const nightFactor = pal.nightFactor;
      const beamLen = range;
      const startX = 18;
      const startHalfW = 14;
      const coneHalfAngle = 0.36;
      const endHalfW = startHalfW + (beamLen - startX) * Math.tan(coneHalfAngle);
      return { nightFactor, beamLen, startX, startHalfW, endHalfW, coneHalfAngle };
    }

    _projectGroundSafe(wx, wy, camX, camY, viewW, viewH) {
      const dx = wrapDelta(wx - camX, WORLD_W);
      let dy = wrapDelta(wy - camY, WORLD_H);
      if (-dy / CYL_R > HORIZON_THETA) {
        dy = HORIZON_DY;
      }
      return this.projectDelta(dx, dy, 0, viewW, viewH, true);
    }

    // Build curved ground-projected screen polygon for the forward headlight cone
    getHeadlightConePolygon(playerX, playerY, hullAngle, range, camX, camY, viewW, viewH, widthScale = 1) {
      const hl = this.getHeadlightMetrics(range);
      const cos = Math.cos(hullAngle);
      const sin = Math.sin(hullAngle);
      const perpX = -sin;
      const perpY = cos;

      const originPt = this._projectGroundSafe(
        playerX + cos * hl.startX,
        playerY + sin * hl.startX,
        camX, camY, viewW, viewH
      );
      const tipPt = this._projectGroundSafe(
        playerX + cos * hl.beamLen,
        playerY + sin * hl.beamLen,
        camX, camY, viewW, viewH
      );
      if (!originPt || !tipPt) return null;

      const leftPts = [];
      const rightPts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const d = lerp(hl.startX, hl.beamLen, u);
        const hw = lerp(hl.startHalfW, hl.endHalfW, u) * widthScale;
        const cx = playerX + cos * d;
        const cy = playerY + sin * d;
        const lp = this._projectGroundSafe(cx - perpX * hw, cy - perpY * hw, camX, camY, viewW, viewH);
        const rp = this._projectGroundSafe(cx + perpX * hw, cy + perpY * hw, camX, camY, viewW, viewH);
        if (lp && rp) {
          leftPts.push(lp);
          rightPts.push(rp);
        }
      }
      if (leftPts.length < 2) return null;
      return { originPt, tipPt, leftPts, rightPts, metrics: hl };
    }

    // Check whether a target sits inside the forward headlight cone up to firing range and clearly visible bounds
    isPointInHeadlightRange(tx, ty, targetRadius, playerX, playerY, hullAngle, range, camX, camY, viewW, viewH) {
      // 1. Cheap world-space cone test first (rejects almost every candidate without projecting)
      const dx = this.deltaX(playerX, tx);
      const dy = this.deltaY(playerY, ty);
      const cos = Math.cos(hullAngle);
      const sin = Math.sin(hullAngle);
      const localForward = dx * cos + dy * sin;

      const hl = this.getHeadlightMetrics(range);
      const pad = Math.min(20, (targetRadius || 0) * 0.45);
      if (localForward < hl.startX - pad || localForward > hl.beamLen + pad) return false;

      const localLateral = Math.abs(-dx * sin + dy * cos);
      const t = Math.max(0, Math.min(1, (localForward - hl.startX) / Math.max(1, hl.beamLen - hl.startX)));
      const maxHalfW = hl.startHalfW + (hl.endHalfW - hl.startHalfW) * t + pad;
      if (localLateral > maxHalfW) return false;

      // 2. Then require the target to be clearly visible on screen
      const targetProj = this.project(tx, ty, 0, camX, camY, viewW, viewH);
      if (!targetProj) return false;

      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.21;
      const sideMargin = Math.max(40, Math.min(80, viewW * 0.045));
      if (targetProj.sx < sideMargin || targetProj.sx > viewW - sideMargin) return false;
      return !(targetProj.sy < horizonY + 28 || targetProj.sy > viewH - 20);
    }

    drawNightVisibility(ctx, playerProj, hullAngle, beamRange, playerX, playerY, camX, camY, viewW, viewH) {
      const darkStrength = this.getNightDarkStrength();
      if (darkStrength <= 0.01 || typeof document === 'undefined') return;

      const cw = Math.max(1, Math.round(viewW));
      const ch = Math.max(1, Math.round(viewH));
      if (!this._nightCanvas) {
        this._nightCanvas = document.createElement('canvas');
        this._nightCtx = this._nightCanvas.getContext('2d');
      }
      if (this._nightCanvas.width !== cw || this._nightCanvas.height !== ch) {
        this._nightCanvas.width = cw;
        this._nightCanvas.height = ch;
      }

      const nCtx = this._nightCtx;
      nCtx.globalCompositeOperation = 'source-over';
      nCtx.clearRect(0, 0, cw, ch);

      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.21;
      const topY = Math.max(0, horizonY - 12);
      const maxAlpha = darkStrength * 0.91;
      const rampFrac = Math.min(0.25, 36 / Math.max(1, ch - topY));

      const darkGrad = nCtx.createLinearGradient(0, topY, 0, ch);
      darkGrad.addColorStop(0, 'rgba(2, 5, 14, 0)');
      darkGrad.addColorStop(rampFrac, `rgba(2, 5, 14, ${maxAlpha.toFixed(3)})`);
      darkGrad.addColorStop(1, `rgba(2, 5, 14, ${maxAlpha.toFixed(3)})`);
      nCtx.fillStyle = darkGrad;
      nCtx.fillRect(0, topY, cw, ch - topY);

      if (playerProj) {
        nCtx.globalCompositeOperation = 'destination-out';
        const px = playerProj.sx;
        const py = playerProj.sy;
        const s = playerProj.scale;

        // 1. Soft radial visibility zone centered around the tank
        const auraR = 215 * s;
        nCtx.save();
        nCtx.translate(px, py);
        nCtx.scale(1, 0.88);
        const auraGrad = nCtx.createRadialGradient(0, 0, auraR * 0.25, 0, 0, auraR);
        auraGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
        auraGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.92)');
        auraGrad.addColorStop(0.76, 'rgba(0, 0, 0, 0.44)');
        auraGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        nCtx.fillStyle = auraGrad;
        nCtx.beginPath();
        nCtx.arc(0, 0, auraR, 0, Math.PI * 2);
        nCtx.fill();
        nCtx.restore();

        // 2. Soft feathered ground-projected forward headlight cone up to firing range
        for (let step = 0; step < 5; step++) {
          const widthScale = 1.24 - step * 0.14;
          const poly = this.getHeadlightConePolygon(
            playerX, playerY, hullAngle, (beamRange || 460) * 1.04,
            camX, camY, viewW, viewH, widthScale
          );
          if (!poly) break;
          const beamGrad = nCtx.createLinearGradient(
            poly.originPt.sx, poly.originPt.sy,
            poly.tipPt.sx, poly.tipPt.sy
          );
          beamGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.34)');
          beamGrad.addColorStop(0.68, 'rgba(0, 0, 0, 0.26)');
          beamGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
          nCtx.fillStyle = beamGrad;
          nCtx.beginPath();
          nCtx.moveTo(poly.leftPts[0].sx, poly.leftPts[0].sy);
          for (let i = 1; i < poly.leftPts.length; i++) {
            nCtx.lineTo(poly.leftPts[i].sx, poly.leftPts[i].sy);
          }
          for (let i = poly.rightPts.length - 1; i >= 0; i--) {
            nCtx.lineTo(poly.rightPts[i].sx, poly.rightPts[i].sy);
          }
          nCtx.closePath();
          nCtx.fill();
        }
      }

      ctx.drawImage(this._nightCanvas, 0, 0, viewW, viewH);
    }

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

    // Atmospheric haze colour at the horizon (same mix drawHorizonHaze uses)
    getHazeRgb() {
      const pal = this.getPalette();
      return [
        Math.round(pal.skyHorRgb[0] * 0.55 + pal.gFarRgb[0] * 0.45),
        Math.round(pal.skyHorRgb[1] * 0.55 + pal.gFarRgb[1] * 0.45),
        Math.round(pal.skyHorRgb[2] * 0.55 + pal.gFarRgb[2] * 0.45)
      ];
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

  global.HorizonWorld = HorizonWorld;
})(window);
