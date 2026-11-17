(function (global) {
  'use strict';

  // Keyboard / mouse state and the HUD buttons (control mode, mute).
  //   input.keys        held key codes (KeyboardEvent.code)
  //   input.mouse       pointer position on the canvas + left button held (main gun)
  //   input.controlMode 'tank' (throttle + steer) | 'direct' (move in pressed direction)
  //   input.setControlMode(mode)  switch the mode without the radio call (start-up defaults)
  //   input.touch       on-screen stick / buttons (js/game/touchControls.js fills it on phones)
  //   input.release()   forget every held key / button (menus opening, restarts, window blur)

  function create(game) {
    const { canvas, audio, radio, sortieSelect, briefing, results } = game;
    const { start: startDialog, garage: garageDialog, gameover: gameoverDialog } = game.dialogs;

    const keys = new Set();
    const mouse = {
      x: game.view.w * 0.5,
      y: game.view.h * 0.35,
      left: false
    };
    const input = {
      keys,
      mouse,
      controlMode: 'tank',
      touch: { active: false, moveX: 0, moveY: 0, fire: false },
      setControlMode(mode) {
        input.controlMode = mode;
        syncControlModeUI();
      },
      release() {
        keys.clear();
        mouse.left = false;
      }
    };

    // The PLANET PANZER title window is no longer shown; the game starts straight into the sortie select
    // (see the end of bootstrap). Audio is unlocked on the first user gesture instead of the DEPLOY click.
    const unlockAudio = () => {
      audio.init();
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);

    const btnControlMode = document.getElementById('btn-control-mode');
    const btnStartMode = document.getElementById('btn-start-mode');
    const hudMoveHint = document.getElementById('hud-move-hint');
    const btnMute = document.getElementById('btn-mute');

    function syncControlModeUI() {
      const isDirect = input.controlMode === 'direct';
      if (btnControlMode) {
        btnControlMode.setAttribute('aria-pressed', String(isDirect));
        btnControlMode.classList.toggle('is-active', isDirect);
        // label in a span: phones show only the icon (css/touch.css)
        btnControlMode.innerHTML = isDirect
          ? '🧭<span class="btn-label"> 方向移動</span> <kbd>C</kbd>'
          : '🎮<span class="btn-label"> 戦車操縦</span> <kbd>C</kbd>';
      }
      if (btnStartMode) {
        btnStartMode.setAttribute('aria-pressed', String(isDirect));
        btnStartMode.classList.toggle('is-active', isDirect);
        btnStartMode.textContent = isDirect
          ? '🧭 操縦: 押した方向移動'
          : '🎮 操縦: 戦車操縦';
      }
      if (hudMoveHint) {
        hudMoveHint.innerHTML = isDirect
          ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 押した方向へ移動'
          : '<kbd>W</kbd><kbd>S</kbd> 前後進 / <kbd>A</kbd><kbd>D</kbd> 超信地旋回';
      }
    }

    const toggleControlMode = () => {
      input.controlMode = input.controlMode === 'tank' ? 'direct' : 'tank';
      syncControlModeUI();
      if (game.started && !startDialog.open && !sortieSelect.isOpen && !briefing.isOpen && !garageDialog.open && !gameoverDialog.open) {
        radio.say(global.RadioComms.script.controlMode(input.controlMode === 'direct'), { key: 'control-mode', priority: 'high' });
      }
    };
    syncControlModeUI();

    if (btnControlMode) {
      btnControlMode.addEventListener('click', () => {
        toggleControlMode();
        btnControlMode.blur();
      });
    }

    if (btnStartMode) {
      btnStartMode.addEventListener('click', () => {
        toggleControlMode();
        btnStartMode.blur();
      });
    }

    btnMute.addEventListener('click', () => {
      audio.init();
      const nextMuted = !audio.muted;
      audio.setMuted(nextMuted);
      btnMute.setAttribute('aria-pressed', String(nextMuted));
      btnMute.innerHTML = nextMuted ? '🔇<span class="btn-label"> 消音</span>' : '🔊<span class="btn-label"> 音声</span>';
      btnMute.blur();
    });

    window.addEventListener('keydown', (e) => {
      if (sortieSelect.isOpen || briefing.isOpen || results.isOpen) return; // these screens handle their own keys
      const code = e.code;
      // Tab would move the focus onto a HUD button, which Space would then press
      if (code === 'Tab') {
        e.preventDefault();
        return;
      }
      if (code === 'KeyC' && radio.controlsLocked) return; // don't cut into Mio's district report
      if (code === 'KeyC' && !garageDialog.open && !gameoverDialog.open) {
        toggleControlMode();
        return;
      }
      if (code === 'KeyM' && !garageDialog.open) {
        btnMute.click();
        return;
      }
      if (code === 'Space' && !startDialog.open && !garageDialog.open && !gameoverDialog.open) {
        e.preventDefault();
      }
      keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      input.release();
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    canvas.addEventListener('pointerdown', (e) => {
      audio.init();
      // Fingers on the battlefield don't fire: phones use the on-screen buttons (touchControls.js)
      if (e.pointerType === 'touch') return;
      if (e.button === 0) mouse.left = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) mouse.left = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    return input;
  }

  global.GameInput = { create };
})(window);
