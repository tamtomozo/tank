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
        el('strong', 'operation-planet-name', `${planet.name}（${planet.terrain}）の作戦`),
        el('span', 'operation-planet-summary', planet.summary)
      );
      this.context.replaceChildren(global.PlanetGlobe.create(planet, 'is-small'), text);
      this.list.replaceChildren(...planet.operations.map((op) => this._card(op)));
      this.show(delayMs, (sayDelayMs) => {
        // Focus the next stage to play: the first open one not yet completed (else the first open one)
        const open = [...this.list.querySelectorAll('button:not([disabled])')];
        const next = open.find((b) => !b.classList.contains('is-cleared')) || open[0];
        if (next) next.focus();
        this.say(`${planet.name}の作戦は${planet.operations.length}段階です。前の段階を完了すると、次の作戦が解放されます。作戦を選んでください。`, sayDelayMs);
      });
    }

    // One stage of the planet's campaign; locked until the stage it requires is completed (js/campaign.js)
    _card(op) {
      const campaign = global.Campaign;
      const unlocked = campaign.isUnlocked(op);
      const cleared = campaign.isCleared(op.id);
      const card = el('button', 'op-card');
      card.type = 'button';
      if (cleared) card.classList.add('is-cleared');
      if (!unlocked) {
        card.classList.add('is-locked');
        card.disabled = true;
      }
      const body = el('div', 'op-card-body');
      const label = el('span', 'op-card-label', op.stage ? `第${op.stage}段階　${op.phase || ''}` : '作戦名');
      if (cleared) label.append(el('span', 'op-card-badge', '完了'));
      body.append(
        label,
        el('strong', 'op-card-name', unlocked ? `「${op.name}」` : '「？？？」'),
        el('p', 'op-card-goal', unlocked ? `目標: ${op.goal}` : '目標: 機密'),
        el('p', 'op-card-summary', unlocked ? op.summary : '前の段階の作戦を完了すると解放されます。')
      );
      card.append(body, el('span', 'op-card-go', unlocked ? 'ブリーフィングへ ▶' : '🔒 未解放'));
      if (unlocked) card.addEventListener('click', () => this.finish({ operation: op }));
      return card;
    }
  }

  global.OperationSelectScene = OperationSelectScene;
})(window);
