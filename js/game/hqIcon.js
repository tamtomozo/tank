(function (global) {
  'use strict';

  // HQ icon marking the operations HQ (作戦本部): a shield with a star. Like FortIcon, one shape
  // (centred on 0,0, ~26x27 units) is shared by the in-world canvas marker, the radar and the
  // off-screen DOM marker.
  const HQ_BODY_D = 'M-13 -15H13V-2C13 5.5 7 9.5 0 12C-7 9.5 -13 5.5 -13 -2Z';
  const HQ_STAR_D = (() => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 7.4 : 3.1;
      d += `${i === 0 ? 'M' : 'L'}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r - 3.2).toFixed(2)}`;
    }
    return `${d}Z`;
  })();
  const HQ_SVG = '<svg viewBox="-16 -18 32 33" aria-hidden="true">'
    + `<path d="${HQ_BODY_D}" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<path d="${HQ_STAR_D}" fill="#fff"/>`
    + '</svg>';

  let hqPaths = null;
  function getHqPaths() {
    if (!hqPaths) hqPaths = { body: new Path2D(HQ_BODY_D), star: new Path2D(HQ_STAR_D) };
    return hqPaths;
  }

  // Draw the HQ glyph centred at the current origin (caller sets translate/scale)
  function drawHqGlyph(c, fill, outline = '#ffffff', lineWidth = 1.8) {
    const hp = getHqPaths();
    c.lineJoin = 'round';
    c.fillStyle = fill;
    c.fill(hp.body);
    c.strokeStyle = outline;
    c.lineWidth = lineWidth;
    c.stroke(hp.body);
    c.fillStyle = outline;
    c.fill(hp.star);
  }

  // HqIcon.SVG: markup for the DOM marker; HqIcon.draw(ctx, fill, outline, lineWidth): canvas glyph
  global.HqIcon = { SVG: HQ_SVG, draw: drawHqGlyph, COLOR: '#38bdf8' };
})(window);
