(function (global) {
  'use strict';

  // Upgrade catalogue shown in the garage (UpgradeManager, upgrades.js):
  // cost = baseCost + costStep * (level - 1); group 'player' = own tank, 'squad' = wingmen.

  const UPGRADE_DEFS = [
    {
      id: 'cannon',
      group: 'player',
      name: '主砲・砲身強化',
      maxLevel: 5,
      baseCost: 45,
      costStep: 40,
      desc: '主砲ダメージ・弾速・爆風半径が上昇。Lv4で連装砲、Lv5でプラズマレール砲へ換装。',
      titles: ['105mm 戦車砲', '120mm 長砲身', '150mm 制退重砲', '連装 150mm 重砲', 'プラズマ・レール砲']
    },
    {
      id: 'reload',
      group: 'player',
      name: '自動装填機構',
      maxLevel: 5,
      baseCost: 40,
      costStep: 35,
      desc: '次弾装填時間を大幅に短縮し、連続砲撃による制圧力を高める。'
    },
    {
      id: 'armor',
      group: 'player',
      name: '複合装甲 & ERA',
      maxLevel: 5,
      baseCost: 40,
      costStep: 38,
      desc: '最大HPと被弾軽減率を強化。車体側面と砲塔に爆発反応装甲(ERA)を追加装着。'
    },
    {
      id: 'engine',
      group: 'player',
      name: '高出力エンジン & 履帯',
      maxLevel: 5,
      baseCost: 35,
      costStep: 32,
      desc: 'キャタピラ駆動トルク・最高速度・旋回性・ターボ容量を向上させる。'
    },
    {
      id: 'subweapon',
      group: 'player',
      name: '副兵装 (右クリック/F)',
      maxLevel: 5,
      baseCost: 50,
      costStep: 45,
      desc: 'Lv1-2: 同軸オートキャノンを装備。Lv3-5: 追尾マイクロミサイルポッドを搭載。',
      titles: ['未装備', '同軸機銃', '20mm 機関砲', '誘導ミサイル', '2連装ミサイル', '3連装ミサイル']
    },
    {
      id: 'repair',
      group: 'player',
      name: '緊急装甲修復',
      maxLevel: 99,
      baseCost: 25,
      costStep: 0,
      isRepair: true,
      desc: '保有スクラップを消費し、車体HPを最大値の55%分ただちに修復する。'
    },
    // ---- Platoon (wingman-only) upgrades: apply to every current and future wingman ----
    {
      id: 'allyArmor',
      group: 'squad',
      name: '僚機装甲',
      maxLevel: 5,
      baseCost: 40,
      costStep: 35,
      desc: '全僚機の最大HPと被弾軽減率を強化し、前線での生存力を高める。'
    },
    {
      id: 'allyGun',
      group: 'squad',
      name: '僚機主砲',
      maxLevel: 5,
      baseCost: 45,
      costStep: 38,
      desc: '全僚機の主砲ダメージ・弾速・爆風半径を強化し、装填時間を短縮する。'
    },
    {
      id: 'allyEngine',
      group: 'squad',
      name: '僚機機動力',
      maxLevel: 5,
      baseCost: 35,
      costStep: 30,
      desc: '全僚機の最高速度・加速・旋回性・ターボ容量を強化。散開と隊列復帰が素早くなる。'
    },
    {
      id: 'reinforce',
      group: 'squad',
      name: '僚機補充',
      maxLevel: 99,
      baseCost: 70,
      costStep: 0,
      isReinforce: true,
      desc: '撃破された僚機を1両補充する。小隊は自機を含め最大5両。補充機も小隊強化を引き継ぐ。'
    }
  ];

  const GROUP_TITLES = {
    player: '自機の強化',
    squad: '小隊（僚機）の強化'
  };

  const GameData = global.GameData || (global.GameData = {});
  GameData.UPGRADE_DEFS = UPGRADE_DEFS;
  GameData.UPGRADE_GROUP_TITLES = GROUP_TITLES;
})(window);
