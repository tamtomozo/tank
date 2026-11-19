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
    const { start: startDialog, garage: garageDialog, gameover: gameoverDialog, pause: pauseDialog } = game.dialogs;

    // Radar-chart tuning (js/tuning.js) → the player's tank and every wingman. refill: fresh tanks
    // waiting on the HQ pad (full armour). Re-run on every change on the briefing.
    function applyTuning(refill = true) {
      game.player.applyStats(tuning.playerStats(), refill);
      global.GameLoadout.fit(game.player, refill); // equipment + wear (js/loadout.js)
      // Long-range operation: the lock-on (and headlight) reach is extended
      const op = game.operation ? game.operation.operation : null;
      if (op && op.longRange) game.player.cannonRange += op.longRange.player || 0;
      combat.magnetRadius = tuning.pickupRadius();
      squad.applyTuning(refill);
      game.hud.update();
    }

    // Fresh tank on the HQ pad (or at the operation's start point), platoon, compounds and clock
    // for `selection` ({ planet, operation }, or null before one is picked: no compounds). The map
    // is set up for the operation first (planet look, compounds, areas: js/planet/zones.js).
    function resetSortie(selection) {
      const op = selection ? selection.operation : null;
      // Sweep operation: lay out its first wave of compounds (js/sweep.js)
      if (op && op.sweep) global.Sweep.planRound(op, selection.planet, 0, world, [world.hq]);
      if (op) world.applyOperation(op, selection.planet.theme);
      const start = op && op.startAt ? op.startAt : { x: world.hq.x, y: world.hq.y, angle: -Math.PI * 0.5 };
      const player = new global.Tank2D(world, {
        isPlayer: true,
        x: start.x,
        y: start.y,
        hullAngle: start.angle != null ? start.angle : -Math.PI * 0.5
      });
      game.player = player;
      // What the campaign carries in: equipment, wear, crew level (tuning points), platoon, scrap
      // (a sweep takes only the equipment and the crew level: fresh tank, full platoon, no scrap)
      const campaign = global.Campaign;
      const sweep = !!(op && op.sweep);
      global.GameLoadout.set(selection ? campaign.equipment(selection.planet) : [], sweep ? 0 : campaign.wear);
      tuning.setBonus(campaign.tuningBonus);
      // Respawn destroyed crates/barrels and clear old decals so a restart is a genuinely fresh run
      world.resetDynamic();
      combat.reset(player, selection);
      combat.scrap = sweep ? 0 : campaign.scrap;
      radio.clear();
      squad.reset(player, sweep ? campaign.maxAllies : campaign.allies);
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
      if (bossTitle) bossTitle.textContent = (op && op.bossName) || L('⚠ 敵指揮官車', '⚠ Enemy Command Tank');
    }

    // New sortie: the sortie-select screens (planet → operation) and the briefing (where the tanks
    // are tuned). The tuning itself is kept from the previous sortie.
    // options.award: the medal earned by the operation just completed, presented when the planet
    // select opens (js/medalAward.js)
    // options.planetId: reopen straight on that planet's operation list (after a sweep)
    function start(options = {}) {
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
      sortieSelect.open(openBriefing, { award: options.award || null, planetId: options.planetId || null });
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

    // After a sweep or a withdrawal the operation list of its planet opens again (returnPlanetId)
    let returnPlanetId = null;
    gameoverDialog.addEventListener('close', () => {
      const val = gameoverDialog.returnValue;
      gameoverDialog.returnValue = '';
      const planetId = returnPlanetId;
      returnPlanetId = null;
      if (val === 'restart') {
        start({ planetId });
      }
    });

    // ---- Supply depots: CAPTURED compounds -----------------------------------------------------
    // Driving onto the white flag of a captured compound opens the depot menu (free resupply +
    // wingman reinforcement), once per visit (drive off the flag zone to re-arm). The zone is drawn
    // as a ring around the flag (render.js). There is no automatic resupply.
    const { SUPPLY_PROMPT_RADIUS, SUPPLY_REARM_RADIUS } = SUPPLY_ZONE;

    function checkSupplyDepots() {
      const player = game.player;
      if (combat.sweep) {
        checkSweepRest();
        return;
      }
      if (game.operation && game.operation.operation.noSupply) return; // cut off: no depots at all
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
          openDepotMenu(L(`拠点 ${b.name}（制圧済み）— 補給・僚機補充`, `${b.name} (captured) — Resupply & Reinforce`));
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

    // ---- Sweep operation: between two waves (js/sweep.js) ----------------------------------------
    // Once a wave has fallen, only the white flag of the compound captured last offers the menu:
    // recover and go on, or go on as is. Closing it (✕) leaves the choice for the next visit.
    function checkSweepRest() {
      const s = combat.sweep;
      const b = s.restBase;
      if (s.phase !== 'rest' || !b) return;
      const player = game.player;
      const d = Math.hypot(world.deltaX(player.x, b.x), world.deltaY(player.y, b.y));
      if (d > SUPPLY_REARM_RADIUS) {
        b.supplyArmed = true;
      } else if (d < SUPPLY_PROMPT_RADIUS && b.supplyArmed) {
        if (!player.alive || garageDialog.open || gameoverDialog.open) return; // (offered once it has closed)
        b.supplyArmed = false; // once per visit
        game.input.release();
        document.getElementById('garage-title').textContent = L(`拠点 ${b.name} — 第${s.round + 1}波 制圧完了`, `${b.name} — Wave ${s.round + 1} cleared`);
        depot.openSweep(player, combat, squad, {
          wave: s.round + 1,
          rounds: s.rounds,
          onChoose: (recover) => {
            if (recover) combat.sweepRecover(game.player, squad);
            sweepNextRound();
          },
          onChange: () => game.hud.update()
        });
      }
    }

    // Lay out the next wave away from the platoon and garrison it (the captured compounds go)
    function sweepNextRound() {
      const sel = game.operation;
      const avoid = [game.player, ...combat.allies.filter((a) => a.alive)];
      global.Sweep.planRound(sel.operation, sel.planet, combat.sweep.round + 1, world, avoid);
      world.replaceSites(sel.operation.sites, avoid);
      combat.startSweepRound();
      game.hud.update();
    }

    // End of a sweep run: the last wave fell (complete) or the tank was lost. The best run per
    // planet is kept; nothing else carries over to the campaign.
    function showSweepResult(complete) {
      const player = game.player;
      const s = combat.sweep;
      const planet = game.operation.planet;
      const time = combat.sweepTime;
      const rec = global.Campaign.recordSweep(planet.id, { captured: s.captured, time, laps: s.laps });
      const fmt = global.Sweep.formatTime;
      returnPlanetId = planet.id;
      game.overShown = true;
      game.input.release();

      const badge = document.getElementById('gameover-badge');
      badge.textContent = complete ? 'SWEEP COMPLETE' : player.sunk ? 'TANK LOST' : 'TANK DESTROYED';
      badge.classList.toggle('danger', !complete);
      badge.classList.toggle('success', complete);
      document.getElementById('gameover-title').textContent = complete
        ? L(`${planet.name} 掃討完了 — 全${s.total}拠点を制圧`, `${planet.name} swept — all ${s.total} compounds captured`)
        : L('掃討作戦 終了', 'Sweep over');
      const notes = [];
      if (rec.newBest) notes.push(L('自己ベスト更新！', 'New personal best!'));
      if (rec.newBestLap) notes.push(L('ベストラップ更新！', 'New best lap!'));
      document.getElementById('gameover-summary').textContent =
        L(`制圧した拠点: ${s.captured} / ${s.total} ／ 合計タイム: ${fmt(time)} ／ 撃破した敵: ${combat.kills} 両`,
          `Compounds captured: ${s.captured} / ${s.total} · Total time: ${fmt(time)} · Enemies destroyed: ${combat.kills}`)
        + (notes.length ? `\n${notes.join(L('　', ' '))}` : '');

      // Lap times, the best of the run marked; an unfinished wave shows how far it got
      const lapsEl = document.getElementById('gameover-laps');
      const best = s.laps.length ? Math.min(...s.laps) : null;
      const items = s.laps.map((t, i) => {
        const li = document.createElement('li');
        li.textContent = L(`第${i + 1}波　${fmt(t)}`, `Wave ${i + 1}  ${fmt(t)}`);
        if (t === best) li.classList.add('is-best');
        return li;
      });
      if (!complete && s.phase === 'fight') {
        const li = document.createElement('li');
        li.className = 'is-unfinished';
        const done = combat.bases.filter((b) => b.cleared).length;
        li.textContent = L(`第${s.round + 1}波　${fmt(s.lap)}（${done} / ${combat.bases.length} で中断）`,
          `Wave ${s.round + 1}  ${fmt(s.lap)} (stopped at ${done} / ${combat.bases.length})`);
        items.push(li);
      }
      lapsEl.replaceChildren(...items);
      lapsEl.hidden = items.length === 0;
      if (rec.record && rec.record.bestLap != null) {
        lapsEl.dataset.record = L(`この惑星の記録: ${rec.record.captured} / ${s.total} 拠点 ${fmt(rec.record.time)} ／ ベストラップ ${fmt(rec.record.bestLap)}`,
          `Planet record: ${rec.record.captured} / ${s.total} in ${fmt(rec.record.time)} · Best lap ${fmt(rec.record.bestLap)}`);
      } else {
        delete lapsEl.dataset.record;
      }
      document.getElementById('btn-restart').textContent = L('作戦選択へ戻る', 'Back to operations');
      gameoverDialog.showModal();
    }

    // ---- Pause (HUD ⏸ / Esc / P): back to the operation, or withdraw ----------------------------
    // The game stands still while the window is open (main.js). Withdrawing ends the sortie as a
    // failure (nothing changes in the campaign, like a lost tank); a sweep keeps its record so far.
    // Once the objective is met, withdrawing is no longer offered.
    function canPause() {
      return game.started && !!game.operation && !game.overShown && game.player.alive
        && !startDialog.open && !garageDialog.open && !gameoverDialog.open && !pauseDialog.open
        && !sortieSelect.isOpen && !briefing.isOpen && !results.isOpen;
    }

    function openPause() {
      if (!canPause()) return;
      game.input.release();
      const s = combat.sweep;
      const canWithdraw = !combat.missionComplete;
      const fmt = global.Sweep.formatTime;
      const name = game.operation.operation.name;
      document.getElementById('pause-title').textContent = L(`作戦「${name}」`, `Op. "${name}"`);
      document.getElementById('btn-pause-withdraw').hidden = !canWithdraw;
      let text;
      if (!canWithdraw) {
        text = L('目標は達成済みです。作戦本部へ帰還してください。', 'The objective is met. Return to HQ.');
      } else if (s) {
        text = L(`撤退すると、ここまでの記録（制圧 ${s.captured} / ${s.total} 拠点・合計タイム ${fmt(combat.sweepTime)}）で作戦を終了します。`,
          `Withdraw and the run ends with the record so far (${s.captured} / ${s.total} compounds, total time ${fmt(combat.sweepTime)}).`);
      } else {
        text = L('撤退すると作戦失敗となり、作戦選択に戻ります。キャンペーンの進行は変わりません。',
          'Withdraw and the operation fails; you return to the operation select. Campaign progress does not change.');
      }
      document.getElementById('pause-summary').textContent = text;
      pauseDialog.showModal();
    }

    // HUD button and keys (js/game/input.js): P also closes the window again
    function togglePause() {
      if (pauseDialog.open) pauseDialog.close('resume');
      else openPause();
    }

    const btnPause = document.getElementById('btn-pause');
    btnPause.addEventListener('click', () => {
      btnPause.blur();
      openPause();
    });

    pauseDialog.addEventListener('close', () => {
      const val = pauseDialog.returnValue;
      pauseDialog.returnValue = '';
      game.input.release();
      if (val !== 'withdraw' || game.overShown || combat.missionComplete || !game.player.alive) return;
      withdraw();
    });

    // Withdraw: straight back to the planet's operation select, no report. An ordinary operation
    // is a failed sortie (the campaign is unchanged); a sweep keeps its record so far.
    function withdraw() {
      const s = combat.sweep;
      const planet = game.operation.planet;
      if (s) global.Campaign.recordSweep(planet.id, { captured: s.captured, time: combat.sweepTime, laps: s.laps });
      game.overShown = true;
      start({ planetId: planet.id });
    }

    // What the platoon achieved before the tank was lost
    function failureSummary() {
      const taken = combat.bases.filter((b) => b.cleared).length;
      return L(`制圧した拠点: ${taken} / ${combat.bases.length} ／ 撃破した敵戦車: ${combat.kills} 両 ／ 残存僚機: ${combat.allies.length} 両 ／ 獲得スクラップ残高: ${combat.scrap}`,
        `Compounds captured: ${taken} / ${combat.bases.length} · Enemy tanks destroyed: ${combat.kills} · Wingmen left: ${combat.allies.length} · Scrap: ${combat.scrap}`);
    }

    // Name of the planet this sortie is fought on (picked on the sortie-select screens)
    function planetName() {
      return game.operation ? game.operation.planet.name : L('作戦区域', 'the operation area');
    }

    // Radio reports for what happened in combat this frame (compound alerted / captured, area secured)
    function handleCombatEvents() {
      for (const ev of combat.drainEvents()) {
        if (ev.type === 'alert') {
          radio.say(global.RadioComms.script.baseAlert(ev.base.name), { priority: 'high' });
        } else if (ev.type === 'cleared' && combat.sweep) {
          // Sweep: a short count of what is left of the wave (the last one gets the wave report)
          ev.base.supplyArmed = false;
          const left = combat.bases.filter((b) => !b.cleared).length;
          if (left > 0) radio.say(global.RadioComms.script.sweepCaptured(ev.base.name, left), { key: 'sweep-capture' });
        } else if (ev.type === 'sweepRoundClear') {
          // Already on the flag when it fell: the menu opens straight away
          ev.base.supplyArmed = true;
          for (const line of global.RadioComms.script.sweepRoundClear(ev.round + 1, combat.sweep.rounds, global.Sweep.formatTime(ev.lap), ev.base.name)) {
            radio.say(line, { priority: 'high' });
          }
        } else if (ev.type === 'sweepRoundStart') {
          radio.say(global.RadioComms.script.sweepRoundStart(ev.round + 1, combat.sweep.rounds, combat.bases.length), { priority: 'high' });
        } else if (ev.type === 'sweepComplete') {
          for (const line of global.RadioComms.script.sweepComplete(combat.sweep.total, global.Sweep.formatTime(ev.time))) {
            radio.say(line, { lockControls: true });
          }
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
          // has finished). Not when the last ice survey point finished it: the tank is out on the
          // frozen lake, where stopping cracks the ice, so it keeps moving while she talks.
          const onIce = ev.bySurvey && !(game.operation && game.operation.operation.surveyKind === 'patrol');
          for (const line of global.RadioComms.script.areaSecured(game.operation, planetName())) {
            radio.say(line, { lockControls: !onIce });
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
        } else if (ev.type === 'bossArrived') {
          radio.say(global.RadioComms.script.bossArrived(ev.kind), { priority: 'high' });
        } else if (ev.type === 'surveyed') {
          const kind = game.operation && game.operation.operation.surveyKind;
          radio.say(global.RadioComms.script.surveyed(ev.point.name, ev.left, kind), { key: 'survey' });
        } else if (ev.type === 'feintSpotted') {
          radio.say(global.RadioComms.script.feintSpotted(ev.base.name, combat.feint.distance), { priority: 'high' });
        } else if (ev.type === 'feintDone') {
          radio.say(global.RadioComms.script.feintDone(ev.base.name));
        } else if (ev.type === 'iceCrack') {
          radio.say(global.RadioComms.script.iceCrack(), { key: 'ice', priority: 'high' });
        } else if (ev.type === 'iceBreak' && !ev.isPlayer) {
          radio.say(global.RadioComms.script.iceBreak(ev.tank.isAlly), { key: 'ice-break' });
        } else if (ev.type === 'outOfAmmo') {
          radio.say(global.RadioComms.script.outOfAmmo(), { key: 'ammo', priority: 'high' });
        } else if (ev.type === 'ambush') {
          radio.say(global.RadioComms.script.ambush(), { key: 'ambush', priority: 'high' });
        } else if (ev.type === 'iedSpotted') {
          radio.say(global.RadioComms.script.iedSpotted(), { key: 'ied' });
        } else if (ev.type === 'iedBlast') {
          radio.say(global.RadioComms.script.iedBlast(), { key: 'ied', priority: 'high' });
        } else if (ev.type === 'iedCleared') {
          radio.say(global.RadioComms.script.iedCleared(), { key: 'ied' });
        } else if (ev.type === 'escortMet') {
          radio.say(global.RadioComms.script.escortMet(ev.escort), { priority: 'high' });
        } else if (ev.type === 'escortDone') {
          radio.say(global.RadioComms.script.escortDone(ev.escort));
        } else if (ev.type === 'escortLost') {
          radio.say(global.RadioComms.script.escortLost(ev.escort), { priority: 'high' });
        } else if (ev.type === 'powerDown') {
          radio.say(global.RadioComms.script.powerDown(ev.count), { priority: 'high' });
        } else if (ev.type === 'siteAppears') {
          radio.say(global.RadioComms.script.siteAppears(ev.base.name), { priority: 'high' });
        } else if (ev.type === 'civilLost') {
          const support = global.Campaign.supportAfter(combat.civilLost);
          radio.say(global.RadioComms.script.civilLost(ev.count, support), { key: 'civil' });
        } else if (ev.type === 'fuelBlast') {
          radio.say(global.RadioComms.script.fuelBlast(), { key: 'fuel' });
        }
      }
    }

    // ---- Return to the operations HQ ------------------------------------------------------------
    // Capturing the last compound doesn't end the sortie: Mio orders the platoon home and the
    // player drives back. Entering the painted circle on the HQ pad reports in (controls lock
    // while Mio confirms), and the after-action report follows (checkEnd).
    function checkReturnToHq() {
      const player = game.player;
      if (combat.sweep) return; // a sweep ends where the last compound falls (checkEnd)
      if (!combat.missionComplete || game.returnedToHq || !player.alive) return;
      if (radio.controlsLocked) return; // Mio is still reporting the secured planet
      // An operation that ends where it is fought (operation.endInPlace: e.g. holding a captured
      // city until the main force arrives): no drive home, the report follows Mio's lines
      if (game.operation && game.operation.operation.endInPlace) {
        game.returnedToHq = true;
        combat.stats.returnClock = combat.stats.endClock;
        return;
      }
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
      // Sweep: the record of the run once Mio has reported the last wave, or as soon as the tank is lost
      if (combat.sweep) {
        if (!game.started || game.overShown) return;
        if (!player.alive) {
          if (combat.lossSequenceDone()) showSweepResult(false);
        }
        else if (combat.sweep.phase === 'done' && radio.isIdle) showSweepResult(true);
        return;
      }
      // Back at the HQ with the planet secured: the after-action report, once Mio has finished
      if (game.started && !game.overShown && player.alive && game.returnedToHq && radio.isIdle) {
        game.overShown = true;
        game.input.release();
        // Progress, experience, wear and what is left of the platoon carry over to the next
        // operation; the next stage of the planet's campaign opens (js/campaign.js)
        const stats = combat.stats;
        const ranking = global.ResultsReport.computeRank(stats, player.maxHp);
        // The medal for this rank is presented on the planet select after the report
        const award = game.operation ? {
          rank: ranking.rank,
          score: ranking.score,
          planetName: game.operation.planet.name,
          operationName: game.operation.operation.name,
          prevRank: global.Campaign.bestRank(game.operation.operation.id)
        } : null;
        const carry = game.operation ? global.Campaign.recordSuccess({
          opId: game.operation.operation.id,
          rank: ranking.rank,
          kills: stats.killsBy.player + stats.killsBy.ally,
          alliesLost: stats.alliesLost,
          alliesLeft: combat.allies.filter((a) => a.alive).length,
          damageRatio: stats.damageTaken / Math.max(1, player.maxHp),
          scrap: combat.scrap,
          civilLost: combat.civilLost,
          collaborator: combat.escort ? combat.escort.stage === 'done' : null,
          last: game.operation.operation.id === 'castra-3'
        }) : null;
        results.open({ stats, combat, squad, player, world, audio, planetName: planetName(), carry }, () => start({ award }));
      }

      // Tank destroyed (once the blast and the burning wreck have played out, js/combat/wreck.js)
      if (game.started && !game.overShown && !player.alive && combat.lossSequenceDone()) {
        game.overShown = true;
        const victory = false;
        const badge = document.getElementById('gameover-badge');
        badge.textContent = victory ? 'MISSION COMPLETE' : player.sunk ? 'TANK LOST' : 'TANK DESTROYED';
        badge.classList.toggle('danger', !victory);
        badge.classList.toggle('success', victory);
        document.getElementById('gameover-title').textContent = victory
          ? L(`${planetName()} 制圧 — 全${combat.bases.length}拠点を制圧`, `${planetName()} secured — all ${combat.bases.length} compounds taken`)
          : player.sunk ? L('氷が割れて水没 — MISSION FAILED', 'Sank through the ice — MISSION FAILED') : L('車体大破 — MISSION FAILED', 'Tank Destroyed — MISSION FAILED');
        document.getElementById('gameover-summary').textContent = failureSummary();
        document.getElementById('btn-restart').textContent = victory ? L('もう一度出撃する', 'Sortie again') : L('新車両で再出撃する', 'Sortie again in a new tank');
        document.getElementById('gameover-laps').hidden = true; // (sweep lap times only)
        gameoverDialog.showModal();
      }
    }

    // Repairs / replacements / equipment changed on the briefing: refit the platoon on the HQ pad
    function refitPlatoon() {
      const selection = game.operation;
      const campaign = global.Campaign;
      // (a sweep: fresh tank, full platoon, no scrap — see resetSortie)
      const sweep = !!(selection && selection.operation.sweep);
      const allies = sweep ? campaign.maxAllies : campaign.allies;
      global.GameLoadout.set(selection ? campaign.equipment(selection.planet) : [], sweep ? 0 : campaign.wear);
      combat.scrap = sweep ? 0 : campaign.scrap;
      if (squad.allies.length !== allies) squad.reset(game.player, allies);
      applyTuning(true);
    }

    return { start, applyTuning, refitPlatoon, handleCombatEvents, checkSupplyDepots, checkReturnToHq, checkEnd, togglePause };
  }

  global.GameMission = { create, SUPPLY_ZONE };
})(window);
