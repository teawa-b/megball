/* =============================================================================
 * MEGABALL — src/fx.js   →   global: FX
 *
 * The juice layer: particles, shockwaves, combat text, screen shake, hitstop
 * and slow motion. Everything here is decoration — the game must play
 * identically with this file stubbed out, except for FX.timeScale().
 *
 * Design constraints this file is built around (see docs/CONTRACT.md §5.1):
 *
 *  1. ZERO ALLOCATION IN THE STEADY STATE. Every particle struct, link table
 *     and scratch buffer is created once at load. update() and the emitters
 *     never create an object, array, closure or string. This is the single
 *     biggest thing keeping the GC quiet on a mid-range phone: a garbage
 *     collection pause during a chain reaction is exactly when you cannot
 *     afford one.
 *
 *  2. HARD PARTICLE CAP with oldest-first recycling. Pools are fixed size and
 *     never grow. When a pool is exhausted we steal the oldest live particle
 *     instead of dropping the emit — dropping would make the *biggest* moments
 *     (the ones that exhaust the pool) look the weakest, which is backwards.
 *
 *  3. BATCHED BY DRAW STYLE. globalCompositeOperation is set at most twice per
 *     draw call, never per particle. Within a blend mode we do all fills, then
 *     all strokes, so fillStyle/strokeStyle churn stays low.
 *
 *  4. NO ctx.shadowBlur. It is catastrophically slow on mobile GPUs. Glow is
 *     faked with a wider, low-alpha additive pass drawn under the core.
 *
 *  5. EFFECTS DIE FAST. Most particles live under 0.6 s. The board must stay
 *     readable — effects may never hide an enemy trajectory, the flippers or
 *     the drain. Fewer, faster, punchier.
 *
 * Coordinates are virtual units (720 x 1440 portrait). The renderer installs
 * the canvas transform before calling drawBelow/drawAbove, so we just draw.
 * ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   * Palette (CONTRACT.md §3). Stored as literal strings so we can assign
   * them straight to fillStyle without building a colour string per frame.
   * ---------------------------------------------------------------------- */
  var COL = {
    void:     '#05060d',
    table:    '#0a0e1a',
    line:     '#1c2740',
    steel:    '#2c3a5c',
    cyan:     '#3fe0ff',
    cyanDeep: '#0a7ea4',
    frost:    '#8fe8ff',
    violet:   '#8b5cff',
    magenta:  '#ff2e88',
    amber:    '#ffb020',
    power:    '#ffd24a',
    powerHot: '#ff7a1a',
    green:    '#4ade80',
    white:    '#ffffff',
    ink:      '#000000'
  };

  var TAU = Math.PI * 2;
  var VW = 720, VH = 1440;

  /* Pool sizes. Total particle budget = 640 + 128 + 72 + 24 = 864, under the
   * ~900 cap in the contract. The split is deliberate: dots are the cheap
   * bulk of every effect, shards are chunky and read as "that thing broke",
   * rings are expensive-looking but you only ever need a handful on screen,
   * and more than a few floating texts at once is unreadable anyway. */
  var CAP_DOT   = 640;
  var CAP_SHARD = 128;
  var CAP_RING  = 72;
  var CAP_TEXT  = 24;
  var CAP_FLASH = 4;

  /* Ribbon trails: 12 concurrent owners is far more empowered balls than the
   * game will ever have live at once, and 20 samples at ~60 Hz covers a third
   * of a second of motion — long enough to read as a comet, short enough that
   * it never becomes a wall across the playfield. */
  var CAP_TRAIL     = 12;
  var TRAIL_SAMPLES = 20;

  var FONT = '900 64px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  var FONT_BASE = 64; // text is drawn at this size and scaled by transform,
                      // which avoids building a font string every frame.

  /* ---------------------------------------------------------------------- *
   * Fast RNG. xorshift32 — no allocation, no Math.random call overhead, and
   * deterministic, which makes visual bugs reproducible.
   * ---------------------------------------------------------------------- */
  var _seed = 0x9e3779b9 | 0;
  function rnd() {
    _seed ^= _seed << 13; _seed |= 0;
    _seed ^= _seed >>> 17;
    _seed ^= _seed << 5;  _seed |= 0;
    return ((_seed >>> 0) % 16777216) / 16777216;
  }
  function rnd2() { return rnd() * 2 - 1; }          // -1 .. 1
  function rrange(a, b) { return a + (b - a) * rnd(); }

  /* ---------------------------------------------------------------------- *
   * Small numeric helpers. `num`/`txt` read an option off a possibly-absent
   * options object and fall back to a default, rejecting NaN/Infinity so a
   * bad caller can never wedge a particle into an immortal state.
   * ---------------------------------------------------------------------- */
  function num(o, k, d) {
    if (!o) return d;
    var v = o[k];
    return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d;
  }
  function txt(o, k, d) {
    if (!o) return d;
    var v = o[k];
    return (typeof v === 'string' && v.length) ? v : d;
  }
  function bool(o, k, d) {
    if (!o) return d;
    var v = o[k];
    return (typeof v === 'boolean') ? v : d;
  }
  function fin(v, d) {
    return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Overshoot ease — the classic "pop" for combat text.
  function easeOutBack(k) {
    var c1 = 1.70158, c3 = c1 + 1, m = k - 1;
    return 1 + c3 * m * m * m + c1 * m * m;
  }
  function easeOutCubic(k) { var m = 1 - k; return 1 - m * m * m; }

  /* ======================================================================= *
   * POOL
   *
   * A fixed array of pre-built structs plus two index tables:
   *   - a free stack (O(1) alloc / release)
   *   - a doubly linked list in INSERTION ORDER (head = oldest, tail = newest)
   *
   * The linked list exists purely so that "recycle the oldest" is O(1) when
   * the pool is exhausted. A dense array would need an O(n) scan or would
   * lose ordering under swap-removal; during a huge chain reaction the pool
   * is exhausted on exactly the frames where we have the least time to spare.
   * ======================================================================= */
  function Pool(cap, factory) {
    this.cap     = cap;
    this.item    = new Array(cap);
    this.prevIx  = new Int16Array(cap);
    this.nextIx  = new Int16Array(cap);
    this.freeIx  = new Int16Array(cap);
    this.freeTop = cap;
    this.head    = -1;
    this.tail    = -1;
    this.live    = 0;
    for (var i = 0; i < cap; i++) {
      this.item[i]   = factory();
      this.freeIx[i] = cap - 1 - i; // so the first allocations run 0,1,2,...
      this.prevIx[i] = -1;
      this.nextIx[i] = -1;
    }
  }

  Pool.prototype.unlink = function (i) {
    var p = this.prevIx[i], n = this.nextIx[i];
    if (p !== -1) this.nextIx[p] = n; else this.head = n;
    if (n !== -1) this.prevIx[n] = p; else this.tail = p;
    this.prevIx[i] = -1;
    this.nextIx[i] = -1;
  };

  // Returns the index of a struct ready to be filled in. Never fails, never
  // grows the pool: a full pool cannibalises its oldest member.
  Pool.prototype.alloc = function () {
    var i;
    if (this.freeTop > 0) {
      i = this.freeIx[--this.freeTop];
      this.live++;
    } else {
      i = this.head;
      this.unlink(i);
    }
    this.prevIx[i] = this.tail;
    this.nextIx[i] = -1;
    if (this.tail !== -1) this.nextIx[this.tail] = i; else this.head = i;
    this.tail = i;
    return i;
  };

  Pool.prototype.release = function (i) {
    this.unlink(i);
    this.freeIx[this.freeTop++] = i;
    this.live--;
  };

  Pool.prototype.clear = function () {
    this.head = -1; this.tail = -1; this.live = 0;
    this.freeTop = this.cap;
    for (var i = 0; i < this.cap; i++) {
      this.freeIx[i] = this.cap - 1 - i;
      this.prevIx[i] = -1;
      this.nextIx[i] = -1;
    }
  };

  /* ======================================================================= *
   * PARTICLE STRUCTS
   * Every field is initialised here and fully rewritten on every emit, so a
   * recycled struct can never carry stale state (and the hidden class stays
   * stable, which keeps the update loop monomorphic).
   * ======================================================================= */
  function Dot() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.life = 0; this.life0 = 1;
    this.size = 0; this.size0 = 0;
    this.grav = 0; this.drag = 0;
    this.col = COL.white;
    this.glow = true;
    this.streak = 0;   // seconds of velocity smear; 0 = round/square dot
    this.fadePow = 1;  // alpha = (life/life0) ^ fadePow
    this.shrink = 1;   // 0 = keeps size, 1 = shrinks to nothing
  }

  function Ring() {
    this.x = 0; this.y = 0;
    this.r0 = 0; this.r1 = 0;
    this.life = 0; this.life0 = 1;
    this.col = COL.white;
    this.w = 3;
    this.fadePow = 1;
    this.alpha = 1;
    this.fill = false; // true = soft expanding disc (ground glow / shockwave)
  }

  function Shard() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.a = 0; this.spin = 0;
    this.size = 0;
    this.life = 0; this.life0 = 1;
    this.col = COL.white;
    this.grav = 0; this.drag = 0;
  }

  function Txt() {
    this.x = 0; this.y = 0;
    this.s = '';
    this.col = COL.white;
    this.size = 30;
    this.life = 0; this.life0 = 1;
    this.rise = 0;
    this.pop = 1;
    this.outline = true;
  }

  function Flash() {
    this.col = COL.white;
    this.a = 0;
    this.life = 0; this.life0 = 1;
  }

  var dots   = new Pool(CAP_DOT,   function () { return new Dot(); });
  var shards = new Pool(CAP_SHARD, function () { return new Shard(); });
  var rings  = new Pool(CAP_RING,  function () { return new Ring(); });
  var texts  = new Pool(CAP_TEXT,  function () { return new Txt(); });
  var flashes= new Pool(CAP_FLASH, function () { return new Flash(); });

  /* ======================================================================= *
   * TRAILS (the hero effect: the empowered ball's ribbon)
   *
   * One slot per owner key. Samples live in a per-slot ring buffer of typed
   * arrays — no per-sample objects, no array pushes, no garbage.
   * ======================================================================= */
  function TrailSlot() {
    this.key   = null;
    this.x     = new Float32Array(TRAIL_SAMPLES);
    this.y     = new Float32Array(TRAIL_SAMPLES);
    this.age   = new Float32Array(TRAIL_SAMPLES);
    this.head  = 0;   // ring write cursor (index of the NEXT write)
    this.n     = 0;   // live sample count
    this.lastX = 0; this.lastY = 0;
    this.idle  = 0;   // seconds since the owner last fed us a sample
    this.col   = COL.power;
    this.col2  = COL.powerHot;
    this.width = 12;
    this.life  = 0.28;
    this.glow  = true;
  }

  var trails = new Array(CAP_TRAIL);
  for (var _t = 0; _t < CAP_TRAIL; _t++) trails[_t] = new TrailSlot();

  // Scratch buffers for ribbon tessellation. Allocated once; the ribbon
  // builder writes into these and the fill reads them straight back.
  var _lx = new Float32Array(TRAIL_SAMPLES);
  var _ly = new Float32Array(TRAIL_SAMPLES);
  var _rx = new Float32Array(TRAIL_SAMPLES);
  var _ry = new Float32Array(TRAIL_SAMPLES);

  // k-th newest sample (k = 0 is the head of the comet).
  function sampleIx(s, k) {
    var i = s.head - 1 - k;
    while (i < 0) i += TRAIL_SAMPLES;
    return i % TRAIL_SAMPLES;
  }

  function findTrail(key) {
    for (var i = 0; i < CAP_TRAIL; i++) if (trails[i].key === key) return trails[i];
    return null;
  }

  // Grab a slot for `key`. If all slots are busy, steal the most idle one —
  // same philosophy as the particle pools: never refuse the newest event.
  function claimTrail(key) {
    var free = null, worst = null, i, s;
    for (i = 0; i < CAP_TRAIL; i++) {
      s = trails[i];
      if (s.key === null) { free = s; break; }
      if (!worst || s.idle > worst.idle) worst = s;
    }
    s = free || worst;
    s.key = key; s.head = 0; s.n = 0; s.idle = 0;
    s.lastX = 0; s.lastY = 0;
    return s;
  }

  function killTrail(s) { s.key = null; s.n = 0; s.head = 0; s.idle = 0; }

  /* ======================================================================= *
   * TIME CONTROL — hitstop, slow motion, and the resulting time scale.
   *
   * Hitstop wins outright (scale 0). Slowmo is a punctuation mark: short, and
   * it eases back to full speed over its own tail so play does not snap.
   * ======================================================================= */
  var hitT = 0;                 // remaining hitstop, real seconds
  var slowT = 0, slowScale = 1; // remaining slowmo + its target scale
  var slowRamp = 0.12;          // seconds of ease-out at the end of a slowmo
  var scaleNow = 1;             // cached scale for this frame

  var HITSTOP_MAX = 0.14;       // anything longer reads as a hitch, not a hit
  var SLOWMO_MAX  = 0.60;

  function computeScale() {
    if (hitT > 0) return 0;
    if (slowT > 0) {
      if (slowT < slowRamp) {
        // Ease back to 1 over the tail so the return to speed is felt as a
        // release rather than a jump cut.
        var k = 1 - slowT / slowRamp;
        return slowScale + (1 - slowScale) * easeOutCubic(k);
      }
      return slowScale;
    }
    return 1;
  }

  /* ======================================================================= *
   * SCREEN SHAKE
   *
   * Amplitude decays exponentially (impacts ring down, they do not fade
   * linearly), and the offset comes from smoothed value noise rather than
   * per-frame white noise. White noise at 60 Hz reads as a buzz and fights
   * the player's eye; noise sampled at ~26 Hz and smoothstep-interpolated
   * reads as the cabinet actually moving.
   * ======================================================================= */
  var NOISE = new Float32Array(96);
  // Values are over-driven and clipped so roughly 40% of the table sits at the
  // rails. Plain uniform noise averages |0.5|, which would make shake(14) peak
  // at only ~6 units — the caller's magnitude should mean what it says.
  for (var _n = 0; _n < 96; _n++) NOISE[_n] = clamp(rnd2() * 1.7, -1, 1);
  var SHAKE_HZ = 26;
  var ROT_MIN = 8;   // only the biggest hits get any rotation at all

  // Table indices sitting at the rails. A new shake re-phases the noise onto
  // one of these so its FIRST rendered frame is its biggest: an impact has to
  // land immediately, not ramp in over three frames. Built once at load.
  var PEAKS = new Int16Array(96);
  var PEAK_N = 0, _pk = 0;
  for (_n = 0; _n < 96; _n++) if (NOISE[_n] > 0.92 || NOISE[_n] < -0.92) PEAKS[PEAK_N++] = _n;

  var shakeMag = 0;
  var shakeTau = 0.12;
  var shakeClock = 0;
  var _cam = { x: 0, y: 0, rot: 0 }; // reused every frame — never retain it

  function noiseAt(offset, t) {
    var p = t * SHAKE_HZ + offset;
    var i = p | 0;
    var f = p - i;
    f = f * f * (3 - 2 * f); // smoothstep
    var a = NOISE[i & 95], b = NOISE[(i + 1) & 95];
    return a + (b - a) * f;
  }

  /* ======================================================================= *
   * EMITTERS
   * ======================================================================= */

  function spark(x, y, o) {
    x = fin(x, 0); y = fin(y, 0);
    var count  = clamp(num(o, 'count', 8) | 0, 0, 64);
    var col    = txt(o, 'color', COL.cyan);
    var speed  = num(o, 'speed', 260);
    var hasDir = !!(o && typeof o.dir === 'number' && o.dir === o.dir);
    var dir    = hasDir ? o.dir : 0;
    // No direction given → spray a full circle rather than a degenerate fan.
    var spread = num(o, 'spread', hasDir ? 0.55 : Math.PI);
    var size   = num(o, 'size', 3);
    var life   = num(o, 'life', 0.22);
    var grav   = num(o, 'gravity', 0);
    var drag   = num(o, 'drag', 3.4);
    var glow   = bool(o, 'glow', true);
    var streak = num(o, 'streak', 0.03);

    for (var i = 0; i < count; i++) {
      var d = dots.item[dots.alloc()];
      var a = dir + rnd2() * spread;
      var sp = speed * rrange(0.5, 1.0);
      d.x = x; d.y = y;
      d.vx = Math.cos(a) * sp;
      d.vy = Math.sin(a) * sp;
      d.life = d.life0 = life * rrange(0.7, 1.05);
      d.size = d.size0 = size * rrange(0.7, 1.25);
      d.grav = grav; d.drag = drag;
      d.col = col; d.glow = glow;
      d.streak = streak;
      d.fadePow = 1;
      d.shrink = 0.8;
    }
  }

  function burst(x, y, o) {
    x = fin(x, 0); y = fin(y, 0);
    var count = clamp(num(o, 'count', 14) | 0, 0, 64);
    var col   = txt(o, 'color', COL.power);
    var col2  = txt(o, 'color2', COL.powerHot);
    var power = num(o, 'power', 200);
    var life  = num(o, 'life', 0.34);
    var size  = num(o, 'size', 6);

    for (var i = 0; i < count; i++) {
      var d = dots.item[dots.alloc()];
      var a = rnd() * TAU;
      // Bias speed toward the outside of the disc so the puff has an edge
      // instead of a uniform mush.
      var sp = power * (0.35 + 0.65 * Math.sqrt(rnd()));
      d.x = x + Math.cos(a) * size * 0.4;
      d.y = y + Math.sin(a) * size * 0.4;
      d.vx = Math.cos(a) * sp;
      d.vy = Math.sin(a) * sp;
      d.life = d.life0 = life * rrange(0.65, 1.1);
      d.size = d.size0 = size * rrange(0.6, 1.3);
      d.grav = 0;
      d.drag = 5.5;                 // puffs stall fast; sparks fly
      d.col = (i & 1) ? col2 : col; // two-tone without per-frame colour math
      d.glow = true;
      d.streak = 0;
      d.fadePow = 1.4;
      d.shrink = 1;
    }
  }

  function ring(x, y, o) {
    x = fin(x, 0); y = fin(y, 0);
    var r = rings.item[rings.alloc()];
    r.x = x; r.y = y;
    r.r0 = num(o, 'r0', 4);
    r.r1 = num(o, 'r1', 90);
    r.life = r.life0 = Math.max(0.01, num(o, 'life', 0.3));
    r.col = txt(o, 'color', COL.cyan);
    r.w = num(o, 'width', 4);
    r.fadePow = num(o, 'fade', 1);
    r.alpha = num(o, 'alpha', 1);
    r.fill = bool(o, 'fill', false);
    // Deliberately returns nothing: `r` is a pooled struct that will be
    // recycled underneath any caller that hangs on to it.
  }

  function shard(x, y, o) {
    x = fin(x, 0); y = fin(y, 0);
    var count = clamp(num(o, 'count', 5) | 0, 0, 32);
    var col   = txt(o, 'color', COL.white);
    var speed = num(o, 'speed', 230);
    var life  = num(o, 'life', 0.45);
    var size  = num(o, 'size', 9);
    var grav  = num(o, 'gravity', 900);
    var dir   = num(o, 'dir', 0);
    var hasDir = !!(o && typeof o.dir === 'number');
    var spread = num(o, 'spread', hasDir ? 0.9 : Math.PI);

    for (var i = 0; i < count; i++) {
      var s = shards.item[shards.alloc()];
      var a = dir + rnd2() * spread;
      var sp = speed * rrange(0.45, 1.0);
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp;
      s.a = rnd() * TAU;
      s.spin = rnd2() * 13;
      s.size = size * rrange(0.65, 1.25);
      s.life = s.life0 = life * rrange(0.75, 1.1);
      s.col = col;
      s.grav = grav;
      s.drag = 1.1;
    }
  }

  function text(x, y, str, o) {
    if (typeof str !== 'string' || !str.length) return;
    var t = texts.item[texts.alloc()];
    t.x = fin(x, 0); t.y = fin(y, 0);
    t.s = str;
    t.col = txt(o, 'color', COL.white);
    t.size = num(o, 'size', 34);
    t.life = t.life0 = Math.max(0.05, num(o, 'life', 0.85));
    t.rise = num(o, 'rise', 70);
    t.pop = num(o, 'pop', 1);
    t.outline = bool(o, 'outline', true);
  }

  function flash(o) {
    var f = flashes.item[flashes.alloc()];
    f.col = txt(o, 'color', COL.white);
    f.a = clamp(num(o, 'alpha', 0.35), 0, 1);
    f.life = f.life0 = Math.max(0.02, num(o, 'life', 0.12));
  }

  function trail(key, x, y, o) {
    if (key === null || key === undefined) return;
    x = fin(x, 0); y = fin(y, 0);
    var s = findTrail(key);
    if (!s) {
      s = claimTrail(key);
      s.lastX = x; s.lastY = y;
    }
    s.col   = txt(o, 'color', COL.power);
    s.col2  = txt(o, 'color2', COL.powerHot);
    s.width = num(o, 'width', 12);
    s.life  = Math.max(0.05, num(o, 'life', 0.28));
    s.glow  = bool(o, 'glow', true);
    s.idle  = 0;

    // Only record a sample once the owner has actually moved. A stationary
    // ball would otherwise pile 60 samples/second into one spot and the
    // ribbon would collapse into a blob.
    var dx = x - s.lastX, dy = y - s.lastY;
    if (s.n > 0 && dx * dx + dy * dy < 16) return;

    s.x[s.head] = x;
    s.y[s.head] = y;
    s.age[s.head] = 0;
    s.head = (s.head + 1) % TRAIL_SAMPLES;
    if (s.n < TRAIL_SAMPLES) s.n++;
    s.lastX = x; s.lastY = y;
  }

  function dropTrail(key) {
    var s = findTrail(key);
    // Unbind the key but keep the samples: the ribbon fades out on its own
    // over `life` instead of vanishing the instant its owner dies.
    if (s) { s.key = null; s.idle = 0; }
  }

  /* ======================================================================= *
   * UPDATE
   * ======================================================================= */

  function update(dtReal) {
    dtReal = fin(dtReal, 0);
    // A tab-switch or a stalled frame must not teleport particles or blow
    // through a hitstop; clamp to ~3 frames' worth.
    if (dtReal < 0) dtReal = 0;
    if (dtReal > 0.05) dtReal = 0.05;

    // Time-control timers run on REAL time, so a freeze always ends.
    if (hitT > 0) hitT -= dtReal;
    if (slowT > 0) slowT -= dtReal;
    if (hitT < 0) hitT = 0;
    if (slowT < 0) { slowT = 0; slowScale = 1; }
    scaleNow = computeScale();

    // Particles live in GAME time: they freeze during hitstop (which is what
    // makes a freeze read as an impact rather than a dropped frame) and
    // stretch out during slowmo.
    var dt = dtReal * scaleNow;

    var i, nx, k, u;

    // --- dots -----------------------------------------------------------
    for (i = dots.head; i !== -1; i = nx) {
      nx = dots.nextIx[i];
      var d = dots.item[i];
      d.life -= dt;
      if (d.life <= 0) { dots.release(i); continue; }
      // Exponential drag, integrated properly so it is framerate-independent.
      if (d.drag > 0) {
        var f = 1 / (1 + d.drag * dt);
        d.vx *= f; d.vy *= f;
      }
      d.vy += d.grav * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      u = d.life / d.life0;
      d.size = d.size0 * (1 - d.shrink + d.shrink * u);
    }

    // --- shards ---------------------------------------------------------
    for (i = shards.head; i !== -1; i = nx) {
      nx = shards.nextIx[i];
      var s = shards.item[i];
      s.life -= dt;
      if (s.life <= 0) { shards.release(i); continue; }
      if (s.drag > 0) {
        var sf = 1 / (1 + s.drag * dt);
        s.vx *= sf; s.vy *= sf;
      }
      s.vy += s.grav * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.a += s.spin * dt;
    }

    // --- rings ----------------------------------------------------------
    for (i = rings.head; i !== -1; i = nx) {
      nx = rings.nextIx[i];
      var r = rings.item[i];
      r.life -= dt;
      if (r.life <= 0) rings.release(i);
    }

    // --- texts ----------------------------------------------------------
    // Real time, deliberately. Combat text is feedback, not scenery: the
    // event that spawns "CHAIN x4" usually calls hitstop() in the same breath,
    // and on game time the label would sit frozen at pop-in scale — i.e.
    // invisible — for the entire freeze. It must be readable instantly.
    for (i = texts.head; i !== -1; i = nx) {
      nx = texts.nextIx[i];
      var t = texts.item[i];
      t.life -= dtReal;
      if (t.life <= 0) texts.release(i);
    }

    // --- flashes (real time: a screen flash during hitstop should still
    //     resolve, otherwise the frozen frame stays washed out) -----------
    for (i = flashes.head; i !== -1; i = nx) {
      nx = flashes.nextIx[i];
      var fl = flashes.item[i];
      fl.life -= dtReal;
      if (fl.life <= 0) flashes.release(i);
    }

    // --- trails ---------------------------------------------------------
    for (k = 0; k < CAP_TRAIL; k++) {
      var tr = trails[k];
      if (tr.n === 0 && tr.key === null) continue;
      tr.idle += dt;
      for (var j = 0; j < tr.n; j++) tr.age[sampleIx(tr, j)] += dt;
      // Ages increase monotonically toward the tail, so expiring from the
      // oldest end is just a count decrement.
      while (tr.n > 0 && tr.age[sampleIx(tr, tr.n - 1)] > tr.life) tr.n--;
      if (tr.key === null && (tr.n === 0 || tr.idle > tr.life)) killTrail(tr);
    }

    // --- shake ----------------------------------------------------------
    shakeClock += dtReal;
    if (shakeMag > 0) {
      shakeMag *= Math.exp(-dtReal / shakeTau);
      if (shakeMag < 0.05) shakeMag = 0;
    }
    _cam.x = shakeMag ? noiseAt(0, shakeClock) * shakeMag : 0;
    _cam.y = shakeMag ? noiseAt(31, shakeClock) * shakeMag * 0.85 : 0;
    _cam.rot = shakeMag > ROT_MIN
      ? noiseAt(61, shakeClock) * (shakeMag - ROT_MIN) * 0.0022
      : 0;
  }

  /* ======================================================================= *
   * DRAW — BELOW ENTITIES
   * Trails, shockwave rings and ground glow. Everything here is additive and
   * lives under the balls so it can never hurt readability.
   * ======================================================================= */

  function drawRibbon(ctx, s, count, widthMul, expo, alpha, col, capHead) {
    if (count < 2 || alpha <= 0.004) return;
    var k, idx, ia, ib, px, py, dx, dy, len, nrx, nry, half, t;
    var head = s.width * widthMul * 0.5;

    for (k = 0; k < count; k++) {
      idx = sampleIx(s, k);
      px = s.x[idx]; py = s.y[idx];
      ia = sampleIx(s, k > 0 ? k - 1 : 0);
      ib = sampleIx(s, k < count - 1 ? k + 1 : count - 1);
      dx = s.x[ib] - s.x[ia];
      dy = s.y[ib] - s.y[ia];
      len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-4) { dx = 1; dy = 0; len = 1; }
      nrx = -dy / len; nry = dx / len;
      t = 1 - k / (count - 1);                 // 1 at the head, 0 at the tail
      half = head * (expo === 1 ? t : Math.pow(t, expo));
      _lx[k] = px + nrx * half; _ly[k] = py + nry * half;
      _rx[k] = px - nrx * half; _ry[k] = py - nry * half;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(_lx[0], _ly[0]);
    for (k = 1; k < count; k++) ctx.lineTo(_lx[k], _ly[k]);
    for (k = count - 1; k >= 0; k--) ctx.lineTo(_rx[k], _ry[k]);
    ctx.closePath();
    if (capHead) {
      // Round off the leading edge so the comet has a head, not a chisel.
      idx = sampleIx(s, 0);
      ctx.moveTo(s.x[idx] + head, s.y[idx]);
      ctx.arc(s.x[idx], s.y[idx], head, 0, TAU);
    }
    ctx.fill();
  }

  function drawBelow(ctx) {
    if (!ctx) return;
    if (rings.live === 0 && !anyTrail()) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    var i, nx, u, k;

    // --- filled shockwave discs / ground glow (fills first, then strokes,
    //     so we never ping-pong the rasteriser between path styles) -------
    var lastCol = null;
    for (i = rings.head; i !== -1; i = nx) {
      nx = rings.nextIx[i];
      var rf = rings.item[i];
      if (!rf.fill) continue;
      u = 1 - rf.life / rf.life0;
      var rad = rf.r0 + (rf.r1 - rf.r0) * easeOutCubic(u);
      var a = rf.alpha * Math.pow(1 - u, rf.fadePow);
      if (a <= 0.004 || rad <= 0) continue;
      if (rf.col !== lastCol) { ctx.fillStyle = rf.col; lastCol = rf.col; }
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath(); ctx.arc(rf.x, rf.y, rad, 0, TAU); ctx.fill();
    }

    // --- ribbon trails (3 stacked fills: dim wide underlay, coloured core,
    //     hot white head — this is what sells the empowered ball) ---------
    for (k = 0; k < CAP_TRAIL; k++) {
      var tr = trails[k];
      if (tr.n < 2) continue;
      // Fade the whole ribbon out once its owner has stopped feeding it.
      var fade = tr.key === null ? clamp(1 - tr.idle / tr.life, 0, 1) : 1;
      if (fade <= 0.01) continue;
      if (tr.glow) drawRibbon(ctx, tr, tr.n, 2.4, 0.55, 0.11 * fade, tr.col2, false);
      drawRibbon(ctx, tr, tr.n, 1.0, 1, 0.5 * fade, tr.col, true);
      var hot = (tr.n * 0.45) | 0;
      if (hot >= 2) drawRibbon(ctx, tr, hot, 0.5, 1, 0.8 * fade, COL.white, true);
    }

    // --- stroked rings --------------------------------------------------
    lastCol = null;
    for (i = rings.head; i !== -1; i = nx) {
      nx = rings.nextIx[i];
      var r = rings.item[i];
      if (r.fill) continue;
      u = 1 - r.life / r.life0;
      var rr = r.r0 + (r.r1 - r.r0) * easeOutCubic(u); // fast out, slow stop
      var ra = r.alpha * Math.pow(1 - u, r.fadePow);
      if (ra <= 0.004 || rr <= 0.2) continue;
      if (r.col !== lastCol) { ctx.strokeStyle = r.col; lastCol = r.col; }
      ctx.globalAlpha = ra;
      ctx.lineWidth = Math.max(0.5, r.w * (1 - u * 0.72)); // thins as it grows
      ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, TAU); ctx.stroke();
    }

    ctx.restore();
  }

  function anyTrail() {
    for (var i = 0; i < CAP_TRAIL; i++) if (trails[i].n > 1) return true;
    return false;
  }

  /* ======================================================================= *
   * DRAW — ABOVE ENTITIES
   * Order: normal-blend debris → additive sparks/glow → screen flash →
   * combat text. Exactly two composite-mode changes per frame.
   * ======================================================================= */

  function drawAbove(ctx) {
    if (!ctx) return;
    if (dots.live === 0 && shards.live === 0 && texts.live === 0 && flashes.live === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, nx, u, d, lastCol;

    /* -------- pass 1: normal blend, fills -------------------------------
     * Shards are opaque white-with-black-outline chunks, matching the enemy
     * ball language, so they must NOT be additive or they lose their outline. */
    var s, sz, ca, sa;
    lastCol = null;
    for (i = shards.head; i !== -1; i = nx) {
      nx = shards.nextIx[i];
      s = shards.item[i];
      u = s.life / s.life0;
      sz = s.size * (0.45 + 0.55 * u);
      ctx.globalAlpha = clamp(u * 1.6, 0, 1);
      if (s.col !== lastCol) { ctx.fillStyle = s.col; lastCol = s.col; }
      // Triangle built straight from the rotation — no save/translate/rotate
      // per shard, which would be three context ops for one small path.
      ca = Math.cos(s.a); sa = Math.sin(s.a);
      ctx.beginPath();
      triPoint(ctx, s.x, s.y, ca, sa, sz, -0.35 * sz, true);
      triPoint(ctx, s.x, s.y, ca, sa, -sz * 0.8, -sz * 0.7, false);
      triPoint(ctx, s.x, s.y, ca, sa, -sz * 0.3, sz * 0.9, false);
      ctx.closePath();
      ctx.fill();
    }

    // Shard outlines in their own pass, so fillStyle and strokeStyle are each
    // set once for the whole batch (art direction: heavy black outlines).
    if (shards.live > 0) {
      ctx.strokeStyle = COL.ink;
      for (i = shards.head; i !== -1; i = nx) {
        nx = shards.nextIx[i];
        s = shards.item[i];
        u = s.life / s.life0;
        sz = s.size * (0.45 + 0.55 * u);
        if (sz <= 3) continue; // outline on a 3-unit chip is just mud
        ctx.globalAlpha = clamp(u * 1.6, 0, 1) * 0.9;
        ctx.lineWidth = Math.min(3, sz * 0.42);
        ca = Math.cos(s.a); sa = Math.sin(s.a);
        ctx.beginPath();
        triPoint(ctx, s.x, s.y, ca, sa, sz, -0.35 * sz, true);
        triPoint(ctx, s.x, s.y, ca, sa, -sz * 0.8, -sz * 0.7, false);
        triPoint(ctx, s.x, s.y, ca, sa, -sz * 0.3, sz * 0.9, false);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Non-glow dots (rare, but keeps the option honest).
    lastCol = null;
    for (i = dots.head; i !== -1; i = nx) {
      nx = dots.nextIx[i];
      d = dots.item[i];
      if (d.glow || d.streak > 0 || d.size <= 0) continue;
      u = d.life / d.life0;
      ctx.globalAlpha = Math.pow(u, d.fadePow);
      if (d.col !== lastCol) { ctx.fillStyle = d.col; lastCol = d.col; }
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, TAU); ctx.fill();
    }

    /* -------- pass 2: additive ----------------------------------------- */
    ctx.globalCompositeOperation = 'lighter';

    // 2a. additive fills — round puffs, plus a wide low-alpha halo under each
    //     one. This is the cheap stand-in for shadowBlur.
    lastCol = null;
    for (i = dots.head; i !== -1; i = nx) {
      nx = dots.nextIx[i];
      d = dots.item[i];
      if (!d.glow || d.streak > 0 || d.size <= 0) continue;
      u = d.life / d.life0;
      var a = Math.pow(u, d.fadePow);
      if (d.col !== lastCol) { ctx.fillStyle = d.col; lastCol = d.col; }
      ctx.globalAlpha = a * 0.20;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size * 2.4, 0, TAU); ctx.fill();
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, TAU); ctx.fill();
    }

    // 2b. additive strokes — velocity streaks. A spark drawn as a smear along
    //     its own velocity reads as speed; a dot just reads as confetti.
    lastCol = null;
    for (i = dots.head; i !== -1; i = nx) {
      nx = dots.nextIx[i];
      d = dots.item[i];
      if (d.streak <= 0 || d.size <= 0) continue;
      u = d.life / d.life0;
      var sa2 = Math.pow(u, d.fadePow);
      if (d.col !== lastCol) { ctx.strokeStyle = d.col; lastCol = d.col; }
      var tx = d.x - d.vx * d.streak;
      var ty = d.y - d.vy * d.streak;
      // Skip the halo on hair-thin sparks: it costs a second stroke and is
      // invisible at that width anyway.
      if (d.glow && d.size > 2) {
        ctx.globalAlpha = sa2 * 0.18;
        ctx.lineWidth = d.size * 3.2;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.globalAlpha = sa2;
      ctx.lineWidth = d.size;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(tx, ty); ctx.stroke();
    }

    // 2c. full-screen flash. Additive so it can only brighten — a source-over
    //     tint would muddy the dark table and hurt contrast on the balls.
    for (i = flashes.head; i !== -1; i = nx) {
      nx = flashes.nextIx[i];
      var fl = flashes.item[i];
      u = fl.life / fl.life0;
      ctx.globalAlpha = fl.a * u * u; // snap on, fall off fast
      ctx.fillStyle = fl.col;
      // Overfill so screen shake can never expose an unflashed edge.
      ctx.fillRect(-120, -120, VW + 240, VH + 240);
    }

    /* -------- pass 3: combat text, on top, normal blend ------------------ */
    if (texts.live > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = COL.ink;
      // Thickness is specified in the 64px design space and scales with the
      // text transform, so every size gets the same heavy outline weight.
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;

      for (i = texts.head; i !== -1; i = nx) {
        nx = texts.nextIx[i];
        var t = texts.item[i];
        var age = t.life0 - t.life;
        u = 1 - t.life / t.life0;
        // Pop in over 0.12 s with an overshoot, then hold. The curve starts at
        // 0.35 rather than 0 so the label is legible on its very first frame —
        // scaling up from nothing costs two frames of readability on the exact
        // beat the player is looking for it.
        var k = age < 0.12 ? age / 0.12 : 1;
        var sc = 1 + (0.35 + 0.65 * easeOutBack(k) - 1) * t.pop;
        if (sc <= 0.001) continue;
        var alpha = t.life < t.life0 * 0.3 ? t.life / (t.life0 * 0.3) : 1;
        var yy = t.y - t.rise * easeOutCubic(u);
        var f = (t.size / FONT_BASE) * sc;

        ctx.save();
        ctx.translate(t.x, yy);
        ctx.scale(f, f);
        ctx.globalAlpha = alpha;
        if (t.outline) ctx.strokeText(t.s, 0, 0);
        ctx.fillStyle = t.col;
        ctx.fillText(t.s, 0, 0);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // Rotate a local shard vertex into world space and emit it into the path.
  function triPoint(ctx, x, y, ca, sa, lx, ly, move) {
    var px = x + lx * ca - ly * sa;
    var py = y + lx * sa + ly * ca;
    if (move) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }

  /* ======================================================================= *
   * CONVENIENCE PRESETS
   * Thin wrappers over the core API so the gameplay code can express intent
   * ("this was a medium impact") instead of tuning particle counts inline.
   * ======================================================================= */

  // Escalating chain labels, pre-built so FX.chain() never concatenates a
  // string at runtime.
  var CHAIN_LABEL = [
    '', '', 'CHAIN x2', 'CHAIN x3', 'CHAIN x4', 'CHAIN x5',
    'CHAIN x6', 'CHAIN x7', 'CHAIN x8', 'MEGA HIT'
  ];

  /**
   * A directional impact along a surface normal: a tight spark fan plus a
   * thin quick ring, with shake/hitstop scaled by strength.
   * strength 0 = a graze, 1 = a full-power paddle smash.
   */
  function impact(x, y, nx2, ny, strength, color) {
    var s = clamp(fin(strength, 0.5), 0, 1.5);
    var col = (typeof color === 'string' && color.length) ? color : COL.cyan;
    var dx = fin(nx2, 0), dy = fin(ny, -1);
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-4) { dx = 0; dy = -1; len = 1; }
    var dir = Math.atan2(dy / len, dx / len);

    _o.count = (4 + 10 * s) | 0;
    _o.color = col;
    _o.speed = 170 + 300 * s;
    _o.spread = 0.5;
    _o.dir = dir;
    _o.size = 2.4 + 2.2 * s;
    _o.life = 0.14 + 0.12 * s;
    _o.gravity = 260;
    _o.drag = 3.2;
    _o.glow = true;
    _o.streak = 0.03;
    spark(x, y, _o);
    clearOpt();

    _o.r0 = 3;
    _o.r1 = 24 + 74 * s;
    _o.color = col;
    _o.life = 0.16 + 0.12 * s;
    _o.width = 2 + 4 * s;
    _o.fade = 1.3;
    ring(x, y, _o);
    clearOpt();

    shake(2.2 + 8 * s, 0.12 + 0.18 * s);
    if (s > 0.4) hitstop(0.02 + 0.06 * s);
  }

  /**
   * "That thing broke": a puff, spinning debris, a ring and a ground bloom.
   * radius is the dead entity's radius (13–46 in this game).
   */
  function death(x, y, radius, color) {
    var r = clamp(fin(radius, 17), 4, 80);
    var col = (typeof color === 'string' && color.length) ? color : COL.white;

    _o.count = (7 + r * 0.34) | 0;
    _o.color = col;
    _o.color2 = COL.frost;
    _o.power = 130 + r * 4.5;
    _o.life = 0.24 + r * 0.004;
    _o.size = 3 + r * 0.14;
    burst(x, y, _o);
    clearOpt();

    _o.count = (3 + r * 0.15) | 0;
    _o.color = col;
    _o.speed = 150 + r * 4;
    _o.life = 0.34 + r * 0.004;
    _o.size = 3.5 + r * 0.22;
    _o.gravity = 950;
    shard(x, y, _o);
    clearOpt();

    _o.r0 = r * 0.5;
    _o.r1 = r * 3.1;
    _o.color = col;
    _o.life = 0.26;
    _o.width = 3 + r * 0.06;
    _o.fade = 1.4;
    ring(x, y, _o);
    clearOpt();

    // Soft bloom under the wreckage — sits below the entities so it never
    // washes out the balls above it.
    _o.r0 = r * 0.8;
    _o.r1 = r * 2.0;
    _o.color = col;
    _o.life = 0.2;
    _o.fill = true;
    _o.alpha = 0.5;
    _o.fade = 1.6;
    ring(x, y, _o);
    clearOpt();

    shake(2.5 + r * 0.13, 0.16);
    hitstop(0.025 + r * 0.0009);
  }

  /**
   * Chain-reaction punctuation. n is the running chain count (2, 3, 4 ...).
   * The whole point is that it STACKS: each step adds ring + shake + hitstop,
   * and past x4 it buys a flash and a slowmo beat.
   */
  function chain(x, y, n) {
    n = clamp(fin(n, 2) | 0, 2, 99);
    var step = n > 9 ? 9 : n;
    var col = n < 4 ? COL.power : (n < 6 ? COL.powerHot : COL.white);

    _o.color = col;
    _o.size = 28 + step * 4;
    _o.life = 0.7 + step * 0.03;
    _o.rise = 60 + step * 8;
    _o.pop = 1;
    text(x, y, CHAIN_LABEL[step], _o);
    clearOpt();

    _o.r0 = 8;
    _o.r1 = 70 + step * 22;
    _o.color = col;
    _o.life = 0.24 + step * 0.02;
    _o.width = 3 + step * 0.9;
    _o.fade = 1.2;
    ring(x, y, _o);
    clearOpt();

    _o.count = 6 + step * 2;
    _o.color = col;
    _o.color2 = COL.powerHot;
    _o.power = 200 + step * 40;
    _o.life = 0.3;
    _o.size = 5;
    burst(x, y, _o);
    clearOpt();

    shake(4 + step * 1.4, 0.18 + step * 0.02);
    hitstop(0.03 + step * 0.011);

    if (n >= 4) {
      // Short enough to be a punctuation mark, not a state.
      slowmo(0.42 - Math.min(n, 8) * 0.02, 0.22 + Math.min(n, 8) * 0.02);
    }
    if (n >= 6) {
      _o.color = COL.powerHot;
      _o.alpha = 0.16 + step * 0.02;
      _o.life = 0.16;
      flash(_o);
      clearOpt();
    }
  }

  /**
   * The empowered ball. Call every frame with a stable key (the ball id) and
   * FX.dropTrail(key) when the empowerment expires.
   */
  function powerTrail(key, x, y, radius) {
    var r = clamp(fin(radius, 17), 4, 80);
    _o.color = COL.power;
    _o.color2 = COL.powerHot;
    _o.width = r * 1.15;
    _o.life = 0.26;
    _o.glow = true;
    trail(key, x, y, _o);
    clearOpt();

    // Occasional embers falling off the corona. Gated by chance so the rate
    // is independent of how often the caller ticks.
    if (rnd() < 0.35) {
      _o.count = 1;
      _o.color = rnd() < 0.5 ? COL.power : COL.powerHot;
      _o.speed = 90;
      _o.size = 2.4;
      _o.life = 0.26;
      _o.gravity = 220;
      _o.drag = 2.5;
      _o.streak = 0.02;
      spark(x + rnd2() * r * 0.6, y + rnd2() * r * 0.6, _o);
      clearOpt();
    }
  }

  /** A ball reached the drain. Danger colour, big shake, no ambiguity. */
  function lifeLost(x, y) {
    _o.color = COL.magenta;
    _o.alpha = 0.3;
    _o.life = 0.24;
    flash(_o);
    clearOpt();

    _o.r0 = 10;
    _o.r1 = 260;
    _o.color = COL.magenta;
    _o.life = 0.42;
    _o.width = 9;
    _o.fade = 1.1;
    ring(fin(x, VW * 0.5), fin(y, 1220), _o);
    clearOpt();

    _o.count = 18;
    _o.color = COL.magenta;
    _o.speed = 420;
    _o.spread = 1.1;
    _o.dir = -Math.PI / 2;
    _o.size = 4;
    _o.life = 0.36;
    _o.gravity = 500;
    spark(fin(x, VW * 0.5), fin(y, 1220), _o);
    clearOpt();

    shake(13, 0.45);
    hitstop(0.1);
  }

  /* A single reusable options object for the presets. Reusing it is what
   * keeps the presets allocation-free; clearOpt() wipes it so a stale field
   * can never leak into the next call. */
  var _o = {
    count: undefined, color: undefined, color2: undefined, speed: undefined,
    spread: undefined, dir: undefined, size: undefined, life: undefined,
    gravity: undefined, drag: undefined, glow: undefined, streak: undefined,
    power: undefined, r0: undefined, r1: undefined, width: undefined,
    fade: undefined, alpha: undefined, fill: undefined, rise: undefined,
    pop: undefined, outline: undefined
  };
  function clearOpt() {
    _o.count = undefined; _o.color = undefined; _o.color2 = undefined;
    _o.speed = undefined; _o.spread = undefined; _o.dir = undefined;
    _o.size = undefined; _o.life = undefined; _o.gravity = undefined;
    _o.drag = undefined; _o.glow = undefined; _o.streak = undefined;
    _o.power = undefined; _o.r0 = undefined; _o.r1 = undefined;
    _o.width = undefined; _o.fade = undefined; _o.alpha = undefined;
    _o.fill = undefined; _o.rise = undefined; _o.pop = undefined;
    _o.outline = undefined;
  }

  /* ======================================================================= *
   * TIME + CAMERA API
   * ======================================================================= */

  function hitstop(seconds) {
    var s = clamp(fin(seconds, 0), 0, HITSTOP_MAX);
    if (s > hitT) hitT = s;   // additive in the "take the max" sense (§5.1)
    scaleNow = computeScale();
  }

  function slowmo(scale, seconds) {
    var sc = clamp(fin(scale, 0.3), 0.05, 1);
    var t = clamp(fin(seconds, 0.3), 0, SLOWMO_MAX);
    if (t <= 0) return;
    // Deepest scale and longest remaining time win, so a second call during a
    // slowmo extends the moment rather than cutting it short.
    if (sc < slowScale || slowT <= 0) slowScale = sc;
    if (t > slowT) slowT = t;
    slowRamp = Math.min(0.12, slowT * 0.4);
    scaleNow = computeScale();
  }

  function shake(magnitude, seconds) {
    var m = clamp(fin(magnitude, 0), 0, 40);
    if (m <= 0) return;
    var t = clamp(fin(seconds, 0.2), 0.02, 1.5);
    // Decay constant: e^-3 ≈ 5%, so the shake is visually done after `seconds`.
    var tau = t / 3;
    // A fresh shake owns the decay curve; an overlapping one can only make it
    // longer, never shorter — cutting a big shake short with a small late one
    // is the thing that feels like the camera is fighting the player.
    if (shakeMag <= 0) shakeTau = tau;
    else if (tau > shakeTau) shakeTau = tau;
    if (shakeTau > 0.5) shakeTau = 0.5;
    // Re-phase onto a noise peak so the impact is felt on the very next frame.
    if (PEAK_N > 0) shakeClock = PEAKS[(_pk = (_pk + 1) % PEAK_N)] / SHAKE_HZ;
    // Additive amplitude with a ceiling: stacked hits build, but the table
    // never tears itself off the screen.
    shakeMag = Math.min(shakeMag + m, 26);
  }

  function timeScale() { return scaleNow; }

  function camera() { return _cam; }

  function reset() {
    dots.clear(); shards.clear(); rings.clear(); texts.clear(); flashes.clear();
    for (var i = 0; i < CAP_TRAIL; i++) killTrail(trails[i]);
    hitT = 0; slowT = 0; slowScale = 1; scaleNow = 1;
    shakeMag = 0; shakeTau = 0.12;
    _cam.x = 0; _cam.y = 0; _cam.rot = 0;
  }

  function count() {
    return dots.live + shards.live + rings.live + texts.live;
  }

  /* ======================================================================= */

  global.FX = {
    // core (CONTRACT.md §5.1)
    reset: reset,
    update: update,
    timeScale: timeScale,
    hitstop: hitstop,
    slowmo: slowmo,
    shake: shake,
    camera: camera,
    drawBelow: drawBelow,
    drawAbove: drawAbove,
    spark: spark,
    burst: burst,
    ring: ring,
    shard: shard,
    text: text,
    flash: flash,
    trail: trail,
    dropTrail: dropTrail,

    // convenience presets
    impact: impact,
    death: death,
    chain: chain,
    powerTrail: powerTrail,
    lifeLost: lifeLost,

    // introspection / shared palette
    count: count,
    COL: COL,
    CAP: CAP_DOT + CAP_SHARD + CAP_RING + CAP_TEXT
  };

})(typeof window !== 'undefined' ? window : this);
