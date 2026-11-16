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
      name: '主砲・砲身強化',
      short: '主砲',
      desc: '主砲ダメージ・弾速・爆風半径・射程。自機はLv4で連装砲、Lv5でプラズマレール砲。'
    },
    {
      id: 'reload',
      name: '自動装填機構',
      short: '装填',
      desc: '次弾装填時間を短縮し、連続砲撃による制圧力を高める。'
    },
    {
      id: 'engine',
      name: '高出力エンジン & 履帯',
      short: '機動',
      desc: '最高速度・加速・旋回性・ターボ容量を向上させる。'
    },
    {
      id: 'armor',
      name: '複合装甲 & ERA',
      short: '装甲',
      desc: '最大HPと被弾軽減率を強化する。'
    }
  ];

  const TUNING_RULES = {
    min: 1,
    max: 5,
    budget: 12, // points per unit (all four axes at Lv3)
    standard: { cannon: 3, reload: 3, engine: 3, armor: 3 }
  };

  const TUNING_UNITS = [
    { id: 'player', name: '自機', note: '隊長車' },
    { id: 'ally', name: '僚機', note: '全僚機（補充機を含む）' }
  ];

  // Player's main gun per cannon level (HUD)
  const CANNON_TITLES = ['105mm 戦車砲', '120mm 長砲身', '150mm 制退重砲', '連装 150mm 重砲', 'プラズマ・レール砲'];

  // Sub weapon (right click / F): fixed equipment of the player's tank.
  // Level 1-2: coaxial autocannon (heat), 3-5: homing micro missiles (1-3 per salvo) — js/combat/weapons.js
  const SUB_WEAPON = {
    level: 3,
    titles: ['未装備', '同軸機銃', '20mm 機関砲', '誘導ミサイル', '2連装ミサイル', '3連装ミサイル']
  };

  const GameData = global.GameData || (global.GameData = {});
  GameData.TUNING_AXES = TUNING_AXES;
  GameData.TUNING_RULES = TUNING_RULES;
  GameData.TUNING_UNITS = TUNING_UNITS;
  GameData.CANNON_TITLES = CANNON_TITLES;
  GameData.SUB_WEAPON = SUB_WEAPON;
})(window);
