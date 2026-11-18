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
  //   planet.hazards   environment rules shared by every operation on the planet (js/game/hazards.js)
  //                      heat: the engine overheats on a long run at full speed
  //                      dust: the dust a moving tank kicks up lets compounds spot it from farther away
  //
  // An operation is one stage of the planet's campaign; a stage is unlocked once the one named in
  // `requires` has been completed (js/campaign.js).
  //   operation.stage / phase   stage number and its role in the campaign (侵食 / 決戦 / 斬首 …)
  //   operation.name / goal / summary   operation card + briefing texts
  //   operation.startTime       time of day the sortie starts at (0..1, 0.25 = 06:00)
  //   operation.sites           enemy compounds, each captured by destroying its garrison:
  //                               slot: one of the compound sites generated with the map (js/planet/terrain.js)
  //                               or x / y / rot: a fixed position (the rocks around it are cleared)
  //                               garrison: { tier, bunkers, tanks: [kinds] } (js/data/enemies.js)
  //   operation.zones           areas laid over the map for this operation (js/planet/zones.js):
  //                               saltflat: a flat white plain with no rocks; city: an old town of buildings
  //   operation.weather         sandstorm: { firstCalm, calm, ramp, peak } seconds (js/game/hazards.js)
  //   operation.mirage          distant enemies shimmer and show off their real position (daytime)
  //   operation.longRange       { enemy: range scale, player: lock-on range bonus }
  //   operation.hold            after every compound falls: hold the area around sites[site] for
  //                             `duration` s while enemy reinforcements arrive in waves
  //   operation.bossName        title of the boss health bar
  //   operation.scenario        the general's overview on the briefing (prehead / catch / deck / lead)
  //   operation.mio             Mio's briefing lines for the operation / enemy / terrain steps
  //   operation.radio           Mio's in-game lines: start (sortie begins), complete (objective done)

  const PLANETS = [
    {
      id: 1,
      code: 'PLANET 01',
      name: '惑星ザハル',
      terrain: '砂漠',
      summary: '砂丘と塩の平原、オアシス都市が点在する砂漠の惑星。本国から遠い辺境の守備軍が駐留している。',
      available: true,
      globe: { style: 'desert', base: '#c08a4a', dark: '#7a4d26', light: '#ecc58c', glow: '#f59e0b', seed: 11 },
      hazards: { heat: true, dust: true },
      operations: [
        {
          id: 'zahar-1',
          stage: 1,
          phase: '侵食',
          name: '渇きの楔',
          goal: '水源プラントと国境監視所2か所の制圧',
          summary: '敵拠点への水の供給を断ち、砂嵐に紛れて国境の監視所を潰す。',
          startTime: 0.33,
          weather: { sandstorm: { firstCalm: 24, calm: 40, ramp: 6, peak: 20 } },
          sites: [
            { slot: 0, name: '水源プラント', garrison: { tier: 0, bunkers: 1, tanks: ['light', 'light', 'medium'] } },
            { slot: 2, name: '監視所A', garrison: { tier: 0, bunkers: 1, tanks: ['light', 'light'] } },
            { slot: 5, name: '監視所B', garrison: { tier: 1, bunkers: 2, tanks: ['light', 'medium'] } }
          ],
          scenario: {
            prehead: '惑星ザハル攻略の第一段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '砂漠で最も強い武器は、水だ。',
            deck: '辺境の守備軍は、ひとつの水源プラントに命を預けている。その蛇口を閉めるのが、我々の最初の一手だ。',
            lead: '水源プラントを押さえ、国境の監視所を潰せ。この星の砂嵐は視界を奪うが、それは敵も同じこと。'
              + '嵐に紛れて近づけば、監視所は砲声を聞くまで君たちに気づかない。'
              + '作戦名「渇きの楔」――この楔が、敵の守りに最初のひびを入れる。'
          },
          mio: {
            tactical: '目標は水源プラントと、国境の監視所2か所です。順番は任せます。'
              + 'この惑星ではときどき砂嵐が来ます。嵐の中では敵もこちらを見つけられません。近づくチャンスに使ってください。',
            enemies: '敵は旧式の軽戦車と中戦車、それにトーチカです。数は少ないですが、拠点の守りは固めてあります。',
            terrain: '注意点が三つあります。全速で走り続けるとエンジンがオーバーヒートします。'
              + '速く走るほど砂煙が上がって、遠くの拠点にも気づかれやすくなります。'
              + 'そして砂嵐。視界はほぼゼロになりますが、敵の目も同じです。準備ができたら出撃してください。'
          },
          radio: {
            start: [
              'こちら作戦本部、ミオです。作戦「渇きの楔」を開始します。目標は水源プラントと監視所2か所です。',
              '全速で走り続けるとエンジンが過熱します。砂煙にも気をつけて、隊長。'
            ],
            complete: [
              '水源プラントと国境の監視所、すべて制圧を確認しました。敵の補給線に楔が入りました。',
              '作戦本部へ帰還してください、隊長。'
            ]
          }
        },
        {
          id: 'zahar-2',
          stage: 2,
          phase: '決戦',
          name: '塩原の砲声',
          goal: '塩の平原の砲兵陣地2か所と、司令官の重戦車小隊の撃破',
          summary: '遮蔽物のない塩の平原で、守備軍の主力と遠距離で撃ち合う。',
          requires: 'zahar-1',
          startTime: 0.40,
          zones: [{ kind: 'saltflat', x: 2400, y: 1250, radius: 900, seed: 31 }],
          mirage: true,
          longRange: { enemy: 1.25, player: 170 },
          bossName: '⚠ 守備軍司令官車',
          sites: [
            { x: 1960, y: 1520, rot: 0.6, name: '西砲兵陣地', garrison: { tier: 1, bunkers: 2, tanks: ['medium', 'heavy'] } },
            { x: 2840, y: 1520, rot: 2.2, name: '東砲兵陣地', garrison: { tier: 1, bunkers: 2, tanks: ['medium', 'heavy'] } },
            { x: 2400, y: 820, rot: 1.0, name: '司令官隊', garrison: { tier: 1, bunkers: 0, tanks: ['boss', 'heavy', 'heavy'] } }
          ],
          scenario: {
            prehead: '惑星ザハル攻略の第二段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '隠れる場所はない。だから、先に当てた者が勝つ。',
            deck: '水を断たれた守備軍は、塩の平原に主力を集めた。司令官みずから重戦車を率いて、決着をつけに来る。',
            lead: '平原には岩ひとつない。照準の長さと、撃つ瞬間の判断がすべてだ。'
              + '昼の平原には蜃気楼が立つ。遠くの敵は揺らいで見え、狙いは外れやすい。焦らず距離を詰めよ。'
              + '作戦名「塩原の砲声」――この砲声で、ザハルの空気を変えろ。'
          },
          mio: {
            tactical: '目標は塩の平原にある砲兵陣地2か所と、司令官の重戦車小隊です。'
              + '平原は作戦本部の北に広がっています。この作戦では照準距離を延ばしてありますが、敵の射程も長くなっています。',
            enemies: '敵は重戦車と中戦車、トーチカ。そして司令官の乗る大型の司令官車です。司令官車は装甲も火力も桁違いです。',
            terrain: '塩の平原には遮蔽物がまったくありません。昼間は蜃気楼で遠くの敵の位置が揺らいで見えます。'
              + '遠すぎる敵には当たりにくいので、ある程度近づいてから撃ってください。'
          },
          radio: {
            start: [
              'ミオです。作戦「塩原の砲声」を開始します。目標は北の塩の平原、砲兵陣地2か所と司令官隊です。',
              '平原では蜃気楼が出ます。遠くの敵は見えている位置にいるとは限りません。'
            ],
            complete: [
              '司令官隊の撃破を確認……守備軍の主力は壊滅です！ やりました、隊長。',
              '作戦本部へ帰還してください。'
            ]
          }
        },
        {
          id: 'zahar-3',
          stage: 3,
          phase: '斬首',
          name: '砂の玉座',
          goal: 'オアシス都市の総督府を制圧し、歩兵の突入まで周囲を封鎖',
          summary: '迷路のような旧市街を抜けて総督府を落とし、歩兵部隊の突入を援護する。',
          requires: 'zahar-2',
          startTime: 0.64,
          zones: [{ kind: 'city', x: 4000, y: 2400, radius: 760, plaza: 250, seed: 77 }],
          sites: [
            { x: 3130, y: 2400, rot: 0, name: '西門守備隊', garrison: { tier: 1, bunkers: 1, tanks: ['light', 'medium', 'medium'] } },
            { x: 4000, y: 2400, rot: 0.3, name: '総督府', garrison: { tier: 2, bunkers: 2, tanks: ['light', 'light', 'medium', 'medium', 'heavy'] } }
          ],
          hold: {
            site: 1,
            radius: 300,
            duration: 60,
            waveEvery: 11,
            waveSize: 2,
            kinds: ['light', 'medium', 'medium'],
            spawnDist: [880, 1020]
          },
          scenario: {
            prehead: '惑星ザハル攻略の最終段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '玉座に届くのは、狭い路地を抜けた者だけだ。',
            deck: '主力を失った守備軍は、オアシス都市の総督府に立てこもった。ここを落とせば、ザハルの戦いは終わる。',
            lead: '旧市街の路地は狭く、角を曲がれば目の前に敵がいる。平原で鍛えた遠距離の勘は、ここでは通じない。'
              + '総督府を制圧したら、歩兵部隊が突入するまで周囲を封鎖せよ。敵の増援は必ず来る。'
              + '作戦名「砂の玉座」――その玉座から、敵を引きずり下ろせ。'
          },
          mio: {
            tactical: '目標はオアシス都市の総督府です。都市は作戦本部の東にあります。手前の西門には守備隊がいます。'
              + '総督府を制圧したら、歩兵部隊が突入を終えるまで60秒間、総督府のまわりを封鎖してください。',
            enemies: '敵は総督府の守備隊と、封鎖中に駆けつける増援です。重戦車もいます。路地の角での出会い頭に注意してください。',
            terrain: '旧市街は建物が密集していて、建物は砲弾を通しません。通りは狭く、行き止まりもあります。'
              + '東西と南北の大通りは総督府まで抜けています。迷ったら大通りを使ってください。'
          },
          radio: {
            start: [
              'ミオです。作戦「砂の玉座」を開始します。目標は東のオアシス都市、総督府です。',
              '旧市街は狭い路地ばかりです。出会い頭に気をつけてください。'
            ],
            holdStart: [
              '総督府を制圧！ 歩兵部隊が突入を開始します。',
              '突入が終わるまで60秒、総督府のまわりの円から離れないでください。敵の増援が来ます！'
            ],
            complete: [
              '歩兵部隊が総督府を確保しました！ 惑星ザハルの守備軍は降伏です。',
              'お疲れさまでした、隊長。作戦本部へ帰還してください。'
            ]
          }
        }
      ]
    },
    {
      id: 2,
      code: 'PLANET 02',
      name: '惑星ヴェルグ',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      globe: { style: 'ice', base: '#8db4cc', dark: '#4b7390', light: '#eef7fc', glow: '#7dd3fc', seed: 23 },
      operations: []
    },
    {
      id: 3,
      code: 'PLANET 03',
      name: '惑星カストラ',
      terrain: '未踏査',
      summary: '偵察情報なし。',
      available: false,
      globe: { style: 'volcanic', base: '#45403c', dark: '#1f1c1a', light: '#fb923c', glow: '#f97316', seed: 37 },
      operations: []
    }
  ];

  const GameData = global.GameData || (global.GameData = {});
  GameData.PLANETS = PLANETS;
})(window);
