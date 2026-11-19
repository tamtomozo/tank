(function (global) {
  'use strict';

  // Operation medal: the overall rank of a completed operation (js/results.js computeRank) shown
  // as a medal whose metal tells how well it went. Used by the after-action report and by the
  // completed stages on the operation select (js/operationSelect.js). Colours: css/medal.css.
  //   S 金勲章 (gold) / A 銀勲章 (silver) / B 銅勲章 (bronze) / C 鉄勲章 (iron)
  // The gold medal has a shape of its own: an eight-rayed faceted star on a laurel wreath with a
  // red enamel centre (goldBody); the others share the round disc (discBody).

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RANKS = ['S', 'A', 'B', 'C']; // best first
  const NAMES = L({ S: '金勲章', A: '銀勲章', B: '銅勲章', C: '鉄勲章' }, { S: 'Gold Medal', A: 'Silver Medal', B: 'Bronze Medal', C: 'Iron Medal' });
  const GRADES = L({ S: '最優秀', A: '優秀', B: '良好', C: '達成' }, { S: 'Outstanding', A: 'Excellent', B: 'Good', C: 'Completed' });

  let uid = 0; // gradient ids must be unique per medal in the document

  // Five-pointed star centred at (cx, cy)
  function starPoints(cx, cy, outer, inner) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  // Twelve-pointed sunburst behind the disc
  function burstPoints(cx, cy, outer, inner) {
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 12;
      pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  const pt = (cx, cy, r, a) => `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  const DEG = Math.PI / 180;

  // Round disc on a sunburst (silver / bronze / iron)
  function discBody(id) {
    return `
        <path class="medal-ribbon" d="M14 0h36v8L38 34H26L14 8Z"/>
        <path class="medal-ribbon-stripe" d="M26 0h12v34h-12Z"/>
        <path class="medal-ribbon-edge" d="M14 8 26 34M50 8 38 34" fill="none"/>
        <rect class="medal-clasp" x="23" y="31" width="18" height="6" rx="1.5" fill="url(#${id}-rim)"/>
        <polygon class="medal-burst" points="${burstPoints(32, 58, 25, 20)}" fill="url(#${id}-rim)"/>
        <circle cx="32" cy="58" r="18" fill="url(#${id}-disc)" class="medal-disc"/>
        <circle cx="32" cy="58" r="14.5" class="medal-inner-ring" fill="none"/>
        <polygon class="medal-star" points="${starPoints(32, 58.5, 10, 4.2)}"/>
        <path class="medal-shine" d="M19 50a15 15 0 0 1 10-8" fill="none"/>`;
  }

  // Gold: laurel wreath, eight faceted rays (each split into a lit and a shaded half), small rays
  // between them, a red enamel ring with a gold star, and two glints
  function goldBody(id) {
    const cx = 32;
    const cy = 57;
    // Laurel: a branch up each side from the bottom, behind the star. Leaves sit in pairs on the
    // stem (one outside, one inside), pointing along the branch towards its tip.
    const R = 22;
    let laurel = '';
    for (const side of [-1, 1]) {
      const from = 90 - side * 12; // just off the bottom
      const to = 90 - side * 150; // tips end level with the clasp
      laurel += `<path class="medal-stem" d="M${pt(cx, cy, R, from * DEG).replace(',', ' ')}A${R} ${R} 0 0 ${side > 0 ? 0 : 1} ${pt(cx, cy, R, to * DEG).replace(',', ' ')}" fill="none"/>`;
      for (let i = 0; i < 6; i++) {
        const deg = from - side * (14 + i * 23);
        const a = deg * DEG;
        const along = deg - side * 90; // direction of the branch towards its tip
        for (const [off, tilt] of [[3.2, -side * 32], [-3.2, side * 32]]) {
          const x = cx + Math.cos(a) * (R + off);
          const y = cy + Math.sin(a) * (R + off);
          const rot = along + 90 + (off > 0 ? tilt : -tilt) * -1;
          laurel += `<ellipse class="medal-leaf" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="1.7" ry="4.2" transform="rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"/>`;
        }
      }
    }
    // Small rays between the main ones
    let small = '';
    for (let i = 0; i < 8; i++) {
      const a = (-90 + 22.5 + i * 45) * DEG;
      small += `<polygon class="medal-ray-small" points="${pt(cx, cy, 8, a - 14 * DEG)} ${pt(cx, cy, 18, a)} ${pt(cx, cy, 8, a + 14 * DEG)}"/>`;
    }
    // Eight main rays, faceted
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (-90 + i * 45) * DEG;
      const tip = pt(cx, cy, 25, a);
      const left = pt(cx, cy, 9, a - 22.5 * DEG);
      const right = pt(cx, cy, 9, a + 22.5 * DEG);
      const c = `${cx},${cy}`;
      rays += `<polygon class="medal-facet-lit" points="${c} ${left} ${tip}"/>`
        + `<polygon class="medal-facet-dark" points="${c} ${tip} ${right}"/>`;
    }
    const glint = (x, y, s) =>
      `<path class="medal-glint" d="M${x} ${y - s}L${x + s * 0.22} ${y - s * 0.22}L${x + s} ${y}L${x + s * 0.22} ${y + s * 0.22}L${x} ${y + s}L${x - s * 0.22} ${y + s * 0.22}L${x - s} ${y}L${x - s * 0.22} ${y - s * 0.22}Z"/>`;
    return `
        <path class="medal-ribbon" d="M12 0h40v8L39 31H25L12 8Z"/>
        <path class="medal-ribbon-stripe" d="M27 0h10v31h-10Z"/>
        <path class="medal-ribbon-gold" d="M15 0h3v8L28 31M49 0h-3v8L36 31" fill="none"/>
        <path class="medal-ribbon-edge" d="M12 8 25 31M52 8 39 31" fill="none"/>
        <rect class="medal-clasp" x="21" y="28.5" width="22" height="5.5" rx="2" fill="url(#${id}-rim)"/>
        <circle class="medal-clasp-gem" cx="32" cy="31.2" r="1.6"/>
        ${laurel}
        ${small}
        ${rays}
        <circle cx="${cx}" cy="${cy}" r="9.5" fill="url(#${id}-rim)" class="medal-enamel-rim"/>
        <circle cx="${cx}" cy="${cy}" r="7.6" class="medal-enamel"/>
        <polygon class="medal-centre-star" points="${starPoints(cx, cy + 0.4, 5.6, 2.3)}"/>
        ${glint(47, 43, 3.6)}
        ${glint(18, 67, 2.4)}`;
  }

  const Medal = {
    RANKS,

    name(rank) {
      return NAMES[rank] || NAMES.C;
    },

    grade(rank) {
      return GRADES[rank] || GRADES.C;
    },

    // True if rank a is better than rank b (a missing rank is the worst)
    isBetter(a, b) {
      const ia = RANKS.indexOf(a);
      const ib = RANKS.indexOf(b);
      return ia >= 0 && (ib < 0 || ia < ib);
    },

    // <svg class="medal {extraClass}" data-rank="S"> — ribbon, sunburst, disc and star
    create(rank, extraClass) {
      const r = RANKS.includes(rank) ? rank : 'C';
      const id = `medal-g${++uid}`;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 64 84');
      svg.setAttribute('class', `medal${extraClass ? ` ${extraClass}` : ''}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', L(`${NAMES[r]}（${GRADES[r]}）`, `${NAMES[r]} (${GRADES[r]})`));
      svg.dataset.rank = r;
      svg.innerHTML = `
        <defs>
          <radialGradient id="${id}-disc" cx="38%" cy="32%" r="75%">
            <stop offset="0" class="medal-stop-hi"/>
            <stop offset="0.55" class="medal-stop-mid"/>
            <stop offset="1" class="medal-stop-lo"/>
          </radialGradient>
          <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" class="medal-stop-hi"/>
            <stop offset="1" class="medal-stop-lo"/>
          </linearGradient>
        </defs>
        ${r === 'S' ? goldBody(id) : discBody(id)}`;
      // Gradient stops take their colour from the rank's CSS variables
      svg.querySelectorAll('.medal-stop-hi').forEach((s) => s.setAttribute('style', 'stop-color: var(--medal-hi)'));
      svg.querySelectorAll('.medal-stop-mid').forEach((s) => s.setAttribute('style', 'stop-color: var(--medal-mid)'));
      svg.querySelectorAll('.medal-stop-lo').forEach((s) => s.setAttribute('style', 'stop-color: var(--medal-lo)'));
      return svg;
    }
  };

  global.Medal = Medal;
})(window);
