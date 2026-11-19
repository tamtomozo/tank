(function (global) {
  'use strict';

  // Pre-operation briefing scene, shown before the tactical phase of every sortie.
  // Six steps: strategic situation, operation (start time, compounds), tank tuning
  // (radar charts, js/tuningPanel.js), equipment & maintenance (js/loadoutPanel.js), enemy intel,
  // terrain.
  // ⑤ 地理情報 only: a tactical map of the whole battlefield on the left, the details on the right.
  // Other steps: the details take the whole width. Bottom: Mio narrates each step.

  // 'tactical' = start time followed by the compounds (in that order)
  const STEP_IDS = ['status', 'tactical', 'tuning', 'loadout', 'enemies', 'terrain'];

  const { ENEMY_INFO, ENEMY_SPECS, ENEMY_KIND_ORDER } = global.GameData; // js/data/enemies.js
  const { el } = global.TankUtil;

  const OPEN_DELAY_MS = 900; // pause before the briefing window starts drawing
  const BOOT_INTRO_MS = 1450; // boot-up sequence length before Mio starts talking (matches css/hudframe.css)
  const GENERAL = L('惑星機甲軍 司令官 ハヤセ将軍', 'General Hayase, Commander, Planetary Armored Corps'); // author of the strategic overview (original character)
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

      // ④ 装備・整備: campaign carry-over (crew, wear, wingmen, scrap) and the fitted equipment;
      // every change refits the platoon on the HQ pad (deps.onRefit)
      this.loadoutPanel = new global.LoadoutPanel(dialog.querySelector('#briefing-loadout'), {
        audio: this.audio,
        onChange: () => {
          if (deps.onRefit) deps.onRefit();
          this.tuningPanel.render();
        }
      });

      this.mapCanvas = dialog.querySelector('#briefing-map');
      this.mapWrap = dialog.querySelector('.briefing-map-wrap');
      this.mainEl = dialog.querySelector('.briefing-main');
      this.tabs = [...dialog.querySelectorAll('.briefing-step')];
      this.panels = [...dialog.querySelectorAll('.briefing-panel')];
      this.btnPrev = dialog.querySelector('#briefing-prev');
      this.btnNext = dialog.querySelector('#briefing-next');

      // Mio's narration: a call floating at the screen centre until clicked (js/mioCall.js).
      // Created before HudFrame's `cancel` handler, so Esc while it is up only dismisses it
      // (instead of closing the briefing and starting the operation).
      this.mio = new global.MioCall(dialog, this.audio);

      this.titleEl = dialog.querySelector('#briefing-title');

      this.step = 0;
      this.onStart = null;
      this.onBack = null;
      this._openTimer = null;
      // Planet + operation picked on the sortie-select screens (js/sortieSelect.js, js/data/operations.js)
      this.planet = null;
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

    // selection = { planet, operation } from the sortie-select screens.
    // onStart: 作戦開始 (or Esc) / onBack: 作戦選択へ
    open(selection, { onStart = null, onBack = null, delayMs = OPEN_DELAY_MS } = {}) {
      this.planet = selection.planet;
      this.operation = selection.operation;
      this.onStart = onStart;
      this.onBack = onBack;
      this.titleEl.textContent = L(`作戦本部 ブリーフィング — ${this.planet.name}「${this.operation.name}」`, `HQ Briefing — ${this.planet.name}, Operation "${this.operation.name}"`);
      this._buildPanels();
      this.tuningPanel.render();
      this.loadoutPanel.open(this.planet, this.operation);
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
      // The map is shown only on ⑤ 地理情報; the other steps give the whole width to their panel
      const showMap = STEP_IDS[this.step] === 'terrain';
      this.mainEl.classList.toggle('is-no-map', !showMap);
      this.mapWrap.hidden = !showMap;
      if (showMap) this._drawMap(STEP_IDS[this.step]);
      this._say(this._mioLine(STEP_IDS[this.step]), sayDelayMs);
    }

    // ------------------------------------------------------------------ data helpers
    // Combat power of both armies: sum over units of armour (HP) x firepower (damage per second).
    // Enemy = every compound's garrison (HP scaled per garrison tier);
    // ours = the player's tank + living wingmen with their current tuning.
    _powerBalance() {
      const specs = ENEMY_SPECS;
      const unitPower = (hp, dmg, reload) => hp * (dmg / Math.max(0.1, reload));
      let enemyPower = 0;
      let enemyTanks = 0;
      let enemyBunkers = 0;
      for (const base of this.combat.bases) {
        const tpl = base.garrison;
        const hpScale = 1 + (tpl.tier || 0) * 0.15;
        const add = (kind) => {
          const sp = specs[kind];
          enemyPower += unitPower(sp.maxHp * hpScale, sp.damage, sp.reloadTime);
        };
        for (let i = 0; i < (tpl.bunkers || 0); i++) add('bunker');
        for (const k of tpl.tanks || []) add(k);
        enemyBunkers += tpl.bunkers || 0;
        enemyTanks += (tpl.tanks || []).length;
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
        enemyBases: this.combat.bases.length
      };
    }

    _status() {
      const combat = this.combat;
      return {
        baseCount: combat.bases.length,
        squadMax: this.squad.maxSize
      };
    }

    // Enemy kinds this operation fields (compound garrisons + reinforcements), in briefing order
    _enemyKinds() {
      const kinds = new Set();
      for (const b of this.combat.bases) {
        if (b.garrison.bunkers) kinds.add('bunker');
        for (const k of b.garrison.tanks || []) kinds.add(k);
      }
      const op = this.operation;
      // Compounds that only appear later (site.after) are not in combat.bases yet
      for (const s of op.sites || []) {
        if (s.after == null) continue;
        if (s.garrison.bunkers) kinds.add('bunker');
        for (const k of s.garrison.tanks || []) kinds.add(k);
      }
      // Sweep: every kind its waves can field (js/sweep.js)
      if (op.sweep) op.sweep.kinds.forEach((k) => kinds.add(k));
      const hold = op.hold;
      if (hold) {
        hold.kinds.forEach((k) => kinds.add(k));
        if (hold.boss) kinds.add(hold.boss.kind);
      }
      if (op.turrets && op.turrets.length) kinds.add('turret');
      if (op.tunnels && op.tunnels.length) kinds.add('infantry');
      if (op.finale) kinds.add(op.finale.kind);
      return ENEMY_KIND_ORDER.filter((k) => kinds.has(k));
    }

    _mioLine(stepId) {
      const st = this._status();
      const mio = this.operation.mio || {};
      switch (stepId) {
        case 'status': {
          if (!SHOW_POWER_BALANCE) return L('ハヤセ将軍より、全車への戦況概要です。目を通しておいてください、隊長。', 'An overview of the situation from General Hayase, to every crew. Please read it through, Commander.');
          const pb = this._powerBalance();
          return L(`ハヤセ将軍より、全車への戦況概要です。戦力差は約${pb.ratio.toFixed(1)}倍……ですが、勝機はあります。目を通しておいてください、隊長。`, `An overview of the situation from General Hayase, to every crew. We are outnumbered about ${pb.ratio.toFixed(1)} to 1... but we can win. Please read it through, Commander.`);
        }
        case 'loadout': {
          const c = global.Campaign;
          if (this.operation.sweep) {
            return L(`装備と整備です。掃討作戦は本編とは別扱いで、車両は新品、僚機は${c.maxAllies}両そろった状態で出撃します。結果はキャンペーンに持ち帰りません。この星での装備を${global.GameData.EQUIP_SLOTS}つ選んでください。`,
              `Gear and repairs. The sweep is kept apart from the campaign: a fresh tank and all ${c.maxAllies} wingmen, and nothing carries back. Choose ${global.GameData.EQUIP_SLOTS} pieces of equipment for this planet.`);
          }
          const parts = [L(`装備と整備です。この星での装備を${global.GameData.EQUIP_SLOTS}つ選んでください。推奨の印は、この星の環境に合わせた装備です。`, `Gear and repairs. Choose ${global.GameData.EQUIP_SLOTS} pieces of equipment for this planet. The ones marked Recommended suit its conditions.`)];
          if (c.wear > 0) parts.push(L(`自機の損耗が${Math.round(c.wear * 100)}%残っています。スクラップで修理できます。`, `Your tank still has ${Math.round(c.wear * 100)}% wear. You can repair it with scrap.`));
          if (c.allies < c.maxAllies) parts.push(L(`僚機が${c.maxAllies - c.allies}両足りません。スクラップで補充できます。`, `You are ${c.maxAllies - c.allies} wingmen short. You can replace them with scrap.`));
          if (this.planet.hazards && this.planet.hazards.civilians) parts.push(L(`住民の協力度は${c.support}%です。`, `Civilian support is at ${c.support}%.`));
          return parts.join(L('', ' '));
        }
        case 'tuning':
          return L(`車両調整です。主砲・装填・機動・装甲の4項目に、自機と僚機それぞれ${this.tuning.budget}ポイントを配分してください。`
            + (this.tuning.bonus > 0 ? `小隊の練度が上がったので、${this.tuning.bonus}ポイント多く使えます。` : '')
            + 'どこかを上げるなら、ほかを下げる必要があります。出撃後は調整できません。作戦に合わせて決めてください、隊長。',
          `Tank tuning. Spread ${this.tuning.budget} points over gun, reload, mobility and armor, for your tank and for the wingmen. `
            + (this.tuning.bonus > 0 ? `The platoon's crew level has risen, so you have ${this.tuning.bonus} extra points. ` : '')
            + 'To raise one stat you have to lower another. No changes after the sortie. Set them for the operation, Commander.');
        case 'tactical': {
          // Same order as the panel: operation name, objective, start time, then the compounds
          const t = this.world.getTimeInfo();
          if (this.operation.sweep) {
            return L(`作戦名は「${this.operation.name}」です。${mio.tactical}戦術行動の開始はDAY ${t.day}の${t.clockText}、${t.phaseName}です。`,
              `This is the ${this.operation.name}. ${mio.tactical} Tactical action begins on DAY ${t.day} at ${t.clockText}, ${t.phaseName}.`);
          }
          if (mio.tactical) {
            return L(`作戦名は「${this.operation.name}」です。${mio.tactical}`
              + `戦術行動の開始はDAY ${t.day}の${t.clockText}、${t.phaseName}です。目標を達成したら、この作戦本部まで帰還してください。`,
            `This is Operation "${this.operation.name}". ${mio.tactical} `
              + `Tactical action begins on DAY ${t.day} at ${t.clockText}, ${t.phaseName}. Once the objectives are done, return here to HQ.`);
          }
          return L(`作戦名は「${this.operation.name}」、目標は${this.planet.name}の敵拠点${st.baseCount}か所の制圧です。`
            + `戦術行動の開始はDAY ${t.day}の${t.clockText}、${t.phaseName}です。`
            + '敵拠点は作戦本部の周囲に散らばっています。どこから攻めるかは隊長に任せます。制圧した拠点では補給と僚機の補充ができます。'
            + '全拠点を制圧した時点で作戦時間が確定します。その後は、この作戦本部まで帰還してください。',
          `This is Operation "${this.operation.name}": capture the ${st.baseCount} enemy compounds on ${this.planet.name}. `
            + `Tactical action begins on DAY ${t.day} at ${t.clockText}, ${t.phaseName}. `
            + 'The compounds are scattered around HQ. Where to strike first is up to you. Captured compounds offer resupply and replacement wingmen. '
            + 'The mission time is fixed once every compound is captured. After that, return here to HQ.');
        }
        case 'enemies':
          if (mio.enemies) {
            return this.combat.bases.length > 0
              ? L(`${mio.enemies}拠点の敵は待機していますが、接近するか攻撃すると出撃してきます。`, `${mio.enemies} The enemies wait at their compounds, but they sortie if you come close or attack.`)
              : mio.enemies;
          }
          return L('敵は軽戦車、中戦車、トーチカで構成されています。拠点で待機していますが、接近するか攻撃すると出撃してきます。', 'The enemy has light tanks, medium tanks and pillboxes. They wait at their compounds, but they sortie if you come close or attack.');
        case 'terrain':
          if (mio.terrain) return mio.terrain;
          return L('大型の岩は砲弾を防ぐ遮蔽物になります。ジャンプ台に勢いよく進入すると飛び越えられます。マップは上下左右がつながっています。'
            + '準備ができたら、作戦本部から出撃してください。',
          'Large rocks give cover from shells. Hit a ramp at speed and you will jump over obstacles. The map wraps around on every side. '
            + 'Sortie from HQ when you are ready.');
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
      const statusBox = this.dialog.querySelector('#briefing-status');
      const sc = this.operation.scenario || {
        prehead: L(`${this.planet.name}奪還作戦に臨む、第1機甲小隊の全戦車兵へ`, `To every tank crew of the 1st Armored Platoon, about to retake ${this.planet.name}`),
        catch: L('この星を取り戻すのは、君たちの履帯だ。', 'It is your tracks that will win this world back.'),
        deck: L(`敵は${this.planet.name}の各地に${st.baseCount}つの拠点を築き、勝利を確信している。`
          + `だが彼らはまだ知らない――たった${st.squadMax}両の小隊が、この戦況を塗り替えようとしていることを。`,
        `The enemy has built ${st.baseCount} compounds across ${this.planet.name} and is sure of victory. `
          + `What they do not know yet: a platoon of just ${st.squadMax} tanks is about to turn this war around.`),
        lead: L('敵拠点を一つずつ叩け。制圧した拠点は諸君の補給線となり、失った僚機を補う。'
          + `作戦名「${this.operation.name}」――それを成し遂げるのは、諸君だ。`,
        'Strike the enemy compounds one by one. Each one you capture becomes your supply line and replaces lost wingmen. '
          + `Operation "${this.operation.name}" — and you are the ones who will carry it out.`)
      };
      statusBox.replaceChildren(
        el('p', 'scenario-prehead', sc.prehead),
        el('h4', 'scenario-catch', sc.catch),
        el('p', 'scenario-deck', sc.deck),
        el('p', 'scenario-lead', sc.lead)
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
      powerBar.setAttribute('aria-label', L(`戦力比 我が軍${sharePct}% 対 敵軍${100 - sharePct}%`, `Strength: ours ${sharePct}% vs enemy ${100 - sharePct}%`));
      const ourSeg = el('div', 'power-seg is-ours', L(`我が軍 ${sharePct}%`, `Ours ${sharePct}%`));
      ourSeg.style.flexBasis = `${sharePct}%`;
      const enemySeg = el('div', 'power-seg is-enemy', L(`敵軍 ${100 - sharePct}%`, `Enemy ${100 - sharePct}%`));
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
        side('is-ours', L('我が軍　第1機甲小隊', 'Ours: 1st Armored Platoon'), [
          [L('兵力', 'Strength'), L(`戦車 ${pb.ourTanks} 両`, `${pb.ourTanks} tanks`)],
          [L('強み', 'Strengths'), L('機動力と連携。制圧した拠点での補給と僚機補充', 'Mobility and teamwork. Resupply and replacements at captured compounds')],
          [L('弱み', 'Weaknesses'), L('数で劣る。補給は拠点を制圧するまで受けられない', 'Outnumbered. No resupply until a compound is captured')]
        ]),
        side('is-enemy', L(`敵軍　${this.planet.name}守備隊`, `Enemy: ${this.planet.name} garrison`), [
          [L('兵力', 'Strength'), L(`戦車 約${pb.enemyTanks} 両・トーチカ 約${pb.enemyBunkers} 基（推定）`, `About ${pb.enemyTanks} tanks and ${pb.enemyBunkers} pillboxes (estimated)`)],
          [L('強み', 'Strengths'), L('数と、トーチカに守られた拠点の防御', 'Numbers, and compounds defended by pillboxes')],
          [L('弱み', 'Weaknesses'), L(`${pb.enemyBases}拠点に分散。待機中は動かない`, `Spread over ${pb.enemyBases} compounds. Idle while on standby`)]
        ])
      );

      powerBox.replaceChildren(
        el('p', 'power-ratio', L(`戦力比　我が軍 1 : 敵軍 約${pb.ratio.toFixed(1)}`, `Strength ratio: ours 1 : enemy ${pb.ratio.toFixed(1)}`)),
        powerBar,
        cols,
        el('p', 'power-comment',
          L(`数の上では、敵は我が小隊の約${pb.ratio.toFixed(1)}倍の戦力を持つ。だが敵は${pb.enemyBases}つの拠点に分散し、互いを支援できない。`
          + '一拠点ずつ確実に落とし、制圧した拠点で補給を重ねれば、天秤は必ず我々に傾く。',
          `On paper, the enemy is about ${pb.ratio.toFixed(1)} times our strength. But it is spread over ${pb.enemyBases} compounds that cannot support each other. `
          + 'Take them one at a time, resupply at each one, and the balance will tip our way.')),
        el('p', 'scenario-sign', `―― ${GENERAL}`)
      );
      }

      // 2. Compounds: bearing and distance from the operations HQ (north = up on the map)
      const bTable = this.dialog.querySelector('#briefing-bases');
      const head = el('tr');
      L(['拠点', '方位（作戦本部から）', '距離'], ['Compound', 'Bearing (from HQ)', 'Distance']).forEach((h) => head.append(el('th', '', h)));
      const DIRS = L(['東', '南東', '南', '南西', '西', '北西', '北', '北東'], ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']);
      const rows = combat.bases.map((b) => {
        const dx = world.deltaX(world.hq.x, b.x);
        const dy = world.deltaY(world.hq.y, b.y);
        const dir = DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
        const tr = el('tr');
        tr.append(el('td', '', b.name), el('td', '', dir), el('td', '', L(`約${Math.round(Math.hypot(dx, dy) / 100) * 100}`, `~${Math.round(Math.hypot(dx, dy) / 100) * 100}`)));
        return tr;
      });
      bTable.replaceChildren(head, ...rows);

      // 3. Enemy intel: enemy types only (no per-compound counts)
      const specs = ENEMY_SPECS;
      const cards = this.dialog.querySelector('#briefing-enemies');
      cards.replaceChildren(...this._enemyKinds().map((kind) => {
        const spec = specs[kind];
        const card = el('article', 'briefing-enemy');
        card.append(this._enemyIcon(kind));
        const body = el('div', 'briefing-enemy-body');
        body.append(
          el('h4', '', ENEMY_INFO[kind].name),
          el('p', 'briefing-enemy-stats', L(`HP ${spec.maxHp} ／ 火力 ${spec.damage} ／ 速度 ${spec.maxSpeed || '固定'}`, `HP ${spec.maxHp} · Firepower ${spec.damage} · Speed ${spec.maxSpeed || 'fixed'}`)),
          el('p', 'briefing-enemy-role', ENEMY_INFO[kind].role)
        );
        card.append(body);
        return card;
      }));

      // 4. Terrain and the operation's conditions (environment first: it matters most)
      const terrain = this.dialog.querySelector('#briefing-terrain');
      const op = this.operation;
      const rules = this.planet.hazards || {};
      const items = [];
      if (op.weather && op.weather.sandstorm) {
        items.push(['storm', L('砂嵐', 'Sandstorm'), L('ときどき発生。視界がほぼゼロになり、敵拠点にも気づかれにくくなる。', 'Comes now and then. Visibility drops to almost zero, and the compounds have trouble spotting you too.')]);
      }
      if (op.weather && op.weather.blizzard) {
        items.push(['blizzard', L('吹雪', 'Blizzard'), L('止むことなく、強まったり弱まったりを繰り返す。強いときは視界がほぼゼロ。', 'Never stops, only rises and falls. At its worst, visibility is almost zero.')]);
      }
      if (op.weather && op.weather.smog) {
        items.push(['smog', L('スモッグと酸性雨', 'Smog & acid rain'), L('茶色いもやが濃くなったり薄くなったりを繰り返す。濃いときは視界が大きく落ちる。', 'A brown haze that thickens and thins. When it is thick, visibility drops sharply.')]);
      }
      if (op.polarNight) items.push(['night', L('極夜', 'Polar night'), L('太陽が昇らず、ずっと夜。敵拠点は撃たれるまでこちらに気づかない。', 'The sun never rises. Compounds do not notice you until you fire.')]);
      if (rules.thermal) items.push(['thermal', L('熱源センサー', 'Heat sensor'), L(`吹雪や暗闇の中でも、約${global.CombatManager.THERMAL_RANGE}以内の敵を熱源として映し、照準できる。`, `Even in blizzards and darkness, shows enemies within about ${global.CombatManager.THERMAL_RANGE} as heat sources you can aim at.`)]);
      if (rules.cold) items.push(['cold', L('低温', 'Cold'), L('長く止まると車体が冷え、砲塔の旋回とエンジンが鈍る。走れば暖まる。', 'Stand still for long and the tank chills: slower turret, sluggish engine. Driving warms it up.')]);
      if (rules.heat) items.push(['heat', L('エンジン過熱', 'Engine heat'), L('全速で走り続けるとオーバーヒートし、冷えるまで速度が落ちる。', 'Run flat out for too long and the engine overheats, slowing you until it cools.')]);
      if (rules.dust) items.push(['dust', L('砂煙', 'Dust'), L('速く走るほど、遠くの拠点に気づかれやすい。止まっていれば気づかれにくい。', 'The faster you go, the farther away compounds spot you. Standing still keeps you hidden.')]);
      if (op.mirage) items.push(['mirage', L('蜃気楼', 'Mirage'), L('昼間、遠くの敵は実際の位置からずれて揺らいで見える。', 'By day, distant enemies waver and appear away from where they really are.')]);
      if (op.longRange) items.push(['range', L('遠距離戦', 'Long range'), L(`自機の照準距離 +${op.longRange.player}。敵の射程も長い。`, `Your aiming range +${op.longRange.player}. The enemy's range is longer too.`)]);
      for (const z of world.zones) {
        if (z.kind === 'saltflat') items.push(['salt', L('塩の平原', 'Salt flats'), L('岩ひとつない真っ白な平原。遮蔽物がまったくない。', 'A pure white plain without a single rock. No cover at all.')]);
        if (z.kind === 'city' && z.style === 'industrial') {
          const civil = world.structures.filter((s) => s.civil).length;
          const fuel = world.structures.filter((s) => s.fuel).length;
          items.push(['civil', L(`民間の建物 ×${civil}`, `Civilian buildings ×${civil}`), L('明るい壁と赤茶色の屋根の住宅・商店。味方の砲弾で崩れ、1棟壊すごとに住民の協力度が4%下がる。', 'Houses and shops with bright walls and red-brown roofs. Our shells bring them down, and each one costs 4% civilian support.')]);
          items.push(['industry', L('工場・倉庫', 'Factories & warehouses'), L('灰色の建物。壊れない。通行不可で、砲弾も通さない。', 'Gray buildings. Indestructible, impassable, and they stop shells.')]);
          if (fuel > 0) items.push(['fuel', L(`燃料タンク ×${fuel}`, `Fuel tanks ×${fuel}`), L('赤い屋根の丸いタンク。撃つと大爆発し、敵味方と周りの建物を巻き込む。', 'Round tanks with red tops. Shoot one and it blows up, taking friend, foe and nearby buildings with it.')]);
        } else if (z.kind === 'city') {
          const name = z.style === 'snow' ? L('首都', 'Capital') : L('旧市街', 'Old town');
          items.push(['city', L(`${name} 建物×${world.structures.length}`, `${name}: buildings ×${world.structures.length}`), L('建物は通行不可で、砲弾も通さない。狭い路地と行き止まりに注意。', 'Buildings are impassable and stop shells. Watch for narrow alleys and dead ends.')]);
        }
        if (z.kind === 'highway') {
          items.push(['highway', L('高架道路', 'Elevated highway'), L('通れない壁で、砲弾も止める。切れ目から反対側へ抜けられる。上の砲台は下から撃てる。', 'An impassable wall that stops shells. Pass through the gaps. The turrets on top can be shot from below.')]);
        }
        if (z.kind === 'factory') {
          items.push(['factory', L('工場の内部', 'Factory interior'), L('壁の扉から出入りする。中には生産ラインが並び、間を縫って戦う。', 'Enter and leave through the doors in the walls. Inside, you fight between rows of production lines.')]);
        }
        if (z.kind === 'lake') {
          items.push(['lake', L('凍った湖', 'Frozen lake'), L('止まると氷が割れて沈む。走り続ければ渡れる。', 'Stop and the ice breaks under you. Keep moving and you can cross.')]);
          items.push(['thin', L(`薄い氷 ×${z.thin.length}`, `Thin ice ×${z.thin.length}`), L('色の濃いところ。重い戦車（重戦車・指揮官車）は踏み抜いて沈む。敵を誘い込める。', 'The darker patches. Heavy tanks (heavy and command tanks) break through and sink. You can lure the enemy onto them.')]);
        }
      }
      if (op.survey && op.surveyKind === 'patrol') {
        items.push(['survey', L(`巡回点 ×${op.survey.length}`, `Patrol points ×${op.survey.length}`), L('水色の円に乗ると、その地点の巡回が済む。', 'Drive into the light-blue circle to patrol that point.')]);
      } else if (op.survey) {
        items.push(['survey', L(`観測点 ×${op.survey.length}`, `Survey points ×${op.survey.length}`), L('水色の円に乗ると、その地点の氷の厚さを計測する。', 'Drive into the light-blue circle to measure the ice there.')]);
      }
      if (op.escort) {
        items.push(['escort', L('協力者の護衛', 'Escort the collaborator'), L(`${op.escort.meet.name}で合流し、${op.escort.to.name}まで送り届ける。歩きで、撃たれると倒れる。`, `Meet them at the ${op.escort.meet.name} and take them to the ${op.escort.to.name}. They are on foot and fall if shot.`)]);
      }
      if (op.turrets && op.turrets.length) {
        const powered = op.turrets.some((t) => t.powered);
        items.push(['turret', L(`高架砲台 ×${op.turrets.length}`, `Overpass turrets ×${op.turrets.length}`), powered
          ? L('高架の上から撃ち下ろしてくる。発電所を制圧すると止まる。', 'They fire down from the overpass. Capturing the power plant shuts them down.')
          : L('高架の上から撃ち下ろしてくる。', 'They fire down from the overpass.')]);
      }
      if (op.tunnels && op.tunnels.length) {
        const known = global.Campaign && global.Campaign.collaborator === true && !op.escort;
        items.push(['tunnel', L(`マンホール ×${op.tunnels.length}`, `Manholes ×${op.tunnels.length}`), L(`近くを通ると歩兵が出てくる。${known ? '協力者の地図で、位置がレーダーに映る。' : '協力者の地図があれば、位置がレーダーに映る。'}`,
          `Infantry climb out when you pass nearby. ${known ? 'Thanks to the collaborator\'s map, they show on the radar.' : 'With the collaborator\'s map, they would show on the radar.'}`)]);
      }
      if (op.guerrilla) {
        items.push(['ied', L('即席爆弾', 'IEDs'), L('道路に隠されている。近づくと赤く光る。撃てば処理でき、踏むと大きな被害。数は住民の協力度しだい。', 'Hidden in the roads; they glow red when you get close. Shoot them to clear them; driving over one does heavy damage. How many depends on civilian support.')]);
      }
      if (op.feint) items.push(['feint', L('陽動', 'Feint'), L(`${op.sites[op.feint.site].name}に発見されたあと、${op.feint.distance}以上引き離す。攻め落とす必要はない。`, `Get spotted by the ${op.sites[op.feint.site].name}, then pull at least ${op.feint.distance} away. No need to take it.`)]);
      if (op.hold) {
        const label = op.hold.label || L('封鎖', 'Hold');
        items.push(['hold', label, L(`${op.hold.duration}秒間、黄色い円の中を守る。円を出るとカウントが止まる。`, `Hold the yellow circle for ${op.hold.duration} seconds. Leave it and the count stops.`)]);
      }
      if (op.ammo) items.push(['ammo', L(`砲弾 ${op.ammo}発`, `${op.ammo} shells`), L('撃ち尽くすと主砲が撃てない。撃破した敵1両につき2発回収できる。', 'Run out and the main gun falls silent. Each enemy destroyed gives back 2 shells.')]);
      if (op.noSupply) items.push(['nosupply', L('補給なし', 'No supply'), L('補給拠点も修理キットもない。', 'No supply depots and no repair kits.')]);
      if (op.sweep) {
        items.push(
          ['sweep', L(`${op.sweep.perRound}拠点×${op.sweep.rounds}波`, `${op.sweep.rounds} waves of ${op.sweep.perRound}`), L(`波の${op.sweep.perRound}拠点をすべて落とすと、次の${op.sweep.perRound}拠点が別の場所に現れる。拠点が現れてから最後の1か所を落とすまでがラップタイム。`,
            `Take all ${op.sweep.perRound} compounds of a wave and the next ${op.sweep.perRound} appear elsewhere. The lap runs from when a wave appears until its last compound falls.`)],
          ['nosupply', L('回復は波ごとに1回', 'One recovery per wave'), L('補給拠点も修理キットもない。波を制圧するたび、最後に落とした拠点の白旗で1回だけ全回復（弾薬・僚機の補充込み）できる。',
            'No supply depots and no repair kits. After each wave, the white flag of the last compound taken gives one full recovery (ammo and wingmen included).')]
        );
      }
      items.push(
        ['rock', `${rules.cold ? L('雪をかぶった岩', 'Snow-covered rocks') : L('大型の岩', 'Large rocks')} ×${world.obstacles.length}`, L('通行不可。砲弾を防ぐ遮蔽物として使える。', 'Impassable. Use them as cover from shells.')],
        ['ramp', L(`ジャンプ台 ×${world.ramps.length}`, `Ramps ×${world.ramps.length}`), L('勢いよく進入すると空中に跳躍する。', 'Hit one at speed to jump into the air.')],
        ['wrap', L(`マップ ${world.width}×${world.height}`, `Map ${world.width}×${world.height}`), L('上下左右がつながっている（端を越えると反対側へ）。', 'Wraps on every side (cross an edge to come out on the other).')]
      );
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
      L(['0時', '6時', '12時', '18時', '24時'], ['0:00', '6:00', '12:00', '18:00', '24:00']).forEach((s) => scale.append(el('span', '', s)));
      timeBox.replaceChildren(
        el('p', 'briefing-time-main', `DAY ${t.day}　${t.clockText}　${t.phaseIcon}${t.phaseName}`),
        bar,
        scale
      );

      // Operation name and objective (shown above the start time, name first)
      const opBox = this.dialog.querySelector('#briefing-operation');
      opBox.replaceChildren(
        kv(L('作戦名', 'Operation'), L(`「${this.operation.name}」`, `"${this.operation.name}"`), true),
        ...(this.operation.stage ? [kv(L('段階', 'Stage'), L(`第${this.operation.stage}段階（${this.operation.phase}）`, `Stage ${this.operation.stage} (${this.operation.phase})`))] : []),
        kv(L('目標', 'Objective'), this.operation.goal || L(`敵拠点${combat.bases.length}か所の制圧`, `Capture ${combat.bases.length} enemy compounds`))
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
      if (tank.isInfantry) {
        g.scale(1.4, 1.4);
        tank._paintInfantry(g);
        return c;
      }
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
      g.fillStyle = world.theme.mapBg;
      g.fillRect(0, 0, S, S);

      // Terrain (dimmed unless the terrain step is active)
      g.globalAlpha = stepId === 'terrain' ? 1 : 0.55;
      global.TacticalMap.drawTerrain(g, world, k); // js/tacticalMap.js
      g.globalAlpha = 1;

      // Compounds (fort icons): enemy-held in red, captured in green
      for (const b of combat.bases) {
        const px = b.x * k;
        const py = b.y * k;
        g.save();
        g.globalAlpha = stepId === 'terrain' ? 0.55 : 1;
        g.translate(px, py);
        g.scale(0.55, 0.55);
        if (global.FortIcon) {
          global.FortIcon.draw(g, b.cleared ? '#22c55e' : '#ef4444', 'rgba(255,255,255,0.9)', 2);
        }
        g.restore();
        g.font = '700 12px system-ui, "Segoe UI", sans-serif';
        g.textAlign = 'left';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        g.strokeText(b.name, px + 10, py + 4);
        g.fillStyle = '#fff';
        g.fillText(b.name, px + 10, py + 4);
      }

      // Operations HQ: where the sortie starts and where the platoon returns once the planet is secured
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
      g.strokeText(L('自軍小隊', 'Our platoon'), sx, sy + 27);
      g.fillStyle = '#bae6fd';
      g.fillText(L('自軍小隊', 'Our platoon'), sx, sy + 27);

      // Frame
      g.strokeStyle = 'rgba(148, 180, 218, 0.45)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, S - 1, S - 1);
    }

    // ------------------------------------------------------------------ Mio narration
    // Mio narrates the current step (after `delayMs` while the window is still booting up);
    // her call pops up at the screen centre when she starts talking
    _say(text, delayMs = 0) {
      this.mio.say(text, delayMs);
    }

    _stopTyping() {
      this.mio.stop();
    }
  }

  global.BriefingScene = BriefingScene;
})(window);
