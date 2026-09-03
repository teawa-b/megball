/* MEGABALL — util.js
 * Math, easing, seeded RNG and tiny helpers shared by every other module.
 * Attaches window.U. No dependencies.
 */
(function (global) {
  'use strict';

  var U = {};

  /* ---------- virtual resolution -------------------------------------- */
  /* Every gameplay number in this project is expressed in these units.
   * Phones fill their viewport; wider desktop windows use a contained board. */
  U.VW = 720;
  U.VH = 1370;
  /* The first VIEW_TOP units of virtual y are never shown: they sit behind
   * the HUD on the cabinet head panel, so the display maps y = VIEW_TOP..VH
   * onto the screen. Gameplay coordinates are untouched by this — it is what
   * lets the board present at ~0.54 rather than 0.5 and so fill more of a
   * phone screen without stretching. */
  U.VIEW_TOP = 32;

  /* Vertical bands (see docs/CONTRACT.md §2). */
  U.BAND = {
    hud: 108,
    spawn: 190,
    fieldTop: 190,
    fieldBottom: 1030,
    deckTop: 1030,
    drain: 1200,
    trayTop: 1240
  };

  /* Presentation constants. Gameplay coordinates stay fixed; these only
   * decide how the machine and its menus occupy a real phone screen. */
  U.UI = {
    /* The board is always scaled uniformly, so a ball is a circle on every
     * phone. What varies is how much cabinet is shown. A tall viewport is
     * width-limited and has spare height; rather than black bars, that
     * height becomes machine: the HUD rises into the head panel above the
     * table (up to headMax units, enough to uncover the spawn gates) and the
     * rest goes to the card tray, whose contents scale up (to trayScaleMax)
     * to use the room. A short viewport is height-limited and gets slim side
     * bars. Nothing ever stretches. */
    headMax: 100,
    trayScaleMax: 1.3,
    maxMenuWidth: 520,
    minTouch: 48
  };

  U.WALL_L = 40;
  U.WALL_R = 680;

  /* ---------- scalar math --------------------------------------------- */
  U.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.inv = function (a, b, v) { return b === a ? 0 : (v - a) / (b - a); };
  U.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
  U.approach = function (v, target, step) {
    if (v < target) return Math.min(v + step, target);
    if (v > target) return Math.max(v - step, target);
    return v;
  };
  /* Frame-rate independent exponential smoothing. `rate` is roughly
   * "fraction closed per second", so 0.9 is fast, 0.1 is slow. */
  U.damp = function (v, target, rate, dt) {
    return U.lerp(v, target, 1 - Math.pow(1 - rate, dt * 60));
  };

  U.TAU = Math.PI * 2;
  U.angLerp = function (a, b, t) {
    var d = ((b - a + Math.PI) % U.TAU + U.TAU) % U.TAU - Math.PI;
    return a + d * t;
  };

  /* ---------- easing --------------------------------------------------- */
  U.ease = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return 1 - (1 - t) * (1 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inCubic: function (t) { return t * t * t; },
    outQuart: function (t) { return 1 - Math.pow(1 - t, 4); },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    outBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outElastic: function (t) {
      if (t === 0 || t === 1) return t;
      var c4 = U.TAU / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    /* 0 -> 1 -> 0, useful for one-shot pulses. */
    pulse: function (t) { return Math.sin(t * Math.PI); }
  };

  /* ---------- vectors (scalar pairs, no allocation in hot paths) ------- */
  U.len = function (x, y) { return Math.sqrt(x * x + y * y); };
  U.len2 = function (x, y) { return x * x + y * y; };
  U.dist = function (ax, ay, bx, by) { return U.len(bx - ax, by - ay); };
  U.dist2 = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy;
  };

  /* ---------- seeded RNG (mulberry32) ---------------------------------- */
  /* Levels use a seeded stream so wave layouts replay identically, while
   * cosmetic randomness uses Math.random and is free to differ. */
  U.rng = function (seed) {
    var a = seed >>> 0;
    var f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = function (lo, hi) { return lo + f() * (hi - lo); };
    f.int = function (lo, hi) { return Math.floor(lo + f() * (hi - lo + 1)); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    return f;
  };

  U.rand = function (lo, hi) { return lo + Math.random() * (hi - lo); };
  U.randInt = function (lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); };
  U.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  /* Symmetric jitter — used constantly by the juice layer. */
  U.jit = function (m) { return (Math.random() * 2 - 1) * m; };

  /* ---------- colour helpers ------------------------------------------- */
  /* Cached so the renderer can call rgba() every frame without garbage
   * from repeated string parsing. */
  var hexCache = {};
  function parseHex(hex) {
    var c = hexCache[hex];
    if (c) return c;
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    c = hexCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return c;
  }
  U.rgba = function (hex, a) {
    var c = parseHex(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };
  U.mixHex = function (h1, h2, t) {
    var a = parseHex(h1), b = parseHex(h2);
    return 'rgb(' + Math.round(U.lerp(a[0], b[0], t)) + ',' +
      Math.round(U.lerp(a[1], b[1], t)) + ',' +
      Math.round(U.lerp(a[2], b[2], t)) + ')';
  };

  /* Locked palette — docs/CONTRACT.md §3. */
  U.C = {
    void: '#05060d',
    table: '#0a0e1a',
    panel: '#0b0f1c',
    line: '#1c2740',
    steel: '#2c3a5c',
    cyan: '#3fe0ff',
    cyanDeep: '#0a7ea4',
    frost: '#8fe8ff',
    violet: '#8b5cff',
    magenta: '#ff2e88',
    amber: '#ffb020',
    power: '#ffd24a',
    powerHot: '#ff7a1a',
    green: '#4ade80',
    white: '#ffffff',
    ink: '#000000'
  };

  U.FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

  /* ---------- misc ------------------------------------------------------ */
  U.fmt = function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n | 0); };

  U.now = function () {
    return (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();
  };

  /* Remove element i from an array without preserving order — O(1) and
   * allocation free, which matters for the per-frame entity lists. */
  U.swapRemove = function (arr, i) {
    var last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
  };

  U.save = function (key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  };
  U.loadSave = function (key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  };

  global.U = U;
})(typeof window !== 'undefined' ? window : this);
