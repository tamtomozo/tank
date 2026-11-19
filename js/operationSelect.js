(function (global) {
  'use strict';

  // ② Operation select (#operation-dialog): the operations that can be launched on the planet
  // picked on ① (js/planetSelect.js). Picking one closes this screen and js/sortieSelect.js hands
  // { planet, operation } on to the briefing. ◀ 惑星選択に戻る / Esc goes back to the planet select.

  const { el } = global.TankUtil;

  class OperationSelectScene extends global.SortieScreen {
    constructor(dialog, audio) {
      super(dialog, audio);
      this.context = dialog.querySelector('#operation-planet');
      this.list = dialog.querySelector('#op-list');
      this.planet = null; // planet whose operations are listed

      dialog.querySelector('#operation-back').addEventListener('click', () => this.finish({ back: true }));
      dialog.addEventListener('cancel', () => this.finish({ back: true }));
    }

    open(planet, delayMs) {
      this.planet = planet;
      const text = el('div', 'operation-planet-text');
      text.append(
        el('span', 'sortie-code', planet.code),
        el('strong', 'operation-planet-name', L(`${planet.name}（${planet.terrain}）の作戦`, `Operations on ${planet.name} (${planet.terrain})`)),
        el('span', 'operation-planet-summary', planet.summary)
      );
      this.context.replaceChildren(global.PlanetGlobe.create(planet, 'is-small'), text);
      this.list.replaceChildren(...planet.operations.map((op) => this._card(op)), this._sweepCard(planet));
      this.show(delayMs, (sayDelayMs) => {
        // Focus the next stage to play: the first open one not yet completed (else the first open one)
        const open = [...this.list.querySelectorAll('button:not([disabled])')];
        const next = open.find((b) => !b.classList.contains('is-cleared')) || open[0];
        if (next) next.focus();
        const sweepOpen = global.Sweep.isUnlocked(planet);
        this.say(L(`${planet.name}の作戦は${planet.operations.length}段階です。前の段階を完了すると、次の作戦が解放されます。`
          + (sweepOpen ? '全段階を完了したので、掃討作戦も選べます。' : '全段階を完了すると、掃討作戦が解放されます。') + '作戦を選んでください。',
        `The campaign on ${planet.name} has ${planet.operations.length} stages. Completing one unlocks the next. `
          + (sweepOpen ? 'With every stage complete, the sweep operation is open too. ' : 'Completing every stage unlocks the sweep operation. ') + 'Please choose an operation.'), sayDelayMs);
      });
    }

    // Sweep operation (js/sweep.js): opens once every stage of the planet is completed; shows the
    // planet's best run
    _sweepCard(planet) {
      const unlocked = global.Sweep.isUnlocked(planet);
      const op = global.Sweep.operationFor(planet);
      const fmt = global.Sweep.formatTime;
      const rec = global.Campaign.sweepRecord(planet.id);
      const card = el('button', 'op-card is-sweep');
      card.type = 'button';
      if (rec && rec.captured >= global.Sweep.TOTAL) card.classList.add('is-cleared');
      if (!unlocked) {
        card.classList.add('is-locked');
        card.disabled = true;
      }
      const body = el('div', 'op-card-body');
      body.append(
        el('strong', 'op-card-name', unlocked ? `「${op.name}」` : '「？？？」'),
        el('p', 'op-card-goal', unlocked ? L(`目標: ${op.goal}`, `Objective: ${op.goal}`) : L('目標: 機密', 'Objective: classified')),
        el('p', 'op-card-summary', unlocked ? op.summary : L(`${planet.name}の作戦をすべて完了すると解放されます。`, `Unlocked by completing every operation on ${planet.name}.`))
      );
      if (unlocked && rec) {
        const lap = rec.bestLap != null ? L(` ／ ベストラップ ${fmt(rec.bestLap)}`, ` · Best lap ${fmt(rec.bestLap)}`) : '';
        body.append(el('p', 'op-card-record', L(`最高記録: ${rec.captured} / ${global.Sweep.TOTAL} 拠点 ${fmt(rec.time)}${lap}`,
          `Best run: ${rec.captured} / ${global.Sweep.TOTAL} compounds in ${fmt(rec.time)}${lap}`)));
      }
      card.append(body, el('span', 'op-card-go', unlocked ? L('ブリーフィングへ ▶', 'To briefing ▶') : L('🔒 未解放', '🔒 Locked')));
      if (unlocked) card.addEventListener('click', () => this.finish({ operation: op }));
      return card;
    }

    // Why a stage is still locked: the previous stage, or (first stage) the previous planet's last one
    _lockNote(op) {
      const other = global.GameData.PLANETS.find((p) => p !== this.planet && p.operations.some((o) => o.id === op.requires));
      return other
        ? L(`${other.name}の作戦をすべて完了すると解放されます。`, `Unlocked by completing every operation on ${other.name}.`)
        : L('前の段階の作戦を完了すると解放されます。', 'Unlocked by completing the previous stage.');
    }

    // One stage of the planet's campaign; locked until the stage it requires is completed (js/campaign.js)
    _card(op) {
      const campaign = global.Campaign;
      const unlocked = campaign.isUnlocked(op);
      const cleared = campaign.isCleared(op.id);
      const rank = cleared ? campaign.bestRank(op.id) : null;
      const card = el('button', 'op-card');
      card.type = 'button';
      if (cleared) card.classList.add('is-cleared');
      if (!unlocked) {
        card.classList.add('is-locked');
        card.disabled = true;
      }
      const body = el('div', 'op-card-body');
      body.append(
        el('strong', 'op-card-name', unlocked ? `「${op.name}」` : '「？？？」'),
        el('p', 'op-card-goal', unlocked ? L(`目標: ${op.goal}`, `Objective: ${op.goal}`) : L('目標: 機密', 'Objective: classified')),
        el('p', 'op-card-summary', unlocked ? op.summary : this._lockNote(op))
      );
      // A completed stage shows the medal of its best result; the metal tells how well it went
      if (cleared) card.append(this._medal(rank));
      card.append(body, el('span', 'op-card-go', unlocked ? L('ブリーフィングへ ▶', 'To briefing ▶') : L('🔒 未解放', '🔒 Locked')));
      if (unlocked) card.addEventListener('click', () => this.finish({ operation: op }));
      return card;
    }

    // Medal of a completed stage (rank null: completed before ranks were kept → plain medal)
    _medal(rank) {
      const Medal = global.Medal;
      const box = el('span', 'op-card-medal');
      const medal = Medal.create(rank || 'C', rank ? '' : 'is-unranked');
      const title = rank ? L(`${Medal.name(rank)}（${Medal.grade(rank)}）`, `${Medal.name(rank)} (${Medal.grade(rank)})`) : L('作戦完了', 'Completed');
      medal.setAttribute('aria-label', L(`作戦完了 — ${title}`, `Completed — ${title}`));
      box.title = rank ? L(`最高評価: ${title}`, `Best rating: ${title}`) : L('作戦完了（評価の記録なし — 再出撃で記録されます）', 'Completed (no rating on record — sortie again to record one)');
      box.append(medal);
      if (rank) {
        box.append(el('span', 'op-card-medal-name', Medal.name(rank)));
        box.dataset.rank = rank;
      }
      return box;
    }
  }

  global.OperationSelectScene = OperationSelectScene;
})(window);
