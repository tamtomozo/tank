(function (global) {
  'use strict';

  // Sweep operation (掃討作戦): an extra card on a planet's operation select, opened once every
  // stage of that planet's campaign is completed. 100 compounds in 10 waves of 10:
  //   - a wave's 10 compounds are all garrisoned at once, at random clear spots of the planet
  //   - lap time runs from the moment a wave appears until its 10th compound falls
  //   - after each wave the white flag of the compound captured last offers ONE choice: recover
  //     (armour, ammo and lost wingmen) and go on, or go on as is. Either way the captured
  //     compounds give way to the next 10. There are no other depots and no repair kits.
  //   - the run ends with the 100th compound or with the player's tank; the best result per planet
  //     is kept (js/campaign.js sweepRecord), but nothing else carries over to the campaign
  //     (fresh tank, full platoon, no scrap / xp / wear)
  // This file: the operation data and the wave layouts. The running state lives in
  // js/combat/sweep.js, the flow (recovery menu, end of the run) in js/game/mission.js.

  const ROUNDS = 10;
  const PER_ROUND = 10;
  const TOTAL = ROUNDS * PER_ROUND;

  // Compound placement (world units)
  const SITE_SEP = 820; // between two compounds of a wave (relaxed if the map runs out of room)
  const HQ_CLEAR = 720; // from the operations HQ
  const TANK_CLEAR = 1050; // from the platoon when a wave appears (beyond the alert radius)
  const ROCK_CLEAR = 240; // no rock / ramp this close to a compound centre (= SITE_CLEAR_RADIUS)

  // Waves with a command compound (0-based): its garrison is led by the planet's boss
  const COMMAND_ROUNDS = [4, 9];

  // Enemy mix per planet: pools for the early / middle / late waves, the boss of the command
  // compounds and the title of its health bar
  const PROFILES = {
    1: {
      early: ['light', 'light', 'medium'],
      mid: ['light', 'medium', 'medium', 'heavy'],
      late: ['medium', 'heavy', 'heavy', 'modern'],
      boss: 'boss'
    },
    2: {
      early: ['light', 'medium'],
      mid: ['medium', 'medium', 'heavy'],
      late: ['medium', 'heavy', 'modern'],
      boss: 'ace'
    },
    3: {
      early: ['infantry', 'infantry', 'medium'],
      mid: ['infantry', 'medium', 'modern'],
      late: ['infantry', 'modern', 'modern', 'heavy'],
      boss: 'proto'
    }
  };

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function profileOf(planet) {
    return PROFILES[planet.id] || PROFILES[1];
  }

  // Every enemy kind the sweep fields on this planet (for the briefing's enemy intel)
  function kindsOf(planet) {
    const p = profileOf(planet);
    return [...new Set(['bunker', ...p.early, ...p.mid, ...p.late, p.boss])];
  }

  // Open once every stage of the planet's campaign is done (?unlock opens it too)
  function isUnlocked(planet) {
    const c = global.Campaign;
    return c.unlockAll || planet.operations.every((op) => c.isCleared(op.id));
  }

  // 83.4 s -> "01:23.4"
  function formatTime(sec) {
    const t = Math.max(0, sec || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  // A fresh operation object for the planet (its `sites` are rewritten for every wave)
  function operationFor(planet) {
    const withWeather = planet.operations.find((op) => op.weather);
    const name = L('掃討作戦', 'Sweep Operation');
    const bossName = global.GameData.ENEMY_INFO[profileOf(planet).boss].name;
    return {
      id: `sweep-${planet.id}`,
      sweep: { rounds: ROUNDS, perRound: PER_ROUND, total: TOTAL, kinds: kindsOf(planet) },
      name,
      goal: L(`全${TOTAL}拠点の制圧（${PER_ROUND}拠点×${ROUNDS}波）`, `Capture all ${TOTAL} compounds (${ROUNDS} waves of ${PER_ROUND})`),
      summary: L(`${planet.name}に残る敵拠点を、${PER_ROUND}か所ずつ${ROUNDS}波にわたって掃討する。`,
        `Sweep the enemy compounds left on ${planet.name}, ${PER_ROUND} at a time over ${ROUNDS} waves.`),
      startTime: 0.3,
      weather: withWeather ? withWeather.weather : undefined,
      bossName: `⚠ ${bossName}`,
      sites: [],
      scenario: {
        prehead: L(`${planet.name}の掃討作戦に臨む、第1機甲小隊の全戦車兵へ`, `To every tank crew of the 1st Armored Platoon, about to sweep ${planet.name}`),
        catch: L('百の拠点を、ひとつ残らず。', 'A hundred compounds. Not one left standing.'),
        deck: L(`${planet.name}の戦いは終わった。だが、降伏を拒む残存部隊が各地に${TOTAL}の拠点を築いている。`,
          `The war on ${planet.name} is over. But holdouts who refuse to surrender have built ${TOTAL} compounds across the planet.`),
        lead: L(`拠点は${PER_ROUND}か所ずつ姿を現す。すべて落とせば、次の${PER_ROUND}か所が現れる。`
          + '補給は波の合間に一度だけ。速さと粘り強さ、その両方が試される。'
          + `作戦名「${name}」――この星に、最後の静けさを。`,
        `The compounds show themselves ${PER_ROUND} at a time. Take them all and the next ${PER_ROUND} appear. `
          + 'You get one chance to resupply between waves. Both speed and stamina will be tested. '
          + `Operation "${name}" — bring this world its final silence.`)
      },
      mio: {
        tactical: L(`目標は${planet.name}の敵拠点${TOTAL}か所です。拠点は${PER_ROUND}か所ずつ現れ、すべて制圧すると次の${PER_ROUND}か所が現れます。`
          + '新しい拠点が現れてから10か所目を落とすまでを、ラップタイムとして計測します。'
          + '補給拠点はありません。波を制圧するたびに、最後に落とした拠点の白旗で一度だけ回復できます。回復しないで先へ進むこともできます。',
        `Your targets are ${TOTAL} enemy compounds on ${planet.name}. They appear ${PER_ROUND} at a time; capture them all and the next ${PER_ROUND} appear. `
          + 'Each wave is timed from the moment it appears until its 10th compound falls. '
          + 'There are no supply depots. After each wave you can recover once at the white flag of the last compound you took, or go on without it.'),
        enemies: L(`波が進むほど、拠点の守りは厚くなります。第${COMMAND_ROUNDS[0] + 1}波と第${COMMAND_ROUNDS[1] + 1}波には、${bossName}が指揮する拠点があります。`,
          `The deeper the waves, the stronger the garrisons. Waves ${COMMAND_ROUNDS[0] + 1} and ${COMMAND_ROUNDS[1] + 1} each include a compound led by the ${bossName}.`),
        terrain: L('掃討作戦は本編とは別の記録です。結果はキャンペーンに持ち帰りません。自機がやられた時点で作戦終了、そこまでの拠点数とタイムが記録になります。準備ができたら出撃してください。',
          'The sweep is kept apart from the campaign: nothing carries over to it. The run ends when your tank is destroyed, and the compounds and time up to then are your record. Sortie when you are ready.')
      },
      radio: {
        start: [
          L(`ミオです。${planet.name}の掃討作戦を開始します。第1波、敵拠点${PER_ROUND}か所を確認。計測開始です！`,
            `Mio here. The sweep of ${planet.name} begins. Wave 1: ${PER_ROUND} enemy compounds sighted. The clock is running!`),
          L('補給は波の合間に一度だけです。無理はしないでください、隊長。', 'You only get one resupply between waves. Don\'t push too hard, Commander.')
        ]
      }
    };
  }

  // Garrison of one compound of wave `round` (0-based)
  function garrisonFor(profile, round, command) {
    const pool = round < 3 ? profile.early : round < 7 ? profile.mid : profile.late;
    const tier = Math.min(3, Math.floor(round / 3));
    const bunkers = 1 + (round >= 3 && Math.random() < 0.5 ? 1 : 0);
    if (command) {
      return { tier, bunkers: 2, tanks: [profile.boss, pick(profile.late), pick(profile.late)] };
    }
    const n = Math.min(4, 2 + Math.floor(round / 4) + (Math.random() < 0.3 ? 1 : 0));
    const tanks = [];
    for (let i = 0; i < n; i++) tanks.push(pick(pool));
    return { tier, bunkers, tanks };
  }

  // Random clear spots for `count` compounds: away from the HQ, the platoon (`avoid`), rocks and
  // ramps (so no rock has to be cleared or brought back) and each other
  function placeSites(world, count, avoid) {
    const d = (ax, ay, bx, by) => Math.hypot(world.deltaX(ax, bx), world.deltaY(ay, by));
    const hq = world.hq;
    const blockers = [...(world.allObstacles || world.obstacles), ...(world.allRamps || world.ramps)];
    const out = [];
    let sep = SITE_SEP;
    let rockFree = true;
    for (let tries = 0; out.length < count && tries < 9000; tries++) {
      if (tries > 0 && tries % 1500 === 0) sep *= 0.85; // crowded map: let them sit closer
      if (tries === 7500) rockFree = false; // last resort: rocks there are cleared (js/planet/zones.js)
      const x = Math.random() * world.width;
      const y = Math.random() * world.height;
      if (d(x, y, hq.x, hq.y) < HQ_CLEAR) continue;
      if (avoid.some((p) => d(x, y, p.x, p.y) < TANK_CLEAR)) continue;
      if (rockFree && blockers.some((o) => d(x, y, o.x, o.y) < ROCK_CLEAR + o.radius)) continue;
      if (out.some((s) => d(x, y, s.x, s.y) < sep)) continue;
      out.push({ x, y });
    }
    return out;
  }

  // Lay out wave `round` (0-based): rewrites op.sites (index == compound id of the wave).
  // avoid: points the new compounds keep clear of (the platoon)
  function planRound(op, planet, round, world, avoid = []) {
    const profile = profileOf(planet);
    const spots = placeSites(world, PER_ROUND, avoid);
    const command = COMMAND_ROUNDS.includes(round) ? Math.floor(Math.random() * spots.length) : -1;
    op.sites = spots.map((s, i) => {
      const n = round * PER_ROUND + i + 1;
      const label = `S-${String(n).padStart(2, '0')}`;
      return {
        x: s.x,
        y: s.y,
        rot: Math.random() * Math.PI * 2,
        name: i === command ? L(`${label}（指揮所）`, `${label} (Command Post)`) : label,
        garrison: garrisonFor(profile, round, i === command)
      };
    });
    return op.sites;
  }

  global.Sweep = { ROUNDS, PER_ROUND, TOTAL, isUnlocked, operationFor, planRound, formatTime };
})(window);
