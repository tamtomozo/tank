(function (global) {
  'use strict';

  // Terrain layer of the top-down tactical maps (briefing map js/briefing.js and the full-screen
  // briefing backdrop js/hqBackdrop.js): dry hardpans, gullies, large rocks and jump ramps.
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
