(function (global) {
  'use strict';

  // Tank tuning (radar chart), set on the briefing's 車両調整 step (js/tuningPanel.js) before a sortie.
  // Two units are tuned separately: the player's own tank and the wingmen (every wingman, including
  // reinforcements, shares the wingman tuning). Each axis has a level of TUNING_RULES.min..max and
  // the levels of one unit may add up to at most TUNING_RULES.budget points, so raising one axis
  // means lowering another. Stats per level: js/tuning.js.

  // Axis order = clockwise on the radar chart, starting at the top
  const TUNING_AXES = [
    {
      id: 'cannon',
      name: L('主砲・砲身強化', 'Main gun & barrel'),
      short: L('主砲', 'Gun'),
      desc: L('主砲ダメージ・弾速・爆風半径・射程。自機はLv4で連装砲、Lv5でプラズマレール砲。', 'Gun damage, shell speed, blast radius and range. Your tank gets twin guns at Lv4 and a plasma railgun at Lv5.')
    },
    {
      id: 'reload',
      name: L('自動装填機構', 'Autoloader'),
      short: L('装填', 'Reload'),
      desc: L('次弾装填時間を短縮し、連続砲撃による制圧力を高める。', 'Shortens the reload time for more sustained fire.')
    },
    {
      id: 'engine',
      name: L('高出力エンジン & 履帯', 'Engine & tracks'),
      short: L('機動', 'Mobility'),
      desc: L('最高速度・加速・旋回性を向上させる。', 'Raises top speed, acceleration and turning.')
    },
    {
      id: 'armor',
      name: L('複合装甲 & ERA', 'Composite armor & ERA'),
      short: L('装甲', 'Armor'),
      desc: L('最大HPと被弾軽減率を強化する。', 'Raises max HP and damage reduction.')
    }
  ];

  const TUNING_RULES = {
    min: 1,
    max: 5,
    budget: 12, // points per unit (all four axes at Lv3)
    standard: { cannon: 3, reload: 3, engine: 3, armor: 3 }
  };

  const TUNING_UNITS = [
    { id: 'player', name: L('自機', 'Your tank'), note: L('隊長車', 'Commander\'s tank') },
    { id: 'ally', name: L('僚機', 'Wingmen'), note: L('全僚機（補充機を含む）', 'All wingmen (replacements included)') }
  ];

  // Player's main gun per cannon level (HUD)
  const CANNON_TITLES = L(['105mm 戦車砲', '120mm 長砲身', '150mm 制退重砲', '連装 150mm 重砲', 'プラズマ・レール砲'],
    ['105mm tank gun', '120mm long barrel', '150mm heavy gun', 'Twin 150mm heavy guns', 'Plasma railgun']);

  const GameData = global.GameData || (global.GameData = {});
  GameData.TUNING_AXES = TUNING_AXES;
  GameData.TUNING_RULES = TUNING_RULES;
  GameData.TUNING_UNITS = TUNING_UNITS;
  GameData.CANNON_TITLES = CANNON_TITLES;
})(window);
