/* MEGABALL — fonts.js
 * The one typeface the menus ship with: "Kenney Pixel" by Kenney (kenney.nl),
 * released under CC0 1.0 (public domain). Source: assets/raw/kenpixel.ttf, with
 * one out-of-range cmap entry stripped and re-saved as WOFF so the OpenType
 * sanitizer in browsers accepts it. The shipped file is assets/fonts/kenpixel-CC0.woff,
 * loaded by relative path from the @font-face below. Attaches window.FONTS.
 */
(function (global) {
  'use strict';
  var FONTS = {};
  FONTS.pixelFamily = 'Ken Pixel';
  FONTS.css = '@font-face{font-family:"Ken Pixel";font-style:normal;font-weight:400;font-display:block;'
    + 'src:url("assets/fonts/kenpixel-CC0.woff") format("woff");}';
  /* Put the @font-face in the document once; the boot splash and the menu
   * layer both call this, whichever runs first. */
  FONTS.inject = function () {
    if (FONTS.injected || !global.document) return;
    FONTS.injected = true;
    var st = global.document.createElement('style');
    st.textContent = FONTS.css;
    global.document.head.appendChild(st);
  };
  global.FONTS = FONTS;
})(typeof window !== 'undefined' ? window : this);
