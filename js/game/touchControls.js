(function (global) {
  'use strict';

  // On-screen controls for phones / tablets (GameQuality.touch), plus the phone-only screen bits:
  //   - virtual stick (left): appears where the thumb lands in the left part of the screen;
  //     writes input.touch.moveX / moveY (-1..1, screen directions: +x right, +y down)
  //   - button (right): main gun -> input.touch.fire while held
  //   - radar moved under the top-right panel (the bottom-right corner belongs to the buttons)
  //   - fullscreen button where the browser supports it
  //   - landscape only: while a phone is held upright (menus and the "click to connect" screen
  //     included) everything waits behind the "turn the phone sideways" screen; on the first tap
  //     the game goes fullscreen and locks the screen sideways where the browser allows (Android)
  //
  //   touchUi.update(menuOpen) once per frame (main.js) -> true while the game must wait (upright)

  const STICK_RADIUS = 46; // px the knob can travel from the stick centre (full speed at the rim)
  const DEAD_ZONE = 0.18; // fraction of STICK_RADIUS ignored around the centre

  function create(game) {
    const { input } = game;
    const touch = { active: false, moveX: 0, moveY: 0, fire: false };
    input.touch = touch;

    const enabled = global.GameQuality.touch; // also put <html class="is-touch"> (quality.js)
    const root = document.documentElement;

    const panel = document.getElementById('touch-controls');
    const rotateEl = document.getElementById('rotate-notice');
    if (!enabled) {
      return { update: () => false, enabled };
    }

    // Touch-first: the stick reads naturally as "go where I push"
    input.setControlMode('direct');

    // Radar under the scrap / buttons panel (top right)
    const radarPanel = document.querySelector('.hud-radar');
    const topRight = document.querySelector('.hud-top-right');
    if (radarPanel && topRight) topRight.appendChild(radarPanel);

    // ---------------------------------------------------------------- virtual stick
    const zone = document.getElementById('touch-stick-zone');
    const stick = document.getElementById('touch-stick');
    const knob = document.getElementById('touch-stick-knob');
    let stickId = null;
    let originX = 0;
    let originY = 0;

    const setKnob = (x, y) => {
      knob.style.transform = `translate(${x}px, ${y}px)`;
    };

    const resetStick = () => {
      stickId = null;
      touch.active = false;
      touch.moveX = 0;
      touch.moveY = 0;
      stick.classList.remove('is-held');
      stick.style.transform = '';
      setKnob(0, 0);
    };

    const moveStick = (clientX, clientY) => {
      let dx = clientX - originX;
      let dy = clientY - originY;
      const len = Math.hypot(dx, dy);
      const reach = Math.min(len, STICK_RADIUS);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      setKnob(dx, dy);
      const mag = reach / STICK_RADIUS;
      if (mag < DEAD_ZONE) {
        touch.moveX = 0;
        touch.moveY = 0;
      } else {
        // direction of the knob, strength rescaled to start at 0 just outside the dead zone
        const strength = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
        touch.moveX = (dx / reach) * strength;
        touch.moveY = (dy / reach) * strength;
      }
    };

    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      e.preventDefault();
      game.audio.init();
      stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      // The stick jumps to where the thumb landed (its resting spot is only a hint)
      const zoneRect = zone.getBoundingClientRect();
      const restRect = stick.getBoundingClientRect();
      const restX = restRect.left + restRect.width * 0.5;
      const restY = restRect.top + restRect.height * 0.5;
      originX = Math.max(zoneRect.left + 50, Math.min(zoneRect.right - 50, e.clientX));
      originY = Math.max(zoneRect.top + 50, Math.min(zoneRect.bottom - 50, e.clientY));
      stick.style.transform = `translate(${originX - restX}px, ${originY - restY}px)`;
      stick.classList.add('is-held');
      touch.active = true;
      moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      moveStick(e.clientX, e.clientY);
    });
    const endStick = (e) => {
      if (e.pointerId === stickId) resetStick();
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);
    zone.addEventListener('lostpointercapture', endStick);

    // ---------------------------------------------------------------- buttons (held while touched)
    const buttons = Array.from(panel.querySelectorAll('[data-touch]'));
    for (const btn of buttons) {
      const action = btn.dataset.touch; // 'fire'
      const pointers = new Set();
      const sync = () => {
        touch[action] = pointers.size > 0;
        btn.classList.toggle('is-held', touch[action]);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        game.audio.init();
        btn.setPointerCapture(e.pointerId);
        pointers.add(e.pointerId);
        sync();
      });
      const up = (e) => {
        pointers.delete(e.pointerId);
        sync();
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      btn._release = () => {
        pointers.clear();
        sync();
      };
    }

    const releaseAll = () => {
      resetStick();
      for (const btn of buttons) btn._release();
    };
    // Menus opening, restarts, the window losing focus: forget held controls with the keys
    const baseRelease = input.release;
    input.release = () => {
      baseRelease();
      releaseAll();
    };
    panel.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------------------------------------------------------------- fullscreen
    const btnFull = document.getElementById('btn-fullscreen');
    const canFullscreen = btnFull && typeof root.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
    if (canFullscreen) {
      btnFull.hidden = false;
      const syncFull = () => {
        const on = !!document.fullscreenElement;
        btnFull.setAttribute('aria-pressed', String(on));
        btnFull.classList.toggle('is-active', on);
      };
      const enterFullscreen = () => {
        root.requestFullscreen({ navigationUI: 'hide' })
          .then(() => {
            // Android keeps the game sideways once fullscreen (not supported everywhere)
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
              screen.orientation.lock('landscape').catch(() => {});
            }
          })
          .catch(() => {});
      };
      btnFull.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          enterFullscreen();
        }
        btnFull.blur();
      });
      document.addEventListener('fullscreenchange', syncFull);
      syncFull();
      // Landscape from the start: the very first tap (usually "click to connect") goes fullscreen
      // and turns the screen sideways. Only once: leaving fullscreen afterwards is the player's call.
      // Not needed when launched from the home screen: the app already runs fullscreen + landscape
      // (manifest.webmanifest).
      const installedApp = global.matchMedia && global.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      const onFirstTap = () => {
        window.removeEventListener('pointerup', onFirstTap, true);
        if (!document.fullscreenElement) enterFullscreen();
      };
      if (!installedApp) window.addEventListener('pointerup', onFirstTap, true);
    }

    // ---------------------------------------------------------------- per frame
    let shown = null;
    let rotateShown = null;
    function update(menuOpen) {
      const upright = window.innerHeight > window.innerWidth;
      const blockUpright = upright; // landscape only, menus included
      const showControls = !menuOpen && !upright;
      if (showControls !== shown) {
        shown = showControls;
        panel.hidden = !showControls;
        if (!showControls) releaseAll();
      }
      if (blockUpright !== rotateShown) {
        rotateShown = blockUpright;
        rotateEl.hidden = !blockUpright;
        root.classList.toggle('is-upright', blockUpright);
        if (blockUpright) input.release();
      }
      return blockUpright;
    }

    return { update, enabled };
  }

  global.GameTouchControls = { create };
})(window);
