(function (global) {
  'use strict';

  // Environment of the operation, run every frame while the battle runs:
  //   sandstorm  (operation.weather.sandstorm) comes and goes on a fixed rhythm: calm → building
  //              up → full storm → dying down → calm. world.storm (0..1) closes in the view
  //              (js/planet/weather.js), how far compounds spot the platoon (js/combat/bases.js),
  //              how far tanks see to fire (CombatManager.sightRange) and the radar.
  //   mirage     (operation.mirage) world.mirage = daylight strength: distant enemies shimmer off
  //              their real position (CombatManager.apparentPos)
  //   heat       (planet.hazards.heat) running near full speed heats the engine; at 100% it
  //              overheats and the tank is held to OVERHEAT_SPEED until it has cooled down
  // Mio reports each change on the radio. The heat gauge is drawn under the player's tank.

  const HEAT_FROM = 0.62; // share of top speed above which the engine heats up
  const HEAT_RISE = 0.05; // per second at full speed (≈20 s flat out from cold)
  const HEAT_COOL = 0.11; // per second when parked (less while moving)
  const HEAT_WARN = 0.8; // Mio warns once the engine gets this hot
  const HEAT_RECOVER = 0.35; // an overheated engine runs normally again once cooled to this
  const OVERHEAT_SPEED = 0.45; // share of top speed allowed while overheated
  const NIGHT_HEAT = 0.6; // the night air: heats up slower…
  const NIGHT_COOL = 1.4; // …and cools down faster

  function create(game) {
    const { world, combat, radio } = game;
    const script = () => global.RadioComms.script;

    let stormCfg = null; // { firstCalm, calm, ramp, peak } or null
    let stormT = 0; // seconds into the storm timeline
    let stormRising = false; // last reported trend (for Mio's lines)
    let mirageOn = false;
    let heatOn = false;

    const heat = { value: 0, overheated: false, warned: false };

    // New operation (selection = { planet, operation }) or none
    function reset(selection) {
      const op = selection ? selection.operation : null;
      stormCfg = op && op.weather && op.weather.sandstorm ? op.weather.sandstorm : null;
      mirageOn = !!(op && op.mirage);
      heatOn = !!(selection && selection.planet.hazards && selection.planet.hazards.heat);
      stormT = 0;
      stormRising = false;
      world.storm = 0;
      world.mirage = 0;
      heat.value = 0;
      heat.overheated = false;
      heat.warned = false;
      if (game.player) game.player.speedLimit = 1;
    }

    // Storm strength at time t of the timeline: first calm, then [build-up, full, die-down, calm] repeating
    function stormAt(t) {
      const c = stormCfg;
      if (t < c.firstCalm) return 0;
      const cycle = c.ramp * 2 + c.peak + c.calm;
      const u = (t - c.firstCalm) % cycle;
      if (u < c.ramp) return smooth(u / c.ramp);
      if (u < c.ramp + c.peak) return 1;
      if (u < c.ramp * 2 + c.peak) return 1 - smooth((u - c.ramp - c.peak) / c.ramp);
      return 0;
    }

    function smooth(u) {
      return u * u * (3 - 2 * u);
    }

    function updateStorm(dt) {
      if (!stormCfg) {
        world.storm = 0;
        return;
      }
      const before = world.storm;
      stormT += dt;
      const now = stormAt(stormT);
      world.storm = now;
      if (now > before + 1e-4 && !stormRising && now > 0.05) {
        stormRising = true;
        radio.say(script().stormIncoming(), { key: 'storm', priority: 'high' });
      } else if (now < before - 1e-4 && stormRising) {
        stormRising = false;
        radio.say(script().stormPassing(), { key: 'storm' });
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

    function updateHeat(dt) {
      const player = game.player;
      if (!heatOn || !player.alive) return;
      const ratio = Math.max(0, Math.min(1, Math.abs(player.speed) / Math.max(1, player.maxSpeed)));
      const night = world.getPalette().nightFactor;
      let rate;
      if (ratio > HEAT_FROM && !heat.overheated) {
        rate = ((ratio - HEAT_FROM) / (1 - HEAT_FROM)) * HEAT_RISE * (1 + (NIGHT_HEAT - 1) * night);
      } else {
        rate = -HEAT_COOL * (1 - ratio * 0.6) * (1 + (NIGHT_COOL - 1) * night);
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
      player.speedLimit = heat.overheated ? OVERHEAT_SPEED : 1;
    }

    // Once per frame while the battle runs
    function update(dt) {
      updateStorm(dt);
      updateMirage();
      updateHeat(dt);
    }

    // Engine heat gauge under the player's tank (p = its ground projection), shown once the
    // engine is warm; blinks red while overheated
    function drawHeatGauge(ctx, p, timeSec) {
      if (!heatOn || !p || (heat.value < 0.3 && !heat.overheated)) return;
      const w = 54;
      const h = 6;
      const x = p.sx - w / 2;
      const y = p.sy + 34 * p.scale + 8;
      const v = heat.value;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (v - 0.2) / 0.15);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      const hue = Math.round(48 - 48 * Math.max(0, (v - 0.5) / 0.5)); // amber → red
      const blink = heat.overheated ? 0.55 + 0.45 * Math.sin(timeSec * 12) : 1;
      ctx.fillStyle = `hsla(${hue}, 95%, 55%, ${blink.toFixed(2)})`;
      ctx.fillRect(x, y, w * v, h);
      ctx.font = '800 10px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      const label = heat.overheated ? 'オーバーヒート' : 'エンジン温度';
      ctx.strokeText(label, p.sx, y + h + 12);
      ctx.fillStyle = heat.overheated ? '#fca5a5' : '#fde68a';
      ctx.fillText(label, p.sx, y + h + 12);
      ctx.restore();
    }

    return { reset, update, drawHeatGauge, heat };
  }

  global.GameHazards = { create };
})(window);
