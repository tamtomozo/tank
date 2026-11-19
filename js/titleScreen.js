(function (global) {
  'use strict';

  // Title screen (#title-screen, css/title.css): the first thing shown on page load. A starfield
  // (drawn here on a canvas), a planet rising into view with a tank on its horizon, the logo, and
  // under it the story of the campaign in the four parts of a 司令書, rolling up through a box like
  // end credits (text in index.html; the turning globes of the three planets are added here).
  // The medals earned so far (best rank per operation, js/campaign.js) line up under the tank.
  // A click / tap / key press fires the tank's cannon and fades the title out to the operations
  // room and the planet select (js/sortieSelect.js). That first gesture is also what lets the
  // browser play sound (autoplay policy), so the operations-meeting BGM starts with the planet select.

  const LEAVE_DELAY_MS = 650; // cannon shot + muzzle flash before the fade starts
  const FADE_MS = 1200; // = .title-screen.is-leaving transition (css/title.css)
  // Keys that don't count as a user gesture for the browser's autoplay rules
  const IGNORED_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']);
  // Story roll, like end credits: once the box has appeared (css/title.css: at 2.1 s) the text
  // rises in from below its bottom edge, moving one box height every SCROLL_BOX_SEC seconds, and
  // after its last line has left at the top it rolls in from the bottom again. The roll runs even
  // with the OS set to reduce motion: it is how the story is read (like the typed lines, js/typewriter.js).
  const SCROLL_DELAY_MS = 2600;
  const SCROLL_BOX_SEC = 8;
  const SCROLL_PAUSE_MS = 1500; // empty box between the end of the story and its next roll
  const REDUCED_MOTION = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The planets of the story, with how the title describes them
  const STORY_PLANETS = [
    { id: 1, label: '砂嵐の辺境' },
    { id: 2, label: '吹雪と極夜' },
    { id: 3, label: '敵の本星' }
  ];

  class TitleScreen {
    constructor(el, audio) {
      this.el = el;
      this.audio = audio;
      this.canvas = el.querySelector('.title-stars');
      this.ctx = this.canvas.getContext('2d');
      this.stars = [];
      this.meteor = null;
      this.nextMeteorAt = 0;
      this.w = 0;
      this.h = 0;
      this._raf = null;
      this._cleanup = null; // set while waiting for the start gesture
      this._leaving = false;
      this._onResize = () => this._resize();
      this._loop = (now) => this._frame(now);

      this._addPlanets(el.querySelector('.title-sc-planets'));
      this._addMedals(el.querySelector('.title-medals'));
      this.viewport = el.querySelector('.title-sc-viewport');
      this.track = el.querySelector('.title-sc-track');
      this.group = this.track ? this.track.querySelector('.title-sc-group') : null;
      this.rolled = 0; // px the text has risen since it started below the box
      this._scrollFrom = null; // time the (next) roll starts (set on the first frame)
      if (this.track) this.track.style.transform = 'translateY(100vh)'; // below the box until the roll
      window.addEventListener('resize', this._onResize);
      this._resize();
      this._raf = requestAnimationFrame(this._loop);
    }

    // True while the title is up (waiting for the gesture, or playing its exit)
    get isOpen() {
      return this._cleanup != null || this._leaving;
    }

    // Wait for a click / tap / key press, then fire and fade out; onStart() runs as the fade begins
    waitForStart(onStart) {
      if (this._cleanup) this._cleanup();
      this.el.hidden = false;
      const onGesture = (e) => {
        if (e.type === 'keydown') {
          if (e.repeat || IGNORED_KEYS.has(e.key)) return;
        } else if (e.button > 0) {
          return;
        }
        cleanup();
        this.audio.init(); // resume() inside the gesture: sound is audible from here on
        this._start(onStart);
      };
      const cleanup = () => {
        window.removeEventListener('pointerup', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        this._cleanup = null;
      };
      this._cleanup = cleanup;
      // pointerup (not pointerdown): on touch screens only the release counts as a user gesture
      window.addEventListener('pointerup', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
    }

    _start(onStart) {
      this._leaving = true;
      this.el.classList.add('is-starting'); // prompt flashes, muzzle flash (css/title.css)
      this.audio.playCannon(1.3);
      setTimeout(() => {
        this.el.classList.add('is-leaving');
        onStart();
      }, LEAVE_DELAY_MS);
      setTimeout(() => {
        this._leaving = false;
        this.el.hidden = true;
        this.el.classList.remove('is-starting', 'is-leaving');
        cancelAnimationFrame(this._raf);
        this._raf = null;
        window.removeEventListener('resize', this._onResize);
      }, LEAVE_DELAY_MS + FADE_MS);
    }

    // ------------------------------------------------------------------ story scroll
    _scroll(now, dt) {
      if (!this.group) return;
      if (this._scrollFrom == null) this._scrollFrom = now + SCROLL_DELAY_MS;
      if (now < this._scrollFrom) return;
      const box = this.viewport.clientHeight;
      if (!box) return;
      this.rolled += (box / SCROLL_BOX_SEC) * dt;
      // Text top starts at the box's bottom edge and rises until the last line has left the top
      if (this.rolled > box + this.group.offsetHeight) {
        this.rolled = 0;
        this._scrollFrom = now + SCROLL_PAUSE_MS;
      }
      this.track.style.transform = `translateY(${(box - this.rolled).toFixed(2)}px)`;
    }

    // Medals earned so far, grouped by planet in campaign order (nothing shown before the first)
    _addMedals(box) {
      const campaign = global.Campaign;
      if (!box || !campaign || !global.Medal) return;
      let i = 0;
      for (const planet of global.GameData.PLANETS) {
        const group = document.createElement('div');
        group.className = 'title-medal-group';
        for (const op of planet.operations) {
          const rank = campaign.bestRank(op.id);
          if (!rank) continue;
          const item = document.createElement('span');
          item.className = 'title-medal';
          item.title = `${planet.name}「${op.name}」— ${global.Medal.name(rank)}`;
          item.style.setProperty('--i', i++);
          const medal = global.Medal.create(rank);
          medal.setAttribute('aria-label', item.title);
          item.append(medal);
          group.append(item);
        }
        if (group.childElementCount) box.append(group);
      }
      box.hidden = i === 0;
    }

    // Small turning globes with their names, in the deck copy
    _addPlanets(row) {
      if (!row) return;
      for (const entry of STORY_PLANETS) {
        const planet = global.GameData.PLANETS.find((p) => p.id === entry.id);
        if (!planet) continue;
        const item = document.createElement('div');
        item.className = 'title-sc-planet';
        const caption = document.createElement('div');
        caption.className = 'title-sc-planet-name';
        const label = document.createElement('span');
        label.textContent = entry.label;
        const name = document.createElement('strong');
        name.textContent = planet.name;
        name.style.color = planet.globe.glow;
        caption.append(label, name);
        item.append(global.PlanetGlobe.create(planet), caption);
        row.append(item);
      }
    }

    // ------------------------------------------------------------------ starfield
    _resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = Math.floor(this.w * dpr);
      this.canvas.height = Math.floor(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Star count follows the screen area; three depths drift at different speeds
      const count = Math.round(Math.min(420, (this.w * this.h) / 2600));
      this.stars = [];
      for (let i = 0; i < count; i++) {
        const depth = Math.random();
        this.stars.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          r: 0.35 + depth * depth * 1.4,
          speed: 1.5 + depth * 6, // px per second, leftwards
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.6 + Math.random() * 2.2,
          tint: Math.random() < 0.12 ? '253, 230, 138' : Math.random() < 0.2 ? '147, 197, 253' : '237, 243, 251'
        });
      }
      if (REDUCED_MOTION) this._draw(0, 0);
    }

    _frame(now) {
      if (this.el.hidden && !this._leaving) {
        this._raf = requestAnimationFrame(this._loop);
        return;
      }
      const dt = this._last != null ? Math.min(0.05, (now - this._last) / 1000) : 0;
      this._last = now;
      if (!REDUCED_MOTION) this._draw(now / 1000, dt); // reduced motion: still stars, drawn on resize
      this._scroll(now, dt);
      this._raf = requestAnimationFrame(this._loop);
    }

    _draw(t, dt) {
      const g = this.ctx;
      g.clearRect(0, 0, this.w, this.h);
      for (const s of this.stars) {
        s.x -= s.speed * dt;
        if (s.x < -2) {
          s.x += this.w + 4;
          s.y = Math.random() * this.h;
        }
        const a = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.twinkle + s.phase));
        g.fillStyle = `rgba(${s.tint}, ${a.toFixed(3)})`;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        g.fill();
      }
      this._drawMeteor(t, dt);
    }

    // A shooting star every few seconds, across the upper sky
    _drawMeteor(t, dt) {
      if (REDUCED_MOTION) return;
      if (!this.meteor) {
        if (this.nextMeteorAt === 0) this.nextMeteorAt = t + 2.5 + Math.random() * 3;
        if (t < this.nextMeteorAt) return;
        const angle = Math.PI * (0.8 + Math.random() * 0.12); // heading down-left
        this.meteor = {
          x: this.w * (0.35 + Math.random() * 0.65),
          y: this.h * Math.random() * 0.3,
          vx: Math.cos(angle) * 900,
          vy: Math.sin(angle) * 400,
          life: 0,
          dur: 0.7 + Math.random() * 0.4
        };
      }
      const m = this.meteor;
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const k = m.life / m.dur;
      if (k >= 1) {
        this.meteor = null;
        this.nextMeteorAt = t + 4 + Math.random() * 6;
        return;
      }
      const alpha = Math.sin(k * Math.PI) * 0.9;
      const tail = 0.12;
      const grad = this.ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
      grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      grad.addColorStop(1, 'rgba(147, 197, 253, 0)');
      const g = this.ctx;
      g.strokeStyle = grad;
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
      g.stroke();
    }
  }

  global.TitleScreen = TitleScreen;
})(window);
