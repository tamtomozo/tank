(function (global) {
  'use strict';

  // HUD panels (status, HP bar, scrap, boss banner) and the reload ring on the touch fire button.
  // Values are written through dirty-checked setters so the DOM is only touched when they change.
  // Bars read CSS variables (--hp-ratio, --reload-ratio, ... see css/hud.css, css/touch.css) set on the
  // bar element itself: set on <html> they made the browser re-style the whole page every frame.
  // The bars follow every frame (frame()); the texts are refreshed about 10 times a second, since
  // each change lays the panels out again.

  const TEXT_INTERVAL_MS = 100;
  // The status panels and radar hide while the player drives / fires, so more of the
  // battlefield shows, and come back once nothing has been done for this long
  const HUD_REVEAL_IDLE_MS = 2000;

  function create(game) {
    const { world, combat, squad } = game;

    // Cached HUD element refs + dirty-checked writes: only touch the DOM when a value actually changes
    const styleOf = (id) => document.getElementById(id).style;
    // Reload: shown only as a ring around the on-screen fire button on phones (css/touch.css)
    const touchBtn = (action) => {
      const el = global.GameQuality.touch ? document.querySelector(`.touch-btn[data-touch="${action}"]`) : null;
      return el ? [el.style] : [];
    };
    const varStyle = {
      '--hp-ratio': [styleOf('hud-hp-fill')],
      '--hp-hue': [styleOf('hud-hp-fill')],
      '--reload-ratio': touchBtn('fire'),
      '--boss-hp-ratio': [styleOf('boss-hp-fill')],
      '--hold-ratio': [styleOf('hold-fill')],
      '--damage-alpha': [styleOf('damage-vignette')]
    };

    const hudEl = {
      objective: document.getElementById('hud-objective'),
      clock: document.getElementById('hud-clock'),
      squad: document.getElementById('hud-squad'),
      coords: document.getElementById('hud-coords'),
      hpText: document.getElementById('hud-hp-text'),
      scrap: document.getElementById('hud-scrap'),
      bossBanner: document.getElementById('boss-banner'),
      holdBanner: document.getElementById('hold-banner'),
      holdText: document.getElementById('hold-text'),
      goals: document.getElementById('hud-goals')
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
      const reloadRatio = player.reloadTime > 0
        ? Math.max(0, Math.min(1, 1 - player.reloadTimer / player.reloadTime))
        : 1;

      setVar('--hp-ratio', hpRatio.toFixed(3));
      setVar('--hp-hue', String(Math.round(hpRatio * 125)));
      setVar('--reload-ratio', reloadRatio.toFixed(3));
      setVar('--damage-alpha', (combat.damageFlash * 0.85).toFixed(3));

      const boss = combat.enemies.find((e) => e.alive && e.isBoss);
      if (boss) {
        if (hudEl.bossBanner.hidden) hudEl.bossBanner.hidden = false;
        setVar('--boss-hp-ratio', Math.max(0, boss.hp / boss.maxHp).toFixed(3));
      } else if (!hudEl.bossBanner.hidden) {
        hudEl.bossBanner.hidden = true;
      }

      // Hold-the-area objective: time held so far
      const hold = combat.hold;
      const holding = !!(hold && hold.active && !hold.done);
      if (hudEl.holdBanner.hidden === holding) hudEl.holdBanner.hidden = !holding;
      if (holding) setVar('--hold-ratio', (hold.progress / hold.duration).toFixed(3));
    }

    function updateTexts(timeInfo) {
      const player = game.player;

      // Operation picked on the sortie-select screen (js/data/operations.js)
      const op = game.operation ? game.operation.operation : null;
      setText(hudEl.objective, op ? L(`作戦「${op.name}」`, `Op. "${op.name}"`) : '—');
      setText(hudEl.clock, `DAY ${timeInfo.day} ${timeInfo.clockText}`);
      if (hudEl.squad) setText(hudEl.squad, `${squad.size}/${squad.maxSize}`);
      setText(hudEl.coords, `X: ${Math.round(player.x)} / Y: ${Math.round(player.y)}`);
      setText(hudEl.hpText, `${Math.ceil(player.hp)} / ${player.maxHp}`);
      setText(hudEl.scrap, String(combat.scrap));

      const hold = combat.hold;
      if (hold && hold.active && !hold.done) {
        const left = Math.ceil(hold.duration - hold.progress);
        setText(hudEl.holdText, hold.inside
          ? L(`${hold.banner || '封鎖中 — 完了まで'} ${left} 秒`, `${hold.banner || 'Holding — until done'} ${left} s`)
          : L(`円の外！ 戻れ（残り ${left} 秒で停止中）`, `Outside the circle! Get back (stopped at ${left} s)`));
        hudEl.holdBanner.classList.toggle('is-outside', !hold.inside);
      }

      setText(hudEl.goals, goalsText());
    }

    // The operation's objectives, one per line, ✔ once met
    function goalsText() {
      if (!combat.operation) return '';
      const lines = [];
      const tick = (done, text) => lines.push(`${done ? '✔' : '□'} ${text}`);
      // Sweep operation: the wave, the run so far and the lap clock (js/combat/sweep.js)
      const s = combat.sweep;
      if (s) {
        const fmt = global.Sweep.formatTime;
        const wave = s.round + 1;
        if (s.phase === 'fight') {
          const n = combat.bases.filter((b) => b.cleared).length;
          tick(false, L(`第${wave}/${s.rounds}波 拠点制圧 ${n}/${combat.bases.length}`, `Wave ${wave}/${s.rounds}: compounds ${n}/${combat.bases.length}`));
        } else {
          tick(true, L(`第${wave}/${s.rounds}波 制圧完了`, `Wave ${wave}/${s.rounds} cleared`));
        }
        if (s.phase === 'rest' && s.restBase) {
          tick(false, L(`${s.restBase.name}の白旗で 回復／次の波へ`, `Recover / next wave at ${s.restBase.name}'s flag`));
        }
        lines.push(L(`総制圧 ${s.captured}/${s.total}`, `Total ${s.captured}/${s.total}`));
        const lap = s.phase === 'fight' ? s.lap : s.laps[s.laps.length - 1] || 0;
        lines.push(`LAP ${fmt(lap)} ／ TOTAL ${fmt(combat.sweepTime)}`);
        return lines.join('\n');
      }
      const required = combat.bases.filter((b) => !b.optional);
      if (required.length > 0) {
        const n = required.filter((b) => b.cleared).length;
        tick(n === required.length, L(`拠点制圧 ${n}/${required.length}`, `Compounds ${n}/${required.length}`));
      }
      const f = combat.feint;
      if (f) {
        const name = combat.bases[f.site].name;
        tick(f.done, f.spotted || f.done
          ? L(`陽動：${name}から${f.distance}引き離す`, `Feint: pull ${f.distance} away from ${name}`)
          : L(`陽動：${name}に発見される`, `Feint: get spotted by ${name}`));
      }
      if (combat.survey) {
        const n = combat.survey.filter((p) => p.done).length;
        const label = combat.operation.surveyKind === 'patrol' ? L('市街の巡回', 'City patrol') : L('氷上偵察', 'Ice survey');
        tick(n === combat.survey.length, `${label} ${n}/${combat.survey.length}`);
      }
      const esc = combat.escort;
      if (esc) {
        if (esc.stage === 'lost') lines.push(L(`✖ ${esc.name}を失った`, `✖ Lost ${esc.name}`));
        else if (esc.stage === 'meet') tick(false, L(`${esc.name}と合流（${esc.meet.name}）`, `Meet ${esc.name} (${esc.meet.name})`));
        else tick(esc.stage === 'done', L(`${esc.name}を${esc.to.name}へ護衛`, `Escort ${esc.name} to the ${esc.to.name}`));
      }
      const fin = combat.finale;
      if (fin) tick(fin.done, L(`${global.GameData.ENEMY_INFO[fin.kind].name}の撃破`, `Destroy the ${global.GameData.ENEMY_INFO[fin.kind].name}`));
      const hold = combat.hold;
      if (hold) tick(hold.done, L(`${hold.label || '周囲の封鎖'} ${hold.duration}秒`, `${hold.label || 'Hold the area'} ${hold.duration} s`));
      // Industrial planet: the people's cooperation, live (js/campaign.js)
      const planet = game.operation && game.operation.planet;
      if (planet && planet.hazards && planet.hazards.civilians) {
        lines.push(L(`住民の協力度 ${global.Campaign.supportAfter(combat.civilLost || 0)}%`, `Civilian support ${global.Campaign.supportAfter(combat.civilLost || 0)}%`));
      }
      return lines.join('\n');
    }

    return { update, frame };
  }

  global.GameHud = { create };
})(window);
