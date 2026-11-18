(function (global) {
  'use strict';

  // Terrain layer of the top-down tactical maps (briefing map js/briefing.js and the full-screen
  // briefing backdrop js/hqBackdrop.js): dry hardpans, gullies, the operation's areas (salt flat,
  // old town with its buildings), large rocks and jump ramps.
  // `k` = map pixels per world unit; the caller sets the origin and any global alpha.

  function drawTerrain(g, world, k) {
    for (const hp of world.hardpans) {
      g.fillStyle = 'rgba(214, 190, 150, 0.22)';
      g.beginPath();
      g.arc(hp.x * k, hp.y * k, Math.max(2, hp.size * 0.4 * k), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(22, 14, 8, 0.75)';
    g.lineWidth = 1.4;
    for (const gully of world.gullies) {
      g.beginPath();
      let prev = null;
      for (const pt of gully) {
        // Skip the segment where a gully wraps around the map edge
        if (prev && Math.abs(pt.x - prev.x) < world.width / 2 && Math.abs(pt.y - prev.y) < world.height / 2) {
          g.moveTo(prev.x * k, prev.y * k);
          g.lineTo(pt.x * k, pt.y * k);
        }
        prev = pt;
      }
      g.stroke();
    }
    const ZONE_FILL = {
      saltflat: 'rgba(236, 232, 220, 0.55)',
      lake: 'rgba(125, 190, 230, 0.6)',
      city: 'rgba(196, 168, 124, 0.45)',
      snowCity: 'rgba(160, 172, 190, 0.5)',
      industrialCity: 'rgba(90, 88, 86, 0.55)',
      factory: 'rgba(70, 68, 66, 0.8)'
    };
    for (const z of world.zones) {
      if (z.kind === 'highway') continue; // the deck itself is drawn with the buildings
      g.beginPath();
      if (z.kind === 'factory') g.rect((z.x - z.hx) * k, (z.y - z.hy) * k, z.hx * 2 * k, z.hy * 2 * k);
      else g.arc(z.x * k, z.y * k, z.radius * k, 0, Math.PI * 2);
      const city = z.kind === 'city' && (z.style === 'snow' ? 'snowCity' : z.style === 'industrial' ? 'industrialCity' : null);
      g.fillStyle = ZONE_FILL[city || z.kind];
      g.fill();
      for (const t of z.thin || []) {
        g.fillStyle = 'rgba(30, 70, 110, 0.75)';
        g.beginPath();
        g.arc((z.x + t.dx) * k, (z.y + t.dy) * k, Math.max(1.5, t.r * k), 0, Math.PI * 2);
        g.fill();
      }
      if (z.pond) {
        g.fillStyle = 'rgba(56, 140, 170, 0.85)';
        g.beginPath();
        g.ellipse((z.x + z.pond.dx) * k, (z.y + z.pond.dy) * k, z.pond.rx * k, z.pond.ry * k, 0.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Buildings: civilian ones warm-coloured, industry / highway / factory dark, fuel tanks red
    g.strokeStyle = '#4a3a26';
    g.lineWidth = 0.8;
    for (const st of world.structures) {
      if (!st.box) {
        g.fillStyle = '#dc2626';
        g.beginPath();
        g.arc(st.x * k, st.y * k, Math.max(1.6, st.radius * k), 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.fillStyle = st.civil ? '#d6b48a' : st.deck ? '#3f3d3c' : st.industry || st.kind === 'factory' || st.kind === 'machine' ? '#6b6560' : '#a88a5e';
      const x = (st.x - st.box.hx) * k;
      const y = (st.y - st.box.hy) * k;
      g.fillRect(x, y, st.box.hx * 2 * k, st.box.hy * 2 * k);
      g.strokeRect(x, y, st.box.hx * 2 * k, st.box.hy * 2 * k);
    }
    for (const o of world.obstacles) {
      g.fillStyle = '#8b7d6b';
      g.strokeStyle = '#3f372e';
      g.lineWidth = 1;
      g.beginPath();
      o.base.forEach((v, i) => {
        const px = (o.x + v[0]) * k;
        const py = (o.y + v[1]) * k;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.strokeStyle = '#38bdf8';
    g.lineWidth = 1.2;
    for (const r of world.ramps) {
      g.beginPath();
      g.arc(r.x * k, r.y * k, Math.max(2.2, r.radius * k), 0, Math.PI * 2);
      g.stroke();
    }
  }

  global.TacticalMap = { drawTerrain };
})(window);
