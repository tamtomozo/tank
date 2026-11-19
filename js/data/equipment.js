(function (global) {
  'use strict';

  // Equipment fitted to the platoon before a sortie (briefing step 装備・整備, js/loadoutPanel.js).
  // EQUIP_SLOTS items can be fitted at once; the choice is kept by the campaign (js/campaign.js).
  // Each planet recommends its own pair (planet.gear in js/data/operations.js), but any item can
  // be fitted anywhere. Effects (all tanks of the platoon unless noted):
  //   cooler      engine heat rises at half the rate and cools 1.5x faster (player's tank: hazards.js)
  //   filter      in a sandstorm the lock-on reaches 1.6x as far; dust gives the platoon away 15% less
  //   heater      a standing tank chills at a quarter of the rate (player's tank: hazards.js)
  //   wideTracks  half the load on the ice of a frozen lake (js/combat/ice.js)
  //   addArmor    +25% armour (max HP), -8% top speed
  //   cage        -35% damage from near misses (blasts that are not a direct hit); the rockets of
//               anti-tank infantry do 55% less, direct hits included
  // How they are applied: js/loadout.js.

  const EQUIPMENT = [
    { id: 'cooler', name: L('冷却装置', 'Cooling unit'), icon: '❄', desc: L('エンジンの過熱が半分の速さになり、冷えるのも1.5倍速い。', 'The engine heats up half as fast and cools 1.5× faster.') },
    { id: 'filter', name: L('防塵フィルター', 'Dust filter'), icon: '◎', desc: L('砂嵐の中でも照準できる距離が1.6倍。砂煙で見つかる距離も15%短くなる。', 'Aim 1.6× farther inside sandstorms. Your dust gives you away from 15% less far.') },
    { id: 'heater', name: L('エンジンヒーター', 'Engine heater'), icon: '♨', desc: L('止まっていても車体が冷えにくい（低温の進み方が1/4）。', 'The tank stays warm while standing still (chills at 1/4 the rate).') },
    { id: 'wideTracks', name: L('幅広の履帯', 'Wide tracks'), icon: '≡', desc: L('氷にかかる重さが半分になり、止まっても割れにくい（小隊全車）。', 'Halves the load on the ice, so it cracks less when you stop (whole platoon).') },
    { id: 'addArmor', name: L('増加装甲', 'Add-on armor'), icon: '▣', desc: L('最大装甲+25%（小隊全車）。重くなるため最高速度−8%。', 'Max armor +25% (whole platoon). The extra weight costs 8% top speed.') },
    { id: 'cage', name: L('ケージ装甲', 'Cage armor'), icon: '#', desc: L('至近弾の爆風ダメージ−35%、歩兵のロケットは直撃でも−55%（小隊全車）。戦車砲の直撃には効かない。', 'Blast damage from near misses −35%, infantry rockets −55% even on a direct hit (whole platoon). No help against direct tank-gun hits.') }
  ];

  const EQUIP_SLOTS = 2;

  const GameData = global.GameData || (global.GameData = {});
  GameData.EQUIPMENT = EQUIPMENT;
  GameData.EQUIP_SLOTS = EQUIP_SLOTS;
})(window);
