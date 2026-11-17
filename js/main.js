(function (global) {
  'use strict';

  // Entry point: builds every game object once the page has loaded and runs the frame loop.
  // The pieces of the running game live in js/game/ and share the `game` object built here:
  //   input.js    keyboard / mouse / HUD buttons        controls.js  driving, aiming, firing
  //   mission.js  sortie start, radio reports, depots,   hud.js       HUD panels
  //               return to HQ, report / game over       radar.js     radar + off-screen markers
  //   render.js   draws the frame                        fortIcon.js  compound icon (also briefing)
  //   quality.js  render resolution / phone settings     hqIcon.js    operations HQ icon
  //   touchControls.js  on-screen stick & buttons, "turn the phone sideways" screen (phones)

  function bootstrap() {
    const canvas = document.getElementById('game-canvas');
    const dialogs = {
      start: document.getElementById('start-dialog'),
      garage: document.getElementById('garage-dialog'),
      gameover: document.getElementById('gameover-dialog')
    };

    // Canvas pixels per CSS pixel follow what the device keeps up with (js/game/quality.js)
    const quality = global.GameQuality.create();
    const view = {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: quality.ratio()
    };

    function resizeCanvas() {
      view.w = window.innerWidth;
      view.h = window.innerHeight;
      view.dpr = quality.ratio();
      const cw = Math.floor(view.w * view.dpr);
      const ch = Math.floor(view.h * view.dpr);
      // (assigning a canvas size reallocates and clears it, even when the size is unchanged)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
    }
    resizeCanvas();
    // A new render resolution is applied just before the next frame is drawn: resizing clears
    // the canvas, so doing it right away would show one blank frame
    let resizePending = false;
    quality.onChange = () => {
      resizePending = true;
    };
    window.addEventListener('resize', () => {
      quality.refresh();
      resizeCanvas();
    });

    const audio = new global.TankAudio();
    const world = new global.HorizonWorld();
    const combat = new global.CombatManager(world, audio);
    const tuning = new global.TankTuning(); // radar-chart tuning, kept across sorties
    const depot = new global.DepotMenu(dialogs.garage, audio);
    const squad = new global.SquadManager(world, combat, tuning);
    const radio = new global.RadioComms(document.getElementById('radio-panel'), audio);
    const results = new global.ResultsReport(document.getElementById('results-dialog'));
    // Operations room / tactical map behind the sortie select and the briefing (js/hqBackdrop.js)
    const backdrop = new global.HqBackdrop(document.getElementById('hq-backdrop'), {
      world,
      combat,
      getPlayer: () => game.player
    });
    // Sortie select: planet select → operation select, two separate windows (js/sortieSelect.js)
    const sortieSelect = new global.SortieSelect({
      planetDialog: document.getElementById('planet-dialog'),
      operationDialog: document.getElementById('operation-dialog'),
      audio
    });
    const briefing = new global.BriefingScene(document.getElementById('briefing-dialog'), {
      world,
      combat,
      squad,
      tuning,
      audio,
      getPlayer: () => game.player,
      onTune: () => game.mission.applyTuning(true) // tanks are still on the HQ pad: refit + refill
    });

    // Placeholder tank until mission.start() builds the one for the sortie
    const player = new global.Tank2D(world, {
      isPlayer: true,
      x: world.hq.x,
      y: world.hq.y,
      hullAngle: -Math.PI * 0.5
    });
    player.applyStats(tuning.playerStats(), true);

    // Shared state of the running game (read and written by the js/game/ modules)
    const game = {
      canvas,
      // Every frame paints the whole canvas (sky + ground), so it can be opaque: the browser
      // then doesn't have to blend it with the page behind it
      ctx: canvas.getContext('2d', { alpha: false }),
      view, // viewport size in CSS px + canvas pixels per CSS px (render resolution)
      dialogs,
      audio,
      world,
      combat,
      tuning,
      depot,
      squad,
      radio,
      results,
      sortieSelect,
      briefing,
      backdrop,
      operation: null, // { planet, operation } picked on the sortie-select screens (js/data/operations.js)
      player, // replaced on every (re)start
      // Camera follows the player, leading it by (lookX, lookY) along its facing (js/game/controls.js)
      cam: { x: player.x, y: player.y, lookX: 0, lookY: 0, starOffsetX: 0 },
      activeTarget: null, // enemy / prop the turret is locked onto (null = aiming straight ahead)
      started: false,
      overShown: false, // after-action report or game-over window already shown for this sortie
      returnedToHq: false, // planet secured AND the player has driven back to the operations HQ
      input: null,
      controls: null,
      mission: null,
      hud: null,
      radar: null,
      renderer: null,
      touchUi: null
    };
    game.input = global.GameInput.create(game);
    game.touchUi = global.GameTouchControls.create(game);
    game.mission = global.GameMission.create(game);
    game.hud = global.GameHud.create(game);
    game.radar = global.GameRadar.create(game);
    game.controls = global.GameControls.create(game);
    game.renderer = global.GameRenderer.create(game);
    const { mission, controls, hud, renderer } = game;

    let lastTime = performance.now();
    let lastRenderAt = null; // time of the previous drawn battlefield frame (null: none in a row yet)
    let frameNo = 0;

    function animate(now) {
      requestAnimationFrame(animate);
      // Phones with fast displays: skip display frames to hold ~60 fps (js/game/quality.js)
      if (global.GameQuality.skipFrame(now - lastTime)) return;
      const workStart = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      frameNo += 1;

      const menuOpen = !game.started || dialogs.start.open || sortieSelect.isOpen || briefing.isOpen || dialogs.garage.open || dialogs.gameover.open || results.isOpen;
      // Phones held upright: everything waits behind the "turn sideways" screen (landscape only)
      const paused = game.touchUi.update(menuOpen) || menuOpen;
      // While Mio reports a secured district (controls locked) the in-game clock and the mission
      // timer stand still; the radio itself and on-screen effects keep running
      const timeFrozen = radio.controlsLocked;
      world.update(dt, !paused && !timeFrozen);

      const player = game.player;
      if (!paused && player.alive) {
        // While Mio reports a secured district the player can't drive, aim or fire (the tank coasts to a stop)
        controls.update(dt, timeFrozen);

        // Wingmen: hold formation, or fan out and fight when enemies close in
        squad.update(dt, player);

        combat.update(dt, player, !timeFrozen);
        mission.handleCombatEvents();
        mission.checkSupplyDepots();
        mission.checkReturnToHq();
        radio.update(dt); // advances only while the game runs, so reports resume after menus close

        // The engine note glides to its target over ~0.1 s anyway: every 3rd frame is plenty
        if (frameNo % 3 === 0) {
          audio.updateEngine(
            (Math.abs(player.speed) + Math.abs(player.turnRate) * 35) / player.maxSpeed,
            true
          );
        }
      } else if (frameNo % 3 === 0) {
        audio.updateEngine(0, false);
      }

      mission.checkEnd();

      const timeInfo = world.getTimeInfo();
      hud.frame(timeInfo, now, !paused && game.player.alive);
      // The battlefield is hidden while the HQ backdrop fully covers it
      if (!backdrop.covering) {
        if (resizePending) {
          resizePending = false;
          resizeCanvas();
        }
        renderer.render(now * 0.001, timeInfo);
        // Frame time and this frame's own work (update + drawing calls) steer the render resolution
        if (lastRenderAt != null) quality.sample(now - lastRenderAt, now, performance.now() - workStart);
        lastRenderAt = now;
      } else {
        lastRenderAt = null;
      }
    }

    mission.start();
    requestAnimationFrame(animate);
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
