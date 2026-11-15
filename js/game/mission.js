(function (global) {
  'use strict';

  // Mission flow: (re)starting a sortie, Mio's radio reports on combat events, supply depots in
  // secured districts (garage + resupply) and the end of the sortie (after-action report / game over).

  function create(game) {
    const { world, combat, upgrades, squad, radio, results, briefing, audio } = game;
    const { start: startDialog, garage: garageDialog, gameover: gameoverDialog } = game.dialogs;

    // New sortie: fresh tank, upgrades, world, platoon and clock, then the briefing
    function start() {
      audio.init();
      upgrades.reset();
      const player = new global.Tank2D(world, {
        isPlayer: true,
        x: world.width * 0.5,
        y: world.height * 0.5,
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
    // Supply and upgrades are only available once a whole district is secured. Driving into one of
    // its compounds opens the garage (upgrades + free resupply), once per visit (leave to re-arm).
    // Compounds in a district still being fought over offer nothing; there is no automatic resupply.
    const SUPPLY_PROMPT_RADIUS = 170;
    const SUPPLY_REARM_RADIUS = 280;

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

    // End of the sortie, checked every frame
    function checkEnd() {
      const player = game.player;
      // Area secured: the after-action report, once Mio has finished her final transmission
      if (game.started && !game.overShown && player.alive && combat.missionComplete && radio.isIdle) {
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

    return { start, handleCombatEvents, checkSupplyDepots, checkEnd };
  }

  global.GameMission = { create };
})(window);
