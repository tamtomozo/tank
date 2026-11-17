(function (global) {
  'use strict';

  // HUD panels (status, HP bar, scrap, boss banner) and the reload / boost rings on the touch buttons.
  // Values are written through dirty-checked setters so the DOM is only touched when they change.
  // Bars read CSS variables (--hp-ratio, --boost-ratio, ... see css/hud.css, css/touch.css) set on the
  // bar element itself: set on <html> they made the browser re-style the whole page every frame.
  // The bars follow every frame (frame()); the texts are refreshed about 10 times a second, since
  // each change lays the panels out again.

  const TEXT_INTERVAL_MS = 100;
  // The status panels and radar hide while the player drives / boosts / fires, so more of the
  // battlefield shows, and come back once nothing has been done for this long
  const HUD_REVEAL_IDLE_MS = 2000;

  function create(game) {
    const { world, combat, squad } = game;

    // Cached HUD element refs + dirty-checked writes: only touch the DOM when a value actually changes
    const styleOf = (id) => document.getElementById(id).style;
    // Reload / boost: shown only as rings around the on-screen buttons on phones (css/touch.css)
    const touchBtn = (action) => {
      const el = global.GameQuality.touch ? document.querySelector(`.touch-btn[data-touch="${action}"]`) : null;
      return el ? [el.style] : [];
    };
    const varStyle = {
      '--hp-ratio': [styleOf('hud-hp-fill')],
      '--hp-hue': [styleOf('hud-hp-fill')],
      '--boost-ratio': touchBtn('boost'),
      '--reload-ratio': touchBtn('fire'),
      '--boss-hp-ratio': [styleOf('boss-hp-fill')],
      '--damage-alpha': [styleOf('damage-vignette')]
    };

    const hudEl = {
      objective: document.getElementById('hud-objective'),
      clock: document.getElementById('hud-clock'),
      squad: document.getElementById('hud-squad'),
      coords: document.getElementById('hud-coords'),
      hpText: document.getElementById('hud-hp-text'),
      scrap: document.getElementById('hud-scrap'),
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

    // <html class="hud-concealed"> while the player is acting (css/hud.css fades the panels out)
    let lastActionAt = -Infinity;
    let concealed = false;
    function updateConcealed(now, playing) {
      if (playing && game.playerActing) lastActionAt = now;
      const hide = playing && now - lastActionAt < HUD_REVEAL_IDLE_MS;
      if (hide !== concealed) {
        concealed = hide;
        document.documentElement.classList.toggle('hud-concealed', hide);
      }
    }

    // Once per frame: bars every time, texts when TEXT_INTERVAL_MS has passed (now = frame time in ms).
    // playing: the battle is running (no menu / pause): only then may the HUD hide.
    function frame(timeInfo, now, playing = true) {
      updateConcealed(now, playing);
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

      // Operation picked on the sortie-select screen (js/data/operations.js)
      const op = game.operation ? game.operation.operation : null;
      setText(hudEl.objective, op ? `作戦「${op.name}」` : '—');
      setText(hudEl.clock, `DAY ${timeInfo.day} ${timeInfo.clockText}`);
      if (hudEl.squad) setText(hudEl.squad, `${squad.size}/${squad.maxSize}`);
      setText(hudEl.coords, `X: ${Math.round(player.x)} / Y: ${Math.round(player.y)}`);
      setText(hudEl.hpText, `${Math.ceil(player.hp)} / ${player.maxHp}`);
      setText(hudEl.scrap, String(combat.scrap));
    }

    return { update, frame };
  }

  global.GameHud = { create };
})(window);
