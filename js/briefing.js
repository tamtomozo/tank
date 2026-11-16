(function (global) {
  'use strict';

  // Pre-operation briefing scene, shown before the tactical phase of every sortie.
  // Five steps: strategic situation, operation (start time, districts & compounds), tank tuning
  // (radar charts, js/tuningPanel.js), enemy intel, terrain.
  // Left: a tactical map of the whole area (highlighting what the current step talks about).
  // Right: the details for the step. Bottom: Mio narrates each step.

  // 'tactical' = start time followed by districts & compounds (in that order)
  const STEP_IDS = ['status', 'tactical', 'tuning', 'enemies', 'terrain'];

  const { ENEMY_INFO, ENEMY_SPECS, DISTRICT_TEMPLATES } = global.GameData; // js/data/enemies.js
  const { el } = global.TankUtil;

  const OPEN_DELAY_MS = 900; // pause before the briefing window starts drawing
  const BOOT_INTRO_MS = 1450; // boot-up sequence length before Mio starts talking (matches css/hudframe.css)
  const GENERAL = '惑星機甲軍 司令官 ハヤセ将軍'; // author of the strategic overview (original character)
  // 両軍のパワーバランス (司令書). Temporarily hidden: set to true to show it again.
  const SHOW_POWER_BALANCE = false;

  class BriefingScene {
    constructor(dialog, deps) {
      this.dialog = dialog;
      this.world = deps.world;
      this.combat = deps.combat;
      this.squad = deps.squad;
      this.tuning = deps.tuning;
      this.audio = deps.audio;
      this.getPlayer = deps.getPlayer;

      // ③ 車両調整: radar charts for the player's tank and the wingmen; every change re-fits the
      // tanks waiting on the HQ pad (deps.onTune)
      this.tuningPanel = new global.TuningPanel(dialog.querySelector('#briefing-tuning'), this.tuning, {
        audio: this.audio,
        onChange: (unit) => { if (deps.onTune) deps.onTune(unit); }
      });

      this.mapCanvas = dialog.querySelector('#briefing-map');
      this.mioText = dialog.querySelector('#briefing-mio-text');
      this.mioSr = dialog.querySelector('#briefing-mio-sr');
      this.tabs = [...dialog.querySelectorAll('.briefing-step')];
      this.panels = [...dialog.querySelectorAll('.briefing-panel')];
      this.btnPrev = dialog.querySelector('#briefing-prev');
      this.btnNext = dialog.querySelector('#briefing-next');

      this.mio = new global.Typewriter(this.mioText, this.mioSr); // Mio's narration

      this.titleEl = dialog.querySelector('#briefing-title');

      this.step = 0;
      this.onStart = null;
      this.onBack = null;
      this._openTimer = null;
      // Area + operation picked on the sortie-select screen (js/areaSelect.js, js/data/operations.js)
      this.area = null;
      this.operation = null;

      this.tabs.forEach((tab, i) => tab.addEventListener('click', () => this.goTo(i)));
      this.btnPrev.addEventListener('click', () => this.goTo(this.step - 1));
      this.btnNext.addEventListener('click', () => this.goTo(this.step + 1));
      // 作戦開始 / 作戦選択へ / Esc play the frame's closing sequence before the window actually closes
      global.HudFrame.animateCloses(dialog);
      // 作戦選択へ goes back to the sortie-select screen; any other close (作戦開始 / Esc) starts the operation
      dialog.addEventListener('close', () => {
        this._stopTyping();
        const back = dialog.returnValue === 'back';
        dialog.returnValue = '';
        // The operations-meeting BGM continues back on the sortie-select screen; it ends with the briefing
        if (!back) this.audio.stopBriefingBgm();
        const cb = back ? this.onBack : this.onStart;
        this.onStart = null;
        this.onBack = null;
        if (cb) cb();
      });
    }

    // True while the window is shown OR waiting to appear (the game stays paused either way)
    get isOpen() {
      return this.dialog.open || this._openTimer != null;
    }

    // selection = { area, operation } from the sortie-select screen.
    // onStart: 作戦開始 (or Esc) / onBack: 作戦選択へ
    open(selection, { onStart = null, onBack = null, delayMs = OPEN_DELAY_MS } = {}) {
      this.area = selection.area;
      this.operation = selection.operation;
      this.onStart = onStart;
      this.onBack = onBack;
      this.titleEl.textContent = `作戦本部 ブリーフィング — ${this.area.name}「${this.operation.name}」`;
      this._buildPanels();
      this.tuningPanel.render();
      if (this.dialog.open) {
        this.goTo(0);
        return;
      }
      // Hold for a moment on the empty battlefield, then run the boot-up sequence
      // (frame draws first, then the contents) — see css/hudframe.css
      if (this._openTimer != null) clearTimeout(this._openTimer);
      this._openTimer = setTimeout(() => {
        this._openTimer = null;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
        this.audio.startBriefingBgm(); // normally already playing from the sortie-select screen
        this.goTo(0, BOOT_INTRO_MS);
      }, delayMs);
    }

    goTo(index, sayDelayMs = 0) {
      this.step = Math.max(0, Math.min(STEP_IDS.length - 1, index));
      this.tabs.forEach((tab, i) => {
        tab.classList.toggle('is-active', i === this.step);
        tab.setAttribute('aria-selected', String(i === this.step));
      });
      this.panels.forEach((panel, i) => { panel.hidden = i !== this.step; });
      this.btnPrev.disabled = this.step === 0;
      this.btnNext.hidden = this.step === STEP_IDS.length - 1;
      this._drawMap(STEP_IDS[this.step]);
      this._say(this._mioLine(STEP_IDS[this.step]), sayDelayMs);
    }

    // ------------------------------------------------------------------ data helpers
    // Combat power of both armies: sum over units of armour (HP) x firepower (damage per second).
    // Enemy = every compound's garrison template (all districts, HP scaled per district tier);
    // ours = the player's tank + living wingmen with their current tuning.
    _powerBalance() {
      const specs = ENEMY_SPECS;
      const tpls = DISTRICT_TEMPLATES;
      const unitPower = (hp, dmg, reload) => hp * (dmg / Math.max(0.1, reload));
      let enemyPower = 0;
      let enemyTanks = 0;
      let enemyBunkers = 0;
      for (const site of this.world.enemyBases) {
        const tier = Math.min(site.districtId, tpls.length - 1);
        const tpl = tpls[tier][Math.min(site.slot, tpls[tier].length - 1)];
        const hpScale = 1 + tier * 0.15;
        const add = (kind) => {
          const sp = specs[kind];
          enemyPower += unitPower(sp.maxHp * hpScale, sp.damage, sp.reloadTime);
        };
        for (let i = 0; i < tpl.bunkers; i++) add('bunker');
        for (const k of tpl.tanks) add(k);
        enemyBunkers += tpl.bunkers;
        enemyTanks += tpl.tanks.length;
      }
      const player = this.getPlayer();
      const allies = this.combat.allies.filter((a) => a.alive);
      let ourPower = unitPower(player.maxHp, player.damage, player.reloadTime);
      for (const a of allies) ourPower += unitPower(a.maxHp, a.damage, a.reloadTime);
      return {
        ourPower,
        enemyPower,
        ratio: enemyPower / Math.max(1, ourPower),
        ourShare: ourPower / Math.max(1, ourPower + enemyPower),
        ourTanks: 1 + allies.length,
        enemyTanks,
        enemyBunkers,
        enemyBases: this.world.enemyBases.length,
        districts: this.combat.districts.length
      };
    }

    _status() {
      const combat = this.combat;
      const cur = combat.currentDistrict || combat.districts.find((d) => !d.unlocked) || null;
      return {
        objective: cur,
        districtCount: combat.districts.length,
        baseCount: combat.bases.length,
        squadMax: this.squad.maxSize
      };
    }

    _mioLine(stepId) {
      const st = this._status();
      const d0 = this.combat.districts[0];
      switch (stepId) {
        case 'status': {
          if (!SHOW_POWER_BALANCE) return 'ハヤセ将軍より、全車への戦況概要です。目を通しておいてください、隊長。';
          const pb = this._powerBalance();
          return `ハヤセ将軍より、全車への戦況概要です。戦力差は約${pb.ratio.toFixed(1)}倍……ですが、勝機はあります。目を通しておいてください、隊長。`;
        }
        case 'tuning':
          return `車両調整です。主砲・装填・機動・装甲の4項目に、自機と僚機それぞれ${this.tuning.budget}ポイントを配分してください。`
            + 'どこかを上げるなら、ほかを下げる必要があります。出撃後は調整できません。作戦に合わせて決めてください、隊長。';
        case 'tactical': {
          // Same order as the panel: operation name, objective, start time, then districts & compounds
          const t = this.world.getTimeInfo();
          const target = st.objective || d0;
          const names = target ? target.baseIds.map((id) => this.combat.bases[id].name).join('と') : '';
          return `作戦名は「${this.operation.name}」、目標は${this.area.name}の${this.combat.districts.length}地区の制圧です。`
            + `戦術行動の開始はDAY ${t.day}の${t.clockText}、${t.phaseName}です。`
            + `作戦区域は${this.area.name}、${this.combat.districts.length}つの地区に分かれています。${target ? `${target.name}の拠点${names}を制圧してください。` : ''}`
            + '後続の地区は、前の地区を確保すると解放されます。'
            + '全地区を制圧した時点で作戦時間が確定します。その後は、この作戦本部まで帰還してください。';
        }
        case 'enemies':
          return '敵は軽戦車、中戦車、トーチカで構成されています。拠点で待機していますが、接近するか攻撃すると出撃してきます。';
        case 'terrain':
          return '大型の岩は砲弾を防ぐ遮蔽物になります。ジャンプ台はブーストで飛び越えられます。マップは上下左右がつながっています。'
            + '準備ができたら、作戦本部から出撃してください。';
        default:
          return '';
      }
    }

    // ------------------------------------------------------------------ panels
    _buildPanels() {
      const combat = this.combat;
      const world = this.world;
      const st = this._status();
      const kv = (label, value, strong = false) => {
        const row = el('div', 'briefing-kv');
        row.append(el('span', '', label), el(strong ? 'strong' : 'span', strong ? 'is-strong' : '', value));
        return row;
      };

      // 1. Strategic situation = the scenario: the general's overview of the war, written to raise
      //    morale in four parts: pre-head (who it's for), catch copy (headline), deck copy (reinforces
      //    the headline and sparks curiosity), lead (who it targets and what they gain).
      const target = st.objective || combat.districts[0];
      const statusBox = this.dialog.querySelector('#briefing-status');
      statusBox.replaceChildren(
        el('p', 'scenario-prehead', `${this.area.name}奪還作戦に臨む、第1機甲小隊の全戦車兵へ`),
        el('h4', 'scenario-catch', 'この荒野を取り戻すのは、君たちの履帯だ。'),
        el('p', 'scenario-deck',
          `敵は${st.districtCount}つの地区に${st.baseCount}つの拠点を築き、勝利を確信している。`
          + `だが彼らはまだ知らない――たった${st.squadMax}両の小隊が、この戦況を塗り替えようとしていることを。`),
        el('p', 'scenario-lead',
          'この作戦は、最前線で砲火をくぐる諸君のためにある。'
          + `まず${target ? target.name : '第1地区'}の敵拠点を叩け。確保した地区は諸君の補給線となり、失った僚機を補う。`
          + `拠点を落とすたびに前線は押し上がり、${st.districtCount}地区すべてを制圧したとき、${this.area.name}は再び我々の大地となる。`
          + `作戦名「${this.operation.name}」――その鉄槌を振るうのは、諸君だ。`)
      );

      // Power balance of both armies (balance bar + side-by-side comparison + general's assessment).
      // The general signs once: at the end of the power balance when shown, otherwise under the scenario.
      const powerBox = this.dialog.querySelector('#briefing-power');
      const powerHead = this.dialog.querySelector('#briefing-power-head');
      powerBox.hidden = !SHOW_POWER_BALANCE;
      if (powerHead) powerHead.hidden = !SHOW_POWER_BALANCE;
      if (!SHOW_POWER_BALANCE) {
        statusBox.append(el('p', 'scenario-sign', `―― ${GENERAL}`));
        powerBox.replaceChildren();
      }
      const pb = SHOW_POWER_BALANCE ? this._powerBalance() : null;
      if (pb) {
      const sharePct = Math.round(pb.ourShare * 100);
      const powerBar = el('div', 'power-bar');
      powerBar.setAttribute('role', 'img');
      powerBar.setAttribute('aria-label', `戦力比 我が軍${sharePct}% 対 敵軍${100 - sharePct}%`);
      const ourSeg = el('div', 'power-seg is-ours', `我が軍 ${sharePct}%`);
      ourSeg.style.flexBasis = `${sharePct}%`;
      const enemySeg = el('div', 'power-seg is-enemy', `敵軍 ${100 - sharePct}%`);
      enemySeg.style.flexBasis = `${100 - sharePct}%`;
      powerBar.append(ourSeg, enemySeg);

      const side = (cls, title, rows) => {
        const box = el('div', `power-side ${cls}`);
        box.append(el('h5', '', title));
        for (const [k, v] of rows) {
          const row = el('p', 'power-row');
          row.append(el('span', '', k), el('span', '', v));
          box.append(row);
        }
        return box;
      };
      const cols = el('div', 'power-cols');
      cols.append(
        side('is-ours', '我が軍　第1機甲小隊', [
          ['兵力', `戦車 ${pb.ourTanks} 両`],
          ['強み', '機動力と連携。確保した地区での補給と僚機補充'],
          ['弱み', '数で劣る。補給は地区を確保するまで受けられない']
        ]),
        side('is-enemy', `敵軍　${this.area.name}守備隊`, [
          ['兵力', `戦車 約${pb.enemyTanks} 両・トーチカ 約${pb.enemyBunkers} 基（推定）`],
          ['強み', '数と、トーチカに守られた拠点の防御'],
          ['弱み', `${pb.districts}地区・${pb.enemyBases}拠点に分散。待機中は動かない`]
        ])
      );

      powerBox.replaceChildren(
        el('p', 'power-ratio', `戦力比　我が軍 1 : 敵軍 約${pb.ratio.toFixed(1)}`),
        powerBar,
        cols,
        el('p', 'power-comment',
          `数の上では、敵は我が小隊の約${pb.ratio.toFixed(1)}倍の戦力を持つ。だが敵は${pb.enemyBases}つの拠点に分散し、互いを支援できない。`
          + '一拠点ずつ確実に落とし、確保した地区で補給を重ねれば、天秤は必ず我々に傾く。'),
        el('p', 'scenario-sign', `―― ${GENERAL}`)
      );
      }

      // 2. Districts & compounds
      const dTable = this.dialog.querySelector('#briefing-districts');
      const head = el('tr');
      ['地区', '方面', '拠点'].forEach((h) => head.append(el('th', '', h)));
      const rows = combat.districts.map((d) => {
        const tr = el('tr');
        const names = d.baseIds.map((id) => combat.bases[id].name).join('・');
        tr.append(el('td', '', d.name), el('td', '', world.districts[d.id].dir), el('td', '', names));
        return tr;
      });
      dTable.replaceChildren(head, ...rows);

      // 3. Enemy intel: enemy types only (no per-district / per-compound counts)
      const specs = ENEMY_SPECS;
      const cards = this.dialog.querySelector('#briefing-enemies');
      cards.replaceChildren(...['light', 'medium', 'bunker'].map((kind) => {
        const spec = specs[kind];
        const card = el('article', 'briefing-enemy');
        card.append(this._enemyIcon(kind));
        const body = el('div', 'briefing-enemy-body');
        body.append(
          el('h4', '', ENEMY_INFO[kind].name),
          el('p', 'briefing-enemy-stats', `HP ${spec.maxHp} ／ 火力 ${spec.damage} ／ 速度 ${spec.maxSpeed || '固定'}`),
          el('p', 'briefing-enemy-role', ENEMY_INFO[kind].role)
        );
        card.append(body);
        return card;
      }));

      // 4. Terrain
      const terrain = this.dialog.querySelector('#briefing-terrain');
      const items = [
        ['rock', `大型の岩 ×${world.obstacles.length}`, '通行不可。砲弾を防ぐ遮蔽物として使える。'],
        ['ramp', `ジャンプ台 ×${world.ramps.length}`, 'ブーストで進入すると空中に跳躍する。'],
        ['gully', `涸れ川 ×${world.gullies.length}`, '走行可能な浸食溝。進路の目印になる。'],
        ['hardpan', `ひび割れ地帯 ×${world.hardpans.length}`, '乾いた泥の平地。走行への影響はない。'],
        ['wrap', `マップ ${world.width}×${world.height}`, '上下左右がつながっている（端を越えると反対側へ）。']
      ];
      terrain.replaceChildren(...items.map(([key, title, desc]) => {
        const li = el('li', 'briefing-terrain-item');
        li.append(el('span', `briefing-swatch is-${key}`), el('strong', '', title), el('span', '', desc));
        return li;
      }));

      // 5. Start time
      const t = world.getTimeInfo();
      const timeBox = this.dialog.querySelector('#briefing-time');
      const bar = el('div', 'briefing-daybar');
      const marker = el('div', 'briefing-daybar-marker');
      marker.style.left = `${(world.dayTime * 100).toFixed(1)}%`;
      marker.title = t.clockText;
      bar.append(marker);
      const scale = el('div', 'briefing-daybar-scale');
      ['0時', '6時', '12時', '18時', '24時'].forEach((s) => scale.append(el('span', '', s)));
      timeBox.replaceChildren(
        el('p', 'briefing-time-main', `DAY ${t.day}　${t.clockText}　${t.phaseIcon}${t.phaseName}`),
        bar,
        scale
      );

      // Operation name and objective (shown above the start time, name first)
      const opBox = this.dialog.querySelector('#briefing-operation');
      opBox.replaceChildren(
        kv('作戦名', `「${this.operation.name}」`, true),
        kv('目標', `${combat.districts.length}地区の制圧`)
      );
    }

    // Small top-down portrait of an enemy type, drawn with the in-game tank renderer
    _enemyIcon(kind) {
      const size = 68;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const c = document.createElement('canvas');
      c.width = size * dpr;
      c.height = size * dpr;
      c.className = 'briefing-enemy-icon';
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      g.translate(size / 2, size / 2 + 2);
      const spec = ENEMY_SPECS[kind];
      const tank = new global.Tank2D(this.world, { ...spec, kind, hullAngle: -Math.PI / 2 });
      g.scale(1.05, 1.05);
      if (tank.isBunker) tank._drawBunkerBase(g);
      else tank._drawHullAndTracks(g, 0);
      tank._drawTurret(g);
      return c;
    }

    // ------------------------------------------------------------------ tactical map
    _drawMap(stepId) {
      const canvas = this.mapCanvas;
      const cssSize = canvas.clientWidth || 420;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(cssSize * dpr)) {
        canvas.width = Math.round(cssSize * dpr);
        canvas.height = Math.round(cssSize * dpr);
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const S = cssSize;
      const world = this.world;
      const combat = this.combat;
      const k = S / world.width;

      g.clearRect(0, 0, S, S);
      g.fillStyle = '#3a3027';
      g.fillRect(0, 0, S, S);

      // District bands
      for (const d of combat.districts) {
        const wd = world.districts[d.id];
        const x = wd.x0 * k;
        const w = wd.width * k;
        g.fillStyle = d.secured ? 'rgba(34, 197, 94, 0.16)'
          : d.unlocked ? 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 6, 23, 0.42)';
        g.fillRect(x, 0, w, S);
        g.strokeStyle = 'rgba(253, 230, 138, 0.55)';
        g.lineWidth = 1;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, S);
        g.stroke();
        g.setLineDash([]);
      }

      // Terrain (dimmed unless the terrain step is active)
      g.globalAlpha = stepId === 'terrain' ? 1 : 0.55;
      for (const hp of world.hardpans) {
        g.fillStyle = 'rgba(214, 190, 150, 0.22)';
        g.beginPath();
        g.arc(hp.x * k, hp.y * k, Math.max(2, hp.size * 0.4 * k), 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(22, 14, 8, 0.75)';
      g.lineWidth = 1.4;
      for (const gully of world.gullies) {
        g.beginPath();
        let prev = null;
        for (const pt of gully) {
          if (prev && Math.abs(pt.x - prev.x) < world.width / 2 && Math.abs(pt.y - prev.y) < world.height / 2) {
            g.moveTo(prev.x * k, prev.y * k);
            g.lineTo(pt.x * k, pt.y * k);
          }
          prev = pt;
        }
        g.stroke();
      }
      for (const o of world.obstacles) {
        g.fillStyle = '#8b7d6b';
        g.strokeStyle = '#3f372e';
        g.lineWidth = 1;
        g.beginPath();
        o.base.forEach((v, i) => {
          const px = (o.x + v[0]) * k;
          const py = (o.y + v[1]) * k;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.strokeStyle = '#38bdf8';
      g.lineWidth = 1.2;
      for (const r of world.ramps) {
        g.beginPath();
        g.arc(r.x * k, r.y * k, Math.max(2.2, r.radius * k), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      // Compounds (fort icons): current/secured districts in colour, later districts as estimates
      for (const b of combat.bases) {
        const px = b.x * k;
        const py = b.y * k;
        const locked = b.locked;
        g.save();
        g.globalAlpha = stepId === 'terrain' ? 0.55 : 1;
        g.translate(px, py);
        g.scale(0.55, 0.55);
        if (global.FortIcon) {
          global.FortIcon.draw(g, b.cleared ? '#22c55e' : locked ? '#64748b' : '#ef4444', 'rgba(255,255,255,0.9)', 2);
        }
        g.restore();
        g.font = '700 12px system-ui, "Segoe UI", sans-serif';
        g.textAlign = 'left';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        const label = locked ? `${b.name}?` : b.name;
        g.strokeText(label, px + 10, py + 4);
        g.fillStyle = locked ? '#cbd5e1' : '#fff';
        g.fillText(label, px + 10, py + 4);
      }

      // Operations HQ: where the sortie starts and where the platoon returns once the area is secured
      const hq = world.hq;
      const hx = hq.x * k;
      const hy = hq.y * k;
      const hs = 13; // half-size of the HQ frame on the map
      g.fillStyle = 'rgba(56, 189, 248, 0.16)';
      g.strokeStyle = '#7dd3fc';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(hx - hs, hy - hs, hs * 2, hs * 2, 3);
      g.fill();
      g.stroke();
      g.font = '700 12px system-ui, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      g.strokeText(hq.name, hx, hy - hs - 5);
      g.fillStyle = '#e0f2fe';
      g.fillText(hq.name, hx, hy - hs - 5);

      // Own platoon (on the HQ pad at the start of a sortie)
      const player = this.getPlayer();
      const sx = player.x * k;
      const sy = player.y * k;
      g.fillStyle = '#38bdf8';
      g.strokeStyle = '#e0f2fe';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx, sy - 8);
      g.lineTo(sx + 6.5, sy + 6);
      g.lineTo(sx - 6.5, sy + 6);
      g.closePath();
      g.fill();
      g.stroke();
      g.font = '700 12px system-ui, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      g.strokeText('自軍小隊', sx, sy + 27);
      g.fillStyle = '#bae6fd';
      g.fillText('自軍小隊', sx, sy + 27);

      // District labels last, outlined, so terrain never covers them
      g.textAlign = 'center';
      g.lineJoin = 'round';
      for (const d of combat.districts) {
        const wd = world.districts[d.id];
        const cxBand = (wd.x0 + wd.width / 2) * k;
        const outlined = (text, y, font, color) => {
          g.font = font;
          g.lineWidth = 4;
          g.strokeStyle = 'rgba(15, 23, 42, 0.92)';
          g.strokeText(text, cxBand, y);
          g.fillStyle = color;
          g.fillText(text, cxBand, y);
        };
        g.globalAlpha = stepId === 'terrain' ? 0.8 : 1;
        outlined(`${d.name}（${wd.dir}）`, 18, '700 13px system-ui, "Segoe UI", sans-serif', d.unlocked ? '#fde68a' : '#cbd5e1');
        outlined(d.secured ? '確保済み' : d.unlocked ? '作戦対象' : '未解放', 34, '11px system-ui, "Segoe UI", sans-serif', 'rgba(226, 232, 240, 0.9)');
        g.globalAlpha = 1;
      }

      // Frame
      g.strokeStyle = 'rgba(148, 180, 218, 0.45)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, S - 1, S - 1);
    }

    // ------------------------------------------------------------------ Mio narration
    // Mio narrates the current step (after `delayMs` while the window is still booting up)
    _say(text, delayMs = 0) {
      this.mio.say(text, this.audio, delayMs);
    }

    _stopTyping() {
      this.mio.stop();
    }
  }

  global.BriefingScene = BriefingScene;
})(window);
