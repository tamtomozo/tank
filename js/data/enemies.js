(function (global) {
  'use strict';

  // Enemy unit data: tank/bunker specs and the names/descriptions shown on the briefing and the
  // after-action report. The garrison of each compound is set per operation (js/data/operations.js).
  // Read by CombatManager (js/combat/), BriefingScene (briefing.js) and ResultsReport (results.js).

  const ENEMY_SPECS = {
    // Anti-tank infantry (militia / guerrillas, industrial planet): a fire team on foot with
    // rocket launchers. Fragile, and a tank driving into it runs it over (js/combat/city.js)
    infantry: {
      hullColor: '#57534e',
      hullDark: '#292524',
      turretColor: '#78716c',
      accentColor: '#f97316',
      scale: 0.6,
      isInfantry: true,
      maxHp: 30,
      maxSpeed: 74,
      accel: 300,
      turnSpeed: 4.5,
      damage: 17,
      reloadTime: 4.2,
      shellSpeed: 400,
      splashRadius: 30,
      scrapValue: 8,
      preferredDist: 230
    },
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
    // Modern main battle tank of the home army (industrial planet): fast and well armoured
    modern: {
      hullColor: '#334155',
      hullDark: '#1e293b',
      turretColor: '#475569',
      accentColor: '#f43f5e',
      scale: 1.1,
      maxHp: 150,
      maxSpeed: 205,
      accel: 400,
      turnSpeed: 2.4,
      damage: 24,
      reloadTime: 2.2,
      shellSpeed: 520,
      splashRadius: 50,
      scrapValue: 60,
      preferredDist: 300
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
    // Gun turret on an elevated highway: fires down from above, out of reach of the tanks below
    // (stands at the deck height, js/combat/city.js)
    turret: {
      hullColor: '#3f3f46',
      hullDark: '#27272a',
      turretColor: '#52525b',
      accentColor: '#facc15',
      scale: 1.0,
      isBunker: true,
      maxHp: 120,
      maxSpeed: 0,
      accel: 0,
      turnSpeed: 0,
      damage: 20,
      reloadTime: 2.6,
      shellSpeed: 520,
      splashRadius: 48,
      scrapValue: 40,
      preferredDist: 400
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
      preferredDist: 360,
      boss: true
    },
    // Ace in snow camouflage (ice planet): hard to make out from afar, quick and accurate
    ace: {
      hullColor: '#e2e8f0',
      hullDark: '#94a3b8',
      turretColor: '#f1f5f9',
      accentColor: '#38bdf8',
      scale: 1.45,
      maxHp: 520,
      maxSpeed: 185,
      accel: 340,
      turnSpeed: 1.9,
      damage: 30,
      reloadTime: 1.7,
      shellSpeed: 560,
      splashRadius: 64,
      scrapValue: 200,
      preferredDist: 330,
      boss: true,
      camo: true
    },
    // Prototype super-heavy tank (industrial planet, the last boss): rolls out of the factory
    proto: {
      hullColor: '#1f2937',
      hullDark: '#0b0f17',
      turretColor: '#374151',
      accentColor: '#ef4444',
      scale: 2.05,
      maxHp: 980,
      maxSpeed: 112,
      accel: 220,
      turnSpeed: 1.05,
      damage: 44,
      reloadTime: 2.3,
      shellSpeed: 560,
      splashRadius: 86,
      scrapValue: 320,
      preferredDist: 320,
      boss: true
    }
  };

  // Display names + one-line role descriptions (briefing enemy intel, results kill breakdown)
  const ENEMY_INFO = {
    infantry: { name: '対戦車歩兵', role: '民兵とゲリラ。携行ロケットで戦車を狙う。脆く、戦車で轢けば倒せるが、建物の陰やマンホールから突然現れる。' },
    light: { name: '軽戦車', role: '高速で接近してくる突撃型。装甲は薄いが数が多い。' },
    medium: { name: '中戦車', role: '火力と装甲のバランスが取れた主力。正面からの撃ち合いに強い。' },
    modern: { name: '新型主力戦車', role: '本国軍の最新鋭戦車。中戦車より速く、装甲も厚い。装填も早い。' },
    heavy: { name: '重戦車', role: '鈍重だが装甲が厚く、一撃が重い。距離を取って確実に削ること。' },
    bunker: { name: 'トーチカ', role: '拠点の固定砲台。移動しないが耐久が高く、射程も長い。' },
    turret: { name: '高架砲台', role: '高架道路の上に据えられた砲台。高い位置から撃ち下ろしてくる。高架には登れないので、下から撃ち返すこと。' },
    boss: { name: '司令官車', role: '敵指揮官が乗る大型戦車。装甲・火力ともに桁違いで、装填も速い。' },
    ace: { name: 'エース重戦車', role: '雪原迷彩をまとったエースの重戦車。遠くからは雪に溶けて見えにくい。速く、正確に撃ってくる。' },
    proto: { name: '試作超重戦車', role: '工場で開発中だった超重戦車。装甲も主砲も桁違い。正面から撃ち合わず、僚機と囲んで削ること。' }
  };

  // Briefing / report order of the enemy kinds
  const ENEMY_KIND_ORDER = ['infantry', 'light', 'medium', 'modern', 'heavy', 'bunker', 'turret', 'boss', 'ace', 'proto'];

  const GameData = global.GameData || (global.GameData = {});
  GameData.ENEMY_SPECS = ENEMY_SPECS;
  GameData.ENEMY_INFO = ENEMY_INFO;
  GameData.ENEMY_KIND_ORDER = ENEMY_KIND_ORDER;
})(window);
