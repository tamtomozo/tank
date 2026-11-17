(function (global) {
  'use strict';

  // Player tank control, once per frame while the game runs: drive (tank or direct mode),
  // keep the camera on the tank, lock onto the nearest target inside the headlight cone
  // (the turret swings back to straight ahead otherwise) and fire.

  function create(game) {
    const { world, combat } = game;

    function findLookAtTarget() {
      const player = game.player;
      let bestTarget = null;
      let bestDistSq = Infinity;

      const consider = (obj) => {
        if (!obj.alive) return;
        if (!world.isPointInHeadlightRange(
          obj.x, obj.y, obj.radius,
          player.x, player.y, player.hullAngle, player.cannonRange,
          game.cam.x, game.cam.y, game.view.w, game.view.h
        )) {
          return;
        }
        const dx = world.deltaX(player.x, obj.x);
        const dy = world.deltaY(player.y, obj.y);
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestTarget = obj;
        }
      };

      for (const e of combat.enemies) consider(e);
      for (const prop of world.props) consider(prop);

      return bestTarget;
    }

    // Point `range` ahead along the turret (where an unlocked shot lands)
    function barrelForwardTarget(range = 340) {
      const player = game.player;
      return {
        x: world.wrapX(player.x + Math.cos(player.turretAngle) * range),
        y: world.wrapY(player.y + Math.sin(player.turretAngle) * range)
      };
    }

    // locked: Mio is reporting a secured district -> no driving, aiming or firing (the tank coasts to a stop)
    function update(dt, locked) {
      const player = game.player;
      const { input } = game;
      const { keys, mouse, touch } = input;
      const held = (code) => !locked && keys.has(code);
      // On-screen stick / buttons on phones (js/game/touchControls.js)
      const stick = !locked && touch.active && (touch.moveX !== 0 || touch.moveY !== 0);
      const wantBoost = held('ShiftLeft') || held('ShiftRight') || (!locked && touch.boost);
      const dustCb = (x, y, count) => {
        combat.spawnDustOrSmoke(x, y, 2, count, '#a8a29e');
      };

      let moving = false; // any drive input this frame (also hides the HUD, see hud.js)
      if (input.controlMode === 'direct') {
        let moveX = 0;
        let moveY = 0;
        if (held('KeyW') || held('ArrowUp')) moveY -= 1;
        if (held('KeyS') || held('ArrowDown')) moveY += 1;
        if (held('KeyA') || held('ArrowLeft')) moveX -= 1;
        if (held('KeyD') || held('ArrowRight')) moveX += 1;
        if (stick && moveX === 0 && moveY === 0) {
          moveX = touch.moveX;
          moveY = touch.moveY;
        }
        moving = moveX !== 0 || moveY !== 0;
        player.stepPhysicsDirectional(moveX, moveY, wantBoost, dt, dustCb);
      } else {
        let throttle = 0;
        if (held('KeyW') || held('ArrowUp')) throttle += 1;
        if (held('KeyS') || held('ArrowDown')) throttle -= 1;

        let steer = 0;
        if (held('KeyA') || held('ArrowLeft')) steer -= 1;
        if (held('KeyD') || held('ArrowRight')) steer += 1;
        // Stick in tank mode: up / down = throttle, left / right = steer
        if (stick && throttle === 0 && steer === 0) {
          throttle = -touch.moveY;
          steer = touch.moveX;
        }
        moving = throttle !== 0 || steer !== 0;
        player.stepPhysics(throttle, steer, wantBoost, dt, dustCb);
      }

      // Keep camera centered on player tank
      const cam = game.cam;
      const prevCamX = cam.x;
      cam.x = player.x;
      cam.y = player.y;
      cam.starOffsetX += world.deltaX(prevCamX, cam.x) * 0.04;

      // Keep tracking the target while reloading (previously the turret snapped back to center
      // after every shot and had to re-traverse once the reload finished)
      const lockCandidate = locked ? null : findLookAtTarget();
      if (lockCandidate) {
        player.aimAtWorldPoint(lockCandidate.x, lockCandidate.y, dt);
        game.activeTarget = player.isAimedAt(lockCandidate.x, lockCandidate.y) ? lockCandidate : null;
      } else {
        game.activeTarget = null;
        player.returnTurretStraight(dt);
      }

      const firing = !locked && (mouse.left || keys.has('Space') || touch.fire);
      // The player is busy driving / fighting: hud.js keeps the HUD panels out of the way meanwhile
      game.playerActing = moving || wantBoost || firing;
      if (firing) {
        const fireTarget = game.activeTarget || barrelForwardTarget(340);
        combat.fireMainCannon(player, fireTarget.x, fireTarget.y);
      }
    }

    return { update, barrelForwardTarget };
  }

  global.GameControls = { create };
})(window);
