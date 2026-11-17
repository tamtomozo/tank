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
        const first = this.list.querySelector('button');
        if (first) first.focus();
        this.say(`${planet.name}で実行可能な作戦です。作戦名を選んでください。選んだ作戦のブリーフィングに移ります。`, sayDelayMs);
      });
    }

    _card(op) {
      const card = el('button', 'op-card');
      card.type = 'button';
      const body = el('div', 'op-card-body');
      body.append(
        el('span', 'op-card-label', '作戦名'),
        el('strong', 'op-card-name', `「${op.name}」`),
        el('p', 'op-card-goal', `目標: ${op.goal}`),
        el('p', 'op-card-summary', op.summary)
      );
      card.append(body, el('span', 'op-card-go', 'ブリーフィングへ ▶'));
      card.addEventListener('click', () => this.finish({ operation: op }));
      return card;
    }
  }

  global.OperationSelectScene = OperationSelectScene;
})(window);
