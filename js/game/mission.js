(function (global) {
  'use strict';

  // Mission flow: (re)starting a sortie at the operations HQ, Mio's radio reports on combat events,
  // supply depots at captured compounds (resupply + wingman reinforcement), the drive back to the HQ once the planet
  // is secured and the end of the sortie (after-action report / game over).

  // Supply-depot trigger zone around a captured compound's white flag (the compound centre)
  const SUPPLY_ZONE = {
    SUPPLY_PROMPT_RADIUS: 60, // tank centre within this distance of the flag opens the menu
    SUPPLY_REARM_RADIUS: 110 // leave beyond this to be offered the menu again
  };

  // Pause between the sortie-select screen and the briefing (either way) once one has closed
  const SCENE_SWITCH_DELAY_MS = 250;

  function create(game) {
    const { world, combat, tuning, depot, squad, radio, results, sortieSelect, briefing, backdrop, audio, hazards } = game;
    const { start: startDialog, garage: garageDialog, gameover: gameoverDialog } = game.dialogs;

    // Radar-chart tuning (js/tuning.js) → the player's tank and every wingman. refill: fresh tanks
    // waiting on the HQ pad (full armour). Re-run on every change on the briefing.
    function applyTuning(refill = true) {
      game.player.applyStats(tuning.playerStats(), refill);
      // Long-range operation: the lock-on (and headlight) reach is extended
      const op = game.operation ? game.operation.operation : null;
      if (op && op.longRange) game.player.cannonRange += op.longRange.player || 0;
      combat.magnetRadius = tuning.pickupRadius();
      squad.applyTuning(refill);
      game.hud.update();
    }

    // Fresh tank on the HQ pad, platoon, compounds and clock for `selection` ({ planet, operation },
    // or null before one is picked: no compounds). The map is set up for the operation first
    // (its compounds, salt flat / old town areas: js/planet/zones.js).
    function resetSortie(selection) {
      const op = selection ? selection.operation : null;
      if (op) world.applyOperation(op);
      const player = new global.Tank2D(world, {
        isPlayer: true,
        x: world.hq.x,
        y: world.hq.y,
        hullAngle: -Math.PI * 0.5
      });
      game.player = player;
      // Respawn destroyed crates/barrels and clear old decals so a restart is a genuinely fresh run
      world.resetDynamic();
      combat.reset(player, selection);
      radio.clear();
      squad.reset(player);
      hazards.reset(selection);
      applyTuning(true);
      world.dayTime = op && op.startTime != null ? op.startTime : 0.30;
      world.dayCount = 1;
      game.cam.x = player.x;
      game.cam.y = player.y;
      game.cam.lookX = 0;
      game.cam.lookY = 0;
      game.cam.starOffsetX = 0;
      game.activeTarget = null;
      const bossTitle = document.querySelector('#boss-banner .boss-title');
      if (bossTitle) bossTitle.textContent = (op && op.bossName) || '⚠ 敵指揮官車';
    }

    // New sortie: the sortie-select screens (planet → operation) and the briefing (where the tanks
    // are tuned). The tuning itself is kept from the previous sortie.
    function start() {
      audio.init();
      game.operation = null;
      resetSortie(null);
      game.started = true;
      game.overShown = false;
      game.returnedToHq = false;
      game.input.release();
      // Sortie select, then the briefing (the game stays paused while either is open); the tactical
      // phase and Mio's mission-start report begin once the briefing is closed with 作戦開始.
      // Behind them the battlefield is hidden: the operations room, then the planet's tactical map.
      backdrop.show('room');
      sortieSelect.open(openBriefing);
    }

    // Briefing for the picked { planet, operation }; 作戦選択へ goes back to that planet's operation list.
    // The battlefield is set up for the operation right away (the briefing shows its compounds).
    function openBriefing(selection) {
      game.operation = selection;
      resetSortie(selection);
      backdrop.show('map', selection);
      briefing.open(selection, {
        delayMs: SCENE_SWITCH_DELAY_MS,
        onStart: () => {
          backdrop.hide(); // fade out to the battlefield
          for (const line of global.RadioComms.script.missionStart(selection)) radio.say(line);
        },
        onBack: () => {
          backdrop.show('room');
          sortieSelect.open(openBriefing, { planetId: selection.planet.id, delayMs: SCENE_SWITCH_DELAY_MS });
        }
      });
    }

    startDialog.addEventListener('close', () => {
      startDialog.returnValue = '';
      if (!game.started) start();
    });

    gameoverDialog.addEventListener('close', () => {
      const val = gameoverDialog.returnValue;
      gameoverDialog.returnValue = '';
      if (val === 'restart') {
        start();
      }
    });

    // ---- Supply depots: CAPTURED compounds -----------------------------------------------------
    // Driving onto the white flag of a captured compound opens the depot menu (free resupply +
    // wingman reinforcement), once per visit (drive off the flag zone to re-arm). The zone is drawn
    // as a ring around the flag (render.js). There is no automatic resupply.
    const { SUPPLY_PROMPT_RADIUS, SUPPLY_REARM_RADIUS } = SUPPLY_ZONE;

    function checkSupplyDepots() {
      const player = game.player;
      // In combat (same condition as the HUD's "散開・交戦": sortied enemies near the platoon)
      // no prompt is offered; the visit stays armed so it appears once the fight is over.
      const inCombat = squad.mode === 'engage';
      for (const b of combat.bases) {
        if (!b.cleared) continue;
        const d = Math.hypot(world.deltaX(player.x, b.x), world.deltaY(player.y, b.y));
        if (d > SUPPLY_REARM_RADIUS) {
          b.supplyArmed = true;
          b.supplyBlockedNotified = false;
        } else if (d < SUPPLY_PROMPT_RADIUS && b.supplyArmed) {
          if (inCombat) {
            if (!b.supplyBlockedNotified) {
              b.supplyBlockedNotified = true;
              radio.say(global.RadioComms.script.supplyBlocked(b.name), { key: 'supply-blocked' });
            }
            continue;
          }
          b.supplyArmed = false; // once per visit
          openDepotMenu(`拠点 ${b.name}（制圧済み）— 補給・僚機補充`);
        }
      }
    }

    // Depot menu (#garage-dialog): opened when entering a captured compound
    function openDepotMenu(title) {
      const player = game.player;
      if (!player.alive || garageDialog.open || gameoverDialog.open) return;
      game.input.release();
      document.getElementById('garage-title').textContent = title;
      depot.open(player, combat, squad, () => game.hud.update());
    }

    // Name of the planet this sortie is fought on (picked on the sortie-select screens)
    function planetName() {
      return game.operation ? game.operation.planet.name : '作戦区域';
    }

    // Radio reports for what happened in combat this frame (compound alerted / captured, area secured)
    function handleCombatEvents() {
      for (const ev of combat.drainEvents()) {
        if (ev.type === 'alert') {
          radio.say(global.RadioComms.script.baseAlert(ev.base.name), { priority: 'high' });
        } else if (ev.type === 'cleared') {
          // Capture hauls in every scattered item (done in CombatManager); no automatic resupply
          ev.base.supplyArmed = false; // the depot menu is offered on the next visit (leave and return)
          radio.say(global.RadioComms.script.baseCaptured(ev.base.name));
          // First capture of the sortie (and not the last one): tell the player about the depot
          if (combat.bases.filter((b) => b.cleared).length === 1 && !combat.missionComplete) {
            radio.say(global.RadioComms.script.supplyAvailable(ev.base.name));
          }
        } else if (ev.type === 'areaSecured') {
          // Objective done: Mio reports it and orders the platoon home (controls locked until she
          // has finished)
          for (const line of global.RadioComms.script.areaSecured(game.operation, planetName())) {
            radio.say(line, { lockControls: true });
          }
        } else if (ev.type === 'holdStart') {
          for (const line of global.RadioComms.script.holdStart(game.operation, combat.hold)) {
            radio.say(line, { priority: 'high' });
          }
        } else if (ev.type === 'holdLeft') {
          radio.say(global.RadioComms.script.holdLeft(), { key: 'hold-zone', priority: 'high' });
        } else if (ev.type === 'holdBack') {
          radio.say(global.RadioComms.script.holdBack(), { key: 'hold-zone' });
        } else if (ev.type === 'holdHalf') {
          radio.say(global.RadioComms.script.holdHalf(ev.left), { key: 'hold-half' });
        } else if (ev.type === 'holdWave' && !combat.hold.waveReported) {
          combat.hold.waveReported = true;
          radio.say(global.RadioComms.script.holdWave(), { key: 'hold-wave' });
        }
      }
    }

    // ---- Return to the operations HQ ------------------------------------------------------------
    // Capturing the last compound doesn't end the sortie: Mio orders the platoon home and the
    // player drives back. Entering the painted circle on the HQ pad reports in (controls lock
    // while Mio confirms), and the after-action report follows (checkEnd).
    function checkReturnToHq() {
      const player = game.player;
      if (!combat.missionComplete || game.returnedToHq || !player.alive) return;
      if (radio.controlsLocked) return; // Mio is still reporting the secured planet
      const hq = world.hq;
      const d = Math.hypot(world.deltaX(player.x, hq.x), world.deltaY(player.y, hq.y));
      if (d > hq.returnRadius) return;
      game.returnedToHq = true;
      const t = world.getTimeInfo();
      combat.stats.returnClock = { day: t.day, clock: t.clockText };
      radio.say(global.RadioComms.script.hqReturned(), { lockControls: true });
    }

    // End of the sortie, checked every frame
    function checkEnd() {
      const player = game.player;
      // Back at the HQ with the planet secured: the after-action report, once Mio has finished
      if (game.started && !game.overShown && player.alive && game.returnedToHq && radio.isIdle) {
        game.overShown = true;
        game.input.release();
        // The next stage of the planet's campaign opens (js/campaign.js)
        if (game.operation) global.Campaign.markCleared(game.operation.operation.id);
        results.open({ stats: combat.stats, combat, squad, player, world, audio, planetName: planetName() }, () => start());
      }

      // Tank destroyed
      if (game.started && !game.overShown && !player.alive) {
        game.overShown = true;
        const victory = false;
        const badge = document.getElementById('gameover-badge');
        badge.textContent = victory ? 'MISSION COMPLETE' : 'TANK DESTROYED';
        badge.classList.toggle('danger', !victory);
        badge.classList.toggle('success', victory);
        document.getElementById('gameover-title').textContent = victory
          ? `${planetName()} 制圧 — 全${combat.bases.length}拠点を制圧`
          : '車体大破 — MISSION FAILED';
        document.getElementById('gameover-summary').textContent =
          `制圧した拠点: ${combat.bases.filter((b) => b.cleared).length} / ${combat.bases.length} ／ 撃破した敵戦車: ${combat.kills} 両 ／ 残存僚機: ${combat.allies.length} 両 ／ 獲得スクラップ残高: ${combat.scrap}`;
        document.getElementById('btn-restart').textContent = victory ? 'もう一度出撃する' : '新車両で再出撃する';
        gameoverDialog.showModal();
      }
    }

    return { start, applyTuning, handleCombatEvents, checkSupplyDepots, checkReturnToHq, checkEnd };
  }

  global.GameMission = { create, SUPPLY_ZONE };
})(window);
