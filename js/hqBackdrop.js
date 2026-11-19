(function (global) {
  'use strict';

  // Full-screen backdrop behind the pre-sortie windows, hiding the battlefield until the operation
  // starts (driven by js/game/mission.js):
  //   'room'  the operations-meeting room — "click to connect" screen and the sortie select
  //   'map'   full-screen tactical map of the picked planet — the briefing
  // show() crossfades between the two; hide() fades out to the battlefield (作戦開始).
  // Each scene is one canvas: the still parts are pre-rendered once per size, the moving parts
  // (holo table, wall screens, radar sweep, compound pulses) are drawn every frame while visible.

  const FADE_MS = 600; // matches the opacity transitions in css/hqbackdrop.css
  // Touch-first devices (phones, tablets): lighter redraws, see _loop and _drawRoom (js/game/quality.js)
  const LOW_POWER = global.GameQuality.touch;
  const TAU = Math.PI * 2;
  const FONT_UI = '"Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", system-ui, sans-serif';
  const FONT_MONO = '"Cascadia Mono", Consolas, ui-monospace, monospace';

  const lerp = (a, b, t) => a + (b - a) * t;

  // Small deterministic RNG so the room's screens look the same on every redraw
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class HqBackdrop {
    constructor(root, deps) {
      this.root = root;
      this.world = deps.world;
      this.combat = deps.combat;
      this.getPlayer = deps.getPlayer;

      this.roomCanvas = root.querySelector('.hq-bd-room');
      this.mapCanvas = root.querySelector('.hq-bd-map');
      this.captionPlanet = root.querySelector('#hq-bd-planet');
      this.captionOp = root.querySelector('#hq-bd-op');

      this.mode = null; // 'room' | 'map' | null (hidden)
      this.shownAt = 0; // when the backdrop started fading in over the battlefield
      this.switchedAt = 0; // last room ↔ map switch (both layers are drawn during the crossfade)
      this.hiddenAt = -Infinity;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.room = null; // { still canvas, layout, leds, rows }
      this.map = null; // { still canvas, marks }
      this._raf = null;
      this._drawnAt = -Infinity; // time of the last redraw (30 fps limit on phones)

      window.addEventListener('resize', () => {
        this.room = null;
        this.map = null;
      });
    }

    // True once the backdrop fully covers the battlefield (the world need not be drawn)
    get covering() {
      return this.mode != null && performance.now() - this.shownAt > FADE_MS;
    }

    // selection = { planet, operation } for the map caption
    show(mode, selection = null) {
      const now = performance.now();
      if (this.mode == null) this.shownAt = now;
      if (this.mode !== mode) this.switchedAt = now;
      this.mode = mode;
      if (mode === 'map') {
        this.map = null; // the compounds may have changed since the last briefing
        if (selection) {
          const { planet, operation } = selection;
          this.captionPlanet.textContent = `${planet.code} — ${planet.name}（${planet.terrain}）`;
          this.captionOp.textContent = L(`作戦「${operation.name}」 TACTICAL MAP`, `Op. "${operation.name}" TACTICAL MAP`);
        }
      }
      this.root.dataset.mode = mode;
      this.root.classList.add('is-visible');
      this._loop();
    }

    hide() {
      if (this.mode == null) return;
      this.mode = null;
      this.hiddenAt = performance.now();
      this.root.classList.remove('is-visible');
    }

    // ---------------------------------------------------------------- frame loop
    _loop() {
      if (this._raf != null) return;
      const frame = (ms) => {
        const fadingOut = this.mode == null && ms - this.hiddenAt < FADE_MS;
        if (this.mode == null && !fadingOut) {
          this._raf = null;
          return;
        }
        this._raf = requestAnimationFrame(frame);
        // Phones / tablets: the slow ambient animation is redrawn at ~30 fps (the fades between
        // scenes are CSS transitions and stay smooth)
        if (LOW_POWER && ms - this._drawnAt < 30) return;
        this._drawnAt = ms;
        this._fitCanvases();
        const t = ms / 1000;
        const crossfading = ms - this.switchedAt < FADE_MS;
        const mode = this.root.dataset.mode;
        if (mode === 'room' || crossfading) this._drawRoom(t);
        if (mode === 'map' || crossfading) this._drawMap(t);
      };
      this._raf = requestAnimationFrame(frame);
    }

    _fitCanvases() {
      const w = global.innerWidth;
      const h = global.innerHeight;
      const dpr = global.GameQuality.menuRatio();
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      for (const c of [this.roomCanvas, this.mapCanvas]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      this.room = null;
      this.map = null;
    }

    _still() {
      const c = document.createElement('canvas');
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
      const g = c.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      return { c, g };
    }

    // ================================================================ operations room
    // One-point perspective room: ceiling light strips, side walls lined with consoles, a back wall
    // with a large situation screen between two data screens, and a holo table in the foreground.
    _roomLayout() {
      const W = this.w;
      const H = this.h;
      const bw = { x0: W * 0.17, x1: W * 0.83, y0: H * 0.1, y1: H * 0.58 }; // back wall
      const bh = bw.y1 - bw.y0;
      const scr = { x0: W * 0.34, x1: W * 0.66, y0: bw.y0 + bh * 0.16, y1: bw.y0 + bh * 0.76 };
      const gap = W * 0.016;
      const sideY0 = scr.y0 + bh * 0.08;
      const sideY1 = scr.y1 - bh * 0.05;
      const side = [
        { x0: bw.x0 + gap * 1.4, x1: scr.x0 - gap, y0: sideY0, y1: sideY1 },
        { x0: scr.x1 + gap, x1: bw.x1 - gap * 1.4, y0: sideY0, y1: sideY1 }
      ];
      const table = { cx: W / 2, cy: H * 0.86, rx: W * 0.27, ry: Math.max(16, H * 0.06) };
      // Point on a side wall: s = depth (0 front edge of the screen → 1 back wall), v = height (0 top → 1 floor)
      const wallPt = (left, s, v) => {
        const x = lerp(left ? 0 : W, left ? bw.x0 : bw.x1, s);
        return [x, lerp(lerp(0, bw.y0, s), lerp(H, bw.y1, s), v)];
      };
      return { W, H, bw, bh, scr, side, table, wallPt };
    }

    _buildRoom() {
      const L = this._roomLayout();
      const { W, H, bw, bh, scr, side, table, wallPt } = L;
      const { c, g } = this._still();
      const rand = rng(7);
      const DEPTHS = [0.2, 0.38, 0.53, 0.66, 0.77, 0.86, 0.93];
      const poly = (pts) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
      };
      const line = (a, b) => {
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      };

      // Surfaces
      let grad = g.createLinearGradient(0, 0, 0, bw.y0);
      grad.addColorStop(0, '#0b1322');
      grad.addColorStop(1, '#070b14');
      g.fillStyle = grad;
      poly([[0, 0], [W, 0], [bw.x1, bw.y0], [bw.x0, bw.y0]]);
      g.fill();

      grad = g.createLinearGradient(0, bw.y1, 0, H);
      grad.addColorStop(0, '#0b1220');
      grad.addColorStop(1, '#04070c');
      g.fillStyle = grad;
      poly([[0, H], [W, H], [bw.x1, bw.y1], [bw.x0, bw.y1]]);
      g.fill();

      for (const left of [true, false]) {
        grad = g.createLinearGradient(left ? 0 : W, 0, left ? bw.x0 : bw.x1, 0);
        grad.addColorStop(0, '#05080f');
        grad.addColorStop(1, '#0d1626');
        g.fillStyle = grad;
        poly([wallPt(left, 0, 0), wallPt(left, 1, 0), wallPt(left, 1, 1), wallPt(left, 0, 1)]);
        g.fill();
      }

      grad = g.createLinearGradient(0, bw.y0, 0, bw.y1);
      grad.addColorStop(0, '#0f192b');
      grad.addColorStop(1, '#0b1322');
      g.fillStyle = grad;
      g.fillRect(bw.x0, bw.y0, bw.x1 - bw.x0, bh);

      // Floor grid (faint reflection of the screens' light)
      g.strokeStyle = 'rgba(56, 189, 248, 0.07)';
      g.lineWidth = 1;
      for (let i = 0; i <= 12; i++) {
        const f = i / 12;
        line([W * f, H], [lerp(bw.x0, bw.x1, f), bw.y1]);
      }
      for (const s of DEPTHS) line(wallPt(true, s, 1), wallPt(false, s, 1));
      grad = g.createLinearGradient(0, bw.y1, 0, bw.y1 + bh * 0.6);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.10)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      g.fillStyle = grad;
      g.fillRect(scr.x0 - W * 0.04, bw.y1, scr.x1 - scr.x0 + W * 0.08, bh * 0.6);

      // Ceiling beams + light strips converging on the back wall
      g.strokeStyle = 'rgba(148, 180, 218, 0.08)';
      for (const s of DEPTHS) line(wallPt(true, s, 0), wallPt(false, s, 0));
      g.save();
      g.shadowColor = 'rgba(186, 230, 253, 0.8)';
      g.shadowBlur = 14;
      g.fillStyle = 'rgba(186, 230, 253, 0.42)';
      for (const f of [0.3, 0.5, 0.7]) {
        const fx = W * f;
        const bx = lerp(bw.x0, bw.x1, f);
        const hw = Math.max(3, W * 0.006);
        poly([[fx - hw, 0], [fx + hw, 0], [bx + hw * 0.25, bw.y0], [bx - hw * 0.25, bw.y0]]);
        g.fill();
      }
      g.restore();

      // Side walls: panel seams, wall screens and consoles with status lights
      const leds = [];
      for (const left of [true, false]) {
        g.strokeStyle = 'rgba(148, 180, 218, 0.10)';
        for (const s of DEPTHS) line(wallPt(left, s, 0), wallPt(left, s, 1));
        for (let i = 0; i + 1 < DEPTHS.length; i += 2) {
          const sa = DEPTHS[i] + 0.02;
          const sb = DEPTHS[i + 1] - 0.02;
          const quad = (va, vb) => poly([wallPt(left, sa, va), wallPt(left, sb, va), wallPt(left, sb, vb), wallPt(left, sa, vb)]);
          // Wall screen
          quad(0.36, 0.56);
          g.fillStyle = 'rgba(8, 20, 36, 0.95)';
          g.fill();
          g.strokeStyle = 'rgba(56, 189, 248, 0.38)';
          g.lineWidth = 1;
          g.stroke();
          g.strokeStyle = 'rgba(56, 189, 248, 0.22)';
          for (let r = 0; r < 4; r++) {
            const v = 0.4 + r * 0.04;
            const len = 0.3 + rand() * 0.6;
            line(wallPt(left, sa + 0.01, v), wallPt(left, lerp(sa + 0.01, sb - 0.01, len), v));
          }
          // Console desk below it
          quad(0.64, 0.72);
          g.fillStyle = '#0a111d';
          g.fill();
          g.strokeStyle = 'rgba(148, 180, 218, 0.16)';
          g.stroke();
          for (let n = 0; n < 4; n++) {
            const [x, y] = wallPt(left, lerp(sa, sb, 0.15 + n * 0.22), 0.68);
            leds.push({
              x,
              y,
              r: Math.max(1.2, (1 - lerp(sa, sb, 0.5)) * 3.2),
              color: rand() < 0.25 ? '239, 68, 68' : rand() < 0.5 ? '245, 158, 11' : '34, 197, 94',
              phase: rand() * TAU,
              speed: 1.5 + rand() * 3
            });
          }
        }
      }

      // Back wall: seams, trim, label, situation screen and two data screens
      g.strokeStyle = 'rgba(148, 180, 218, 0.08)';
      for (let i = 1; i < 8; i++) {
        const x = lerp(bw.x0, bw.x1, i / 8);
        line([x, bw.y0], [x, bw.y1]);
      }
      g.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      line([bw.x0, bw.y0 + bh * 0.05], [bw.x1, bw.y0 + bh * 0.05]);
      line([bw.x0, bw.y1 - bh * 0.06], [bw.x1, bw.y1 - bh * 0.06]);
      g.font = `600 ${Math.max(10, Math.round(H * 0.017))}px ${FONT_MONO}`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(148, 180, 218, 0.55)';
      g.fillText('PLANETARY ARMORED CORPS — OPERATIONS HQ', W / 2, bw.y0 + bh * 0.115);

      const screenFrame = (s) => {
        g.save();
        g.fillStyle = '#050d18';
        g.shadowColor = 'rgba(56, 189, 248, 0.55)';
        g.shadowBlur = 18;
        g.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
        g.restore();
        g.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        g.lineWidth = 1.2;
        g.strokeRect(s.x0 + 0.5, s.y0 + 0.5, s.x1 - s.x0 - 1, s.y1 - s.y0 - 1);
      };
      screenFrame(scr);
      g.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      g.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const x = lerp(scr.x0, scr.x1, i / 10);
        line([x, scr.y0], [x, scr.y1]);
      }
      for (let i = 1; i < 6; i++) {
        const y = lerp(scr.y0, scr.y1, i / 6);
        line([scr.x0, y], [scr.x1, y]);
      }
      for (const s of side) {
        screenFrame(s);
        g.fillStyle = 'rgba(56, 189, 248, 0.18)';
        g.fillRect(s.x0 + 4, s.y0 + 4, s.x1 - s.x0 - 8, Math.max(4, (s.y1 - s.y0) * 0.06));
      }

      // Holo table: body, then the glowing top with its grid
      const { cx, cy, rx, ry } = table;
      g.fillStyle = '#04070c';
      g.beginPath();
      g.ellipse(cx, cy + ry * 0.45, rx * 1.01, ry, 0, 0, TAU);
      g.fill();
      g.fillRect(cx - rx * 1.01, cy, rx * 2.02, ry * 0.45);
      grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.05)');
      g.save();
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      g.fillStyle = '#071423';
      g.fill();
      g.fillStyle = grad;
      g.fill();
      g.clip();
      g.strokeStyle = 'rgba(56, 189, 248, 0.16)';
      for (let i = -8; i <= 8; i++) {
        line([cx + (i / 8) * rx, cy - ry], [cx + (i / 8) * rx, cy + ry]);
        line([cx - rx, cy + (i / 8) * ry], [cx + rx, cy + (i / 8) * ry]);
      }
      g.restore();
      g.save();
      g.strokeStyle = 'rgba(125, 211, 252, 0.8)';
      g.shadowColor = 'rgba(56, 189, 248, 0.9)';
      g.shadowBlur = 12;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      g.stroke();
      g.restore();

      // Vignette
      grad = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.45, Math.max(W, H) * 0.75);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);

      const rows = Array.from({ length: 23 }, () => 0.25 + rand() * 0.7);
      // Holo terrain: a small height field shown rotating above the table
      const N = 12;
      const heights = [];
      for (let i = 0; i <= N; i++) {
        heights.push([]);
        for (let j = 0; j <= N; j++) {
          const u = i / N - 0.5;
          const v = j / N - 0.5;
          const ridge = Math.sin(u * 7 + 1.3) * Math.cos(v * 6 - 0.4);
          const fall = Math.max(0, 1 - (u * u + v * v) * 3.2);
          heights[i].push(Math.max(0, (0.35 + ridge * 0.4) * fall));
        }
      }
      this.room = { still: c, layout: L, leds, rows, heights, N };
    }

    _drawRoom(t) {
      if (!this.room) this._buildRoom();
      const { still, layout: L, leds, rows, heights, N } = this.room;
      const { W, H, scr, side, table } = L;
      const g = this.roomCanvas.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.drawImage(still, 0, 0, W, H);

      // Situation screen: the planet turning, enemy positions blinking, a scan line sweeping down
      const sw = scr.x1 - scr.x0;
      const sh = scr.y1 - scr.y0;
      const cx = (scr.x0 + scr.x1) / 2;
      const cy = (scr.y0 + scr.y1) / 2;
      const R = Math.min(sw, sh) * 0.36;
      g.save();
      g.beginPath();
      g.rect(scr.x0, scr.y0, sw, sh);
      g.clip();
      let grad = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.04)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(125, 211, 252, 0.7)';
      g.lineWidth = 1.2;
      g.stroke();
      g.strokeStyle = 'rgba(56, 189, 248, 0.32)';
      g.lineWidth = 1;
      for (const lat of [-0.9, -0.45, 0, 0.45, 0.9]) {
        g.beginPath();
        g.ellipse(cx, cy - R * Math.sin(lat), R * Math.cos(lat), R * Math.cos(lat) * 0.16, 0, 0, TAU);
        g.stroke();
      }
      const spin = t * 0.3;
      for (let i = 0; i < 6; i++) {
        const ph = spin + (i * Math.PI) / 6;
        g.beginPath();
        g.ellipse(cx, cy, Math.max(0.5, R * Math.abs(Math.cos(ph))), R, 0, 0, TAU);
        g.stroke();
      }
      [[0.4, 0.2], [1.3, -0.15], [2.2, 0.3]].forEach(([lon0, lat], i) => {
        const lon = spin + lon0;
        if (Math.cos(lon) <= 0.05) return; // far side of the planet
        const x = cx + R * Math.cos(lat) * Math.sin(lon);
        const y = cy - R * Math.sin(lat);
        const a = 0.55 + 0.45 * Math.sin(t * 4 + i * 2);
        g.fillStyle = `rgba(239, 68, 68, ${a.toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, Math.max(2.5, R * 0.05), 0, TAU);
        g.fill();
      });
      const scanY = scr.y0 + ((t * 0.22) % 1) * sh;
      grad = g.createLinearGradient(0, scanY - sh * 0.12, 0, scanY);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.16)');
      g.fillStyle = grad;
      g.fillRect(scr.x0, scanY - sh * 0.12, sw, sh * 0.12);
      g.restore();

      // Data screens: scrolling report lines
      side.forEach((s, si) => {
        const h = s.y1 - s.y0;
        const rh = Math.max(6, h / 13);
        const top = s.y0 + Math.max(4, h * 0.06) + 8;
        const scroll = t * (10 + si * 4);
        const first = Math.floor(scroll / rh);
        const off = scroll - first * rh;
        g.save();
        g.beginPath();
        g.rect(s.x0 + 2, top, s.x1 - s.x0 - 4, s.y1 - top - 2);
        g.clip();
        for (let r = 0; r * rh < h + rh; r++) {
          const len = rows[(first + r + si * 7) % rows.length];
          const y = top + r * rh - off;
          g.fillStyle = (first + r) % 5 === 0 ? 'rgba(245, 158, 11, 0.45)' : 'rgba(125, 211, 252, 0.32)';
          g.fillRect(s.x0 + 6, y, (s.x1 - s.x0 - 12) * len, Math.max(2, rh * 0.32));
        }
        g.restore();
      });

      // Console status lights
      for (const led of leds) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * led.speed + led.phase));
        g.fillStyle = `rgba(${led.color}, ${a.toFixed(3)})`;
        g.beginPath();
        g.arc(led.x, led.y, led.r, 0, TAU);
        g.fill();
      }

      // Holo table: light column and the planet's terrain turning above it
      const { cx: tx, cy: ty, rx, ry } = table;
      const hs = Math.min(rx * 0.8, H * 0.2); // half-size of the holo terrain
      const baseY = ty - ry * 0.2;
      grad = g.createLinearGradient(0, ty, 0, ty - hs * 1.6);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(tx - rx * 0.6, ty);
      g.lineTo(tx - hs * 1.05, ty - hs * 1.6);
      g.lineTo(tx + hs * 1.05, ty - hs * 1.6);
      g.lineTo(tx + rx * 0.6, ty);
      g.closePath();
      g.fill();

      const rot = t * 0.25;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const tilt = 0.38; // how much depth shows as screen height
      const pts = heights.map((row, i) => row.map((hgt, j) => {
        const u = (i / N - 0.5) * 2;
        const v = (j / N - 0.5) * 2;
        const x = u * cr - v * sr;
        const z = u * sr + v * cr;
        return [tx + x * hs, baseY - hs * 0.55 + z * hs * tilt - hgt * hs * 0.7];
      }));
      g.save();
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
          const [x, y] = pts[i][j];
          if (j === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        for (let j = 0; j <= N; j++) {
          const [x, y] = pts[j][i];
          if (j === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      }
      if (LOW_POWER) {
        // A canvas shadow blurs the whole wireframe again on every frame; on phones the glow is
        // a wide faint stroke under the lines instead
        g.strokeStyle = 'rgba(56, 189, 248, 0.16)';
        g.lineWidth = 5;
        g.stroke();
      } else {
        g.shadowColor = 'rgba(56, 189, 248, 0.8)';
        g.shadowBlur = 6;
      }
      g.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      // Enemy compounds marked on the holo terrain
      [[3, 4], [8, 3], [6, 9]].forEach(([i, j], n) => {
        const [x, y] = pts[i][j];
        const a = 0.5 + 0.5 * Math.sin(t * 3 + n * 2.1);
        g.fillStyle = `rgba(239, 68, 68, ${(0.45 + a * 0.55).toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, Math.max(2.5, hs * 0.035), 0, TAU);
        g.fill();
      });
    }

    // ================================================================ tactical map (briefing)
    // The whole battlefield scaled to cover the screen: terrain, compounds, the HQ and the
    // platoon, under a coordinate grid; a radar sweep crosses it and the enemy compounds pulse.
    _buildMap() {
      const W = this.w;
      const H = this.h;
      const world = this.world;
      const combat = this.combat;
      const { c, g } = this._still();
      const k = Math.max(W / world.width, H / world.height);
      const ox = (W - world.width * k) / 2;
      const oy = (H - world.height * k) / 2;
      const marks = [];

      g.fillStyle = world.theme.mapBg;
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(ox, oy);

      global.TacticalMap.drawTerrain(g, world, k);

      // Coordinate grid (every 200 units, stronger every 600)
      for (let v = 0; v <= world.width; v += 200) {
        g.strokeStyle = v % 600 === 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.08)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(v * k, 0);
        g.lineTo(v * k, world.height * k);
        g.moveTo(0, v * k);
        g.lineTo(world.width * k, v * k);
        g.stroke();
      }
      g.font = `600 11px ${FONT_MONO}`;
      g.fillStyle = 'rgba(125, 211, 252, 0.55)';
      g.textAlign = 'left';
      for (let v = 600; v < world.width; v += 600) {
        g.fillText(`X${v}`, v * k + 4, -oy + 14);
        g.fillText(`Y${v}`, -ox + 6, v * k - 4);
      }

      const outlined = (text, x, y, font, color, align = 'center') => {
        g.font = font;
        g.textAlign = align;
        g.lineJoin = 'round';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(15, 23, 42, 0.92)';
        g.strokeText(text, x, y);
        g.fillStyle = color;
        g.fillText(text, x, y);
      };

      // Compounds
      for (const b of combat.bases) {
        const px = b.x * k;
        const py = b.y * k;
        const color = b.cleared ? '#22c55e' : '#ef4444';
        g.save();
        g.translate(px, py);
        g.scale(0.85, 0.85);
        if (global.FortIcon) global.FortIcon.draw(g, color, 'rgba(255,255,255,0.9)', 2);
        g.restore();
        outlined(b.name, px + 15, py + 5, `700 13px ${FONT_UI}`, '#fff', 'left');
        if (!b.cleared) marks.push({ x: ox + px, y: oy + py, color: '239, 68, 68' });
      }

      // Operations HQ + own platoon
      const hq = world.hq;
      const hx = hq.x * k;
      const hy = hq.y * k;
      const hsz = 16;
      g.fillStyle = 'rgba(56, 189, 248, 0.18)';
      g.strokeStyle = '#7dd3fc';
      g.lineWidth = 1.8;
      g.beginPath();
      g.roundRect(hx - hsz, hy - hsz, hsz * 2, hsz * 2, 3);
      g.fill();
      g.stroke();
      outlined(hq.name, hx, hy - hsz - 7, `700 13px ${FONT_UI}`, '#e0f2fe');
      marks.push({ x: ox + hx, y: oy + hy, color: '56, 189, 248' });
      const player = this.getPlayer();
      if (player) {
        const sx = player.x * k;
        const sy = player.y * k;
        g.fillStyle = '#38bdf8';
        g.strokeStyle = '#e0f2fe';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sx, sy - 9);
        g.lineTo(sx + 7, sy + 7);
        g.lineTo(sx - 7, sy + 7);
        g.closePath();
        g.fill();
        g.stroke();
      }

      g.restore();

      // Vignette so the briefing window stands out
      const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      grad.addColorStop(0, 'rgba(2, 6, 14, 0.22)');
      grad.addColorStop(1, 'rgba(2, 6, 14, 0.62)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);

      this.map = { still: c, marks };
    }

    _drawMap(t) {
      if (!this.map) this._buildMap();
      const W = this.w;
      const H = this.h;
      const { still, marks } = this.map;
      const g = this.mapCanvas.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.drawImage(still, 0, 0, W, H);

      // Pulse rings on the enemy compounds still to take, and on the HQ
      marks.forEach((m, i) => {
        const p = (t * 0.6 + i * 0.37) % 1;
        g.strokeStyle = `rgba(${m.color}, ${(0.75 * (1 - p)).toFixed(3)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(m.x, m.y, 14 + p * 34, 0, TAU);
        g.stroke();
      });

      // Radar sweep crossing the map from left to right
      const band = Math.max(120, W * 0.12);
      const x = ((t * 0.09) % 1) * (W + band * 2) - band;
      const grad = g.createLinearGradient(x - band, 0, x, 0);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.12)');
      g.fillStyle = grad;
      g.fillRect(x - band, 0, band, H);
      g.fillStyle = 'rgba(125, 211, 252, 0.35)';
      g.fillRect(x, 0, 1.5, H);
    }
  }

  global.HqBackdrop = HqBackdrop;
})(window);
