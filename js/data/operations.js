(function (global) {
  'use strict';

  // Planets and the operations that can be launched on each. The sortie select runs over two
  // screens (js/sortieSelect.js): pick a planet (js/planetSelect.js), then one of its operations
  // (js/operationSelect.js), then the briefing (js/briefing.js) follows.
  // Only planets with `available: true` can be chosen; the others are shown locked.
  //   planet.code      short tag (planet cards, tactical-map caption)
  //   planet.name      name used in the briefing / radio / report texts
  //   planet.terrain   one-word terrain type shown on the card
  //   planet.globe     look of the turning globe on the cards (js/planetGlobe.js)
  //                      base / dark / light: surface colours, glow: atmosphere,
  //                      style: 'desert' | 'ice' | 'volcanic', seed: surface pattern
  //   operation.name   operation name (briefing, after the 「」 quotes are added)
  //   operation.goal   one-line objective shown on the operation card

  const PLANETS = [
    {
      id: 1,
      code: 'PLANET 01',
      name: '惑星アリダ',
      terrain: '荒野',
      summary: '岩と涸れ川が続く乾いた荒野の惑星。敵は3つの地区に拠点を築いている。',
      available: true,
      globe: { style: 'desert', base: '#b7793f', dark: '#6f4322', light: '#e6b77c', glow: '#f59e0b', seed: 11 },
      operations: [
        {
          id: 'dust-hammer',
          name: '砂塵の鉄槌',
          goal: '3地区・6拠点の制圧',
          summary: '作戦本部から出撃し、地区ごとに敵拠点を制圧して惑星アリダを奪還する。全地区制圧後は作戦本部へ帰還。'
        }
      ]
    },
    {
      id: 2,
      code: 'PLANET 02',
      name: '惑星グラキス',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      globe: { style: 'ice', base: '#8db4cc', dark: '#4b7390', light: '#eef7fc', glow: '#7dd3fc', seed: 23 },
      operations: []
    },
    {
      id: 3,
      code: 'PLANET 03',
      name: '惑星ヴァルカ',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      globe: { style: 'volcanic', base: '#4a3330', dark: '#221614', light: '#ff7a3a', glow: '#f97316', seed: 37 },
      operations: []
    }
  ];

  const GameData = global.GameData || (global.GameData = {});
  GameData.PLANETS = PLANETS;
})(window);
