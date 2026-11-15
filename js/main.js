(function (global) {
  'use strict';

  // Entry point: builds every game object once the page has loaded and runs the frame loop.
  // The pieces of the running game live in js/game/ and share the `game` object built here:
  //   input.js    keyboard / mouse / HUD buttons        controls.js  driving, aiming, firing
  //   mission.js  sortie start, radio reports, depots,   hud.js       HUD panels
  //               return to HQ, report / game over       radar.js     radar + off-screen markers
  //   render.js   draws the frame                        fortIcon.js  compound icon (also briefing)
  //                                                      hqIcon.js    operations HQ icon

  function bootstrap() {
    const canvas = document.getElementById('game-canvas');
    const dialogs = {
      start: document.getElementById('start-dialog'),
      garage: document.getElementById('garage-dialog'),
      gameover: document.getElementById('gameover-dialog')
    };

    const view = {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    };

    function resizeCanvas() {
      view.w = window.innerWidth;
      view.h = window.innerHeight;
      view.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(view.w * view.dpr);
      canvas.height = Math.floor(view.h * view.dpr);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const audio = new global.TankAudio();
    const world = new global.HorizonWorld();
    const combat = new global.CombatManager(world, audio);
    const upgrades = new global.UpgradeManager(dialogs.garage, audio);
    const squad = new global.SquadManager(world, combat);
    const radio = new global.RadioComms(document.getElementById('radio-panel'), audio);
    const results = new global.ResultsReport(document.getElementById('results-dialog'));
    const briefing = new global.BriefingScene(document.getElementById('briefing-dialog'), {
      world,
      combat,
      squad,
      upgrades,
      audio,
      getPlayer: () => game.player
    });

    // Placeholder tank until mission.start() builds the one for the sortie
    const player = new global.Tank2D(world, {
      isPlayer: true,
      x: world.hq.x,
      y: world.hq.y,
      hullAngle: -Math.PI * 0.5
    });
    player.applyPlayerUpgrades(upgrades.levels);

    // Shared state of the running game (read and written by the js/game/ modules)
    const game = {
      canvas,
      ctx: canvas.getContext('2d'),
      view, // viewport size in CSS px + device pixel ratio
      dialogs,
      audio,
      world,
      combat,
      upgrades,
      squad,
      radio,
      results,
      briefing,
      player, // replaced on every (re)start
      // Camera locked to player center so the tank sits at exact screen center
      cam: { x: player.x, y: player.y, starOffsetX: 0 },
      activeTarget: null, // enemy / prop the turret is locked onto (null = aiming straight ahead)
      started: false,
      overShown: false, // after-action report or game-over window already shown for this sortie
      returnedToHq: false, // area secured AND the player has driven back to the operations HQ
      input: null,
      controls: null,
      mission: null,
      hud: null,
      radar: null,
      renderer: null
    };
    game.input = global.GameInput.create(game);
    game.mission = global.GameMission.create(game);
    game.hud = global.GameHud.create(game);
    game.radar = global.GameRadar.create(game);
    game.controls = global.GameControls.create(game);
    game.renderer = global.GameRenderer.create(game);
    const { mission, controls, hud, renderer } = game;

    let lastTime = performance.now();

    function animate(now) {
      requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const paused = !game.started || dialogs.start.open || briefing.isOpen || dialogs.garage.open || dialogs.gameover.open || results.isOpen;
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

        audio.updateEngine(
          (Math.abs(player.speed) + Math.abs(player.turnRate) * 35) / player.maxSpeed,
          player.boosting,
          true
        );
      } else {
        audio.updateEngine(0, false, false);
      }

      mission.checkEnd();

      const timeInfo = world.getTimeInfo();
      hud.update(timeInfo);
      renderer.render(now * 0.001, timeInfo);
    }

    mission.start();
    requestAnimationFrame(animate);
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
