(function (global) {
  'use strict';

  // Mission flow: (re)starting a sortie at the operations HQ, Mio's radio reports on combat events,
  // supply depots in secured districts (garage + resupply), the drive back to the HQ once the area
  // is secured and the end of the sortie (after-action report / game over).

  // Supply-depot trigger zone around a captured compound's white flag (the compound centre)
  const SUPPLY_ZONE = {
    SUPPLY_PROMPT_RADIUS: 60, // tank centre within this distance of the flag opens the menu
    SUPPLY_REARM_RADIUS: 110 // leave beyond this to be offered the menu again
  };

  function create(game) {
    const { world, combat, upgrades, squad, radio, results, briefing, audio } = game;
    const { start: startDialog, garage: garageDialog, gameover: gameoverDialog } = game.dialogs;

    // New sortie: fresh tank on the HQ pad, upgrades, world, platoon and clock, then the briefing
    function start() {
      audio.init();
      upgrades.reset();
      const player = new global.Tank2D(world, {
        isPlayer: true,
        x: world.hq.x,
        y: world.hq.y,
        hullAngle: -Math.PI * 0.5
      });
      game.player = player;
      player.applyPlayerUpgrades(upgrades.levels);
      // Respawn destroyed crates/barrels and clear old decals so a restart is a genuinely fresh run
      world.resetDynamic();
      combat.reset(player);
      radio.clear();
      squad.reset(player, upgrades.levels);
      world.dayTime = 0.30;
      world.dayCount = 1;
      game.cam.x = player.x;
      game.cam.y = player.y;
      game.cam.starOffsetX = 0;
      game.started = true;
      game.overShown = false;
      game.returnedToHq = false;
      game.input.release();
      // Briefing first (the game stays paused while it is open); the tactical phase and Mio's
      // mission-start report begin once it is closed with 作戦開始.
      briefing.open(() => {
        radio.say(global.RadioComms.script.missionStart(
          combat.districts.length ? combat.districts[0].name : null,
          combat.districts.length
        ));
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

    // ---- Supply depots: compounds in a SECURED district ---------------------------------------
    // Supply and upgrades are only available once a whole district is secured. Driving onto the
    // white flag of one of its compounds opens the garage (upgrades + free resupply), once per visit
    // (drive off the flag zone to re-arm). The zone is drawn as a ring around the flag (render.js).
    // Compounds in a district still being fought over offer nothing; there is no automatic resupply.
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
          const district = combat.districts[b.districtId];
          if (!district || !district.secured) continue; // district not secured yet: no supply here
          if (inCombat) {
            if (!b.supplyBlockedNotified) {
              b.supplyBlockedNotified = true;
              radio.say(global.RadioComms.script.supplyBlocked(b.name), { key: 'supply-blocked' });
            }
            continue;
          }
          b.supplyArmed = false; // once per visit
          openUpgradeMenu(`拠点 ${b.name}（${district.name}・確保済み）— 部隊強化・補給`, { depotSupply: true });
        }
      }
    }

    // Platoon upgrade menu (garage): opened when entering a compound in a secured district
    function openUpgradeMenu(title, options = {}) {
      const player = game.player;
      if (!player.alive || garageDialog.open || gameoverDialog.open) return;
      game.input.release();
      document.getElementById('garage-title').textContent = title;
      upgrades.open(player, combat, () => {
        squad.applyUpgrades(upgrades.levels);
        game.hud.update();
      }, squad, options);
    }

    // Radio reports for what happened in combat this frame (compound alerted / captured, district secured)
    function handleCombatEvents() {
      for (const ev of combat.drainEvents()) {
        if (ev.type === 'alert') {
          radio.say(global.RadioComms.script.baseAlert(ev.base.name), { priority: 'high' });
        } else if (ev.type === 'cleared') {
          // Capture hauls in every scattered item (done in CombatManager); no automatic resupply
          ev.base.supplyArmed = false; // the depot menu is offered on the next visit (leave and return)
          radio.say(global.RadioComms.script.baseCaptured(ev.base.name));
        } else if (ev.type === 'districtSecured') {
          // No automatic upgrade menu: upgrades happen by entering a compound in a secured district.
          // Mio reports in steps (short result line, then details); the next district is unlocked
          // only after the last of those transmissions has finished.
          const next = ev.next;
          const nextDir = next ? world.districts[next.id].dir : '';
          const lines = global.RadioComms.script.districtSecured(ev.district.name, next ? next.name : null, nextDir);
          lines.forEach((line, i) => {
            const isLast = i === lines.length - 1;
            const opts = { lockControls: true };
            if (isLast && next) opts.onDone = () => combat.unlockDistrict(next.id, true);
            radio.say(line, opts);
          });
        }
      }
    }

    // ---- Return to the operations HQ ------------------------------------------------------------
    // Securing the last district doesn't end the sortie: Mio orders the platoon home and the
    // player drives back. Entering the painted circle on the HQ pad reports in (controls lock
    // while Mio confirms), and the after-action report follows (checkEnd).
    function checkReturnToHq() {
      const player = game.player;
      if (!combat.missionComplete || game.returnedToHq || !player.alive) return;
      if (radio.controlsLocked) return; // Mio is still reporting the secured area
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
      // Back at the HQ with the area secured: the after-action report, once Mio has finished
      if (game.started && !game.overShown && player.alive && game.returnedToHq && radio.isIdle) {
        game.overShown = true;
        game.input.release();
        results.open({ stats: combat.stats, combat, squad, player, world, audio }, () => start());
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
          ? `エリア1 制圧 — 全${combat.districts.length}地区を確保`
          : '車体大破 — MISSION FAILED';
        document.getElementById('gameover-summary').textContent =
          `確保した地区: ${combat.districtsSecured} / ${combat.districts.length} ／ 制圧した拠点: ${combat.bases.filter((b) => b.cleared).length} / ${combat.bases.length} ／ 撃破した敵戦車: ${combat.kills} 両 ／ 残存僚機: ${combat.allies.length} 両 ／ 獲得スクラップ残高: ${combat.scrap}`;
        document.getElementById('btn-restart').textContent = victory ? 'もう一度出撃する' : '新車両で再出撃する';
        gameoverDialog.showModal();
      }
    }

    return { start, handleCombatEvents, checkSupplyDepots, checkReturnToHq, checkEnd };
  }

  global.GameMission = { create, SUPPLY_ZONE };
})(window);
