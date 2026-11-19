(function (global) {
  'use strict';

  // ① Planet select (#planet-dialog): one card per planet with its turning globe
  // (js/planetGlobe.js). Locked planets are shown but can't be picked. Picking a planet closes this
  // screen; js/sortieSelect.js then opens that planet's operation list (js/operationSelect.js).
  // Esc does nothing here: there is no sortie without a planet.
  // Right after a completed operation, the medal it earned is presented first, cutting in over
  // this screen (js/medalAward.js); Mio's guidance follows once it is dismissed.

  const { PLANETS } = global.GameData; // js/data/operations.js
  const { el } = global.TankUtil;

  class PlanetSelectScene extends global.SortieScreen {
    constructor(dialog, audio) {
      super(dialog, audio);
      this.list = dialog.querySelector('#planet-list');
      this.focusId = null; // planet whose card gets the keyboard focus
      this.award = new global.MedalAward(dialog, audio);
      dialog.addEventListener('close', () => this.award.stop());
    }

    // focusId: planet the player just came back from (keeps the focus on its card)
    // award: medal to present first (js/medalAward.js), or null
    open(focusId, delayMs, award = null) {
      this.focusId = focusId != null ? focusId : (PLANETS.find((p) => p.available) || {}).id;
      this.list.replaceChildren(...PLANETS.map((planet) => this._card(planet)));
      this.show(delayMs, (sayDelayMs) => {
        const guide = (delay) => {
          const focus = this.list.querySelector(`[data-planet-id="${this.focusId}"]`);
          if (focus) focus.focus();
          const ready = PLANETS.filter((p) => p.available).map((p) => p.name).join(L('、', ', '));
          this.say(L(`隊長、出撃する惑星を選択してください。現在、出撃可能なのは${ready}です。`, `Commander, please choose a planet to deploy to. Currently available: ${ready}.`), delay);
        };
        if (award) this.award.show(award, sayDelayMs, () => guide(300));
        else guide(sayDelayMs);
      });
    }

    _card(planet) {
      const card = el('button', `planet-card${planet.available ? '' : ' is-locked'}`);
      card.type = 'button';
      card.dataset.planetId = String(planet.id);
      card.disabled = !planet.available;

      const head = el('div', 'planet-card-head');
      head.append(
        el('span', 'sortie-code', planet.code),
        el('span', `planet-card-state${planet.available ? '' : ' is-locked'}`, planet.available ? L('出撃可能', 'Available') : L('未解放', 'Locked'))
      );
      const info = el('div', 'planet-card-info');
      info.append(
        head,
        el('strong', 'planet-card-name', planet.name),
        el('span', 'planet-card-terrain', L(`地形: ${planet.terrain}`, `Terrain: ${planet.terrain}`)),
        el('p', 'planet-card-summary', planet.summary),
        el('p', 'planet-card-ops', planet.available ? L(`作戦 ${planet.operations.length} 件`, `${planet.operations.length} operations`) : L('作戦なし', 'No operations'))
      );
      card.append(global.PlanetGlobe.create(planet), info);

      if (planet.available) {
        card.addEventListener('click', () => {
          this.focusId = planet.id;
          this.finish({ planet });
        });
      }
      return card;
    }
  }

  global.PlanetSelectScene = PlanetSelectScene;
})(window);
