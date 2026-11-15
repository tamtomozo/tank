(function (global) {
  'use strict';

  // Fort icon marking enemy compounds. One SVG path (centred on 0,0, ~28x29 units) shared by the
  // in-world canvas icon, the radar and the off-screen DOM markers so they all look the same.
  // Body: two crenellated towers + crenellated curtain wall, gate cut out via even-odd fill.
  const FORT_BODY_D = 'M-14 10V-12H-12V-10H-9V-12H-7V-5H-5V-7H-2V-5H2V-7H5V-5H7V-12H9V-10H12V-12H14V10Z'
    + 'M-3.5 10V4A3.5 3.5 0 0 1 3.5 4V10Z';
  const FORT_POLE_D = 'M0 -5V-17';
  const FORT_FLAG_D = 'M0 -17L7 -14.5L0 -12Z';
  const FORT_SVG = '<svg viewBox="-17 -20 34 32" aria-hidden="true">'
    + `<path d="${FORT_POLE_D}" stroke="#fff" stroke-width="1.6" fill="none"/>`
    + `<path d="${FORT_FLAG_D}" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="${FORT_BODY_D}" fill="currentColor" fill-rule="evenodd" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`
    + '</svg>';

  let fortPaths = null;
  function getFortPaths() {
    if (!fortPaths) {
      fortPaths = {
        body: new Path2D(FORT_BODY_D),
        pole: new Path2D(FORT_POLE_D),
        flag: new Path2D(FORT_FLAG_D)
      };
    }
    return fortPaths;
  }

  // Draw the fort glyph centred at the current origin (caller sets translate/scale)
  function drawFortGlyph(c, fill, outline = '#ffffff', lineWidth = 1.8) {
    const fp = getFortPaths();
    c.lineJoin = 'round';
    c.strokeStyle = outline;
    c.lineWidth = lineWidth;
    c.stroke(fp.pole);
    c.fillStyle = fill;
    c.fill(fp.flag);
    c.stroke(fp.flag);
    c.fill(fp.body, 'evenodd');
    c.stroke(fp.body);
  }
  global.drawFortGlyph = drawFortGlyph; // shared with the briefing map

  function bootstrap() {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const radarCanvas = document.getElementById('radar-canvas');
    const radarCtx = radarCanvas.getContext('2d');

    const startDialog = document.getElementById('start-dialog');
    const garageDialog = document.getElementById('garage-dialog');
    const gameoverDialog = document.getElementById('gameover-dialog');
    const briefingDialog = document.getElementById('briefing-dialog');
    const resultsDialog = document.getElementById('results-dialog');

    let viewW = window.innerWidth;
    let viewH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resizeCanvas() {
      viewW = window.innerWidth;
      viewH = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewW * dpr);
      canvas.height = Math.floor(viewH * dpr);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const audio = new global.TankAudio();
    const world = new global.HorizonWorld();
    const combat = new global.CombatManager(world, audio);
    const upgrades = new global.UpgradeManager(garageDialog, audio);
    const squad = new global.SquadManager(world, combat);
    const radio = new global.RadioComms(document.getElementById('radio-panel'), audio);
    const results = new global.ResultsReport(resultsDialog);
    const briefing = new global.BriefingScene(briefingDialog, {
      world,
      combat,
      squad,
      upgrades,
      audio,
      getPlayer: () => player
    });

    let player = new global.Tank2D(world, {
      isPlayer: true,
      x: world.width * 0.5,
      y: world.height * 0.5,
      hullAngle: -Math.PI * 0.5
    });
    player.applyPlayerUpgrades(upgrades.levels);

    // Camera locked to player center so the tank sits at exact screen center
    let camX = player.x;
    let camY = player.y;
    let starOffsetX = 0;

    const keys = new Set();
    let mouseX = viewW * 0.5;
    let mouseY = viewH * 0.35;
    let mouseLDown = false;
    let mouseRDown = false;
    let aimWorld = { x: player.x, y: world.wrapY(player.y - 220) };
    let activeTarget = null;

    let gameStarted = false;
    let gameOverShown = false;
    let controlMode = 'tank'; // 'tank' (throttle + steer) | 'direct' (move in pressed direction)


    const startOrRestartGame = () => {
      audio.init();
      upgrades.reset();
      player = new global.Tank2D(world, {
        isPlayer: true,
        x: world.width * 0.5,
        y: world.height * 0.5,
        hullAngle: -Math.PI * 0.5
      });
      player.applyPlayerUpgrades(upgrades.levels);
      // Respawn destroyed crates/barrels and clear old decals so a restart is a genuinely fresh run
      world.resetDynamic();
      combat.reset(player);
      radio.clear();
      squad.reset(player, upgrades.levels);
      world.dayTime = 0.30;
      world.dayCount = 1;
      camX = player.x;
      camY = player.y;
      starOffsetX = 0;
      gameStarted = true;
      gameOverShown = false;
      keys.clear();
      mouseLDown = false;
      mouseRDown = false;
      // Briefing first (the game stays paused while it is open); the tactical phase and Mio's
      // mission-start report begin once it is closed with 作戦開始.
      briefing.open(() => {
        radio.say(global.RadioComms.script.missionStart(
          combat.districts.length ? combat.districts[0].name : null,
          combat.districts.length
        ));
      });
    };

    // The PLANET PANZER title window is no longer shown; the game starts straight into the briefing
    // (see the end of bootstrap). Audio is unlocked on the first user gesture instead of the DEPLOY click.
    const unlockAudio = () => {
      audio.init();
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    startDialog.addEventListener('close', () => {
      startDialog.returnValue = '';
      if (!gameStarted) startOrRestartGame();
    });

    gameoverDialog.addEventListener('close', () => {
      const val = gameoverDialog.returnValue;
      gameoverDialog.returnValue = '';
      if (val === 'restart') {
        startOrRestartGame();
      }
    });

    // ---- Supply depots: compounds in a SECURED district ---------------------------------------
    // Supply and upgrades are only available once a whole district is secured. Driving into one of
    // its compounds opens the garage (upgrades + free resupply), once per visit (leave to re-arm).
    // Compounds in a district still being fought over offer nothing; there is no automatic resupply.
    const SUPPLY_PROMPT_RADIUS = 170;
    const SUPPLY_REARM_RADIUS = 280;

    const checkSupplyDepots = () => {
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
    };

    const btnGarage = document.getElementById('btn-garage');
    const btnControlMode = document.getElementById('btn-control-mode');
    const btnStartMode = document.getElementById('btn-start-mode');
    const hudMoveHint = document.getElementById('hud-move-hint');
    const btnMute = document.getElementById('btn-mute');

    const syncControlModeUI = () => {
      const isDirect = controlMode === 'direct';
      if (btnControlMode) {
        btnControlMode.setAttribute('aria-pressed', String(isDirect));
        btnControlMode.classList.toggle('is-active', isDirect);
        btnControlMode.innerHTML = isDirect
          ? '🧭 方向移動 <kbd>C</kbd>'
          : '🎮 戦車操縦 <kbd>C</kbd>';
      }
      if (btnStartMode) {
        btnStartMode.setAttribute('aria-pressed', String(isDirect));
        btnStartMode.classList.toggle('is-active', isDirect);
        btnStartMode.textContent = isDirect
          ? '🧭 操縦: 押した方向移動'
          : '🎮 操縦: 戦車操縦';
      }
      if (hudMoveHint) {
        hudMoveHint.innerHTML = isDirect
          ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 押した方向へ移動'
          : '<kbd>W</kbd><kbd>S</kbd> 前後進 / <kbd>A</kbd><kbd>D</kbd> 超信地旋回';
      }
    };

    const toggleControlMode = () => {
      controlMode = controlMode === 'tank' ? 'direct' : 'tank';
      syncControlModeUI();
      if (gameStarted && !startDialog.open && !briefing.isOpen && !garageDialog.open && !gameoverDialog.open) {
        radio.say(global.RadioComms.script.controlMode(controlMode === 'direct'), { key: 'control-mode', priority: 'high' });
      }
    };
    syncControlModeUI();

    // Platoon upgrade menu: opened only at the moment a district is secured (once per district)
    const openUpgradeMenu = (title, options = {}) => {
      if (!player.alive || garageDialog.open || gameoverDialog.open) return;
      keys.clear();
      mouseLDown = false;
      mouseRDown = false;
      document.getElementById('garage-title').textContent = title;
      upgrades.open(player, combat, () => {
        squad.applyUpgrades(upgrades.levels);
        updateHUD();
      }, squad, options);
    };

    // U / Tab: only closes the menu; the menu opens on its own when entering a compound
    // in a secured district (or at the moment a district is secured)
    const toggleGarage = () => {
      if (!gameStarted || !player.alive) return;
      if (garageDialog.open) {
        upgrades.close();
      } else {
        radio.say(global.RadioComms.script.garageUnavailable(), { key: 'garage-hint' });
      }
    };

    btnGarage.addEventListener('click', () => {
      toggleGarage();
      btnGarage.blur();
    });

    if (btnControlMode) {
      btnControlMode.addEventListener('click', () => {
        toggleControlMode();
        btnControlMode.blur();
      });
    }

    if (btnStartMode) {
      btnStartMode.addEventListener('click', () => {
        toggleControlMode();
        btnStartMode.blur();
      });
    }

    btnMute.addEventListener('click', () => {
      audio.init();
      const nextMuted = !audio.muted;
      audio.setMuted(nextMuted);
      btnMute.setAttribute('aria-pressed', String(nextMuted));
      btnMute.textContent = nextMuted ? '🔇 消音' : '🔊 音声';
      btnMute.blur();
    });

    window.addEventListener('keydown', (e) => {
      if (briefing.isOpen || results.isOpen) return; // these screens handle their own keys
      const code = e.code;
      if (code === 'Tab' || code === 'KeyU') {
        e.preventDefault();
        if (!radio.controlsLocked) toggleGarage();
        return;
      }
      if (code === 'KeyC' && radio.controlsLocked) return; // don't cut into Mio's district report
      if (code === 'KeyC' && !garageDialog.open && !gameoverDialog.open) {
        toggleControlMode();
        return;
      }
      if (code === 'KeyM' && !garageDialog.open) {
        btnMute.click();
        return;
      }
      if (code === 'Space' && !startDialog.open && !garageDialog.open && !gameoverDialog.open) {
        e.preventDefault();
      }
      keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      keys.clear();
      mouseLDown = false;
      mouseRDown = false;
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('pointerdown', (e) => {
      audio.init();
      if (e.button === 0) mouseLDown = true;
      if (e.button === 2) mouseRDown = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) mouseLDown = false;
      if (e.button === 2) mouseRDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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
      bossBanner: document.getElementById('boss-banner'),
      indicators: document.getElementById('target-indicators')
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

    function updateHUD(timeInfo = world.getTimeInfo()) {
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
      setText(hudEl.objective, curDistrict
        ? `${curDistrict.name} 拠点 残り ${combat.districtRemaining(curDistrict.id)}/${curDistrict.baseIds.length}（確保 ${securedCount}/${districtTotal}地区）`
        : awaitingDistrict
          ? `${awaitingDistrict.name} 解放待ち（確保 ${securedCount}/${districtTotal}地区）`
          : districtTotal ? `エリア1 制圧（${securedCount}/${districtTotal}地区）` : '—');
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

    // Pooled off-screen enemy arrows (reused every frame instead of rebuilding DOM nodes)
    const arrowPool = [];

    const RADAR_RANGE = 1200; // world units from the player to the radar edge (local radar)

    function updateRadarAndIndicators(drawCamX, drawCamY) {
      const w = radarCanvas.width;
      const h = radarCanvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      radarCtx.clearRect(0, 0, w, h);

      let arrowsUsed = 0;
      // Local radar: the player is the centre and the edge is RADAR_RANGE world units away
      const scalePx = (cx - 6) / RADAR_RANGE;
      const toRadar = (x, y) => {
        const dx = world.deltaX(player.x, x);
        const dy = world.deltaY(player.y, y);
        return {
          rx: cx + dx * scalePx,
          ry: cy + dy * scalePx,
          dx,
          dy,
          inRange: Math.abs(dx) <= RADAR_RANGE && Math.abs(dy) <= RADAR_RANGE
        };
      };
      // Same direction, pinned to the radar border (for compounds outside the range)
      const toRadarEdge = (dx, dy) => {
        const f = RADAR_RANGE / (Math.max(Math.abs(dx), Math.abs(dy)) || 1);
        return { rx: cx + dx * f * scalePx, ry: cy + dy * f * scalePx };
      };

      // Off-screen directional marker toward world point (x, y), using the wrapped delta from the camera
      // glyph: text for rotating arrows; fort markers use the SVG icon and stay upright
      // (their position along the screen edge already shows the direction)
      const placeArrow = (x, y, cls, glyph, isFort = false) => {
        const proj = world.project(x, y, 0, drawCamX, drawCamY, viewW, viewH, true);
        const offScreen = !proj || proj.th > world.horizonTheta || proj.sx < 24 || proj.sx > viewW - 24 || proj.sy < 24 || proj.sy > viewH - 24;
        if (!offScreen) return;
        const ang = Math.atan2(world.deltaY(drawCamY, y), world.deltaX(drawCamX, x));
        const px = 50 + Math.cos(ang) * 44;
        const py = 50 + Math.sin(ang) * 42;
        const deg = isFort ? 0 : ang * (180 / Math.PI) + 90;
        let arrow = arrowPool[arrowsUsed];
        if (!arrow) {
          arrow = document.createElement('div');
          hudEl.indicators.appendChild(arrow);
          arrowPool.push(arrow);
        }
        arrowsUsed++;
        if (arrow.className !== cls) arrow.className = cls;
        const content = isFort ? 'fort' : glyph;
        if (arrow.dataset.content !== content) {
          arrow.dataset.content = content;
          if (isFort) arrow.innerHTML = FORT_SVG;
          else arrow.textContent = glyph;
        }
        arrow.style.display = '';
        arrow.style.left = `${px.toFixed(2)}%`;
        arrow.style.top = `${py.toFixed(2)}%`;
        arrow.style.setProperty('--arrow-deg', `${deg.toFixed(1)}deg`);
      };

      // District bands within range: locked ones darkened, secured ones tinted green, dashed borders
      // (each band is also tried one world-width either side so wrapped copies show up)
      for (const d of combat.districts) {
        const wd = world.districts[d.id];
        const fill = d.secured ? 'rgba(34, 197, 94, 0.13)' : d.unlocked ? null : 'rgba(2, 6, 23, 0.55)';
        const dx0 = world.deltaX(player.x, wd.x0);
        for (const k of [-1, 0, 1]) {
          const left = dx0 + k * world.width;
          if (left > RADAR_RANGE || left + wd.width < -RADAR_RANGE) continue;
          const px0 = cx + left * scalePx;
          if (fill) {
            radarCtx.fillStyle = fill;
            radarCtx.fillRect(px0, 0, wd.width * scalePx, h);
          }
          if (Math.abs(left) <= RADAR_RANGE) {
            radarCtx.strokeStyle = 'rgba(253, 230, 138, 0.5)';
            radarCtx.lineWidth = 1;
            radarCtx.setLineDash([3, 3]);
            radarCtx.beginPath();
            radarCtx.moveTo(px0, 0);
            radarCtx.lineTo(px0, h);
            radarCtx.stroke();
            radarCtx.setLineDash([]);
          }
        }
      }

      // Range rings (half and full range) and a faint crosshair
      radarCtx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      radarCtx.lineWidth = 1;
      radarCtx.beginPath();
      radarCtx.moveTo(cx, 0);
      radarCtx.lineTo(cx, h);
      radarCtx.moveTo(0, cy);
      radarCtx.lineTo(w, cy);
      radarCtx.stroke();
      for (const frac of [0.5, 1]) {
        radarCtx.beginPath();
        radarCtx.arc(cx, cy, (cx - 6) * frac, 0, Math.PI * 2);
        radarCtx.stroke();
      }

      // Compounds: fort icons (green once captured). Out of range -> small, faded, pinned to the border
      // so the direction to every known compound stays visible.
      for (const b of combat.bases) {
        if (b.locked) continue;
        const pos = toRadar(b.x, b.y);
        const at = pos.inRange ? pos : toRadarEdge(pos.dx, pos.dy);
        const iconScale = pos.inRange ? 0.36 : 0.26;
        radarCtx.save();
        radarCtx.globalAlpha = pos.inRange ? 1 : 0.7;
        radarCtx.translate(at.rx, at.ry);
        radarCtx.scale(iconScale, iconScale);
        drawFortGlyph(
          radarCtx,
          b.cleared ? '#22c55e' : b.alerted ? '#f97316' : '#ef4444', // green = captured supply depot
          'rgba(255, 255, 255, 0.85)',
          2.2
        );
        radarCtx.restore();
        if (!b.cleared) {
          placeArrow(b.x, b.y, 'target-arrow is-base' + (b.alerted ? ' is-alerted' : ''), '', true);
        }
      }

      // Wingmen within range as green dots
      radarCtx.fillStyle = '#4ade80';
      for (const a of combat.allies) {
        if (!a.alive) continue;
        const pos = toRadar(a.x, a.y);
        if (!pos.inRange) continue;
        radarCtx.beginPath();
        radarCtx.arc(pos.rx, pos.ry, 2.6, 0, Math.PI * 2);
        radarCtx.fill();
      }

      // Enemies within range: parked units dim, sortied units bright (sortied ones also get an off-screen arrow)
      for (const e of combat.enemies) {
        if (!e.alive) continue;
        const idle = e.state === 'idle';
        if (!idle) placeArrow(e.x, e.y, 'target-arrow', '\u25b2');
        const pos = toRadar(e.x, e.y);
        if (!pos.inRange) continue;
        radarCtx.fillStyle = idle ? 'rgba(239, 68, 68, 0.45)' : '#ef4444';
        radarCtx.beginPath();
        radarCtx.arc(pos.rx, pos.ry, idle ? 2.2 : 2.8, 0, Math.PI * 2);
        radarCtx.fill();
      }

      // Player heading arrow in the centre (drawn last so it is never covered)
      radarCtx.save();
      radarCtx.translate(cx, cy);
      radarCtx.rotate(player.hullAngle);
      radarCtx.fillStyle = '#38bdf8';
      radarCtx.beginPath();
      radarCtx.moveTo(7, 0);
      radarCtx.lineTo(-5, -4.5);
      radarCtx.lineTo(-5, 4.5);
      radarCtx.closePath();
      radarCtx.fill();
      radarCtx.restore();

      for (let i = arrowsUsed; i < arrowPool.length; i++) {
        if (arrowPool[i].style.display !== 'none') arrowPool[i].style.display = 'none';
      }
    }

    function findLookAtTarget() {
      let bestTarget = null;
      let bestDistSq = Infinity;

      const consider = (obj) => {
        if (!obj.alive) return;
        if (!world.isPointInHeadlightRange(
          obj.x, obj.y, obj.radius,
          player.x, player.y, player.hullAngle, player.cannonRange,
          camX, camY, viewW, viewH
        )) {
          return;
        }
        const dx = world.deltaX(player.x, obj.x);
        const dy = world.deltaY(player.y, obj.y);
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestTarget = obj;
        }
      };

      for (const e of combat.enemies) consider(e);
      for (const prop of world.props) consider(prop);

      return bestTarget;
    }

    function getBarrelForwardTarget(range = 340) {
      return {
        x: world.wrapX(player.x + Math.cos(player.turretAngle) * range),
        y: world.wrapY(player.y + Math.sin(player.turretAngle) * range)
      };
    }

    function drawAimReticleAndArc(drawCamX, drawCamY) {
      const targetPos = activeTarget ? { x: activeTarget.x, y: activeTarget.y } : getBarrelForwardTarget(340);
      const rp = world.project(targetPos.x, targetPos.y, 0, drawCamX, drawCamY, viewW, viewH);
      if (rp) {
        ctx.save();
        ctx.translate(rp.sx, rp.sy);
        ctx.scale(rp.scale, rp.scale * rp.tiltCos);
        if (activeTarget) {
          // Target Lock-On Diamond
          ctx.rotate(Math.PI * 0.25);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
          ctx.lineWidth = 2.4;
          ctx.strokeRect(-16, -16, 32, 32);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Straight-ahead turret aim ring
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Dotted parabolic trajectory arc from muzzle along turretAngle
      const muzzle = player.getMuzzleWorld();
      const dx = world.deltaX(muzzle.x, targetPos.x);
      const dy = world.deltaY(muzzle.y, targetPos.y);
      const dirX = Math.cos(player.turretAngle);
      const dirY = Math.sin(player.turretAngle);
      const isRail = player.cannonLevel >= 5;
      const gScale = isRail ? 0.3 : 1.0;
      // Same ballistic solution as CombatManager.fireMainCannon so the preview matches the real shell
      const launch = global.CombatManager.computeShellLaunch(muzzle.z, Math.hypot(dx, dy), player.shellSpeed, gScale);
      const T = launch.flightT;
      const vz0 = launch.vz;
      const gravity = global.CombatManager.SHELL_GRAVITY * gScale;

      ctx.fillStyle = activeTarget
        ? 'rgba(248, 113, 113, 0.8)'
        : isRail ? 'rgba(56, 189, 248, 0.55)' : 'rgba(251, 191, 36, 0.45)';
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * T;
        const px = world.wrapX(muzzle.x + dirX * player.shellSpeed * t);
        const py = world.wrapY(muzzle.y + dirY * player.shellSpeed * t);
        const pz = Math.max(0, muzzle.z + vz0 * t - 0.5 * gravity * t * t);
        const sp = world.project(px, py, pz, drawCamX, drawCamY, viewW, viewH);
        if (!sp) continue;
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, 2.2 * sp.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fort icon hovering above a compound centre, tethered to the ground by a dashed line.
    // Red while the garrison waits; pulses red/orange once the compound is on alert.
    function drawBaseFortIcon(base, p, timeSec) {
      const s = Math.max(1.1, Math.min(1.55, p.scale * 1.5));
      const bob = Math.sin(timeSec * 2.2 + base.id * 1.3) * 2.5;
      const iconY = p.sy - (84 * p.scale + 26) + bob;
      if (p.sx < -40 || p.sx > viewW + 40 || iconY < -40 || p.sy > viewH + 60) return;

      const pulse = base.alerted ? 0.5 + 0.5 * Math.sin(timeSec * 9) : 0;
      const fill = base.alerted
        ? `rgb(${Math.round(239 + (249 - 239) * pulse)}, ${Math.round(68 + (115 - 68) * pulse)}, ${Math.round(68 - (68 - 22) * pulse)})`
        : '#ef4444';

      ctx.save();
      // Tether from the icon down to the compound's ground point
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.sx, iconY + 12 * s);
      ctx.lineTo(p.sx, p.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Soft dark disc behind the icon for contrast on bright sand
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.beginPath();
      ctx.ellipse(p.sx, iconY - 3 * s, 21 * s, 18 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(p.sx, iconY);
      ctx.scale(s * (1 + pulse * 0.08), s * (1 + pulse * 0.08));
      drawFortGlyph(ctx, fill);

      // Compound name to the right of the icon
      ctx.font = '800 11px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeText(base.name, 17, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(base.name, 17, 2);
      ctx.restore();
    }

    function renderScene(timeSec, timeInfo) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Apply subtle camera shake
      const shakeX = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const shakeY = combat.shakeIntensity > 0.01 ? (Math.random() - 0.5) * combat.shakeIntensity * 14 : 0;
      const drawCamX = world.wrapX(camX + shakeX);
      const drawCamY = world.wrapY(camY + shakeY);

      world.drawBackdropAndGround(ctx, drawCamX, drawCamY, viewW, viewH, timeSec, starOffsetX);

      // Collect visible 2D entities and sort back-to-front by depth (dy)
      const renderQueue = [];

      // Off-viewport cull (vertical too: roughly half the wrapped map projects below the screen)
      const offView = (p, m) => p.sx < -m || p.sx > viewW + m || p.sy < -m || p.sy > viewH + m;

      for (const prop of world.props) {
        if (!prop.alive) continue;
        const p = world.project(prop.x, prop.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 60)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawProp(ctx, prop, p, timeSec) });
      }

      for (const obs of world.obstacles) {
        const p = world.project(obs.x, obs.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, obs.radius * 1.25 * p.scale + 20)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawObstacle(ctx, obs, p, drawCamX, drawCamY, viewW, viewH) });
      }

      for (const e of combat.enemies) {
        if (!e.alive) continue;
        const p = world.project(e.x, e.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 120)) continue;
        renderQueue.push({ dy: p.dy, draw: () => e.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
      }

      for (const a of combat.allies) {
        if (!a.alive) continue;
        const p = world.project(a.x, a.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 120)) continue;
        renderQueue.push({ dy: p.dy, draw: () => a.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
      }

      // White flags over captured enemy compounds
      for (const b of combat.bases) {
        if (!b.cleared) continue;
        const p = world.project(b.x, b.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p || offView(p, 110 * p.scale + 20)) continue;
        renderQueue.push({ dy: p.dy, draw: () => world.drawWhiteFlag(ctx, p, b.flagRaise || 0, timeSec) });
      }

      if (player.alive) {
        const p = world.project(player.x, player.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (p) {
          renderQueue.push({ dy: p.dy, draw: () => player.draw(ctx, drawCamX, drawCamY, viewW, viewH, timeInfo.nightFactor) });
        }
      }

      renderQueue.sort((a, b) => a.dy - b.dy);
      for (const item of renderQueue) {
        item.draw();
      }

      combat.drawEffectsAndPickups(ctx, drawCamX, drawCamY, viewW, viewH);
      world.drawHorizonHaze(ctx, viewW, viewH);

      const playerGroundProj = player.alive
        ? world.project(player.x, player.y, 0, drawCamX, drawCamY, viewW, viewH)
        : null;
      world.drawNightVisibility(
        ctx, playerGroundProj, player.hullAngle, player.cannonRange,
        player.x, player.y, drawCamX, drawCamY, viewW, viewH
      );

      // Fort icons floating over enemy-held compounds (UI layer: above the night darkness)
      for (const b of combat.bases) {
        if (b.cleared || b.locked) continue;
        const p = world.project(b.x, b.y, 0, drawCamX, drawCamY, viewW, viewH);
        if (!p) continue;
        drawBaseFortIcon(b, p, timeSec);
      }

      // "!" spotted marks are UI: drawn above the night darkness so they stay readable
      for (const e of combat.enemies) {
        if (e.alive && e.alertMarkTimer > 0) e.drawAlertMark(ctx, drawCamX, drawCamY, viewW, viewH);
      }

      if (gameStarted && player.alive && !garageDialog.open) {
        drawAimReticleAndArc(drawCamX, drawCamY);
      }

      updateRadarAndIndicators(drawCamX, drawCamY);
    }

    let lastTime = performance.now();

    function animate(now) {
      requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const paused = !gameStarted || startDialog.open || briefing.isOpen || garageDialog.open || gameoverDialog.open || results.isOpen;
      // While Mio reports a secured district (controls locked) the in-game clock and the mission
      // timer stand still; the radio itself and on-screen effects keep running
      const timeFrozen = radio.controlsLocked;
      world.update(dt, !paused && !timeFrozen);

      if (!paused && player.alive) {
        // While Mio reports a secured district the player can't drive, aim or fire (the tank coasts to a stop)
        const locked = timeFrozen;
        const held = (code) => !locked && keys.has(code);
        const wantBoost = held('ShiftLeft') || held('ShiftRight');
        const dustCb = (x, y, count) => {
          combat.spawnDustOrSmoke(x, y, 2, count, '#a8a29e');
        };

        if (controlMode === 'direct') {
          let moveX = 0;
          let moveY = 0;
          if (held('KeyW') || held('ArrowUp')) moveY -= 1;
          if (held('KeyS') || held('ArrowDown')) moveY += 1;
          if (held('KeyA') || held('ArrowLeft')) moveX -= 1;
          if (held('KeyD') || held('ArrowRight')) moveX += 1;
          player.stepPhysicsDirectional(moveX, moveY, wantBoost, dt, dustCb);
        } else {
          let throttle = 0;
          if (held('KeyW') || held('ArrowUp')) throttle += 1;
          if (held('KeyS') || held('ArrowDown')) throttle -= 1;

          let steer = 0;
          if (held('KeyA') || held('ArrowLeft')) steer -= 1;
          if (held('KeyD') || held('ArrowRight')) steer += 1;
          player.stepPhysics(throttle, steer, wantBoost, dt, dustCb);
        }

        // Keep camera centered on player tank
        const prevCamX = camX;
        camX = player.x;
        camY = player.y;
        starOffsetX += world.deltaX(prevCamX, camX) * 0.04;

        aimWorld = world.screenToWorld(mouseX, mouseY, camX, camY, viewW, viewH);
        // Keep tracking the target while reloading (previously the turret snapped back to center
        // after every shot and had to re-traverse once the reload finished)
        const lockCandidate = locked ? null : findLookAtTarget();
        if (lockCandidate) {
          player.aimAtWorldPoint(lockCandidate.x, lockCandidate.y, dt);
          activeTarget = player.isAimedAt(lockCandidate.x, lockCandidate.y) ? lockCandidate : null;
        } else {
          activeTarget = null;
          player.returnTurretStraight(dt);
        }

        if (!locked && (mouseLDown || keys.has('Space'))) {
          const fireTarget = activeTarget || getBarrelForwardTarget(340);
          combat.fireMainCannon(player, fireTarget.x, fireTarget.y);
        }
        if (!locked && (mouseRDown || keys.has('KeyF'))) {
          combat.fireSubWeapon(player);
        }

        // Wingmen: hold formation, or fan out and fight when enemies close in
        squad.update(dt, player);

        combat.update(dt, player, !timeFrozen);
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
        checkSupplyDepots();
        radio.update(dt); // advances only while the game runs, so reports resume after menus close

        audio.updateEngine(
          (Math.abs(player.speed) + Math.abs(player.turnRate) * 35) / player.maxSpeed,
          player.boosting,
          true
        );
      } else {
        audio.updateEngine(0, false, false);
      }

      // Area secured: the after-action report, once Mio has finished her final transmission
      if (gameStarted && !gameOverShown && player.alive && combat.missionComplete && radio.isIdle) {
        gameOverShown = true;
        keys.clear();
        mouseLDown = false;
        mouseRDown = false;
        results.open({ stats: combat.stats, combat, squad, player, world, audio }, () => startOrRestartGame());
      }

      // Tank destroyed
      if (gameStarted && !gameOverShown && !player.alive) {
        gameOverShown = true;
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

      const timeInfo = world.getTimeInfo();
      updateHUD(timeInfo);
      renderScene(now * 0.001, timeInfo);
    }

    startOrRestartGame();
    requestAnimationFrame(animate);
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window);
