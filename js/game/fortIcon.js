(function (global) {
  'use strict';

  // Fort icon marking enemy compounds. One SVG path (centred on 0,0, ~28x29 units) shared by the
  // in-world canvas icon, the radar and the off-screen DOM markers so they all look the same.
  // Body: two crenellated towers + crenellated curtain wall, gate cut out via even-odd fill.
  const FORT_BODY_D = 'M-14 10V-12H-12V-10H-9V-12H-7V-5H-5V-7H-2V-5H2V-7H5V-5H7V-12H9V-10H12V-12H14V10Z'
    + 'M-3.5 10V4A3.5 3.5 0 0 1 3.5 4V10Z';
  const FORT_POLE_D = 'M0 -5V-17';
  const FORT_FLAG_D = 'M0 -17L7 -14.5L0 -12Z';
  const FORT_SVG = '<svg viewBox="-17 -20 34 32" aria-hidden="true">'
    + `<path d="${FORT_POLE_D}" stroke="#fff" stroke-width="1.6" fill="none"/>`
    + `<path d="${FORT_FLAG_D}" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="${FORT_BODY_D}" fill="currentColor" fill-rule="evenodd" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`
    + '</svg>';

  let fortPaths = null;
  function getFortPaths() {
    if (!fortPaths) {
      fortPaths = {
        body: new Path2D(FORT_BODY_D),
        pole: new Path2D(FORT_POLE_D),
        flag: new Path2D(FORT_FLAG_D)
      };
    }
    return fortPaths;
  }

  // Draw the fort glyph centred at the current origin (caller sets translate/scale)
  function drawFortGlyph(c, fill, outline = '#ffffff', lineWidth = 1.8) {
    const fp = getFortPaths();
    c.lineJoin = 'round';
    c.strokeStyle = outline;
    c.lineWidth = lineWidth;
    c.stroke(fp.pole);
    c.fillStyle = fill;
    c.fill(fp.flag);
    c.stroke(fp.flag);
    c.fill(fp.body, 'evenodd');
    c.stroke(fp.body);
  }

  // FortIcon.SVG: markup for DOM markers; FortIcon.draw(ctx, fill, outline, lineWidth): canvas glyph
  // (in-world icons, the radar and the briefing map)
  global.FortIcon = { SVG: FORT_SVG, draw: drawFortGlyph };
})(window);
