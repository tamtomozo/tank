(function (global) {
  'use strict';

  // HUD panels (status, HP / boost bars, scrap, weapons, boss banner).
  // Values are written through dirty-checked setters so the DOM is only touched when they change.
  // Bars read CSS variables (--hp-ratio, --boost-ratio, ... see css/hud.css) that are set on the
  // bar element itself: set on <html> they made the browser re-style the whole page every frame.
  // The bars follow every frame (frame()); the texts are refreshed about 10 times a second, since
  // each change lays the panels out again.

  const TEXT_INTERVAL_MS = 100;

  function create(game) {
    const { world, combat, squad, tuning } = game;

    // Cached HUD element refs + dirty-checked writes: only touch the DOM when a value actually changes
    const styleOf = (id) => document.getElementById(id).style;
    // Phones also show reload / boost as rings around the on-screen buttons (css/touch.css)
    const touchBtn = (action) => {
      const el = global.GameQuality.touch ? document.querySelector(`.touch-btn[data-touch="${action}"]`) : null;
      return el ? [el.style] : [];
    };
    const varStyle = {
      '--hp-ratio': [styleOf('hud-hp-fill')],
      '--hp-hue': [styleOf('hud-hp-fill')],
      '--boost-ratio': [styleOf('hud-boost-fill'), ...touchBtn('boost')],
      '--reload-ratio': [styleOf('hud-reload-fill'), ...touchBtn('fire')],
      '--sub-ratio': [styleOf('hud-sub-fill'), ...touchBtn('sub')],
      '--boss-hp-ratio': [styleOf('boss-hp-fill')],
      '--damage-alpha': [styleOf('damage-vignette')]
    };
    const subTouchBtn = global.GameQuality.touch ? document.querySelector('.touch-btn[data-touch="sub"]') : null;
    let subEmpty = null;
    const hudEl = {
      area: document.getElementById('hud-area'),
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
        for (const style of varStyle[name]) style.setProperty(name, value);
      }
    };

    let lastTextAt = -Infinity;

    // Once per frame: bars every time, texts when TEXT_INTERVAL_MS has passed (now = frame time in ms)
    function frame(timeInfo, now) {
      updateBars();
      if (now - lastTextAt >= TEXT_INTERVAL_MS || now < lastTextAt) {
        lastTextAt = now;
        updateTexts(timeInfo);
      }
    }

    // Everything at once (after a change made while the game is paused: tuning, depot, restart)
    function update(timeInfo = world.getTimeInfo()) {
      updateBars();
      updateTexts(timeInfo);
    }

    function updateBars() {
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

      const subLv = player.subLevel;
      if (subLv <= 0) {
        setVar('--sub-ratio', '0');
      } else if (subLv <= 2) {
        setVar('--sub-ratio', Math.max(0, Math.min(1, 1 - player.subHeat)).toFixed(3));
      } else {
        const maxSubCd = Math.max(0.55, 1.0 - (subLv - 3) * 0.2);
        const subRatio = player.subCooldown <= 0.01 ? 1 : Math.max(0, 1 - player.subCooldown / maxSubCd);
        setVar('--sub-ratio', subRatio.toFixed(3));
      }

      const boss = combat.enemies.find((e) => e.alive && e.kind === 'boss');
      if (boss) {
        if (hudEl.bossBanner.hidden) hudEl.bossBanner.hidden = false;
        setVar('--boss-hp-ratio', Math.max(0, boss.hp / boss.maxHp).toFixed(3));
      } else if (!hudEl.bossBanner.hidden) {
        hudEl.bossBanner.hidden = true;
      }
    }

    function updateTexts(timeInfo) {
      const player = game.player;
      const boostRatio = Math.max(0, Math.min(1, player.boostEnergy / player.maxBoost));

      const curDistrict = combat.currentDistrict;
      const securedCount = combat.districtsSecured;
      const districtTotal = combat.districts.length;
      // Between "district secured" and Mio finishing her report, the next district is still locked
      const awaitingDistrict = !curDistrict ? combat.districts.find((d) => !d.unlocked) : null;
      // Area secured: the objective becomes the drive back to the operations HQ
      const area = game.operation ? game.operation.area : null;
      const areaName = area ? area.name : 'エリア1';
      if (area && hudEl.area) setText(hudEl.area, area.code);
      let returnText = '';
      if (combat.missionComplete) {
        const hqDist = Math.hypot(world.deltaX(player.x, world.hq.x), world.deltaY(player.y, world.hq.y));
        returnText = game.returnedToHq
          ? `${areaName} 制圧完了 — 作戦本部に帰還`
          : `${areaName} 制圧完了 — 作戦本部へ帰還せよ（距離 ${Math.round(hqDist / 10) * 10}）`;
      }
      setText(hudEl.objective, returnText || (curDistrict
        ? `${curDistrict.name} 拠点 残り ${combat.districtRemaining(curDistrict.id)}/${curDistrict.baseIds.length}（確保 ${securedCount}/${districtTotal}地区）`
        : awaitingDistrict
          ? `${awaitingDistrict.name} 解放待ち（確保 ${securedCount}/${districtTotal}地区）`
          : districtTotal ? `${areaName} 制圧（${securedCount}/${districtTotal}地区）` : '—'));
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

      setText(hudEl.cannonName, tuning.cannonName());
      setText(hudEl.reloadText,
        player.reloadTimer <= 0.02 ? 'READY' : `装填中 ${player.reloadTimer.toFixed(1)}s`);

      const subLv = player.subLevel;
      setText(hudEl.subName, tuning.subWeaponName());
      if (subTouchBtn && subEmpty !== (subLv <= 0)) {
        subEmpty = subLv <= 0;
        subTouchBtn.classList.toggle('is-empty', subEmpty);
      }
      if (subLv <= 0) {
        setText(hudEl.subText, '未装備');
      } else if (subLv <= 2) {
        if (player.subOverheated) {
          const remSec = player.subHeat / 0.50;
          setText(hudEl.subText, `OVERHEAT 冷却中 ${remSec.toFixed(1)}s`);
        } else if (player.subHeat > 0.02) {
          setText(hudEl.subText, `HEAT ${Math.round(player.subHeat * 100)}%`);
        } else {
          setText(hudEl.subText, 'READY');
        }
      } else {
        setText(hudEl.subText,
          player.subCooldown <= 0.01 ? 'READY' : `COOLING ${player.subCooldown.toFixed(1)}s`);
      }
    }

    return { update, frame };
  }

  global.GameHud = { create };
})(window);
