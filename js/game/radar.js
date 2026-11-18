(function (global) {
  'use strict';

  // Local radar (bottom-right canvas) and the off-screen direction markers along the screen edge
  // (sortied enemies, enemy compounds, the operations HQ while the platoon is called home).

  const { FortIcon, HqIcon } = global;
  const MARKER_SVG = { fort: FortIcon.SVG, hq: HqIcon.SVG }; // upright icon markers by key

  function create(game) {
    const { world, combat } = game;
    const radarCanvas = document.getElementById('radar-canvas');
    const radarCtx = radarCanvas.getContext('2d');
    const indicatorsEl = document.getElementById('target-indicators');

    // Pooled off-screen enemy arrows (reused every frame instead of rebuilding DOM nodes)
    const arrowPool = [];

    const RADAR_RANGE = 1200; // world units from the player to the radar edge (local radar)

    function update(drawCamX, drawCamY) {
      const player = game.player;
      const viewW = game.view.w;
      const viewH = game.view.h;
      const w = radarCanvas.width;
      const h = radarCanvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      radarCtx.clearRect(0, 0, w, h);

      let arrowsUsed = 0;
      // Local radar: the player is the centre and the edge is RADAR_RANGE world units away
      const scalePx = (cx - 6) / RADAR_RANGE;
      const toRadar = (x, y) => {
        const dx = world.deltaX(player.x, x);
        const dy = world.deltaY(player.y, y);
        return {
          rx: cx + dx * scalePx,
          ry: cy + dy * scalePx,
          dx,
          dy,
          inRange: Math.abs(dx) <= RADAR_RANGE && Math.abs(dy) <= RADAR_RANGE
        };
      };
      // Same direction, pinned to the radar border (for compounds outside the range)
      const toRadarEdge = (dx, dy) => {
        const f = RADAR_RANGE / (Math.max(Math.abs(dx), Math.abs(dy)) || 1);
        return { rx: cx + dx * f * scalePx, ry: cy + dy * f * scalePx };
      };

      // Off-screen directional marker toward world point (x, y), using the wrapped delta from the camera
      // glyph: text for rotating arrows; icon markers ('fort' / 'hq') use an SVG icon and stay upright
      // (their position along the screen edge already shows the direction)
      const placeArrow = (x, y, cls, glyph, icon = null) => {
        const proj = world.project(x, y, 0, drawCamX, drawCamY, viewW, viewH, true);
        const offScreen = !proj || proj.th > world.horizonTheta || proj.sx < 24 || proj.sx > viewW - 24 || proj.sy < 24 || proj.sy > viewH - 24;
        if (!offScreen) return;
        const ang = Math.atan2(world.deltaY(drawCamY, y), world.deltaX(drawCamX, x));
        const px = 50 + Math.cos(ang) * 44;
        const py = 50 + Math.sin(ang) * 42;
        const deg = icon ? 0 : ang * (180 / Math.PI) + 90;
        // Pool entry: the element plus what was last written to it, so the DOM is only touched
        // when something changed. The marker is placed with the `translate` property (no layout,
        // the browser just moves its layer) instead of left / top.
        let arrow = arrowPool[arrowsUsed];
        if (!arrow) {
          arrow = { el: document.createElement('div'), cls: '', content: null, pos: '', deg: '', shown: true };
          indicatorsEl.appendChild(arrow.el);
          arrowPool.push(arrow);
        }
        arrowsUsed++;
        if (arrow.cls !== cls) {
          arrow.cls = cls;
          arrow.el.className = cls;
        }
        const content = icon || glyph;
        if (arrow.content !== content) {
          arrow.content = content;
          if (icon) arrow.el.innerHTML = MARKER_SVG[icon];
          else arrow.el.textContent = glyph;
        }
        if (!arrow.shown) {
          arrow.shown = true;
          arrow.el.style.display = '';
        }
        const pos = `${(viewW * px * 0.01).toFixed(1)}px ${(viewH * py * 0.01).toFixed(1)}px`;
        if (arrow.pos !== pos) {
          arrow.pos = pos;
          arrow.el.style.translate = pos;
        }
        const degText = `${deg.toFixed(1)}deg`;
        if (arrow.deg !== degText) {
          arrow.deg = degText;
          arrow.el.style.setProperty('--arrow-deg', degText);
        }
      };

      // Range rings (half and full range) and a faint crosshair
      radarCtx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      radarCtx.lineWidth = 1;
      radarCtx.beginPath();
      radarCtx.moveTo(cx, 0);
      radarCtx.lineTo(cx, h);
      radarCtx.moveTo(0, cy);
      radarCtx.lineTo(w, cy);
      radarCtx.stroke();
      for (const frac of [0.5, 1]) {
        radarCtx.beginPath();
        radarCtx.arc(cx, cy, (cx - 6) * frac, 0, Math.PI * 2);
        radarCtx.stroke();
      }

      // Compounds: fort icons (green once captured). Out of range -> small, faded, pinned to the border
      // so the direction to every known compound stays visible.
      for (const b of combat.bases) {
        const pos = toRadar(b.x, b.y);
        const at = pos.inRange ? pos : toRadarEdge(pos.dx, pos.dy);
        const iconScale = pos.inRange ? 0.36 : 0.26;
        radarCtx.save();
        radarCtx.globalAlpha = pos.inRange ? 1 : 0.7;
        radarCtx.translate(at.rx, at.ry);
        radarCtx.scale(iconScale, iconScale);
        FortIcon.draw(
          radarCtx,
          b.cleared ? '#22c55e' : b.alerted ? '#f97316' : '#ef4444', // green = captured supply depot
          'rgba(255, 255, 255, 0.85)',
          2.2
        );
        radarCtx.restore();
        if (!b.cleared) {
          placeArrow(b.x, b.y, 'target-arrow is-base' + (b.alerted ? ' is-alerted' : ''), '', 'fort');
        }
      }

      // Operations HQ: blue shield, pinned to the border when out of range like the compounds.
      // Once the area is secured it is the way home: larger, plus an off-screen marker toward it.
      {
        const hq = world.hq;
        const returning = combat.missionComplete && !game.returnedToHq;
        const pos = toRadar(hq.x, hq.y);
        const at = pos.inRange ? pos : toRadarEdge(pos.dx, pos.dy);
        const iconScale = (pos.inRange ? 0.36 : 0.26) * (returning ? 1.3 : 1);
        radarCtx.save();
        radarCtx.globalAlpha = pos.inRange || returning ? 1 : 0.7;
        radarCtx.translate(at.rx, at.ry);
        radarCtx.scale(iconScale, iconScale);
        HqIcon.draw(radarCtx, HqIcon.COLOR, 'rgba(255, 255, 255, 0.9)', 2.2);
        radarCtx.restore();
        if (returning) placeArrow(hq.x, hq.y, 'target-arrow is-base is-hq', '', 'hq');
      }

      // Wingmen within range as green dots
      radarCtx.fillStyle = '#4ade80';
      for (const a of combat.allies) {
        if (!a.alive) continue;
        const pos = toRadar(a.x, a.y);
        if (!pos.inRange) continue;
        radarCtx.beginPath();
        radarCtx.arc(pos.rx, pos.ry, 2.6, 0, Math.PI * 2);
        radarCtx.fill();
      }

      // Enemies within range: parked units dim, sortied units bright (sortied ones also get an off-screen arrow).
      // Shown where they appear to be (mirage); in a sandstorm only those within sight range.
      const sight = combat.sightRange();
      for (const e of combat.enemies) {
        if (!e.alive) continue;
        const ap = combat.apparentPos(e);
        if (sight < Infinity && Math.hypot(world.deltaX(player.x, e.x), world.deltaY(player.y, e.y)) > sight) continue;
        const idle = e.state === 'idle';
        if (!idle && e.state !== 'retreat') placeArrow(ap.x, ap.y, 'target-arrow', '\u25b2');
        const pos = toRadar(ap.x, ap.y);
        if (!pos.inRange) continue;
        radarCtx.fillStyle = idle ? 'rgba(239, 68, 68, 0.45)' : '#ef4444';
        radarCtx.beginPath();
        radarCtx.arc(pos.rx, pos.ry, idle ? 2.2 : 2.8, 0, Math.PI * 2);
        radarCtx.fill();
      }

      // Player heading arrow in the centre (drawn last so it is never covered)
      radarCtx.save();
      radarCtx.translate(cx, cy);
      radarCtx.rotate(player.hullAngle);
      radarCtx.fillStyle = '#38bdf8';
      radarCtx.beginPath();
      radarCtx.moveTo(7, 0);
      radarCtx.lineTo(-5, -4.5);
      radarCtx.lineTo(-5, 4.5);
      radarCtx.closePath();
      radarCtx.fill();
      radarCtx.restore();

      for (let i = arrowsUsed; i < arrowPool.length; i++) {
        const arrow = arrowPool[i];
        if (arrow.shown) {
          arrow.shown = false;
          arrow.el.style.display = 'none';
        }
      }
    }

    return { update };
  }

  global.GameRadar = { create };
})(window);
