/* MEGABALL - src/assets.js
 * The art manifest: one key per image, each mapped to a path relative to
 * index.html. The files themselves live in assets/images/ as WebP, converted
 * from the PNG originals in assets/raw/. Adding art means dropping a .webp in
 * that folder and adding a line below.
 * Exposes window.ART per CONTRACT.md section 5.3.
 */
'use strict';
(function (global) {

  var manifest = {
    bg_table: 'assets/images/bg_table.webp',
    bg_menu_v2: 'assets/images/bg_menu_v2.webp',
    logo_megaball: 'assets/images/logo_megaball.webp',
    lvl_1: 'assets/images/lvl_1.webp',
    lvl_2: 'assets/images/lvl_2.webp',
    lvl_3: 'assets/images/lvl_3.webp',
    lvl_4: 'assets/images/lvl_4.webp',
    lvl_5: 'assets/images/lvl_5.webp',
    card_slowtime: 'assets/images/card_slowtime.webp',
    card_overcharge: 'assets/images/card_overcharge.webp',
    card_megaball: 'assets/images/card_megaball.webp',
    card_barrier: 'assets/images/card_barrier.webp',
    card_magnet: 'assets/images/card_magnet.webp',
    card_shockwave: 'assets/images/card_shockwave.webp'
  };

  var images = {};

  var ART = {
    manifest: manifest,
    ready: false,

    // Load every entry, then fire the callback exactly once.
    // A failed load is recorded as null and must never block boot,
    // because every image in this game is decoration over procedural art.
    load: function (onDone) {
      var keys = Object.keys(manifest);
      var pending = keys.length;
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        ART.ready = true;
        if (typeof onDone === 'function') onDone();
      }

      if (!pending || typeof Image === 'undefined') { finish(); return; }

      // Safety net: never let a wedged request strand the loading screen.
      var guard = setTimeout(finish, 8000);

      function step() {
        pending--;
        if (pending <= 0) { clearTimeout(guard); finish(); }
      }

      keys.forEach(function (k) {
        var img = new Image();
        img.onload = function () { images[k] = img; step(); };
        img.onerror = function () { images[k] = null; step(); };
        try {
          img.src = manifest[k];
        } catch (e) {
          images[k] = null;
          step();
        }
      });
    },

    // Null-safe. Callers draw only when this returns something.
    get: function (key) {
      var img = images[key];
      return img && img.width ? img : null;
    }
  };

  global.ART = ART;

})(typeof window !== 'undefined' ? window : this);
