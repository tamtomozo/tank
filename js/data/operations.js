(function (global) {
  'use strict';

  // Areas and the operations that can be launched in each, listed on the sortie-select screen
  // (js/areaSelect.js): pick an area, then an operation, then the briefing (js/briefing.js) follows.
  // Only areas with `available: true` can be chosen; the others are shown locked.
  //   area.code        short tag (HUD badge, area cards)
  //   area.name        name used in the briefing / HUD texts
  //   area.terrain     one-word terrain type shown on the card
  //   operation.name   operation name (briefing, after the 「」 quotes are added)
  //   operation.goal   one-line objective shown on the operation card

  const AREAS = [
    {
      id: 1,
      code: 'AREA 1',
      name: 'エリア1',
      terrain: '荒野',
      summary: '岩と涸れ川が続く乾いた荒野。敵は3つの地区に拠点を築いている。',
      available: true,
      operations: [
        {
          id: 'dust-hammer',
          name: '砂塵の鉄槌',
          goal: '3地区・6拠点の制圧',
          summary: '作戦本部から出撃し、地区ごとに敵拠点を制圧してエリア1を奪還する。全地区制圧後は作戦本部へ帰還。'
        }
      ]
    },
    {
      id: 2,
      code: 'AREA 2',
      name: 'エリア2',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      operations: []
    },
    {
      id: 3,
      code: 'AREA 3',
      name: 'エリア3',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      operations: []
    }
  ];

  const GameData = global.GameData || (global.GameData = {});
  GameData.AREAS = AREAS;
})(window);
