(function (global) {
  'use strict';

  // Operations HQ (作戦本部): the friendly command post at the map centre. Every sortie starts on
  // its pad and, once the whole area is secured, the platoon drives back here to end the operation
  // (js/game/mission.js). This file owns its layout, the pad baked into the ground texture and the
  // standing parts: command tent and supply crates (low-poly solids), flag and radio mast.
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { WORLD_H, WORLD_W } = global.HorizonWorld.shared;

  const HQ_X = WORLD_W * 0.5; // same point as the spawn point kept clear in terrain.js
  const HQ_Y = WORLD_H * 0.5;
  const HQ_RADIUS = 180; // packed-earth pad
  const RETURN_RADIUS = 70; // painted circle on the pad: stop inside it to report back
  const SANDBAG_RING = 160;

  // Sun from the north-west, high in the sky (same light as the boulders in terrain.js)
  const SUN = [-0.45, -0.55, 0.7];
  const SUN_LEN = Math.hypot(SUN[0], SUN[1], SUN[2]);

  // Convex low-poly solid in the same data shape as a boulder, so drawObstacle() can draw it.
  // faces: [{ verts: [[x, y, z], ...], rgb }] in local coordinates (x east, y south, z up).
  // Each face is wound to face away from `core` and gets its sun shading baked in.
  function makeSolid(x, y, radius, height, footprint, faces, core) {
    const facets = faces.map(({ verts, rgb }) => {
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
      let ordered = verts;
      if (nx * (cx - core[0]) + ny * (cy - core[1]) + nz * (cz - core[2]) < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        ordered = [...verts].reverse();
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const lambert = Math.max(0, (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) / (nLen * SUN_LEN));
      const k = 0.5 + lambert * 0.66;
      const shaded = rgb.map((ch) => Math.min(255, Math.round(ch * k)));
      return { verts: ordered, rgb: shaded, color: `rgb(${shaded[0]}, ${shaded[1]}, ${shaded[2]})` };
    });
    return { x, y, radius, height, base: footprint, facets };
  }

  // Ridge tent: long axis east-west, door in the east gable (facing the pad), blue ID panel south
  function makeTent(x, y) {
    const L = 46;
    const D = 30;
    const wallH = 20;
    const ridgeH = 40;
    const canvas = [108, 118, 78];
    const roof = [122, 132, 90];
    const b = [[-L, -D, 0], [L, -D, 0], [L, D, 0], [-L, D, 0]];
    const w = b.map(([px, py]) => [px, py, wallH]);
    const r0 = [-L, 0, ridgeH];
    const r1 = [L, 0, ridgeH];
    const faces = [
      { verts: [b[0], b[1], w[1], w[0]], rgb: canvas }, // north wall
      { verts: [b[3], b[2], w[2], w[3]], rgb: canvas }, // south wall
      { verts: [b[0], b[3], w[3], r0, w[0]], rgb: canvas }, // west gable
      { verts: [b[1], b[2], w[2], r1, w[1]], rgb: canvas }, // east gable
      { verts: [[L + 0.5, -9, 0], [L + 0.5, 9, 0], [L + 0.5, 9, 25], [L + 0.5, -9, 25]], rgb: [44, 46, 36] }, // door
      { verts: [[-22, D + 0.5, 5], [22, D + 0.5, 5], [22, D + 0.5, 15], [-22, D + 0.5, 15]], rgb: [72, 160, 224] }, // ID panel
      { verts: [w[0], w[1], r1, r0], rgb: roof }, // north roof
      { verts: [w[3], w[2], r1, r0], rgb: roof } // south roof
    ];
    return makeSolid(x, y, L, ridgeH, b, faces, [0, 0, wallH * 0.5]);
  }

  function makeCrate(x, y, hx, hy, h, rgb) {
    const b = [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]];
    const t = b.map(([px, py]) => [px, py, h]);
    const faces = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      faces.push({ verts: [b[i], b[j], t[j], t[i]], rgb });
    }
    faces.push({ verts: t, rgb: rgb.map((ch) => ch + 16) });
    return makeSolid(x, y, Math.max(hx, hy), h, b, faces, [0, 0, h * 0.5]);
  }

  function starPath(c, cx, cy, outer, inner) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? outer : inner;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  class WorldHeadquarters {
    // Layout only (no shared RNG involved, so the rest of the map is unchanged)
    _initHeadquarters() {
      const at = (dx, dy) => ({ x: this.wrapX(HQ_X + dx), y: this.wrapY(HQ_Y + dy) });
      const tent = at(-105, -30);
      const crateA = at(110, 2);
      const crateB = at(132, 26);
      this.hq = {
        name: '作戦本部',
        x: HQ_X,
        y: HQ_Y,
        radius: HQ_RADIUS,
        returnRadius: RETURN_RADIUS,
        // Ground point the floating HQ marker is tethered to (the command tent) and its lift
        marker: { ...tent, lift: 70 },
        // Standing parts, depth-sorted with everything else by render.js
        parts: [
          { kind: 'solid', ...tent, solid: makeTent(tent.x, tent.y) },
          { kind: 'solid', ...crateA, solid: makeCrate(crateA.x, crateA.y, 19, 13, 17, [92, 112, 70]) },
          { kind: 'solid', ...crateB, solid: makeCrate(crateB.x, crateB.y, 13, 13, 13, [146, 118, 80]) },
          { kind: 'flag', ...at(88, -56) },
          { kind: 'mast', ...at(-120, -86) }
        ],
        // Solid circles tanks can't drive through (two along the tent, one over the crates)
        colliders: [
          { ...at(-125, -30), radius: 30 },
          { ...at(-85, -30), radius: 30 },
          { ...at(119, 12), radius: 25 }
        ]
      };
    }

    // HQ pad baked into the ground texture: packed earth, track ruts to the north and south gates,
    // a sandbag ring and the painted return circle with "HQ" lettering (origin = HQ centre)
    _drawHqPad(g) {
      const pad = g.createRadialGradient(0, 0, HQ_RADIUS * 0.2, 0, 0, HQ_RADIUS + 30);
      pad.addColorStop(0, 'rgba(74, 66, 58, 0.5)');
      pad.addColorStop(0.75, 'rgba(84, 72, 58, 0.36)');
      pad.addColorStop(1, 'rgba(84, 72, 58, 0)');
      g.fillStyle = pad;
      g.beginPath();
      g.arc(0, 0, HQ_RADIUS + 30, 0, Math.PI * 2);
      g.fill();

      // Track ruts through the north and south gates
      g.strokeStyle = 'rgba(32, 24, 18, 0.26)';
      g.lineWidth = 5;
      for (const dir of [-1, 1]) {
        for (const off of [-14, 14]) {
          g.beginPath();
          g.moveTo(off, dir * (RETURN_RADIUS + 12));
          g.lineTo(off, dir * (HQ_RADIUS + 28));
          g.stroke();
        }
      }

      // Sandbag ring with gates to the north and south
      const bagLen = 17;
      const n = Math.floor((Math.PI * 2 * SANDBAG_RING) / (bagLen + 2));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        if (Math.abs(Math.cos(a)) < 0.2) continue; // gate
        g.save();
        g.rotate(a);
        g.translate(SANDBAG_RING, 0);
        g.fillStyle = k % 2 === 0 ? '#a8916a' : '#9a8460';
        g.strokeStyle = 'rgba(58, 44, 28, 0.85)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.roundRect(-5, -bagLen * 0.5, 10, bagLen, 3.5);
        g.fill();
        g.stroke();
        g.restore();
      }

      // Painted return circle, quarter ticks and lettering (worn paint)
      g.strokeStyle = 'rgba(186, 230, 253, 0.5)';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, RETURN_RADIUS, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 3;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        g.beginPath();
        g.moveTo(Math.cos(a) * (RETURN_RADIUS - 12), Math.sin(a) * (RETURN_RADIUS - 12));
        g.lineTo(Math.cos(a) * (RETURN_RADIUS + 12), Math.sin(a) * (RETURN_RADIUS + 12));
        g.stroke();
      }
      g.fillStyle = 'rgba(224, 242, 254, 0.42)';
      g.font = '800 46px system-ui, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('HQ', 0, 3);
    }

    // One standing part of the HQ; p = projection of the part's ground point
    drawHqPart(ctx, part, p, timeSec, camX, camY, viewW, viewH) {
      if (part.kind === 'solid') this.drawObstacle(ctx, part.solid, p, camX, camY, viewW, viewH);
      else if (part.kind === 'flag') this._drawHqFlag(ctx, p, timeSec);
      else this._drawHqMast(ctx, p, timeSec);
    }

    // Platoon colours: blue cloth with a white star on a tall pole, rippling in the wind
    _drawHqFlag(ctx, p, timeSec) {
      const poleH = 88;
      const W = 38;
      const H = 24;
      const segs = 8;
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(p.scale * 1.4, p.scale * 1.4);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(15, 2, 24, Math.max(1.5, 5 * p.tiltCos), 0, 0, Math.PI * 2);
      ctx.fill();

      // Concrete footing
      ctx.fillStyle = '#6b6f76';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath();
      ctx.ellipse(0, -1.8, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();

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
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(0, -poleH - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();

      const topY = -poleH + 2;
      const phase = timeSec * 5.2;
      const wave = (u) => Math.sin(phase - u * 4.2) * 2.8 * u; // larger ripple toward the free end
      const shade = ctx.createLinearGradient(0, 0, W, 0);
      for (let k = 0; k <= 4; k++) {
        const u = k / 4;
        const light = 0.5 + 0.5 * Math.cos(phase - u * 4.2);
        shade.addColorStop(u, `rgb(${Math.round(24 + light * 22)}, ${Math.round(98 + light * 48)}, ${Math.round(188 + light * 54)})`);
      }
      ctx.fillStyle = shade;
      ctx.strokeStyle = 'rgba(12, 32, 66, 0.6)';
      ctx.lineWidth = 0.9;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const y = topY + wave(u);
        if (i === 0) ctx.moveTo(u * W, y);
        else ctx.lineTo(u * W, y);
      }
      for (let i = segs; i >= 0; i--) {
        const u = i / segs;
        ctx.lineTo(u * W, topY + H + wave(u) * 1.1 + u * 1.6);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const su = 0.4;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      starPath(ctx, su * W, topY + H * 0.5 + wave(su) + su * 0.8, 7, 2.9);
      ctx.fill();

      ctx.restore();
    }

    // Lattice radio mast with guy wires, antenna bars and a blinking beacon
    _drawHqMast(ctx, p, timeSec) {
      const H = 132;
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(p.scale, p.scale);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
      ctx.beginPath();
      ctx.ellipse(8, 2, 20, Math.max(1.5, 5 * p.tiltCos), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (const gx of [-34, 34]) {
        ctx.moveTo(0, -H * 0.82);
        ctx.lineTo(gx, 3);
      }
      ctx.stroke();

      // Two legs converging toward the top, zigzag bracing between them
      const legX = (t) => 8 - t * 6.2; // half-width at height fraction t
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-legX(0), 0);
      ctx.lineTo(-legX(1), -H);
      ctx.moveTo(legX(0), 0);
      ctx.lineTo(legX(1), -H);
      ctx.stroke();
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const bays = 9;
      for (let i = 0; i < bays; i++) {
        const t0 = i / bays;
        const t1 = (i + 1) / bays;
        const side = i % 2 === 0 ? 1 : -1;
        ctx.moveTo(-side * legX(t0), -H * t0);
        ctx.lineTo(side * legX(t1), -H * t1);
      }
      ctx.stroke();

      // Antenna bars near the top
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-13, -H + 12);
      ctx.lineTo(13, -H + 12);
      ctx.moveTo(-9, -H + 24);
      ctx.lineTo(9, -H + 24);
      ctx.stroke();

      const blink = Math.sin(timeSec * 3.4) > 0.2 ? 1 : 0.25;
      ctx.fillStyle = `rgba(248, 113, 113, ${(0.28 * blink).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, -H - 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(254, 202, 202, ${(0.5 + 0.5 * blink).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, -H - 3, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldHeadquarters);
})(window);
