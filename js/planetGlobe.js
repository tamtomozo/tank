(function (global) {
  'use strict';

  // Turning planet globes for the sortie-select screens (planet cards, operation-list header).
  // Each planet's surface is painted once into a small equirectangular texture (seamless
  // left ↔ right) from planet.globe (js/data/operations.js); a round element shows it and CSS
  // scrolls it sideways so the globe turns (css/sortieselect.css `.planet-globe`), with the
  // day/night shading and atmosphere drawn on top in CSS.

  const TEX_W = 256;
  const TEX_H = 128;
  const TAU = Math.PI * 2;
  const textures = new Map(); // planet id → data URL

  // Small deterministic RNG: the same planet always gets the same surface
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

  // #rrggbb → "r, g, b"
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  // Draw a shape three times (shifted by one texture width) so it wraps across the seam
  function wrapped(draw) {
    for (const dx of [-TEX_W, 0, TEX_W]) draw(dx);
  }

  function blotch(g, x, y, r, color, alpha) {
    wrapped((dx) => {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grad.addColorStop(0, `rgba(${color}, ${alpha})`);
      grad.addColorStop(1, `rgba(${color}, 0)`);
      g.fillStyle = grad;
      g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    });
  }

  // A wandering line (canyon, crack, band edge)
  function trail(g, rand, x, y, steps, stepLen, color, width) {
    const pts = [[x, y]];
    let a = rand() * TAU;
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 1.1;
      x += Math.cos(a) * stepLen;
      y = Math.max(6, Math.min(TEX_H - 6, y + Math.sin(a) * stepLen * 0.6));
      pts.push([x, y]);
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    wrapped((dx) => {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py) : g.moveTo(px + dx, py)));
      g.stroke();
    });
  }

  function paintTexture(planet) {
    const look = planet.globe;
    const rand = rng(look.seed || planet.id * 97);
    const c = document.createElement('canvas');
    c.width = TEX_W;
    c.height = TEX_H;
    const g = c.getContext('2d');
    const base = rgb(look.base);
    const dark = rgb(look.dark);
    const light = rgb(look.light);

    g.fillStyle = look.base;
    g.fillRect(0, 0, TEX_W, TEX_H);

    if (look.style === 'ice') {
      // Soft latitude bands, then white polar caps
      for (let y = 0; y < TEX_H; y += 6 + rand() * 10) {
        g.fillStyle = `rgba(${rand() < 0.5 ? dark : light}, ${0.08 + rand() * 0.14})`;
        g.fillRect(0, y, TEX_W, 3 + rand() * 7);
      }
      for (let i = 0; i < 18; i++) blotch(g, rand() * TEX_W, rand() * TEX_H, 10 + rand() * 26, rand() < 0.6 ? light : dark, 0.25 + rand() * 0.3);
      for (let i = 0; i < 6; i++) trail(g, rand, rand() * TEX_W, 20 + rand() * (TEX_H - 40), 14, 6, `rgba(${dark}, 0.35)`, 1);
      const cap = (y0, y1) => {
        const grad = g.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, `rgba(${light}, 0.95)`);
        grad.addColorStop(1, `rgba(${light}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, Math.min(y0, y1), TEX_W, Math.abs(y1 - y0));
      };
      cap(0, TEX_H * 0.24);
      cap(TEX_H, TEX_H * 0.78);
    } else if (look.style === 'volcanic') {
      // Dark crust, ash plains, glowing lava cracks
      for (let i = 0; i < 26; i++) blotch(g, rand() * TEX_W, rand() * TEX_H, 8 + rand() * 24, rand() < 0.7 ? dark : base, 0.5 + rand() * 0.4);
      for (let i = 0; i < 10; i++) {
        const x = rand() * TEX_W;
        const y = 12 + rand() * (TEX_H - 24);
        // Same seed twice: a wide faint glow under a thin bright core along the same path
        const s = Math.floor(rand() * 1e9);
        trail(g, rng(s), x, y, 12, 5, `rgba(${light}, 0.22)`, 4);
        trail(g, rng(s), x, y, 12, 5, `rgba(${light}, 0.85)`, 1.2);
      }
      for (let i = 0; i < 7; i++) blotch(g, rand() * TEX_W, 16 + rand() * (TEX_H - 32), 3 + rand() * 5, light, 0.9);
    } else {
      // Desert: dune seas and dark rock plateaus, dry riverbeds, a few craters
      for (let i = 0; i < 22; i++) blotch(g, rand() * TEX_W, rand() * TEX_H, 12 + rand() * 30, rand() < 0.55 ? dark : light, 0.22 + rand() * 0.3);
      for (let i = 0; i < 9; i++) trail(g, rand, rand() * TEX_W, 14 + rand() * (TEX_H - 28), 16, 5, `rgba(${dark}, 0.55)`, 1.1);
      for (let i = 0; i < 14; i++) {
        const x = rand() * TEX_W;
        const y = 10 + rand() * (TEX_H - 20);
        const r = 1.5 + rand() * 3.5;
        wrapped((dx) => {
          g.strokeStyle = `rgba(${dark}, 0.6)`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(x + dx, y, r, 0, TAU);
          g.stroke();
          g.strokeStyle = `rgba(${light}, 0.45)`;
          g.beginPath();
          g.arc(x + dx + 0.6, y + 0.6, r, Math.PI * 0.1, Math.PI * 0.9);
          g.stroke();
        });
      }
    }
    return c.toDataURL();
  }

  function texture(planet) {
    let url = textures.get(planet.id);
    if (!url) {
      url = paintTexture(planet);
      textures.set(planet.id, url);
    }
    return url;
  }

  const PlanetGlobe = {
    // A round element showing `planet` turning. extraClass sizes it (e.g. 'is-small').
    create(planet, extraClass = '') {
      const globe = document.createElement('div');
      globe.className = `planet-globe${planet.available ? '' : ' is-locked'}${extraClass ? ` ${extraClass}` : ''}`;
      globe.setAttribute('aria-hidden', 'true');
      globe.style.setProperty('--globe-tex', `url("${texture(planet)}")`);
      globe.style.setProperty('--globe-glow', planet.globe.glow);
      // Each globe starts at a different point of its turn
      globe.style.setProperty('--globe-phase', `${-((planet.id * 7.3) % 40)}s`);
      return globe;
    }
  };

  global.PlanetGlobe = PlanetGlobe;
})(window);
