(function (global) {
  'use strict';

  // HUD window frame (css/hudframe.css `.hud-frame`): shared open/close sequences for the briefing,
  // the after-action report and Mio's radio panel.
  //   open : corner brackets blink in → edges draw → panel fills → contents wipe in
  //   close: contents wipe out → panel empties → edges retract → corner brackets blink out
  const CLOSE_MS = 700; // matches the `.is-closing` timings in css/hudframe.css at --bt: 1

  const restartClass = (el, add, remove) => {
    el.classList.remove(add, ...remove);
    void el.offsetWidth; // restart the CSS animations
    el.classList.add(add);
  };

  const HudFrame = {
    CLOSE_MS,

    // Play the boot-up (open) sequence on a window
    boot(el) {
      restartClass(el, 'is-booting', ['is-closing']);
    },

    // Play the closing sequence on a window (the caller hides it once it has finished)
    shutDown(el) {
      restartClass(el, 'is-closing', ['is-booting']);
    },

    // Play the closing sequence, then actually close the dialog with `returnValue`
    closeDialog(dialog, returnValue = '') {
      if (!dialog.open || dialog.classList.contains('is-closing')) return;
      HudFrame.shutDown(dialog);
      // --bt scales the CSS timings per window (e.g. the garage runs at 0.6)
      const bt = parseFloat(getComputedStyle(dialog).getPropertyValue('--bt')) || 1;
      setTimeout(() => {
        if (dialog.open && dialog.classList.contains('is-closing')) dialog.close(returnValue);
      }, CLOSE_MS * bt);
    },

    // Route a dialog's own closes (a <form method="dialog"> submit button, Esc) through the
    // closing sequence. allowEsc: false keeps Esc from closing it at all.
    animateCloses(dialog, { allowEsc = true } = {}) {
      dialog.addEventListener('submit', (e) => {
        if (e.target.method !== 'dialog') return;
        e.preventDefault();
        HudFrame.closeDialog(dialog, e.submitter ? e.submitter.value : '');
      });
      dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        if (allowEsc) HudFrame.closeDialog(dialog, '');
      });
      // Closed by any route: drop the closing state so the next open starts clean
      dialog.addEventListener('close', () => dialog.classList.remove('is-closing'));
    }
  };

  global.HudFrame = HudFrame;
})(window);
