(function (global) {
  'use strict';

  // Storm overlay (world.storm 0..1 and world.stormKind 'sand' | 'snow' | 'smog', set by js/game/hazards.js):
  // a wall of blowing sand or snow that closes in around the player's tank — a clear pocket around
  // it, everything beyond fades into the storm — plus streaks of sand / snow racing across the
  // screen. Painted at half resolution like the night darkness (js/planet/night.js).
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const STORM_RES = 0.5; // overlay pixels per CSS pixel
  const LOOK = {
    sand: { rgb: '186, 140, 88', streak: '232, 200, 150', len: 1, slope: 0.12 },
    snow: { rgb: '214, 226, 240', streak: '255, 255, 255', len: 0.45, slope: 0.45 },
    // Smog: a brown haze with acid rain falling almost straight down
    smog: { rgb: '112, 102, 78', streak: '176, 196, 128', len: 0.5, slope: 0, rain: true }
  };
  const CLEAR_FAR = 760; // radius of the clear pocket (world units) as a storm begins…
  const CLEAR_NEAR = 170; // …and at full strength
  const STREAKS = 90;

  // Fixed streak layout: position (0..1), length, speed, thickness (same every frame)
  const streakSeeds = [];
  {
    let s = 9137;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    for (let i = 0; i < STREAKS; i++) {
      streakSeeds.push({ x: rand(), y: rand(), len: 30 + rand() * 70, speed: 0.35 + rand() * 0.5, w: 1 + rand() * 1.6, a: 0.2 + rand() * 0.35 });
    }
  }

  class WorldWeather {
    drawSandstorm(ctx, playerProj, viewW, viewH, timeSec) {
      const s = this.storm;
      if (s <= 0.01 || typeof document === 'undefined') return;
      const cw = Math.max(1, Math.round(viewW));
      const ch = Math.max(1, Math.round(viewH));
      const pw = Math.max(1, Math.ceil(cw * STORM_RES));
      const ph = Math.max(1, Math.ceil(ch * STORM_RES));
      if (!this._stormCanvas) {
        this._stormCanvas = document.createElement('canvas');
        this._stormCtx = this._stormCanvas.getContext('2d');
      }
      if (this._stormCanvas.width !== pw || this._stormCanvas.height !== ph) {
        this._stormCanvas.width = pw;
        this._stormCanvas.height = ph;
      }
      const look = LOOK[this.stormKind] || LOOK.sand;
      const g = this._stormCtx;
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.setTransform(STORM_RES, 0, 0, STORM_RES, 0, 0);

      // Dust everywhere, thickest at full storm; the sky turns the same colour
      g.fillStyle = `rgba(${look.rgb}, ${(0.94 * s).toFixed(3)})`;
      g.fillRect(0, 0, cw + 2, ch + 2);

      // Clear pocket around the tank (it never clears completely inside a storm)
      if (playerProj) {
        const r = (CLEAR_FAR + (CLEAR_NEAR - CLEAR_FAR) * s) * playerProj.scale;
        const keep = 0.85 - 0.25 * s; // how much of the dust is cut away at the tank
        g.globalCompositeOperation = 'destination-out';
        g.save();
        g.translate(playerProj.sx, playerProj.sy);
        g.scale(1, 0.8);
        const grad = g.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
        grad.addColorStop(0, `rgba(0, 0, 0, ${keep.toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(0, 0, 0, ${(keep * 0.6).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      ctx.drawImage(this._stormCanvas, 0, 0, pw / STORM_RES, ph / STORM_RES);

      // Blowing sand: streaks racing across the screen, slightly downhill to the right
      const n = Math.round(STREAKS * s);
      ctx.save();
      ctx.lineCap = 'round';
      if (look.rain) {
        // Acid rain: thin streaks falling fast, always some even when the haze is thin
        const drops = Math.round(STREAKS * Math.min(1, 0.35 + s));
        ctx.lineWidth = 1;
        for (let i = 0; i < drops; i++) {
          const k = streakSeeds[i];
          const x = ((k.x + timeSec * 0.03) % 1) * (cw + 40) - 20;
          const y = ((k.y + timeSec * k.speed * 1.6) % 1) * (ch + 80) - 40;
          const len = k.len * look.len;
          ctx.strokeStyle = `rgba(${look.streak}, ${(k.a * 0.8).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - len * 0.12, y - len);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }
      for (let i = 0; i < n; i++) {
        const k = streakSeeds[i];
        const x = ((k.x + timeSec * k.speed) % 1) * (cw + 200) - 100;
        const y = ((k.y + timeSec * k.speed * 0.12) % 1) * ch;
        ctx.strokeStyle = `rgba(${look.streak}, ${(k.a * s * (look === LOOK.snow ? 1.6 : 1)).toFixed(3)})`;
        ctx.lineWidth = k.w * (look === LOOK.snow ? 1.4 : 1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - k.len * look.len, y - k.len * look.len * look.slope);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldWeather);
})(window);
