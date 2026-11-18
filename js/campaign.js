(function (global) {
  'use strict';

  // Campaign progress: which operations have been completed. An operation with `requires`
  // (js/data/operations.js) opens once that one is done, so each planet is played stage by stage.
  // Kept in localStorage (this browser only); adding ?unlock to the page URL opens every stage.

  const STORAGE_KEY = 'planet-panzer.campaign.v1';

  class Campaign {
    constructor() {
      this.cleared = new Set();
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (data && Array.isArray(data.cleared)) data.cleared.forEach((id) => this.cleared.add(String(id)));
      } catch (e) {
        // Storage blocked or unreadable: start with nothing completed
      }
      let unlock = false;
      try {
        unlock = new URLSearchParams(global.location.search).has('unlock');
      } catch (e) {
        unlock = false;
      }
      this.unlockAll = unlock;
    }

    isCleared(opId) {
      return this.cleared.has(opId);
    }

    isUnlocked(op) {
      return this.unlockAll || !op.requires || this.cleared.has(op.requires);
    }

    markCleared(opId) {
      if (this.cleared.has(opId)) return;
      this.cleared.add(opId);
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ cleared: [...this.cleared] }));
      } catch (e) {
        // Not saved: progress lasts until the page is closed
      }
    }
  }

  global.Campaign = new Campaign();
})(window);
