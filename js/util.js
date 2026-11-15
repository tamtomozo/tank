(function (global) {
  'use strict';

  // Small helpers shared by several scripts. Loaded first (see index.html), so every other
  // script can pick what it needs with `const { wrapAngle } = global.TankUtil;`.

  const TankUtil = {
    // Angle normalised to -PI .. PI
    wrapAngle(a) {
      let r = (a + Math.PI) % (Math.PI * 2);
      if (r < 0) r += Math.PI * 2;
      return r - Math.PI;
    },

    clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    // Random element of a list
    pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    },

    // Create a DOM element with an optional class name and text
    el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    },

    // Add the methods (and getters) written in `class Part { ... }` to Target.prototype.
    // Lets one big class be split across files (js/planet/, js/combat/): each extra file declares
    // a class with some of the methods and mixes it into the main class. Defining a method twice
    // is an error, so a part can never silently override another.
    mixin(Target, Part) {
      const descs = Object.getOwnPropertyDescriptors(Part.prototype);
      delete descs.constructor;
      for (const name of Object.keys(descs)) {
        if (Object.prototype.hasOwnProperty.call(Target.prototype, name)) {
          throw new Error(`mixin: ${Target.name}.${name} is already defined`);
        }
      }
      Object.defineProperties(Target.prototype, descs);
    }
  };

  global.TankUtil = TankUtil;
})(window);
