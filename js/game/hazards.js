(function (global) {
  'use strict';

  // Environment of the operation, run every frame while the battle runs:
  //   sandstorm  (operation.weather.sandstorm) comes and goes on a fixed rhythm: calm → building
  //              up → full storm → dying down → calm
  //   blizzard   (operation.weather.blizzard) never stops on its own: it swells and eases on a slow
  //              wave between `base` and base + `amp`
  //   smog       (operation.weather.smog) the same slow wave, as a brown haze with acid rain
  //              Either sets world.storm (0..1): it closes in the view (js/planet/weather.js), how
  //              far compounds spot the platoon (js/combat/bases.js), how far tanks see to fire
  //              (CombatManager.sightRange) and the radar. On a planet with a heat sensor
  //              (planet.hazards.thermal) enemies stay visible and lockable as heat signatures.
  //   mirage     (operation.mirage) world.mirage = daylight strength: distant enemies shimmer off
  //              their real position (CombatManager.apparentPos)
  //   polar night (operation.polarNight) the clock stands still at the start time (darkness)
  //   heat       (planet.hazards.heat) running near full speed heats the engine; at 100% it
  //              overheats and the tank is held to OVERHEAT_SPEED until it has cooled down
  //   cold       (planet.hazards.cold) a tank left standing chills: the turret traverses slower
  //              and the engine is sluggish until it has run warm again
  // Mio reports each change on the radio. Gauges (heat, cold, ice load, shells left) are drawn
  // under the player's tank.

  const HEAT_FROM = 0.62; // share of top speed above which the engine heats up
  const HEAT_RISE = 0.05; // per second at full speed (≈20 s flat out from cold)
  const HEAT_COOL = 0.11; // per second when parked (less while moving)
  const HEAT_WARN = 0.8; // Mio warns once the engine gets this hot
  const HEAT_RECOVER = 0.35; // an overheated engine runs normally again once cooled to this
  const OVERHEAT_SPEED = 0.45; // share of top speed allowed while overheated
  const NIGHT_HEAT = 0.6; // the night air: heats up slower…
  const NIGHT_COOL = 1.4; // …and cools down faster

  const COLD_STILL = 12; // below this speed the tank counts as standing
  const COLD_AFTER = 6; // s standing before it starts to chill…
  const COLD_RISE = 0.08; // …then this much per second (×1.5 at night)
  const COLD_WARM = 0.35; // per second of driving to warm up again
  const COLD_TRAVERSE = 0.6; // turret traverse lost at full chill
  const COLD_ENGINE = 0.65; // top speed lost at full chill (sluggish engine)

  function create(game) {
    const { world, combat, radio } = game;
    const script = () => global.RadioComms.script;

    let stormCfg = null; // sandstorm { firstCalm, calm, ramp, peak } or blizzard { firstCalm, base, amp, period }
    let stormKind = null; // 'sand' | 'snow' | 'smog'
    let stormT = 0; // seconds into the storm timeline
    let stormRising = false; // last reported trend (for Mio's lines)
    let mirageOn = false;
    let heatOn = false;
    let coldOn = false;

    const heat = { value: 0, overheated: false, warned: false };
    const cold = { value: 0, still: 0, warned: false };

    // New operation (selection = { planet, operation }) or none
    function reset(selection) {
      const op = selection ? selection.operation : null;
      const rules = (selection && selection.planet.hazards) || {};
      const weather = (op && op.weather) || {};
      stormKind = weather.sandstorm ? 'sand' : weather.blizzard ? 'snow' : weather.smog ? 'smog' : null;
      stormCfg = weather.sandstorm || weather.blizzard || weather.smog || null;
      mirageOn = !!(op && op.mirage);
      heatOn = !!rules.heat;
      coldOn = !!rules.cold;
      world.clockFrozen = !!(op && op.polarNight);
      stormT = 0;
      stormRising = false;
      world.storm = 0;
      world.stormKind = stormKind || 'sand';
      world.mirage = 0;
      heat.value = 0;
      heat.overheated = false;
      heat.warned = false;
      cold.value = 0;
      cold.still = 0;
      cold.warned = false;
      if (game.player) {
        game.player.speedLimit = 1;
        game.player.traverseLimit = 1;
      }
    }

    function smooth(u) {
      return u * u * (3 - 2 * u);
    }

    // Sandstorm strength at time t: first calm, then [build-up, full, die-down, calm] repeating
    function sandstormAt(t) {
      const c = stormCfg;
      if (t < c.firstCalm) return 0;
      const cycle = c.ramp * 2 + c.peak + c.calm;
      const u = (t - c.firstCalm) % cycle;
      if (u < c.ramp) return smooth(u / c.ramp);
      if (u < c.ramp + c.peak) return 1;
      if (u < c.ramp * 2 + c.peak) return 1 - smooth((u - c.ramp - c.peak) / c.ramp);
      return 0;
    }

    // Blizzard strength at time t: blows in over 5 s after the first calm, then swells and eases
    function blizzardAt(t) {
      const c = stormCfg;
      if (t < c.firstCalm) return 0;
      const u = t - c.firstCalm;
      const wave = 0.5 - 0.5 * Math.cos((u / c.period) * Math.PI * 2);
      return Math.min(1, u / 5) * (c.base + c.amp * wave);
    }

    function updateStorm(dt) {
      if (!stormCfg) {
        world.storm = 0;
        return;
      }
      const before = world.storm;
      stormT += dt;
      const now = stormKind === 'sand' ? sandstormAt(stormT) : blizzardAt(stormT);
      world.storm = now;
      if (stormKind === 'sand') {
        if (now > before + 1e-4 && !stormRising && now > 0.05) {
          stormRising = true;
          radio.say(script().stormIncoming(), { key: 'storm', priority: 'high' });
        } else if (now < before - 1e-4 && stormRising) {
          stormRising = false;
          radio.say(script().stormPassing(), { key: 'storm' });
        }
      } else if (stormKind === 'smog') {
        if (!stormRising && now > 0.5) {
          stormRising = true;
          radio.say(script().smogRising(), { key: 'storm', priority: 'high' });
        } else if (stormRising && now < 0.3) {
          stormRising = false;
          radio.say(script().smogEasing(), { key: 'storm' });
        }
      } else if (!stormRising && now > 0.72) {
        stormRising = true;
        radio.say(script().blizzardRising(!!combat.rules.thermal), { key: 'storm', priority: 'high' });
      } else if (stormRising && now < 0.45) {
        stormRising = false;
        radio.say(script().blizzardEasing(), { key: 'storm' });
      }
    }

    function updateMirage() {
      if (!mirageOn) {
        world.mirage = 0;
        return;
      }
      const nf = world.getPalette().nightFactor;
      world.mirage = Math.max(0, Math.min(1, 1 - nf * 1.6));
    }

    // Returns the share of top speed the engine allows (1 = no limit)
    function updateHeat(dt, player) {
      if (!heatOn) return 1;
      const ratio = Math.max(0, Math.min(1, Math.abs(player.speed) / Math.max(1, player.maxSpeed)));
      const night = world.getPalette().nightFactor;
      const cooler = global.GameLoadout.has('cooler'); // equipment: half the heat, faster cooling
      let rate;
      if (ratio > HEAT_FROM && !heat.overheated) {
        rate = ((ratio - HEAT_FROM) / (1 - HEAT_FROM)) * HEAT_RISE * (1 + (NIGHT_HEAT - 1) * night) * (cooler ? 0.5 : 1);
      } else {
        rate = -HEAT_COOL * (1 - ratio * 0.6) * (1 + (NIGHT_COOL - 1) * night) * (cooler ? 1.5 : 1);
      }
      heat.value = Math.max(0, Math.min(1, heat.value + rate * dt));

      if (!heat.overheated && heat.value >= 1) {
        heat.overheated = true;
        radio.say(script().overheat(), { key: 'heat', priority: 'high' });
      } else if (heat.overheated && heat.value <= HEAT_RECOVER) {
        heat.overheated = false;
        heat.warned = false;
        radio.say(script().heatRecovered(), { key: 'heat' });
      }
      if (!heat.overheated && !heat.warned && heat.value >= HEAT_WARN) {
        heat.warned = true;
        radio.say(script().heatWarning(), { key: 'heat' });
      } else if (heat.warned && !heat.overheated && heat.value < HEAT_WARN - 0.25) {
        heat.warned = false;
      }
      return heat.overheated ? OVERHEAT_SPEED : 1;
    }

    // Returns the share of top speed the chilled engine allows; sets the turret traverse limit
    function updateCold(dt, player) {
      if (!coldOn) return 1;
      if (Math.abs(player.speed) < COLD_STILL) {
        cold.still += dt;
        if (cold.still > COLD_AFTER) {
          const night = world.getPalette().nightFactor;
          const heater = global.GameLoadout.has('heater') ? 0.25 : 1; // equipment: engine heater
          cold.value = Math.min(1, cold.value + COLD_RISE * (1 + 0.5 * night) * heater * dt);
        }
      } else {
        cold.still = 0;
        cold.value = Math.max(0, cold.value - COLD_WARM * dt);
      }
      if (!cold.warned && cold.value > 0.5) {
        cold.warned = true;
        radio.say(script().coldWarning(), { key: 'cold' });
      } else if (cold.warned && cold.value < 0.1) {
        cold.warned = false;
      }
      player.traverseLimit = 1 - COLD_TRAVERSE * cold.value;
      return 1 - COLD_ENGINE * cold.value;
    }

    // Once per frame while the battle runs
    function update(dt) {
      updateStorm(dt);
      updateMirage();
      const player = game.player;
      if (!player.alive) return;
      player.speedLimit = Math.min(updateHeat(dt, player), updateCold(dt, player));
    }

    // Gauges under the player's tank (p = its ground projection): engine heat, chill, ice load
    // (each once it matters), and the shells left on a limited-ammo operation
    function drawGauges(ctx, p, timeSec) {
      if (!p) return;
      const player = game.player;
      const bars = [];
      if (heatOn && (heat.value >= 0.3 || heat.overheated)) {
        const hue = Math.round(48 - 48 * Math.max(0, (heat.value - 0.5) / 0.5)); // amber → red
        bars.push({
          v: heat.value,
          color: `hsl(${hue}, 95%, 55%)`,
          label: heat.overheated ? 'オーバーヒート' : 'エンジン温度',
          alert: heat.overheated,
          fade: Math.min(1, (heat.value - 0.2) / 0.15)
        });
      }
      if (coldOn && cold.value > 0.12) {
        bars.push({ v: cold.value, color: '#7dd3fc', label: cold.value > 0.5 ? '低温 — 砲塔旋回低下' : '低温', alert: false, fade: 1 });
      }
      const iceLoad = combat.iceLoad(player);
      if (iceLoad > 0.1) {
        bars.push({ v: iceLoad, color: iceLoad > 0.55 ? '#f87171' : '#bae6fd', label: iceLoad > 0.55 ? '氷が割れる！ 動け' : '氷にひび', alert: iceLoad > 0.55, fade: 1 });
      }
      const w = 54;
      const h = 6;
      let y = p.sy + 34 * p.scale + 8;
      ctx.save();
      ctx.font = '800 10px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      for (const b of bars) {
        const x = p.sx - w / 2;
        ctx.globalAlpha = Math.max(0, b.fade);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        const blink = b.alert ? 0.55 + 0.45 * Math.sin(timeSec * 12) : 1;
        ctx.globalAlpha = Math.max(0, b.fade) * blink;
        ctx.fillStyle = b.color;
        ctx.fillRect(x, y, w * b.v, h);
        ctx.globalAlpha = Math.max(0, b.fade);
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeText(b.label, p.sx, y + h + 12);
        ctx.fillStyle = b.alert ? '#fca5a5' : '#e2e8f0';
        ctx.fillText(b.label, p.sx, y + h + 12);
        y += 26;
      }
      if (combat.ammo != null) {
        ctx.globalAlpha = 1;
        const low = combat.ammo <= 8;
        const text = `残弾 ${combat.ammo}`;
        ctx.font = '800 11px system-ui, "Segoe UI", sans-serif';
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeText(text, p.sx, y + 6);
        ctx.fillStyle = combat.ammo === 0 ? '#f87171' : low ? '#fde68a' : '#e2e8f0';
        ctx.fillText(text, p.sx, y + 6);
      }
      ctx.restore();
    }

    return { reset, update, drawGauges, heat, cold };
  }

  global.GameHazards = { create };
})(window);
