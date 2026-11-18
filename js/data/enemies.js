(function (global) {
  'use strict';

  // Enemy unit data: tank/bunker specs and the names/descriptions shown on the briefing and the
  // after-action report. The garrison of each compound is set per operation (js/data/operations.js).
  // Read by CombatManager (js/combat/), BriefingScene (briefing.js) and ResultsReport (results.js).

  const ENEMY_SPECS = {
    light: {
      hullColor: '#991b1b',
      hullDark: '#7f1d1d',
      turretColor: '#b91c1c',
      accentColor: '#fca5a5',
      scale: 0.8,
      maxHp: 55,
      maxSpeed: 245,
      accel: 460,
      turnSpeed: 3.1,
      damage: 11,
      reloadTime: 2.1,
      shellSpeed: 440,
      splashRadius: 38,
      scrapValue: 26,
      preferredDist: 230
    },
    medium: {
      hullColor: '#7f1d1d',
      hullDark: '#450a0a',
      turretColor: '#991b1b',
      accentColor: '#f97316',
      scale: 1.0,
      maxHp: 105,
      maxSpeed: 175,
      accel: 340,
      turnSpeed: 2.1,
      damage: 18,
      reloadTime: 2.5,
      shellSpeed: 470,
      splashRadius: 46,
      scrapValue: 42,
      preferredDist: 290
    },
    heavy: {
      hullColor: '#451a03',
      hullDark: '#271002',
      turretColor: '#78350f',
      accentColor: '#fbbf24',
      scale: 1.28,
      maxHp: 210,
      maxSpeed: 130,
      accel: 260,
      turnSpeed: 1.5,
      damage: 28,
      reloadTime: 3.0,
      shellSpeed: 500,
      splashRadius: 56,
      scrapValue: 75,
      preferredDist: 340
    },
    bunker: {
      hullColor: '#334155',
      hullDark: '#1e293b',
      turretColor: '#475569',
      accentColor: '#ef4444',
      scale: 1.15,
      isBunker: true,
      maxHp: 150,
      maxSpeed: 0,
      accel: 0,
      turnSpeed: 0,
      damage: 22,
      reloadTime: 2.7,
      shellSpeed: 520,
      splashRadius: 52,
      scrapValue: 55,
      preferredDist: 380
    },
    boss: {
      hullColor: '#4c1d95',
      hullDark: '#2e1065',
      turretColor: '#6d28d9',
      accentColor: '#f43f5e',
      scale: 1.75,
      maxHp: 560,
      maxSpeed: 145,
      accel: 280,
      turnSpeed: 1.35,
      damage: 34,
      reloadTime: 1.9,
      shellSpeed: 540,
      splashRadius: 72,
      scrapValue: 220,
      preferredDist: 360
    }
  };

  // Display names + one-line role descriptions (briefing enemy intel, results kill breakdown)
  const ENEMY_INFO = {
    light: { name: '軽戦車', role: '高速で接近してくる突撃型。装甲は薄いが数が多い。' },
    medium: { name: '中戦車', role: '火力と装甲のバランスが取れた主力。正面からの撃ち合いに強い。' },
    heavy: { name: '重戦車', role: '鈍重だが装甲が厚く、一撃が重い。距離を取って確実に削ること。' },
    bunker: { name: 'トーチカ', role: '拠点の固定砲台。移動しないが耐久が高く、射程も長い。' },
    boss: { name: '司令官車', role: '敵指揮官が乗る大型戦車。装甲・火力ともに桁違いで、装填も速い。' }
  };

  // Briefing / report order of the enemy kinds
  const ENEMY_KIND_ORDER = ['light', 'medium', 'heavy', 'bunker', 'boss'];

  const GameData = global.GameData || (global.GameData = {});
  GameData.ENEMY_SPECS = ENEMY_SPECS;
  GameData.ENEMY_INFO = ENEMY_INFO;
  GameData.ENEMY_KIND_ORDER = ENEMY_KIND_ORDER;
})(window);
