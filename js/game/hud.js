(function (global) {
  'use strict';

  // HUD panels (status, HP / boost bars, scrap, weapons, boss banner).
  // Values are written through dirty-checked setters so the DOM is only touched when they change.
  // Bars read CSS variables on <html> (--hp-ratio, --boost-ratio, ... see css/hud.css).

  function create(game) {
    const { world, combat, squad, upgrades } = game;

    // Cached HUD element refs + dirty-checked writes: only touch the DOM when a value actually changes
    const rootStyle = document.documentElement.style;
    const hudEl = {
      objective: document.getElementById('hud-objective'),
      clock: document.getElementById('hud-clock'),
      enemies: document.getElementById('hud-enemies'),
      kills: document.getElementById('hud-kills'),
      squad: document.getElementById('hud-squad'),
      coords: document.getElementById('hud-coords'),
      hpText: document.getElementById('hud-hp-text'),
      boostText: document.getElementById('hud-boost-text'),
      scrap: document.getElementById('hud-scrap'),
      cannonName: document.getElementById('hud-cannon-name'),
      reloadText: document.getElementById('hud-reload-text'),
      subName: document.getElementById('hud-sub-name'),
      subText: document.getElementById('hud-sub-text'),
      bossBanner: document.getElementById('boss-banner')
    };
    const lastText = new Map();
    const setText = (el, text) => {
      if (lastText.get(el) !== text) {
        lastText.set(el, text);
        el.textContent = text;
      }
    };
    const lastVar = new Map();
    const setVar = (name, value) => {
      if (lastVar.get(name) !== value) {
        lastVar.set(name, value);
        rootStyle.setProperty(name, value);
      }
    };

    function update(timeInfo = world.getTimeInfo()) {
      const player = game.player;
      const hpRatio = Math.max(0, Math.min(1, player.hp / player.maxHp));
      const boostRatio = Math.max(0, Math.min(1, player.boostEnergy / player.maxBoost));
      const reloadRatio = player.reloadTime > 0
        ? Math.max(0, Math.min(1, 1 - player.reloadTimer / player.reloadTime))
        : 1;

      setVar('--hp-ratio', hpRatio.toFixed(3));
      setVar('--hp-hue', String(Math.round(hpRatio * 125)));
      setVar('--boost-ratio', boostRatio.toFixed(3));
      setVar('--reload-ratio', reloadRatio.toFixed(3));
      setVar('--damage-alpha', (combat.damageFlash * 0.85).toFixed(3));

      const curDistrict = combat.currentDistrict;
      const securedCount = combat.districtsSecured;
      const districtTotal = combat.districts.length;
      // Between "district secured" and Mio finishing her report, the next district is still locked
      const awaitingDistrict = !curDistrict ? combat.districts.find((d) => !d.unlocked) : null;
      // Area secured: the objective becomes the drive back to the operations HQ
      let returnText = '';
      if (combat.missionComplete) {
        const hqDist = Math.hypot(world.deltaX(player.x, world.hq.x), world.deltaY(player.y, world.hq.y));
        returnText = game.returnedToHq
          ? 'エリア1 制圧完了 — 作戦本部に帰還'
          : `エリア1 制圧完了 — 作戦本部へ帰還せよ（距離 ${Math.round(hqDist / 10) * 10}）`;
      }
      setText(hudEl.objective, returnText || (curDistrict
        ? `${curDistrict.name} 拠点 残り ${combat.districtRemaining(curDistrict.id)}/${curDistrict.baseIds.length}（確保 ${securedCount}/${districtTotal}地区）`
        : awaitingDistrict
          ? `${awaitingDistrict.name} 解放待ち（確保 ${securedCount}/${districtTotal}地区）`
          : districtTotal ? `エリア1 制圧（${securedCount}/${districtTotal}地区）` : '—'));
      setText(hudEl.clock, `DAY ${timeInfo.day} ${timeInfo.clockText} ${timeInfo.phaseIcon}${timeInfo.phaseName}`);
      setText(hudEl.enemies, String(combat.enemies.length));
      setText(hudEl.kills, String(combat.kills));
      if (hudEl.squad) {
        setText(hudEl.squad,
          `${squad.size}/${squad.maxSize} ${squad.mode === 'engage' ? '散開・交戦' : '隊列'}`);
      }
      const hereD = combat.districts[world.districtAt(player.x)];
      const hereLabel = hereD
        ? `${hereD.name}${hereD.secured ? '（確保済み）' : hereD.unlocked ? '' : '（未解放）'}`
        : '';
      setText(hudEl.coords, `X: ${Math.round(player.x)} / Y: ${Math.round(player.y)}${hereLabel ? ` ／ 現在地: ${hereLabel}` : ''}`);
      setText(hudEl.hpText, `${Math.ceil(player.hp)} / ${player.maxHp}`);
      setText(hudEl.boostText, `${Math.round(boostRatio * 100)}%`);
      setText(hudEl.scrap, String(combat.scrap));

      setText(hudEl.cannonName, upgrades.getCannonName());
      setText(hudEl.reloadText,
        player.reloadTimer <= 0.02 ? 'READY' : `装填中 ${player.reloadTimer.toFixed(1)}s`);

      const subLv = upgrades.levels.subweapon;
      setText(hudEl.subName, upgrades.getSubWeaponName());
      if (subLv <= 0) {
        setVar('--sub-ratio', '0');
        setText(hudEl.subText, '地区確保時の部隊強化で解放');
      } else if (subLv <= 2) {
        const coolRatio = Math.max(0, Math.min(1, 1 - player.subHeat));
        setVar('--sub-ratio', coolRatio.toFixed(3));
        if (player.subOverheated) {
          const remSec = player.subHeat / 0.50;
          setText(hudEl.subText, `OVERHEAT 冷却中 ${remSec.toFixed(1)}s`);
        } else if (player.subHeat > 0.02) {
          setText(hudEl.subText, `HEAT ${Math.round(player.subHeat * 100)}%`);
        } else {
          setText(hudEl.subText, 'READY');
        }
      } else {
        const maxSubCd = Math.max(0.55, 1.0 - (subLv - 3) * 0.2);
        const subRatio = player.subCooldown <= 0.01 ? 1 : Math.max(0, 1 - player.subCooldown / maxSubCd);
        setVar('--sub-ratio', subRatio.toFixed(3));
        setText(hudEl.subText,
          player.subCooldown <= 0.01 ? 'READY' : `COOLING ${player.subCooldown.toFixed(1)}s`);
      }


      const boss = combat.enemies.find((e) => e.alive && e.kind === 'boss');
      if (boss) {
        if (hudEl.bossBanner.hidden) hudEl.bossBanner.hidden = false;
        setVar('--boss-hp-ratio', Math.max(0, boss.hp / boss.maxHp).toFixed(3));
      } else if (!hudEl.bossBanner.hidden) {
        hudEl.bossBanner.hidden = true;
      }
    }

    return { update };
  }

  global.GameHud = { create };
})(window);
