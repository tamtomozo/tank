(function (global) {
  'use strict';

  // Per-kind designs of the enemy tanks (and the pillbox / overpass gun). Tank2D (js/tank.js) paints
  // an enemy with the look for its kind instead of the plain player-style tank; the player and the
  // wingmen keep their own look. Everything is in tank units, hull/turret-local axes (+x = forward),
  // and coloured from the spec's colours (js/data/enemies.js), so camouflage etc. still come from there.
  //
  // A look has:
  //   hull(ctx, t)    still picture of the hull (sprite), drawn over the tracks
  //   turret(ctx, t)  turret body without the gun (sprite)
  //   barrel(ctx, t)  the gun, drawn inside the recoil offset
  //   muzzle          x of the muzzle tip (shell spawn point and muzzle flash)
  //   muzzleYs        y of each barrel (twin guns flash at both)
  //   antenna         [x, y] foot of the whip antenna, or null for none
  //   base(ctx, t)    fixed emplacements only: what the gun sits on (drawn instead of hull + tracks)

  // ---- colour helpers -----------------------------------------------------------------------------
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Mix toward white (amt > 0) or black (amt < 0)
  function shade(hex, amt) {
    const c = rgbOf(hex);
    const to = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    return `rgb(${c.map((v) => Math.round(v + (to - v) * p)).join(', ')})`;
  }
  function rgba(hex, a) {
    return `rgba(${rgbOf(hex).join(', ')}, ${a})`;
  }

  const INK = '#0a0c10'; // outline of every plate

  // ---- drawing helpers ----------------------------------------------------------------------------
  function path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }

  // Armour plate: lit along the upper edge, darker toward the lower side, outlined
  function plate(ctx, pts, color, lw = 1.6, outline = INK) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 1; i < pts.length; i += 2) {
      y0 = Math.min(y0, pts[i]);
      y1 = Math.max(y1, pts[i]);
    }
    path(ctx, pts);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, shade(color, 0.16));
    g.addColorStop(0.45, color);
    g.addColorStop(1, shade(color, -0.42));
    ctx.fillStyle = g;
    ctx.fill();
    if (lw > 0) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  // Flat panel (no gradient), thin outline
  function panel(ctx, pts, color, lw = 0.8, outline = INK) {
    path(ctx, pts);
    ctx.fillStyle = color;
    ctx.fill();
    if (lw > 0) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  function line(ctx, x0, y0, x1, y1, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Gun tube from x0 to x1 with radius r: shaded round across its width
  function tube(ctx, x0, x1, y, r, color) {
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, shade(color, 0.32));
    g.addColorStop(0.35, color);
    g.addColorStop(1, shade(color, -0.6));
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - r, x1 - x0, r * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x0, y - r, x1 - x0, r * 2);
  }

  // Glowing lamp / sensor: soft halo and a hot core
  function glow(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
    g.addColorStop(0, rgba(color, 0.75));
    g.addColorStop(0.35, rgba(color, 0.3));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glowing seam (energy line): wide faint stroke under a thin bright one
  function seam(ctx, pts, color, w = 1) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [lw, a] of [[w * 4.5, 0.18], [w * 2.2, 0.4], [w, 1]]) {
      ctx.strokeStyle = a === 1 ? color : rgba(color, a);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }
  }

  function rivets(ctx, pts, color, r = 0.65) {
    ctx.fillStyle = color;
    for (let i = 0; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.arc(pts[i], pts[i + 1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Engine grille: dark recess with slats across it
  function grille(ctx, x, y, w, h, slats, color) {
    ctx.fillStyle = '#0d1014';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    const step = w / slats;
    for (let i = 0; i < slats; i++) ctx.fillRect(x + i * step + step * 0.25, y + 0.6, step * 0.45, h - 1.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y, w, h);
  }

  // Round cooling fan seen from above
  function fan(ctx, x, y, r, color) {
    ctx.fillStyle = '#0d1014';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
      ctx.stroke();
    }
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hatch: ring with a lid and hinge
  function hatch(ctx, x, y, r, color) {
    ctx.fillStyle = shade(color, -0.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, shade(color, 0.2));
    g.addColorStop(1, shade(color, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.55);
    ctx.fillRect(x - r * 0.75, y - 0.4, r * 0.5, 0.8);
  }

  // Commander cupola: hatch ringed with vision blocks
  function cupola(ctx, x, y, r, color) {
    hatch(ctx, x, y, r, color);
    ctx.fillStyle = '#7dd3fc';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.fillRect(x + Math.cos(a) * r * 0.86 - 0.5, y + Math.sin(a) * r * 0.86 - 0.5, 1, 1);
    }
  }

  // Diagonal two-colour warning stripes inside a box
  function hazard(ctx, x, y, w, h, c1, c2, step = 3) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = c1;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = c2;
    for (let k = -h; k < w + h; k += step * 2) {
      ctx.beginPath();
      ctx.moveTo(x + k, y);
      ctx.lineTo(x + k + step, y);
      ctx.lineTo(x + k + step - h, y + h);
      ctx.lineTo(x + k - h, y + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Track guards over both tracks (outer strip of the track, from x0 to x1), in panels
  function fenders(ctx, t, x0, x1, inner, outer, segments, color) {
    for (const s of [-1, 1]) {
      const yi = s * inner;
      const yo = s * outer;
      const segW = (x1 - x0) / segments;
      for (let i = 0; i < segments; i++) {
        const a = x0 + i * segW;
        plate(ctx, [a, Math.min(yi, yo), a + segW, Math.min(yi, yo), a + segW, Math.max(yi, yo), a, Math.max(yi, yo)], color, 0.9);
      }
      // Bevelled front end of the guard
      panel(ctx, [x1, yi, x1 + 2.5, yi + s * 0.6, x1 + 2.5, yo - s * 1.5, x1, yo], shade(color, -0.25), 0.8);
    }
  }

  // Head- and tail-lamps of an enemy tank (red, glowing)
  function lamps(ctx, front, rear, ys) {
    for (const y of ys) {
      glow(ctx, front, y, 1.4, '#f87171');
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(rear - 1, y - 1.6, 2, 3.2);
    }
  }

  // Exhaust pipes at the back
  function exhausts(ctx, x, ys, r = 1.6) {
    for (const y of ys) {
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Smoke grenade launchers: a row of short tubes on a turret side
  function smokeLaunchers(ctx, x, y, n, dir, color) {
    for (let i = 0; i < n; i++) {
      const px = x + i * 2.2;
      ctx.fillStyle = shade(color, -0.35);
      ctx.fillRect(px - 0.8, y, 1.6, dir * 2.6);
      ctx.fillStyle = '#0d1014';
      ctx.beginPath();
      ctx.arc(px, y + dir * 2.6, 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- the designs --------------------------------------------------------------------------------
  const LOOKS = {};

  // Light tank: a low, fast raider with an arrowhead nose, racing stripes and a long autocannon
  LOOKS.light = {
    muzzle: 39,
    muzzleYs: [0],
    antenna: [-9, -5],
    hull(ctx, t) {
      // Mudguards over the track fronts
      for (const s of [-1, 1]) panel(ctx, [17, s * 11, 25, s * 12, 25, s * 20, 17, s * 21], shade(t.hullColor, -0.2), 0.9);
      plate(ctx, [27, 0, 21, -12.5, -19, -13.5, -23.5, -9.5, -23.5, 9.5, -19, 13.5, 21, 12.5], t.hullColor);
      // Sloped glacis
      plate(ctx, [27, 0, 20, -9.5, 12, -9.5, 12, 9.5, 20, 9.5], shade(t.turretColor, 0.12), 1);
      line(ctx, 26, 0, 13, 0, rgba('#ffffff', 0.25), 0.8);
      // Racing stripes
      ctx.fillStyle = t.accentColor;
      for (const s of [-1, 1]) {
        path(ctx, [20, s * 10.6, -17, s * 11.6, -17, s * 10, 18, s * 9]);
        ctx.fill();
      }
      grille(ctx, -21.5, -7, 8, 14, 6, shade(t.hullColor, -0.15));
      exhausts(ctx, -23.5, [-11, 11], 1.3);
      lamps(ctx, 22.5, -23.5, [-8.5, 8.5]);
    },
    turret(ctx, t) {
      plate(ctx, [11, 0, 6, -8.5, -8, -9, -12, -5, -12, 5, -8, 9, 6, 8.5], t.turretColor);
      line(ctx, 10, 0, -10, 0, rgba('#000000', 0.25), 0.8);
      hatch(ctx, -4.5, -3.2, 3.2, t.turretColor);
      // Gunner's sight
      ctx.fillStyle = '#111827';
      ctx.fillRect(1.5, 2.5, 4, 3.4);
      glow(ctx, 5.4, 4.2, 0.9, '#ef4444');
      smokeLaunchers(ctx, -1, -8.6, 3, -1, t.turretColor);
      smokeLaunchers(ctx, -1, 8.6, 3, 1, t.turretColor);
    },
    barrel(ctx, t) {
      tube(ctx, 8, 36, 0, 1.6, '#2a2f38');
      tube(ctx, 8, 14, 0, 2.6, shade(t.hullDark, -0.1));
      // Flash hider
      tube(ctx, 34, 39, 0, 2.2, '#1f242c');
      ctx.fillStyle = '#000';
      ctx.fillRect(35.5, -0.5, 2.5, 1);
    }
  };

  // Medium tank: the classic workhorse; cast turret, fan-cooled engine deck, muzzle brake
  LOOKS.medium = {
    muzzle: 39,
    muzzleYs: [0],
    antenna: [-11, -7],
    hull(ctx, t) {
      fenders(ctx, t, -24, 20, 19.5, 22, 4, shade(t.hullColor, -0.1));
      plate(ctx, [25, -9, 20, -14.5, -21, -14.5, -24.5, -11, -24.5, 11, -21, 14.5, 20, 14.5, 25, 9], t.hullColor);
      // Glacis plate with spare track links
      plate(ctx, [25, -9, 20, -12.5, 14, -12.5, 14, 12.5, 20, 12.5, 25, 9], shade(t.turretColor, 0.08), 1);
      ctx.fillStyle = '#2a2d33';
      for (const y of [-10, -7, 7, 10]) {
        ctx.fillRect(16, y - 1.1, 5, 2.2);
      }
      rivets(ctx, [15.5, -12, 15.5, 12, 23.5, -8, 23.5, 8], shade(t.hullColor, 0.35));
      // Tool boxes on the sides
      for (const s of [-1, 1]) panel(ctx, [4, s * 12, 12, s * 12, 12, s * 14, 4, s * 14], shade(t.hullDark, -0.1), 0.6);
      // Engine deck with two cooling fans
      panel(ctx, [-12, -11, -23, -11, -23, 11, -12, 11], shade(t.hullDark, -0.15), 0.8);
      fan(ctx, -17.5, -5.2, 4.2, shade(t.hullColor, 0.1));
      fan(ctx, -17.5, 5.2, 4.2, shade(t.hullColor, 0.1));
      // Unit stripe across the deck
      ctx.fillStyle = t.accentColor;
      ctx.fillRect(-11, -13.5, 1.6, 27);
      exhausts(ctx, -24.5, [-12.5, 12.5]);
      lamps(ctx, 23, -24.5, [-10.5, 10.5]);
    },
    turret(ctx, t) {
      // Stowage basket on the turret rear
      ctx.strokeStyle = shade(t.hullDark, -0.2);
      ctx.lineWidth = 1;
      ctx.strokeRect(-19, -8, 6, 16);
      line(ctx, -19, -2.7, -13, -2.7, shade(t.hullDark, -0.2), 0.6);
      line(ctx, -19, 2.7, -13, 2.7, shade(t.hullDark, -0.2), 0.6);
      plate(ctx, [12, -5.5, 8, -11, -5, -12.5, -14, -8, -14, 8, -5, 12.5, 8, 11, 12, 5.5], t.turretColor);
      // Gun mantlet
      plate(ctx, [16, -4.5, 16, 4.5, 10, 6, 10, -6], shade(t.turretColor, -0.15), 1);
      cupola(ctx, -4.5, -5, 4, t.turretColor);
      hatch(ctx, -5, 5.5, 2.8, t.turretColor);
      glow(ctx, 7, -7, 0.9, '#ef4444');
      rivets(ctx, [-12, -6.5, -12, 6.5, 6, -9.5, 6, 9.5], shade(t.turretColor, 0.35));
    },
    barrel(ctx, t) {
      tube(ctx, 14, 35, 0, 2.3, '#2a2f38');
      // Fume extractor
      tube(ctx, 21, 26, 0, 3.1, '#30363f');
      // Muzzle brake
      tube(ctx, 34, 39, 0, 3.6, '#1f242c');
      ctx.fillStyle = '#000';
      ctx.fillRect(35.3, -3.6, 1, 7.2);
      ctx.fillRect(37, -3.6, 0.8, 7.2);
    }
  };

  // New main battle tank: skirted hull, angular wedge armour on the turret, long smoothbore
  LOOKS.modern = {
    muzzle: 45,
    muzzleYs: [0],
    antenna: [-14, 7],
    hull(ctx, t) {
      fenders(ctx, t, -24, 21, 17.5, 22, 5, shade(t.hullColor, 0.05));
      plate(ctx, [26, -10.5, 23, -14, -22, -14, -25, -11.5, -25, 11.5, -22, 14, 23, 14, 26, 10.5], t.hullColor);
      plate(ctx, [26, -10.5, 23, -12.5, 15, -12.5, 15, 12.5, 23, 12.5, 26, 10.5], shade(t.turretColor, 0.1), 1);
      // Driver's hatch and periscopes
      hatch(ctx, 19.5, -6, 2.6, t.hullColor);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(22.8, -8, 0.9, 1.5);
      ctx.fillRect(22.8, -5.5, 0.9, 1.5);
      // Engine deck: big grilles, warning stripe
      grille(ctx, -23.5, -11, 9, 9.5, 7, shade(t.hullColor, 0.1));
      grille(ctx, -23.5, 1.5, 9, 9.5, 7, shade(t.hullColor, 0.1));
      ctx.fillStyle = t.accentColor;
      ctx.fillRect(-13.5, -12.5, 1.2, 25);
      lamps(ctx, 24.5, -25, [-11, 11]);
      // Hull number plates
      ctx.fillStyle = rgba('#ffffff', 0.65);
      for (const s of [-1, 1]) ctx.fillRect(4, s * 12.6 - 0.6, 6, 1.2);
    },
    turret(ctx, t) {
      // Bustle rack
      plate(ctx, [-15, -9, -20, -8, -20, 8, -15, 9], shade(t.hullDark, 0.05), 1);
      line(ctx, -20, 0, -15, 0, INK, 0.5);
      plate(ctx, [9, -7.5, 4, -11, -12, -11, -15.5, -8, -15.5, 8, -12, 11, 4, 11, 9, 7.5], t.turretColor);
      // Wedge add-on armour on both cheeks
      for (const s of [-1, 1]) {
        plate(ctx, [9, s * 3.8, 18, s * 2.6, 9, s * 11.5, 4, s * 11], shade(t.turretColor, 0.12), 1.1);
        line(ctx, 9.5, s * 4.2, 16, s * 3.2, rgba('#ffffff', 0.3), 0.6);
      }
      // Commander's panoramic sight (red optic)
      panel(ctx, [-3, -9, 2, -9, 2, -5, -3, -5], '#111827', 0.6);
      glow(ctx, 1.6, -7, 1, t.accentColor);
      // Gunner's sight box
      panel(ctx, [3, 4.5, 8, 4.5, 8, 8, 3, 8], '#1e293b', 0.6);
      glow(ctx, 7.6, 6.3, 0.8, t.accentColor);
      hatch(ctx, -8, -4, 3, t.turretColor);
      hatch(ctx, -8, 5, 2.6, t.turretColor);
      smokeLaunchers(ctx, -12, -11, 3, -1, t.turretColor);
      smokeLaunchers(ctx, -12, 11, 3, 1, t.turretColor);
    },
    barrel(ctx, t) {
      tube(ctx, 16, 45, 0, 2, '#2c333d');
      // Thermal sleeve bands
      ctx.fillStyle = '#3b4552';
      for (const x of [22, 29, 36]) ctx.fillRect(x, -2.2, 1.4, 4.4);
      tube(ctx, 26, 31, 0, 2.7, '#353d48');
      // Muzzle reference sensor
      ctx.fillStyle = '#111827';
      ctx.fillRect(42, -3, 2, 1.2);
    }
  };

  // Heavy tank: a riveted fortress; spaced side armour, a blocky turret, a thick gun
  LOOKS.heavy = {
    muzzle: 45,
    muzzleYs: [0],
    antenna: [-15, -9],
    hull(ctx, t) {
      // Spaced armour plates over the tracks
      fenders(ctx, t, -24, 20, 17, 22.5, 3, shade(t.hullColor, 0.08));
      for (const s of [-1, 1]) {
        rivets(ctx, [-21, s * 19.7, -12, s * 19.7, -6, s * 19.7, 3, s * 19.7, 8.5, s * 19.7, 17, s * 19.7], shade(t.accentColor, -0.2), 0.6);
      }
      plate(ctx, [26, -10, 21, -15.5, -22, -15.5, -25.5, -12, -25.5, 12, -22, 15.5, 21, 15.5, 26, 10], t.hullColor, 1.8);
      // Thick sloped bow with an extra applique plate
      plate(ctx, [26, -10, 21, -13.5, 13, -13.5, 13, 13.5, 21, 13.5, 26, 10], shade(t.turretColor, 0.1), 1.1);
      plate(ctx, [24, -6, 21, -8, 16, -8, 16, 8, 21, 8, 24, 6], shade(t.turretColor, 0.2), 0.9);
      rivets(ctx, [14.5, -12, 14.5, -4, 14.5, 4, 14.5, 12, 22, -11, 22, 11], shade(t.turretColor, 0.45));
      // Engine deck
      grille(ctx, -24, -12, 10, 24, 8, shade(t.hullColor, 0.15));
      ctx.fillStyle = t.accentColor;
      for (const s of [-1, 1]) ctx.fillRect(-13, s * 13.6 - 0.8, 24, 1.6);
      exhausts(ctx, -25.5, [-13.5, 13.5], 2);
      lamps(ctx, 24, -25.5, [-11.5, 11.5]);
    },
    turret(ctx, t) {
      plate(ctx, [12, -9, 9, -13, -12, -13, -17, -9, -17, 9, -12, 13, 9, 13, 12, 9], t.turretColor, 1.8);
      // Front armour slabs
      for (const s of [-1, 1]) {
        plate(ctx, [13, s * 4, 13, s * 10, 9.5, s * 12.5, 7, s * 12.5, 7, s * 4], shade(t.turretColor, 0.14), 1);
      }
      // Heavy mantlet
      plate(ctx, [19, -5.5, 19, 5.5, 12, 6.5, 12, -6.5], shade(t.hullDark, 0.3), 1.2);
      rivets(ctx, [13.5, -4.5, 13.5, 4.5, 17.5, -4, 17.5, 4], shade(t.turretColor, 0.4));
      rivets(ctx, [-15, -11, -8, -11.6, -1, -11.6, -15, 11, -8, 11.6, -1, 11.6, 5, -11.6, 5, 11.6], shade(t.turretColor, 0.38));
      // Raised commander's cupola with a gold ring
      ctx.strokeStyle = t.accentColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(-6, -4.5, 5.6, 0, Math.PI * 2);
      ctx.stroke();
      cupola(ctx, -6, -4.5, 4.6, t.turretColor);
      hatch(ctx, -7, 6, 3, t.turretColor);
      glow(ctx, 6, -8, 1, '#ef4444');
      // Turret roof machine gun
      line(ctx, 0, 5, 7, 5, '#18181b', 1.2);
    },
    barrel(ctx, t) {
      tube(ctx, 18, 40, 0, 3.1, '#2a2826');
      tube(ctx, 24, 29, 0, 3.9, '#34302d');
      // Double-baffle muzzle brake
      tube(ctx, 38, 45, 0, 4.6, '#1f1d1b');
      ctx.fillStyle = '#000';
      ctx.fillRect(39.5, -4.6, 1.2, 9.2);
      ctx.fillRect(42.2, -4.6, 1.2, 9.2);
    }
  };

  // Command tank: big, ornate, twin guns, radar dish and an antenna array, glowing trim
  LOOKS.boss = {
    muzzle: 44,
    muzzleYs: [-4.2, 4.2],
    antenna: [-15, -10],
    hull(ctx, t) {
      fenders(ctx, t, -24, 20, 17.5, 22.5, 4, shade(t.hullColor, 0.08));
      plate(ctx, [27, -8, 21, -15, -21, -15, -25.5, -11, -25.5, 11, -21, 15, 21, 15, 27, 8], t.hullColor, 1.8);
      plate(ctx, [27, -8, 21, -13, 14, -13, 14, 13, 21, 13, 27, 8], shade(t.turretColor, 0.15), 1.1);
      // Glowing trim along the hull sides and the bow
      for (const s of [-1, 1]) seam(ctx, [20, s * 13.8, -20, s * 13.8], t.accentColor, 0.7);
      seam(ctx, [26, -7, 21, -11.5], t.accentColor, 0.6);
      seam(ctx, [26, 7, 21, 11.5], t.accentColor, 0.6);
      // Engine deck with the command emblem
      panel(ctx, [-12, -12, -24, -12, -24, 12, -12, 12], shade(t.hullDark, -0.2), 0.8);
      grille(ctx, -23.5, -11, 4, 22, 4, shade(t.hullColor, 0.15));
      ctx.save();
      ctx.translate(-15, 0);
      panel(ctx, [3.5, 0, 1.75, -3, -1.75, -3, -3.5, 0, -1.75, 3, 1.75, 3], shade(t.accentColor, -0.3), 0.6);
      ctx.fillStyle = '#fde68a';
      path(ctx, [2.2, 0, -0.8, -2, -0.2, 0, -0.8, 2]);
      ctx.fill();
      ctx.restore();
      exhausts(ctx, -25.5, [-13.5, 13.5], 1.8);
      lamps(ctx, 25, -25.5, [-9, 9]);
    },
    turret(ctx, t) {
      // Bustle with the command radio
      plate(ctx, [-15, -10, -21, -9, -21, 9, -15, 10], shade(t.hullDark, 0.1), 1.2);
      plate(ctx, [13, -7, 9, -13, -10, -13.5, -16, -9, -16, 9, -10, 13.5, 9, 13, 13, 7], t.turretColor, 1.8);
      // Wide mantlet for the twin guns
      plate(ctx, [18, -8, 18, 8, 12, 9.5, 12, -9.5], shade(t.hullDark, 0.25), 1.2);
      seam(ctx, [12, -10.5, -9, -11.8], t.accentColor, 0.6);
      seam(ctx, [12, 10.5, -9, 11.8], t.accentColor, 0.6);
      // Radar dish
      ctx.fillStyle = shade(t.hullDark, -0.2);
      ctx.beginPath();
      ctx.arc(-9, 5, 4.6, 0, Math.PI * 2);
      ctx.fill();
      const dg = ctx.createRadialGradient(-10, 4, 0.5, -9, 5, 4);
      dg.addColorStop(0, '#e2e8f0');
      dg.addColorStop(1, '#64748b');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(-9, 5, 3.8, 0, Math.PI * 2);
      ctx.fill();
      line(ctx, -9, 5, -6.3, 2.3, '#334155', 0.7);
      // Commander's cupola, sensor eye
      cupola(ctx, -3, -5, 4, t.turretColor);
      glow(ctx, 9, -9, 1.2, t.accentColor);
      glow(ctx, 9, 9, 1.2, t.accentColor);
      // Extra antennas of the command set
      line(ctx, -18, 6, -26, 9, '#cbd5e1', 0.8);
      line(ctx, -18, 0, -27, 0, '#cbd5e1', 0.6);
    },
    barrel(ctx, t) {
      for (const y of [-4.2, 4.2]) {
        tube(ctx, 16, 40, y, 2.1, '#2b2638');
        tube(ctx, 23, 28, y, 2.7, '#352f45');
        tube(ctx, 38, 44, y, 3, '#1c1826');
        ctx.fillStyle = t.accentColor;
        ctx.fillRect(33, y - 2.1, 1.1, 4.2);
      }
    }
  };

  // Ace heavy tank: winter splinter camouflage, a sky-blue personal stripe, very long gun with kill rings
  LOOKS.ace = {
    muzzle: 49,
    muzzleYs: [0],
    antenna: [-14, -8],
    hull(ctx, t) {
      fenders(ctx, t, -24, 20, 17.5, 22, 4, t.hullColor);
      const hull = [27, -8, 21, -14.5, -21, -14.5, -25, -10.5, -25, 10.5, -21, 14.5, 21, 14.5, 27, 8];
      plate(ctx, hull, t.hullColor, 1.6);
      // Splinter camouflage
      ctx.save();
      path(ctx, hull);
      ctx.clip();
      ctx.fillStyle = rgba(t.hullDark, 0.75);
      for (const p of [
        [22, -15, 14, -4, 8, -15], [4, 15, -6, 3, -14, 15], [-8, -15, -16, -6, -24, -15],
        [26, 15, 18, 6, 12, 15], [10, -2, 2, 6, -2, -6], [-18, 2, -26, 10, -26, -4]
      ]) {
        path(ctx, p);
        ctx.fill();
      }
      ctx.fillStyle = rgba('#475569', 0.45);
      for (const p of [[16, -9, 10, -3, 6, -11], [-2, 10, -10, 6, -6, 15], [-14, -12, -20, -2, -24, -10]]) {
        path(ctx, p);
        ctx.fill();
      }
      ctx.restore();
      plate(ctx, [27, -8, 21, -12.5, 15, -12.5, 15, 12.5, 21, 12.5, 27, 8], shade(t.turretColor, -0.04), 1);
      // Personal stripe across the bow
      ctx.fillStyle = t.accentColor;
      path(ctx, [25.5, -9, 22.5, -9, 17, 9, 20, 9]);
      ctx.fill();
      grille(ctx, -24, -10, 8, 20, 7, shade(t.hullDark, 0.2));
      exhausts(ctx, -25, [-12.5, 12.5], 1.6);
      lamps(ctx, 24, -25, [-10, 10]);
    },
    turret(ctx, t) {
      plate(ctx, [-15, -8, -20, -7, -20, 7, -15, 8], shade(t.hullDark, 0.1), 1);
      const tur = [14, -3.5, 7, -11, -11, -11.5, -15.5, -7.5, -15.5, 7.5, -11, 11.5, 7, 11, 14, 3.5];
      plate(ctx, tur, t.turretColor, 1.7);
      ctx.save();
      path(ctx, tur);
      ctx.clip();
      ctx.fillStyle = rgba(t.hullDark, 0.7);
      for (const p of [[10, -12, 2, -3, -4, -12], [0, 12, -8, 2, -14, 12], [-10, -6, -16, -1, -16, -9]]) {
        path(ctx, p);
        ctx.fill();
      }
      ctx.restore();
      // Lightning emblem of the ace
      ctx.fillStyle = t.accentColor;
      path(ctx, [-4, 7, 1, 7.5, -1, 9, 4, 9.6, -3, 11, -0.5, 9.4, -5, 9]);
      ctx.fill();
      cupola(ctx, -6, -4.5, 3.8, t.turretColor);
      panel(ctx, [4, -8.5, 8.5, -8.5, 8.5, -5.2, 4, -5.2], '#1e293b', 0.6);
      glow(ctx, 8, -6.8, 1, t.accentColor);
      smokeLaunchers(ctx, -11, -11.4, 3, -1, t.turretColor);
      smokeLaunchers(ctx, -11, 11.4, 3, 1, t.turretColor);
    },
    barrel(ctx, t) {
      tube(ctx, 12, 45, 0, 2.2, '#cbd5e1');
      // White barrel with dark bands: the ace's kill rings
      ctx.fillStyle = '#1e293b';
      for (const x of [17, 19, 21, 23, 25]) ctx.fillRect(x, -2.2, 0.9, 4.4);
      tube(ctx, 28, 33, 0, 2.9, '#e2e8f0');
      tube(ctx, 44, 49, 0, 3.2, '#334155');
      ctx.fillStyle = '#000';
      ctx.fillRect(45.5, -3.2, 1, 6.4);
      ctx.fillRect(47.3, -3.2, 0.8, 6.4);
    }
  };

  // Prototype super-heavy: black monolith with glowing red power lines, hull machine-gun turrets,
  // a reactor deck and a huge coil-ringed gun
  LOOKS.proto = {
    muzzle: 51,
    muzzleYs: [0],
    antenna: null,
    hull(ctx, t) {
      fenders(ctx, t, -25, 21, 16.5, 23, 6, shade(t.hullColor, 0.1));
      for (const s of [-1, 1]) seam(ctx, [-23, s * 22, 19, s * 22], t.accentColor, 0.5);
      plate(ctx, [28, -6, 23, -15.5, -22, -15.5, -26, -11, -26, 11, -22, 15.5, 23, 15.5, 28, 6], t.hullColor, 2);
      // Faceted bow
      plate(ctx, [28, -6, 23, -13.5, 15, -13.5, 15, 13.5, 23, 13.5, 28, 6], shade(t.turretColor, 0.12), 1.1);
      line(ctx, 15, 0, 28, 0, rgba('#ffffff', 0.12), 0.8);
      seam(ctx, [15, -13.5, 23, -13.5, 28, -6], t.accentColor, 0.55);
      seam(ctx, [15, 13.5, 23, 13.5, 28, 6], t.accentColor, 0.55);
      // Hull machine-gun turrets at the front corners
      for (const s of [-1, 1]) {
        line(ctx, 20, s * 10, 27, s * 11, '#111827', 1.3);
        plate(ctx, [22.5, s * 10, 21, s * 7.5, 18, s * 7.5, 16.5, s * 10, 18, s * 12.5, 21, s * 12.5], shade(t.turretColor, 0.18), 0.9);
        glow(ctx, 21.5, s * 10, 0.6, t.accentColor);
      }
      // Reactor deck: glowing vents
      panel(ctx, [-12, -13, -25, -13, -25, 13, -12, 13], '#05070a', 0.8);
      for (const y of [-9.5, -5, -0.5 + 0, 4, 8.5]) {
        ctx.fillStyle = rgba(t.accentColor, 0.25);
        ctx.fillRect(-24, y - 1.6, 11, 3.2);
        ctx.fillStyle = t.accentColor;
        ctx.fillRect(-23.5, y - 0.5, 10, 1);
      }
      ctx.strokeStyle = shade(t.hullColor, 0.15);
      ctx.lineWidth = 0.8;
      for (let x = -24; x <= -13; x += 2.2) line(ctx, x, -12.5, x, 12.5, rgba('#1f2937', 0.9), 0.6);
      exhausts(ctx, -26, [-13.5, 13.5], 2);
      lamps(ctx, 25.5, -26, [-4, 4]);
    },
    turret(ctx, t) {
      plate(ctx, [-16, -10, -22, -8, -22, 8, -16, 10], shade(t.hullColor, 0.1), 1.2);
      const tur = [16, -6, 10, -13.5, -12, -14, -17, -9, -17, 9, -12, 14, 10, 13.5, 16, 6];
      plate(ctx, tur, t.turretColor, 2);
      // Faceted cheeks
      for (const s of [-1, 1]) {
        plate(ctx, [16, s * 6, 22, s * 4.5, 13, s * 12, 10, s * 13.5], shade(t.turretColor, 0.15), 1);
      }
      seam(ctx, [-12, -11, 9, -11, 13, -6.5], t.accentColor, 0.6);
      seam(ctx, [-12, 11, 9, 11, 13, 6.5], t.accentColor, 0.6);
      // Sensor head: a single red eye
      plate(ctx, [-2, -9, 5, -9, 6, -5, -2, -5], '#111827', 0.7);
      glow(ctx, 4, -7, 1.5, t.accentColor);
      hatch(ctx, -8, 4.5, 3.6, t.turretColor);
      // Rear vents
      for (const y of [-6, -2, 2, 6]) {
        ctx.fillStyle = t.accentColor;
        ctx.fillRect(-21.5, y - 0.4, 4.5, 0.8);
      }
    },
    barrel(ctx, t) {
      tube(ctx, 18, 47, 0, 3.4, '#171b22');
      // Coil rings glowing along the gun
      for (const x of [26, 31, 36, 41]) {
        tube(ctx, x, x + 2.2, 0, 4.2, '#262b33');
        ctx.fillStyle = rgba(t.accentColor, 0.9);
        ctx.fillRect(x + 0.7, -4.2, 0.8, 8.4);
      }
      tube(ctx, 18, 24, 0, 4.6, '#20252d');
      // Muzzle: a split, armoured snout
      tube(ctx, 46, 51, 0, 4.4, '#0f1218');
      ctx.fillStyle = rgba(t.accentColor, 0.9);
      ctx.fillRect(47, -0.6, 4, 1.2);
    }
  };

  // Pillbox: concrete octagon behind sandbags, armoured dome with a vision slit
  LOOKS.bunker = {
    muzzle: 38,
    muzzleYs: [0],
    antenna: null,
    base(ctx, t) {
      // Sandbag ring
      ctx.fillStyle = '#a8a29e';
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.save();
        ctx.translate(Math.cos(a) * 27, Math.sin(a) * 27);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.roundRect(-5, -2.6, 10, 5.2, 2.4);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const oct = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        oct.push(Math.cos(a) * 24, Math.sin(a) * 24);
      }
      plate(ctx, oct, '#64748b', 2);
      const inner = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        inner.push(Math.cos(a) * 18.5, Math.sin(a) * 18.5);
      }
      plate(ctx, inner, '#475569', 1.2);
      // Concrete joints and warning chevrons
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        line(ctx, Math.cos(a) * 18.5, Math.sin(a) * 18.5, Math.cos(a) * 23, Math.sin(a) * 23, '#334155', 0.8);
      }
      ctx.fillStyle = t.accentColor;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.save();
        ctx.rotate(a);
        path(ctx, [21.5, -2.4, 20, -2.4, 18.8, 0, 20, 2.4, 21.5, 2.4, 20.3, 0]);
        ctx.fill();
        ctx.restore();
      }
    },
    turret(ctx, t) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(1, 2, 14, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(-4, -4, 1, 0, 0, 13.5);
      g.addColorStop(0, shade(t.turretColor, 0.35));
      g.addColorStop(0.6, t.turretColor);
      g.addColorStop(1, shade(t.turretColor, -0.5));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Vision slit with a red glow
      ctx.fillStyle = '#05070a';
      ctx.beginPath();
      ctx.roundRect(5.5, -8, 2.6, 5, 1);
      ctx.fill();
      glow(ctx, 6.8, -5.5, 0.8, t.accentColor);
      hatch(ctx, -4, 3, 3.4, t.turretColor);
      rivets(ctx, [-9, -7, -11, 0, -9, 7, 0, 11, 0, -11, 9, 7], shade(t.turretColor, 0.4), 0.7);
    },
    barrel(ctx, t) {
      plate(ctx, [16, -5, 16, 5, 11, 6, 11, -6], shade(t.turretColor, -0.2), 1);
      tube(ctx, 16, 36, 0, 2.6, '#262b33');
      tube(ctx, 33, 38, 0, 3.4, '#1a1f26');
    }
  };

  // Overpass turret: hazard-striped mounting pad, boxy gun shield, twin guns
  LOOKS.turret = {
    muzzle: 40,
    muzzleYs: [-3.2, 3.2],
    antenna: [-11, -9],
    base(ctx, t) {
      plate(ctx, [-21, -21, 21, -21, 21, 21, -21, 21], '#52525b', 2);
      hazard(ctx, -21, -21, 42, 4, '#18181b', t.accentColor);
      hazard(ctx, -21, 17, 42, 4, '#18181b', t.accentColor);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(-21, -21, 42, 42);
      // Turntable ring and bolts
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#71717a';
      ctx.lineWidth = 1;
      ctx.stroke();
      const bolts = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        bolts.push(Math.cos(a) * 13.5, Math.sin(a) * 13.5);
      }
      rivets(ctx, bolts, '#a1a1aa', 0.7);
      rivets(ctx, [-18, -14, 18, -14, -18, 14, 18, 14], '#a1a1aa', 1);
    },
    turret(ctx, t) {
      plate(ctx, [12, -10, 8, -12, -12, -12, -14, -9, -14, 9, -12, 12, 8, 12, 12, 10], t.turretColor, 1.8);
      plate(ctx, [16, -7.5, 16, 7.5, 11, 9.5, 11, -9.5], shade(t.turretColor, -0.15), 1.2);
      ctx.fillStyle = t.accentColor;
      ctx.fillRect(-12, -1, 18, 2);
      hatch(ctx, -6, -6, 3, t.turretColor);
      panel(ctx, [-1, 4.5, 5, 4.5, 5, 9, -1, 9], '#18181b', 0.6);
      glow(ctx, 4.4, 6.7, 0.9, '#ef4444');
      // Ammo feed box
      plate(ctx, [-14, -7, -18, -7, -18, 7, -14, 7], '#3f3f46', 1);
    },
    barrel(ctx, t) {
      for (const y of [-3.2, 3.2]) {
        tube(ctx, 15, 37, y, 1.8, '#27272a');
        tube(ctx, 35, 40, y, 2.4, '#18181b');
      }
    }
  };

  global.EnemyLooks = { LOOKS, shade };
})(window);
