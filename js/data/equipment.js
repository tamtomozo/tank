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
  //   cage        -35% damage from near misses (blasts that are not a direct hit)
  // How they are applied: js/loadout.js.

  const EQUIPMENT = [
    { id: 'cooler', name: '冷却装置', icon: '❄', desc: 'エンジンの過熱が半分の速さになり、冷えるのも1.5倍速い。' },
    { id: 'filter', name: '防塵フィルター', icon: '◎', desc: '砂嵐の中でも照準できる距離が1.6倍。砂煙で見つかる距離も15%短くなる。' },
    { id: 'heater', name: 'エンジンヒーター', icon: '♨', desc: '止まっていても車体が冷えにくい（低温の進み方が1/4）。' },
    { id: 'wideTracks', name: '幅広の履帯', icon: '≡', desc: '氷にかかる重さが半分になり、止まっても割れにくい（小隊全車）。' },
    { id: 'addArmor', name: '増加装甲', icon: '▣', desc: '最大装甲+25%（小隊全車）。重くなるため最高速度−8%。' },
    { id: 'cage', name: 'ケージ装甲', icon: '#', desc: '至近弾の爆風ダメージ−35%（小隊全車）。直撃には効かない。' }
  ];

  const EQUIP_SLOTS = 2;

  const GameData = global.GameData || (global.GameData = {});
  GameData.EQUIPMENT = EQUIPMENT;
  GameData.EQUIP_SLOTS = EQUIP_SLOTS;
})(window);
