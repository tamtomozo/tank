(function (global) {
  'use strict';

  // HorizonWorld: the planet surface — a wrapped 4800 x 4800 map seen on a cylinder curving away
  // toward the horizon. This file holds the constants, coordinates & projection, time of day and
  // decals; the rest of the class is mixed in from the other files in js/planet/:
  //   terrain.js  world generation          ground.js  ground texture build + draw
  //   sky.js      sky / backdrop / haze      night.js   darkness + headlight cone
  //   props.js    flags, crates, rocks, jump pads    hq.js      operations HQ (作戦本部)

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

  const { lerp } = global.TankUtil;

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

      this.revealedBases = new Set(); // compounds whose ground pad is drawn (garrisoned this sortie)

      this._initBackdrop();
      this._initTerrainAndProps();
      this._initEnemyBases();
      this._initHeadquarters();
      // Everything a tank can't drive through: boulders + the solid parts of the HQ
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

    // Restore destructible props and clear decals for a fresh sortie
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
      const b = (this.enemyBases || []).find((s) => s.id === id);
      if (b) this._stampGround(b.x, b.y, b.radius + 40, (g) => this._drawBasePad(g, b));
    }

    // New sortie: remove every compound from the ground again (rebuilds the baked texture)
    hideAllBases() {
      if (this.revealedBases.size === 0) return;
      this.revealedBases.clear();
      this._buildGroundTexture();
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
  }

  // Module-level constants / helpers that the HorizonWorld parts in other files use
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
