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
  //                      style: 'desert' | 'ice' | 'industrial' | 'volcanic', seed: surface pattern
  //   planet.theme     look of the battlefield: 'desert' | 'ice' | 'city' (js/planet/planet.js THEMES)
  //   planet.gear      recommended equipment for the planet (js/data/equipment.js), fitted by default
  //   planet.hazards   environment rules shared by every operation on the planet (js/game/hazards.js)
  //                      heat: the engine overheats on a long run at full speed
  //                      dust: the dust a moving tank kicks up lets compounds spot it from farther away
  //                      cold: a tank left standing chills (slow turret, sluggish engine)
  //                      thermal: a heat sensor shows enemies through storms and darkness
  //                      civilians: civilian buildings: destroying them costs the people's cooperation,
  //                        which decides how many guerrillas the last stage meets (js/campaign.js)
  //
  // An operation is one stage of the planet's campaign; a stage is unlocked once the one named in
  // `requires` has been completed (js/campaign.js).
  //   operation.stage / phase   stage number and its role in the campaign (侵食 / 決戦 / 斬首 …)
  //   operation.name / goal / summary   operation card + briefing texts
  //   operation.startTime       time of day the sortie starts at (0..1, 0.25 = 06:00)
  //   operation.startAt         { x, y, angle } where the platoon starts (default: the operations HQ)
  //   operation.sites           enemy compounds, each captured by destroying its garrison:
  //                               slot: one of the compound sites generated with the map (js/planet/terrain.js)
  //                               or x / y / rot: a fixed position (the rocks around it are cleared)
  //                               garrison: { tier, bunkers, tanks: [kinds] } (js/data/enemies.js)
  //                               optional: need not be captured (the target of a feint)
  //                               power: capturing it shuts down the `powered` turrets
  //                               after: i — appears (garrisoned) only once sites[i] has been captured;
  //                               such sites must come last in the list
  //   operation.zones           areas laid over the map for this operation (js/planet/zones.js):
  //                               saltflat: a flat white plain with no rocks; city: a town of buildings
  //                               (style 'oasis' | 'snow' | 'industrial'; ring: keep clear of a highway
  //                               ring of that half-size); lake: a frozen lake with thin-ice patches;
  //                               highway: elevated roads (legs: from / to, gaps along them);
  //                               factory: a walled hall (hx, hy, doors) with production lines inside
  //   operation.weather         sandstorm: { firstCalm, calm, ramp, peak } seconds, or
  //                             blizzard / smog: { firstCalm, base, amp, period } (js/game/hazards.js)
  //   operation.polarNight      the clock stands still at startTime (darkness all along)
  //   operation.mirage          distant enemies shimmer and show off their real position (daytime)
  //   operation.longRange       { enemy: range scale, player: lock-on range bonus }
  //   operation.survey          points to visit: [{ x, y, name }]; surveyKind 'patrol': patrol points
  //   operation.turrets         gun turrets on an elevated highway: [{ x, y, powered }]
  //   operation.escort          { meet, to, name }: meet the collaborator at `meet`, bring them to `to`
  //   operation.tunnels         manholes / subway exits [{ x, y }]: infantry climb out when the platoon
  //                             passes (ambush: { size, uses }); guerrilla: { ieds, ambush } [min, max]
  //                             scaled by how much the people are on our side (js/combat/city.js)
  //   operation.finale          { kind, at, angle }: after the other objectives a boss appears there;
  //                             destroying it completes the operation
  //   operation.feint           { site, distance }: be spotted by sites[site], then get `distance` away
  //   operation.hold            after the other objectives: hold the area around sites[site] (or the
  //                             point `at`) for `duration` s while enemy reinforcements arrive in waves;
  //                             boss: { kind, at } joins at that share of the time; label / banner: texts
  //   operation.ammo            shells for the player's gun (salvaged from destroyed enemies; default unlimited)
  //   operation.noSupply        no supply depots, no repair kits
  //   operation.endInPlace      the report follows the objective directly (no drive back to the HQ)
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
      theme: 'desert',
      gear: ['cooler', 'filter'],
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
            label: '総督府周辺の封鎖',
            banner: '封鎖中 — 突入完了まで',
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
      terrain: '氷雪',
      summary: '吹雪と凍った湖、山脈に閉ざされた氷の惑星。山岳要塞の精鋭部隊が峠を固め、湖の向こうに首都がある。',
      available: true,
      globe: { style: 'ice', base: '#8db4cc', dark: '#4b7390', light: '#eef7fc', glow: '#7dd3fc', seed: 23 },
      theme: 'ice',
      gear: ['heater', 'wideTracks'],
      hazards: { cold: true, thermal: true },
      operations: [
        {
          id: 'verg-1',
          stage: 1,
          phase: '侵食',
          name: '白い迂回路',
          goal: '峠への陽動、湖の氷上偵察、湖岸監視所の制圧',
          summary: '峠を攻めるふりで敵主力を引きつけ、その隙に凍った湖を渡るルートを探る。',
          requires: 'zahar-3',
          startTime: 0.30,
          weather: { blizzard: { firstCalm: 15, base: 0.3, amp: 0.55, period: 30 } },
          zones: [
            { kind: 'lake', x: 3150, y: 1300, radius: 560, seed: 41, thinCount: 6, keepClear: [[-250, 150], [50, -150], [300, 100]] }
          ],
          sites: [
            { x: 1350, y: 1250, rot: 0.8, name: '峠の要塞', optional: true, garrison: { tier: 2, bunkers: 2, tanks: ['light', 'medium', 'medium', 'heavy', 'heavy'] } },
            { x: 2780, y: 1820, rot: 2.4, name: '湖岸監視所', garrison: { tier: 0, bunkers: 1, tanks: ['light', 'medium'] } }
          ],
          feint: { site: 0, distance: 1150 },
          survey: [
            { x: 2900, y: 1450, name: '観測点A' },
            { x: 3200, y: 1150, name: '観測点B' },
            { x: 3450, y: 1400, name: '観測点C' }
          ],
          scenario: {
            prehead: '惑星ヴェルグ攻略の第一段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '正面から行けないなら、凍った道を行け。',
            deck: 'ザハルの総督府で押収した地図が、ひとつの抜け道を示していた。山脈の峠ではなく、凍った湖を渡る道だ。',
            lead: '峠の要塞を守るのは、この星の精鋭部隊だ。正面からぶつかれば小隊はひとたまりもない。'
              + 'だから攻めるふりをして敵を峠に釘付けにし、その隙に湖の氷を調べよ。'
              + '作戦名「白い迂回路」――敵が峠を見ている間に、我々は湖を渡る。'
          },
          mio: {
            tactical: '目標は三つです。北西の峠の要塞に姿を見せて敵を食いつかせ、引き離すこと。'
              + '北東の凍った湖で、3か所の観測点の氷を調べること。そして湖岸の監視所を制圧することです。峠の要塞は落とさなくてかまいません。',
            enemies: '敵はこの星の精鋭です。峠の要塞には重戦車が控えています。まともに撃ち合わないでください。',
            terrain: 'この星では、長く止まっていると車体が冷えて、砲塔の旋回とエンジンが鈍ります。'
              + '凍った湖の上では止まらないでください。止まると氷が割れます。色の濃いところは氷が薄く、重い戦車はそのまま踏み抜きます。'
              + '吹雪で視界が悪いときは、熱源センサーが敵を映します。準備ができたら出撃してください。'
          },
          radio: {
            start: [
              'ミオです。作戦「白い迂回路」を開始します。まずは峠の要塞に姿を見せて、敵を食いつかせてください。',
              '湖の上では止まらないで。氷が割れます。'
            ],
            complete: [
              '陽動、偵察、監視所の制圧、すべて完了です。湖を渡るルートが開きました。',
              '作戦本部へ帰還してください、隊長。'
            ]
          }
        },
        {
          id: 'verg-2',
          stage: 2,
          phase: '斬首',
          name: '極夜の雷撃',
          goal: '凍った湖を渡り、首都の司令部を制圧',
          summary: '太陽の昇らない極夜の闇に紛れて湖を渡り、山のふもとの首都に電撃突入する。',
          requires: 'verg-1',
          startTime: 0.0,
          polarNight: true,
          zones: [
            { kind: 'lake', x: 3150, y: 1300, radius: 560, seed: 41, thinCount: 6, keepClear: [[-250, 150], [50, -150], [300, 100]] },
            { kind: 'city', style: 'snow', x: 4150, y: 300, radius: 720, plaza: 240, seed: 53 }
          ],
          sites: [
            { x: 3850, y: 1000, rot: 1.2, name: '城門守備隊', garrison: { tier: 1, bunkers: 1, tanks: ['light', 'medium', 'medium'] } },
            { x: 4150, y: 300, rot: 0.5, name: '司令部', garrison: { tier: 2, bunkers: 2, tanks: ['light', 'light', 'medium', 'medium', 'heavy'] } }
          ],
          scenario: {
            prehead: '惑星ヴェルグ攻略の第二段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '夜が明けないなら、闇ごと奪え。',
            deck: '極夜の季節が来た。この星では、これから長いあいだ太陽が昇らない。敵の目は闇に閉ざされる。',
            lead: '湖を渡り、山のふもとの首都に突入せよ。目標は敵の司令部ただひとつ。'
              + '闇の中では、敵は撃たれるまで君たちに気づかない。最初の一撃までは、静かに近づけ。'
              + '作戦名「極夜の雷撃」――夜明けを待たずに、決着をつける。'
          },
          mio: {
            tactical: '目標は首都の司令部です。首都は凍った湖の北東、作戦本部からは湖を渡るのが近道です。手前に城門守備隊がいます。'
              + '極夜のあいだ、時計は進みません。ずっと夜のままです。',
            enemies: '首都の守備隊と司令部の警備隊です。闇の中では、敵は撃たれるまでこちらに気づきません。先手を取ってください。',
            terrain: '凍った湖の上では止まらないでください。濃い色の薄い氷は避けて。'
              + '暗闇では熱源センサーが敵を映します。首都の中は建物が密集していて、建物は砲弾を通しません。'
          },
          radio: {
            start: [
              'ミオです。作戦「極夜の雷撃」を開始します。目標は首都の司令部。',
              '敵は闇の中でこちらに気づいていません。最初の一撃まで、静かに近づいてください。'
            ],
            complete: [
              '司令部の制圧を確認……敵の指揮系統は断ちました。',
              'ただ……峠にいた敵の主力が動き出しています。首都を取り返しに来るつもりです。いったん作戦本部へ帰還してください。'
            ]
          }
        },
        {
          id: 'verg-3',
          stage: 3,
          phase: '決戦',
          name: '凍土の籠城',
          goal: '本隊の到着まで首都を守り抜く（150秒）',
          summary: '首都を取り返しに戻ってきた敵の主力を迎え撃つ。吹雪で補給は届かず、砲弾は限られている。',
          requires: 'verg-2',
          startTime: 0.70,
          startAt: { x: 4150, y: 370, angle: Math.PI * 0.5 },
          weather: { blizzard: { firstCalm: 20, base: 0.25, amp: 0.6, period: 34 } },
          zones: [
            { kind: 'lake', x: 3150, y: 1300, radius: 560, seed: 41, thinCount: 7, keepClear: [] },
            { kind: 'city', style: 'snow', x: 4150, y: 300, radius: 720, plaza: 240, seed: 53 }
          ],
          sites: [],
          hold: {
            at: { x: 4150, y: 300 },
            label: '首都の防衛',
            banner: '防衛中 — 本隊到着まで',
            radius: 420,
            duration: 150,
            waveEvery: 13,
            waveSize: 2,
            waveSizeLate: 3,
            kinds: ['light', 'medium', 'medium', 'heavy'],
            spawnDist: [880, 1060],
            boss: { kind: 'ace', at: 0.55 }
          },
          ammo: 40,
          noSupply: true,
          endInPlace: true,
          bossName: '⚠ 雪原迷彩のエース重戦車',
          scenario: {
            prehead: '惑星ヴェルグ攻略の最終段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '奪った街を、渡すな。',
            deck: '首都は落ちた。だが峠の精鋭部隊は無傷のまま、首都を取り返しに雪原を進んでくる。',
            lead: '吹雪で補給は届かない。砲弾は限られ、修理もできない。味方の本隊が着くまで、首都の中心を守り抜け。'
              + '敵にはエースがいるという。雪原迷彩の重戦車だ。熱源から目を離すな。'
              + '作戦名「凍土の籠城」――この街で、ヴェルグの戦いを終わらせる。'
          },
          mio: {
            tactical: '目標は、味方の本隊が到着するまでの150秒間、首都の中心を守ることです。黄色い円の外に出ると、カウントが止まります。'
              + '吹雪で補給は届きません。砲弾は40発、撃破した敵の残骸から少しずつ回収できます。',
            enemies: '敵の主力が四方から来ます。重戦車も、そして雪原迷彩のエース機もいます。エース機は遠くからはほとんど見えません。',
            terrain: '長く止まっていると車体が冷えて、砲塔の旋回が鈍ります。守るときも、ときどき動いてください。'
              + '湖を渡ってくる敵は、止まれば氷に沈みます。吹雪のあいだは熱源センサーを頼りにしてください。'
          },
          radio: {
            start: [
              'ミオです。作戦「凍土の籠城」を開始します。本隊の到着まで150秒、首都を守り抜いてください。',
              '砲弾は40発です。無駄撃ちはしないでください。'
            ],
            holdStart: [
              '敵の主力を確認、まもなく接敵します！ 円の中から離れないでください！'
            ],
            complete: [
              '本隊が首都に到着しました！ 敵の主力は撤退していきます……ヴェルグの戦いは、私たちの勝ちです。',
              'お疲れさまでした、隊長。本当に……よく持ちこたえてくれました。'
            ]
          }
        }
      ]
    },
    {
      id: 3,
      code: 'PLANET 03',
      name: '惑星カストラ',
      terrain: '工業都市',
      summary: '星全体を工場と巨大都市が覆う、敵の本星。スモッグと酸性雨の下、本国の正規軍と民兵が待ち構える。',
      available: true,
      globe: { style: 'industrial', base: '#4a4640', dark: '#26231f', light: '#fdba74', glow: '#a3a35c', seed: 37 },
      theme: 'city',
      gear: ['addArmor', 'cage'],
      hazards: { civilians: true },
      operations: [
        {
          id: 'castra-1',
          stage: 1,
          phase: '準備',
          name: '灯の消える街',
          goal: '発電所と鉄道ターミナルの制圧、協力者の護衛',
          summary: '発電所を止めて都市の防衛砲台を黙らせ、反体制派の協力者を地下トンネルまで送り届ける。',
          requires: 'verg-3',
          startTime: 0.70,
          weather: { smog: { firstCalm: 10, base: 0.2, amp: 0.35, period: 40 } },
          zones: [
            { kind: 'highway', x: 2400, y: 1000, radius: 960, legs: [{ from: [-900, 0], to: [900, 0], gaps: [[-380, -230], [250, 400]] }] },
            { kind: 'city', style: 'industrial', x: 2400, y: 1380, radius: 760, plaza: 200, seed: 91 }
          ],
          sites: [
            { x: 1350, y: 1520, rot: 0.4, name: '発電所', power: true, garrison: { tier: 1, bunkers: 2, tanks: ['infantry', 'infantry', 'medium', 'modern'] } },
            { x: 3460, y: 1380, rot: 2.0, name: '鉄道ターミナル', garrison: { tier: 1, bunkers: 1, tanks: ['infantry', 'medium', 'modern', 'heavy'] } }
          ],
          turrets: [
            { x: 1800, y: 1000, powered: true },
            { x: 2400, y: 1000, powered: true },
            { x: 3080, y: 1000, powered: true }
          ],
          escort: {
            meet: { x: 2150, y: 1840, name: '接触地点' },
            to: { x: 2930, y: 1760, name: 'トンネル入口' },
            name: '協力者'
          },
          tunnels: [
            { x: 2420, y: 1640 },
            { x: 2700, y: 1900 },
            { x: 2560, y: 1380 },
            { x: 1900, y: 1300 }
          ],
          ambush: { size: 2, uses: 2 },
          scenario: {
            prehead: '惑星カストラ攻略の第一段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '敵の本星は、明かりから消していく。',
            deck: 'ついに敵の本星に降り立った。星全体が工場と都市で埋め尽くされ、空はスモッグで濁っている。ここには戦車だけでなく、武器を取った民兵もいる。',
            lead: 'まず発電所を止めよ。都市を守る高架の砲台は、発電所の電力で動いている。'
              + 'そして反体制派の協力者と接触し、地下トンネルの入口まで送り届けよ。彼らが持つトンネルの地図は、この先の戦いで必ず役に立つ。'
              + '鉄道ターミナルを押さえれば、我々の補給拠点になる。'
              + '忘れるな。この街には住民がいる。むやみに建物を壊せば、彼らは敵に回る。'
              + '作戦名「灯の消える街」――この星の夜を、我々の味方にする。'
          },
          mio: {
            tactical: '目標は三つです。西の発電所と東の鉄道ターミナルの制圧、それに協力者の護衛です。'
              + '北の高架道路の上に砲台が3基あります。発電所を制圧すれば、電源が落ちて止まります。'
              + '協力者とは、作戦本部の北西の接触地点で落ち合います。合流したら、トンネル入口まで一緒に移動してください。',
            enemies: '本国の正規軍です。新型の主力戦車がいます。それに対戦車ロケットを持った歩兵。'
              + '歩兵は脆いですが、建物の陰やマンホールから突然出てきます。戦車で轢くこともできます。',
            terrain: '工業都市の中は、明るい色の住宅や商店が民間の建物です。撃って壊すと、住民の協力度が下がります。'
              + '協力度が低いと、最後の段階でゲリラが増えます。灰色の工場や倉庫は壊れません。'
              + '丸い燃料タンクは撃つと爆発して、周りを巻き込みます。スモッグで視界も悪いので、気をつけてください。'
          },
          radio: {
            start: [
              'ミオです。作戦「灯の消える街」を開始します。目標は発電所、鉄道ターミナル、そして協力者の護衛です。',
              '民間の建物は撃たないでください。住民を敵に回したくありません。'
            ],
            complete: [
              '発電所、鉄道ターミナル、協力者の護衛……すべて完了です。',
              '作戦本部へ帰還してください、隊長。次は、敵の工場です。'
            ]
          }
        },
        {
          id: 'castra-2',
          stage: 2,
          phase: '決戦',
          name: '鋼の環',
          goal: '環状高速道路のインターチェンジ2か所と工場の制圧、試作超重戦車の撃破',
          summary: '高架が囲む工場地帯に踏み込み、生産ラインの間を抜けて、開発中の超重戦車を叩く。',
          requires: 'castra-1',
          startTime: 0.36,
          weather: { smog: { firstCalm: 6, base: 0.3, amp: 0.4, period: 34 } },
          zones: [
            {
              kind: 'highway', x: 2400, y: 1250, radius: 760,
              legs: [
                { from: [-640, -640], to: [640, -640], gaps: [[-90, 90]] },
                { from: [640, -640], to: [640, 640], gaps: [[-90, 90]] },
                { from: [640, 640], to: [-640, 640], gaps: [[-90, 90]] },
                { from: [-640, 640], to: [-640, -640], gaps: [[-90, 90]] }
              ]
            },
            { kind: 'factory', x: 2400, y: 1250, hx: 400, hy: 270, radius: 480, doors: ['n', 's', 'w', 'e'] },
            { kind: 'city', style: 'industrial', x: 2400, y: 1250, radius: 1300, plaza: 0, seed: 57, ring: 640 }
          ],
          sites: [
            { x: 1520, y: 1250, rot: 0.2, name: '西インターチェンジ', garrison: { tier: 1, bunkers: 1, tanks: ['infantry', 'modern', 'modern', 'medium'] } },
            { x: 3280, y: 1250, rot: 2.6, name: '東インターチェンジ', garrison: { tier: 1, bunkers: 1, tanks: ['infantry', 'infantry', 'modern', 'heavy'] } },
            { x: 2400, y: 1250, rot: 0, name: '第七工場', garrison: { tier: 2, bunkers: 2, tanks: ['infantry', 'infantry', 'modern', 'modern', 'heavy'] } }
          ],
          turrets: [
            { x: 1760, y: 790 }, { x: 3040, y: 790 },
            { x: 2040, y: 1890 }, { x: 2760, y: 1890 },
            { x: 1760, y: 1570 }, { x: 3040, y: 930 }
          ],
          tunnels: [
            { x: 1600, y: 1700 },
            { x: 3200, y: 1700 },
            { x: 2400, y: 2000 }
          ],
          ambush: { size: 2, uses: 2 },
          finale: { kind: 'proto', at: { x: 2400, y: 1250 }, angle: Math.PI * 0.5 },
          bossName: '⚠ 試作超重戦車',
          scenario: {
            prehead: '惑星カストラ攻略の第二段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '環の中心で、怪物が目を覚ます。',
            deck: 'ヴェルグで捕らえた将校は、ひとつの名を口にした。第七工場――敵が試作中の超重戦車の生産拠点だ。工場は環状高速道路に囲まれている。',
            lead: '高架の上には砲台が並び、上と下の両方から撃たれる。高架には登れない。切れ目から内側へ抜けよ。'
              + '東西のインターチェンジを押さえ、工場の守備隊を倒せ。試作車が完成する前に。'
              + '作戦名「鋼の環」――この環を断ち切れば、敵の心臓が見える。'
          },
          mio: {
            tactical: '目標は東西のインターチェンジと、中心の第七工場です。工場は環状の高架道路に囲まれています。'
              + '高架の四辺の真ん中に切れ目があり、そこから内側に入れます。工場の守備隊を倒すと、試作車が出てくるはずです。',
            enemies: '新型戦車と歩兵、高架の上の砲台です。砲台は高い位置から撃ってきます。下から撃ち返せます。'
              + 'そして試作超重戦車。装甲も主砲も、司令官車より上です。',
            terrain: '高架道路は通れない壁です。砲弾も止めます。工場の中は生産ラインが並んでいて、間を縫って戦うことになります。'
              + '燃料タンクの爆発と、民間の建物には引き続き注意してください。'
          },
          radio: {
            start: [
              'ミオです。作戦「鋼の環」を開始します。目標は東西のインターチェンジと、第七工場です。',
              '高架の上の砲台に注意。高架の切れ目から内側に入ってください。'
            ],
            complete: [
              '試作超重戦車の撃破を確認……敵の切り札は潰れました！',
              '作戦本部へ帰還してください。あとは、首都だけです。'
            ]
          }
        },
        {
          id: 'castra-3',
          stage: 3,
          phase: '安定化',
          name: '最後の灯',
          goal: '政府庁舎の制圧、市街の巡回、降伏を拒む親衛隊の撃破',
          summary: '首都中枢を押さえて敵政府を降伏させる。だが戦いは終わらない。即席爆弾と地下からの待ち伏せの中を巡回し、最後の抵抗拠点を落とす。',
          requires: 'castra-2',
          startTime: 0.30,
          weather: { smog: { firstCalm: 20, base: 0.15, amp: 0.3, period: 44 } },
          zones: [
            { kind: 'city', style: 'industrial', x: 2400, y: 1350, radius: 860, plaza: 260, seed: 113 }
          ],
          sites: [
            { x: 2400, y: 1350, rot: 0.3, name: '政府庁舎', garrison: { tier: 2, bunkers: 2, tanks: ['infantry', 'infantry', 'modern', 'modern', 'heavy'] } },
            { x: 3600, y: 640, rot: 1.9, name: '親衛隊の最後の拠点', after: 0, garrison: { tier: 2, bunkers: 2, tanks: ['infantry', 'modern', 'modern', 'heavy', 'boss'] } }
          ],
          survey: [
            { x: 1840, y: 1700, name: '巡回点A' },
            { x: 2960, y: 1080, name: '巡回点B' },
            { x: 2160, y: 900, name: '巡回点C' }
          ],
          surveyKind: 'patrol',
          tunnels: [
            { x: 1700, y: 1350 }, { x: 2100, y: 1650 }, { x: 2700, y: 1650 },
            { x: 3050, y: 1350 }, { x: 2700, y: 900 }, { x: 2000, y: 1050 }
          ],
          ambush: { size: 2, uses: 2 },
          // Guerrillas: how many IEDs and how many fighters per tunnel ambush, from `min` (the people
          // on our side, the collaborator saved) to `max` (cooperation gone, collaborator lost)
          guerrilla: { ieds: [3, 11], ambush: [2, 5] },
          endInPlace: true,
          bossName: '⚠ 親衛隊長車',
          scenario: {
            prehead: '惑星カストラ攻略の最終段階に臨む、第1機甲小隊の全戦車兵へ',
            catch: '戦争は、降伏の署名では終わらない。',
            deck: '工場を失った敵政府は、首都中枢の政府庁舎にこもっている。庁舎が落ちれば、政府は降伏するだろう。だがそれで全員が銃を置くとは限らない。',
            lead: '政府庁舎を制圧し、降伏させよ。そのあとは市街を巡回し、治安を確保する。'
              + '道には即席爆弾が仕掛けられ、地下からは待ち伏せが来る。住民がどれだけ我々の側にいるか――それがここで効いてくる。'
              + '降伏を拒む者たちがいれば、それが最後の敵だ。'
              + '作戦名「最後の灯」――この星に、もう一度明かりを灯す。'
          },
          mio: {
            tactical: '目標は首都中枢の政府庁舎です。制圧すれば、敵政府は降伏するはずです。'
              + 'そのあと、市街の巡回点3か所を回ってください。……降伏しない部隊が出てくるかもしれません。',
            enemies: '庁舎の守備隊と、市街にひそむゲリラです。ゲリラの数は、住民の協力度と、協力者を守れたかどうかで変わります。',
            terrain: '道路には即席爆弾が仕掛けられています。近づくと赤く光るので、見えたら撃って処理してください。踏むと大きな被害が出ます。'
              + 'マンホールや地下鉄の出入口から歩兵が出てきます。最後まで民間の建物には気をつけて。'
          },
          radio: {
            start: [
              'ミオです。作戦「最後の灯」を開始します。目標は政府庁舎です。',
              '道路の即席爆弾に注意してください。赤く光ったら、撃って処理を。'
            ],
            complete: [
              '親衛隊の降伏を確認……カストラの全土で、戦闘が止まりました。',
              '隊長。三つの星を越えて、ここまで来ました。……この戦いは、私たちの勝ちです。本当に、お疲れさまでした。'
            ]
          }
        }
      ]
    }
  ];

  const GameData = global.GameData || (global.GameData = {});
  GameData.PLANETS = PLANETS;
})(window);
