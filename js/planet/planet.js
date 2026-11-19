(function (global) {
  'use strict';

  // HorizonWorld: the planet surface — a wrapped 4800 x 4800 map seen on a cylinder curving away
  // toward the horizon. This file holds the constants, coordinates & projection, time of day and
  // decals; the rest of the class is mixed in from the other files in js/planet/:
  //   terrain.js  world generation          ground.js  ground texture build + draw
  //   sky.js      sky / backdrop / haze      night.js   darkness + headlight cone
  //   props.js    flags, crates, rocks, jump pads    hq.js      operations HQ (作戦本部)
  //   zones.js    per-operation compounds, salt flat / old town, collision helpers
  //   weather.js  sandstorm / blizzard overlay
  // The planet's look (sky palette, ground style, rock colours) is a theme: THEMES below, setTheme.

  // World size: 4800 x 4800 (4x the original 2400 x 2400 area). Content counts below are scaled by
  // AREA_SCALE so the density of rocks, terrain detail, crates and jump pads stays the same.
  const BASE_WORLD = 2400;
  const WORLD_W = 4800;
  const WORLD_H = 4800;
  const AREA_SCALE = (WORLD_W * WORLD_H) / (BASE_WORLD * BASE_WORLD); // 4
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

  // Ice planet: cold blue sky, a pale low sun, snow-white ground by day and blue-grey by night.
  // Same key times and night strengths as the desert, so night play works the same.
  const ICE_KEYFRAMES = [
    { t: 0.00, skyTop: [2, 6, 16], skyMid: [8, 18, 38], skyHor: [22, 36, 60], rim: [125, 211, 252],
      gFar: [42, 50, 64], gMid: [58, 68, 84], gNear: [48, 56, 70], star: 1.0, night: 1.0 },
    { t: 0.17, skyTop: [4, 9, 22], skyMid: [12, 24, 46], skyHor: [28, 42, 66], rim: [125, 211, 252],
      gFar: [46, 54, 68], gMid: [62, 72, 88], gNear: [52, 60, 74], star: 0.95, night: 0.95 },
    { t: 0.25, skyTop: [24, 34, 72], skyMid: [96, 92, 142], skyHor: [232, 176, 160], rim: [253, 186, 160],
      gFar: [122, 130, 152], gMid: [152, 162, 184], gNear: [134, 144, 166], star: 0.25, night: 0.30 },
    { t: 0.32, skyTop: [40, 78, 128], skyMid: [110, 152, 196], skyHor: [206, 224, 240], rim: [224, 242, 254],
      gFar: [170, 184, 202], gMid: [198, 210, 226], gNear: [180, 192, 210], star: 0.0, night: 0.0 },
    { t: 0.48, skyTop: [46, 88, 140], skyMid: [120, 164, 206], skyHor: [214, 230, 244], rim: [224, 242, 254],
      gFar: [178, 192, 210], gMid: [206, 218, 232], gNear: [188, 200, 216], star: 0.0, night: 0.0 },
    { t: 0.68, skyTop: [42, 80, 130], skyMid: [114, 154, 198], skyHor: [208, 222, 238], rim: [224, 236, 250],
      gFar: [172, 184, 202], gMid: [200, 210, 226], gNear: [182, 192, 210], star: 0.0, night: 0.0 },
    { t: 0.75, skyTop: [30, 26, 66], skyMid: [120, 82, 132], skyHor: [228, 152, 142], rim: [251, 170, 150],
      gFar: [116, 120, 142], gMid: [146, 150, 174], gNear: [126, 130, 154], star: 0.35, night: 0.40 },
    { t: 0.82, skyTop: [5, 10, 24], skyMid: [14, 26, 48], skyHor: [30, 44, 68], rim: [125, 211, 252],
      gFar: [46, 54, 68], gMid: [62, 72, 88], gNear: [52, 60, 74], star: 0.95, night: 0.95 },
    { t: 1.00, skyTop: [2, 6, 16], skyMid: [8, 18, 38], skyHor: [22, 36, 60], rim: [125, 211, 252],
      gFar: [42, 50, 64], gMid: [58, 68, 84], gNear: [48, 56, 70], star: 1.0, night: 1.0 }
  ];

  // Industrial planet: a smog-brown sky with a dim ochre sun, ash-grey concrete ground; the
  // nights glow faintly orange from the city. Same key times and night strengths as the desert.
  const CITY_KEYFRAMES = [
    { t: 0.00, skyTop: [10, 8, 10], skyMid: [30, 22, 22], skyHor: [74, 46, 34], rim: [251, 146, 60],
      gFar: [34, 32, 32], gMid: [46, 43, 42], gNear: [38, 36, 35], star: 0.25, night: 1.0 },
    { t: 0.17, skyTop: [12, 10, 12], skyMid: [34, 26, 24], skyHor: [80, 52, 38], rim: [251, 146, 60],
      gFar: [36, 34, 33], gMid: [48, 45, 44], gNear: [40, 38, 37], star: 0.2, night: 0.95 },
    { t: 0.25, skyTop: [46, 38, 40], skyMid: [112, 82, 64], skyHor: [196, 132, 82], rim: [253, 186, 116],
      gFar: [90, 84, 78], gMid: [112, 104, 96], gNear: [98, 91, 84], star: 0.05, night: 0.30 },
    { t: 0.32, skyTop: [70, 64, 58], skyMid: [134, 120, 96], skyHor: [190, 170, 128], rim: [250, 214, 150],
      gFar: [112, 106, 98], gMid: [136, 128, 118], gNear: [120, 113, 104], star: 0.0, night: 0.0 },
    { t: 0.48, skyTop: [78, 72, 62], skyMid: [144, 132, 104], skyHor: [198, 182, 138], rim: [250, 220, 160],
      gFar: [118, 112, 104], gMid: [142, 134, 124], gNear: [126, 119, 110], star: 0.0, night: 0.0 },
    { t: 0.68, skyTop: [74, 64, 56], skyMid: [140, 118, 92], skyHor: [200, 168, 120], rim: [250, 204, 140],
      gFar: [112, 104, 96], gMid: [136, 126, 116], gNear: [120, 112, 103], star: 0.0, night: 0.0 },
    { t: 0.75, skyTop: [40, 26, 30], skyMid: [124, 64, 50], skyHor: [222, 112, 52], rim: [249, 115, 22],
      gFar: [80, 66, 58], gMid: [104, 88, 76], gNear: [90, 76, 66], star: 0.1, night: 0.40 },
    { t: 0.82, skyTop: [12, 10, 12], skyMid: [32, 24, 24], skyHor: [78, 50, 36], rim: [251, 146, 60],
      gFar: [36, 34, 33], gMid: [48, 45, 44], gNear: [40, 38, 37], star: 0.2, night: 0.95 },
    { t: 1.00, skyTop: [10, 8, 10], skyMid: [30, 22, 22], skyHor: [74, 46, 34], rim: [251, 146, 60],
      gFar: [34, 32, 32], gMid: [46, 43, 42], gNear: [38, 36, 35], star: 0.25, night: 1.0 }
  ];

  // Look of a planet (planet.theme in js/data/operations.js), applied by applyOperation:
  //   sky          day/night palette keyframes        snow     ground texture drawn as snow
  //   ground       'earth' | 'snow' | 'ash' (concrete and ash: oil stains, drains, no brush)
  //   rock         boulder colours (null = as generated: desert rock / sandstone; else base + snow caps)
  //   dust         blast / track dust colours          storm    storm overlay colour (rgb) + streaks
  //   treadDecay   how fast tread marks fade (snow keeps them for long: tracks can be followed)
  const THEMES = {
    desert: {
      id: 'desert',
      sky: SKY_KEYFRAMES,
      snow: false,
      ground: 'earth',
      rock: null,
      dust: ['#c9b38c', '#b59d78', '#a88f6a', '#d4c29c'],
      treadDecay: 1,
      treadRgb: 'rgb(22, 18, 14)',
      maxTreadMarks: 320,
      storm: { rgb: '186, 140, 88', streak: '232, 200, 150' },
      mapBg: '#3a3027'
    },
    ice: {
      id: 'ice',
      sky: ICE_KEYFRAMES,
      snow: true,
      ground: 'snow',
      rock: { base: [92, 102, 118], snow: [232, 240, 248] },
      dust: ['#eef3f8', '#dbe5ef', '#f8fafc', '#cbd8e6'],
      treadDecay: 0.25,
      treadRgb: 'rgb(74, 96, 124)',
      maxTreadMarks: 760,
      storm: { rgb: '220, 230, 242', streak: '255, 255, 255' },
      mapBg: '#2a3442'
    },
    // Industrial planet: the rocks are heaps of broken concrete
    city: {
      id: 'city',
      sky: CITY_KEYFRAMES,
      snow: false,
      ground: 'ash',
      rock: { base: [120, 116, 110], snow: [96, 90, 84] },
      dust: ['#8a8580', '#77726c', '#9a948c', '#6b6660'],
      treadDecay: 0.8,
      treadRgb: 'rgb(20, 19, 18)',
      maxTreadMarks: 360,
      storm: { rgb: '128, 118, 92', streak: '190, 210, 140' },
      mapBg: '#2c2a28'
    }
  };

  const { lerp } = global.TankUtil;

  function lerpRgb(c1, c2, t) {
    const r = Math.round(lerp(c1[0], c2[0], t));
    const g = Math.round(lerp(c1[1], c2[1], t));
    const b = Math.round(lerp(c1[2], c2[2], t));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function sampleDayPalette(t, frames = SKY_KEYFRAMES) {
    let a = frames[0];
    let b = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (t >= frames[i].t && t <= frames[i + 1].t) {
        a = frames[i];
        b = frames[i + 1];
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
      this.clockFrozen = false; // polar night operation: the time of day stands still
      this.theme = THEMES.desert; // planet look (setTheme)

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
      this.iceHoles = []; // where a tank broke through the ice of a frozen lake (js/combat/ice.js)
      this.revealedBases = new Set(); // compounds whose ground pad is drawn (garrisoned this sortie)
      // Set per operation by applyOperation (js/planet/zones.js)
      this.sites = []; // compound layouts of the current operation (index == compound id)
      this.zones = []; // salt flat / old town areas laid over the map
      this.structures = []; // buildings of an old town (solid boxes: block tanks and shells)
      this.storm = 0; // sandstorm strength 0..1 (js/game/hazards.js)
      this.mirage = 0; // mirage strength 0..1 (daytime on a salt flat operation)

      this._initBackdrop();
      this._initTerrainAndProps();
      this._initEnemyBases();
      this._initHeadquarters();
      // Full sets as generated; an operation can clear the rocks / jump pads of some areas
      this.allObstacles = this.obstacles;
      this.allRamps = this.ramps;
      // Everything a tank can't drive through: boulders + the solid parts of the HQ
      // (+ the buildings of an old town, see applyOperation)
      this.colliders = [...this.obstacles, ...this.hq.colliders];
      // Destructible ground props (crates / crystals / fuel barrels) are disabled. They are still
      // generated above so the shared RNG sequence — and thus the rest of the map layout — is unchanged.
      this.props = [];
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

    // Planet look (THEMES): sky palette, rock colours (re-shaded from the facets' stored light),
    // ground texture style (rebuilt by applyOperation)
    setTheme(id) {
      const theme = THEMES[id] || THEMES.desert;
      if (theme === this.theme) return;
      this.theme = theme;
      this._palCacheT = NaN;
      this.maxTreadMarks = theme.maxTreadMarks;
      this.treadMarks.length = 0;
      for (const rock of this.allObstacles) {
        for (const f of rock.facets) {
          let rgb;
          if (!theme.rock) {
            rgb = rock.baseRgb.map((c) => Math.min(255, Math.round(c * f.k)));
          } else {
            const snowy = f.up > 0.55;
            const src = snowy ? theme.rock.snow : theme.rock.base;
            const k = snowy ? Math.min(1, 0.55 + f.k * 0.5) : f.k;
            rgb = src.map((c) => Math.min(255, Math.round(c * k)));
          }
          f.rgb = rgb;
          f.color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }
      }
    }

    // Restore destructible props and clear decals for a fresh sortie
    resetDynamic() {
      for (const prop of this.props) {
        prop.hp = prop.maxHp;
        prop.alive = true;
      }
      this.treadMarks.length = 0;
      this.scorchMarks.length = 0;
      this.iceHoles.length = 0;
    }

    getPalette() {
      if (this._palCacheT !== this.dayTime) {
        this._palCacheT = this.dayTime;
        this._palCache = sampleDayPalette(this.dayTime, this.theme.sky);
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

    // Screen position only, written to out[i * 2] (x) and out[i * 2 + 1] (y); false if the point
    // can't be projected. Same result as projectDelta(dx, dy, wz, viewW, viewH, true) without
    // creating an object — for the many vertices of rocks and solids drawn every frame.
    projectDeltaInto(out, i, dx, dy, wz, viewW, viewH) {
      if (dy > MAX_BEHIND_DY) return false;
      const th = -dy / CYL_R;
      const r = CYL_R + wz;
      const vy = r * Math.sin(th) - CAM_Y;
      const vz = r * Math.cos(th) - CYL_R - CAM_Z;
      const depth = vy * DIR_Y + vz * DIR_Z;
      if (depth <= 40) return false;
      const scale = this.getFocal(viewH) / depth;
      out[i * 2] = viewW * 0.5 + dx * scale;
      out[i * 2 + 1] = viewH * 0.5 - (vy * UP_Y + vz * UP_Z) * scale;
      return true;
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

    // Show a compound on the ground (garrisoned at the start of a sortie)
    revealBase(id) {
      if (this.revealedBases.has(id)) return;
      this.revealedBases.add(id);
      const b = this.sites.find((s) => s.id === id);
      if (b) this._stampGround(b.x, b.y, b.radius + 40, (g) => this._drawBasePad(g, b));
    }

    // New sortie: forget the garrisoned compounds. Their pads stay baked into the ground until the
    // next operation is set up (applyOperation in js/planet/zones.js rebuilds the texture).
    hideAllBases() {
      this.revealedBases.clear();
    }

    addTreadMark(x, y, angle) {
      if (this.treadMarks.length >= this.maxTreadMarks) {
        this.treadMarks.shift();
      }
      this.treadMarks.push({
        x: this.wrapX(x),
        y: this.wrapY(y),
        angle,
        cos: Math.cos(angle), // for the draw transform (sky.js), so it isn't recomputed every frame
        sin: Math.sin(angle),
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

    // A hole broken into the ice at (x, y) (radius r, ragged rim)
    addIceHole(x, y, r) {
      const rim = [];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (0.8 + Math.random() * 0.45);
        rim.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      this.iceHoles.push({ x: this.wrapX(x), y: this.wrapY(y), r, rim });
    }

    getTimeInfo() {
      const PHASE_NAMES = {
        night: L('夜', 'night'),
        dawn: L('夜明け', 'dawn'),
        morning: L('朝', 'morning'),
        day: L('昼', 'midday'),
        evening: L('夕方', 'evening')
      };
      const totalMins = Math.floor(this.dayTime * 24 * 60) % (24 * 60);
      const snappedMins = Math.floor(totalMins / 15) * 15;
      const hours = Math.floor(snappedMins / 60);
      const mins = snappedMins % 60;
      const clockText = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      const palette = this.getPalette();

      let phase = 'night';
      let phaseIcon = '🌙';
      if (hours >= 5 && hours < 7) {
        phase = 'dawn';
        phaseIcon = '🌅';
      } else if (hours >= 7 && hours < 11) {
        phase = 'morning';
        phaseIcon = '🌤';
      } else if (hours >= 11 && hours < 16) {
        phase = 'day';
        phaseIcon = '☀';
      } else if (hours >= 16 && hours < 19) {
        phase = 'evening';
        phaseIcon = '🌇';
      }

      return {
        day: this.dayCount,
        hours,
        clockText,
        phase, // night / dawn / morning / day / evening
        phaseName: PHASE_NAMES[phase],
        phaseIcon,
        nightFactor: palette.nightFactor
      };
    }

    update(dt, advanceDay = true) {
      if (advanceDay && !this.clockFrozen) {
        this.dayTime += dt / DAY_DURATION;
        if (this.dayTime >= 1) {
          this.dayTime -= 1;
          this.dayCount += 1;
        }
      }
      this._decayDecals(this.treadMarks, dt * 0.05 * this.theme.treadDecay);
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
  }

  // Module-level constants / helpers that the HorizonWorld parts in other files use
  HorizonWorld.THEMES = THEMES;

  HorizonWorld.shared = {
    scaled,
    AREA_SCALE,
    BASE_WORLD,
    WORLD_W,
    WORLD_H,
    CYL_R,
    HORIZON_THETA,
    HORIZON_DY,
    wrapCoord,
    wrapDelta,
    screenYForDy
  };

  global.HorizonWorld = HorizonWorld;
})(window);
