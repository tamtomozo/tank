(function (global) {
  'use strict';

  // Render quality: how many canvas pixels are drawn per CSS pixel, adjusted to what the device
  // can keep up with, plus the settings that differ on phones / tablets.
  //   quality.ratio()              current canvas pixels per CSS pixel (-> game.view.dpr)
  //   quality.sample(ms, t, work)  report a drawn frame (see below); may step the ratio
  //   quality.onChange             called when the ratio changed (main.js resizes the canvas)
  //   GameQuality.touch            true on touch-first devices (phones, tablets)
  //   GameQuality.skipFrame        (ms since the last drawn frame) -> true to leave this display frame out
  //   GameQuality.menuRatio        pixel ratio for the pre-sortie backdrop canvases
  //
  // The battlefield is filled several times over every frame (ground strips, haze, particles,
  // night overlay), so on a weak GPU its cost grows with the pixel count. While frames arrive
  // slowly the ratio goes down a step at a time (the canvas is stretched to the same size on
  // screen, just softer). If even the lowest ratio makes no difference, pixels were not the
  // problem (the device is busy elsewhere): the ratio goes back to where it was and is left alone
  // for a while. After a long smooth stretch it goes up a step again, and a step up that
  // immediately lags is not retried soon.

  const TOUCH = typeof global.matchMedia === 'function' && global.matchMedia('(pointer: coarse)').matches;
  // <html class="is-touch">: phone layout & on-screen controls (css/touch.css, js/game/touchControls.js).
  // Set here, before the first screen is shown, so even the "tap to connect" screen uses it.
  document.documentElement.classList.toggle('is-touch', TOUCH);

  const MAX_RATIO = 2; // never more than 2 canvas px per CSS px, whatever the display has
  const START_RATIO_TOUCH = 1.5; // phones start here instead of at their (2x-3x) display ratio
  const STEPS = [2, 1.5, 1.25, 1]; // ratios tried on the way down (those below the display's)
  const MIN_STEP_TOUCH = 0.75; // last resort on phones only

  const WINDOW_FRAMES = 45; // frames averaged per decision
  const SLOW_MS = 22; // average frame time above this (< ~45 fps): step down ...
  const SLOW_WINDOWS = 2; // ... after this many windows in a row
  const SMOOTH_MS = 17.6; // average at or below this (60 fps held) counts towards stepping up
  const SMOOTH_WINDOWS = 25; // ~20 s of smooth frames before trying a step up
  const SETTLE_MS = 1200; // ignore the frames right after a change (canvas reallocation)
  const RETRY_LOCK_MS = 120000; // how long a step that didn't work out is not tried again ...
  const RETRY_LOCK_MAX = 16; // ... doubling with every further failure, up to this many times as long
  const FAILED_UP_MS = 8000; // a step up that lags within this time counts as failed
  const USELESS_GAIN = 0.85; // lowest ratio still within 15 % of the frame time before: no use

  function displayRatio() {
    return Math.min(global.devicePixelRatio || 1, MAX_RATIO);
  }

  function create() {
    let levels = [];
    let index = 0;

    // Ratios available on this display, best first
    function buildLevels() {
      const top = displayRatio();
      levels = [top, ...STEPS.filter((s) => s < top - 0.01)];
      if (TOUCH && levels[levels.length - 1] > MIN_STEP_TOUCH) levels.push(MIN_STEP_TOUCH);
    }
    buildLevels();
    if (TOUCH) {
      const start = levels.findIndex((r) => r <= START_RATIO_TOUCH);
      index = start < 0 ? 0 : start;
    }

    let frames = 0;
    let sumFrame = 0;
    let sumWork = 0;
    let slowRun = 0;
    let smoothRun = 0;
    let changedAt = -Infinity;
    let steppedUpAt = -Infinity;
    let upLockedUntil = -Infinity;
    let downLockedUntil = -Infinity;
    let upFails = 0; // failed steps up / useless descents so far (each doubles its retry lock)
    let downFails = 0;
    const lockFor = (fails) => RETRY_LOCK_MS * Math.min(RETRY_LOCK_MAX, 2 ** (fails - 1));
    // While stepping down: where the descent began { index, frame, work } (averages at that time)
    let descent = null;

    const quality = {
      onChange: null,

      ratio() {
        return levels[index];
      },

      // The display's own ratio can change (browser zoom, window moved to another screen)
      refresh() {
        const current = levels[index];
        buildLevels();
        let best = 0;
        for (let i = 1; i < levels.length; i++) {
          if (Math.abs(levels[i] - current) < Math.abs(levels[best] - current)) best = i;
        }
        index = best;
        descent = null;
      },

      // frameMs: time between this drawn frame and the previous one; now: frame time in ms;
      // workMs: time the game's own code took for this frame (update + drawing calls)
      sample(frameMs, now, workMs = 0) {
        if (frameMs > 250 || now - changedAt < SETTLE_MS) {
          // A pause, a tab switch or the hitch of a resize: not a measurement
          frames = 0;
          sumFrame = 0;
          sumWork = 0;
          return;
        }
        sumFrame += Math.min(frameMs, 50); // a single long frame (GC, texture rebuild) barely counts
        sumWork += Math.min(workMs, 50);
        frames += 1;
        if (frames < WINDOW_FRAMES) return;
        const avg = sumFrame / frames;
        const work = sumWork / frames;
        frames = 0;
        sumFrame = 0;
        sumWork = 0;

        if (avg > SLOW_MS) {
          smoothRun = 0;
          slowRun += 1;
          if (slowRun < SLOW_WINDOWS) return;
          if (index < levels.length - 1) {
            if (now < downLockedUntil) return;
            if (now - steppedUpAt < FAILED_UP_MS) {
              upFails += 1;
              upLockedUntil = now + lockFor(upFails);
            }
            if (!descent) descent = { index, frame: avg, work };
            index += 1;
            change(now);
          } else if (descent) {
            // Lowest ratio and still slow. If neither the frame time nor the game's own share of
            // it got noticeably shorter on the way down, fewer pixels don't help here: back up.
            const useless = avg > descent.frame * USELESS_GAIN && work > descent.work * USELESS_GAIN;
            const back = descent.index;
            descent = null;
            if (useless) {
              index = back;
              downFails += 1;
              downLockedUntil = now + lockFor(downFails);
              upLockedUntil = Math.max(upLockedUntil, now + RETRY_LOCK_MS);
              change(now);
            }
          }
        } else {
          slowRun = 0;
          descent = null; // fast enough again: the descent (if any) did its job
          if (avg > SMOOTH_MS) {
            smoothRun = 0;
            return;
          }
          smoothRun += 1;
          if (smoothRun >= SMOOTH_WINDOWS && index > 0 && now >= upLockedUntil) {
            index -= 1;
            steppedUpAt = now;
            change(now);
          }
        }
      }
    };

    function change(now) {
      changedAt = now;
      slowRun = 0;
      smoothRun = 0;
      if (quality.onChange) quality.onChange();
    }

    return quality;
  }

  global.GameQuality = {
    create,
    touch: TOUCH,
    // Phones with 90 / 120 Hz screens: drawing every display frame doubles the work (and the heat)
    // for little gain here, so frames closer than 10 ms to the last drawn one are left out
    // (120 Hz -> 60 fps, 90 Hz stays 90, 60 Hz stays 60). Desktop displays are never capped.
    skipFrame(sinceLastMs) {
      return TOUCH && sinceLastMs < 10;
    },
    menuRatio() {
      return Math.min(global.devicePixelRatio || 1, TOUCH ? 1.5 : MAX_RATIO);
    }
  };
})(window);
