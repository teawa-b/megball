/* =============================================================================
 * MEGABALL — src/audio.js   →   global  SFX
 *
 * 100% procedural Web Audio. No sample files, no base64 blobs, no network.
 * Everything you hear is oscillators, pre-baked noise buffers, biquad filters,
 * a wave shaper and envelopes, assembled per shot and thrown away.
 *
 * Design brief (see docs/CONTRACT.md §3): futuristic toy pinball machine —
 * neon, crisp, punchy, arcade. Nothing gritty, nothing realistic, nothing long.
 *
 * Signal graph
 *
 *     one-shots ─► [pan] ─► sfxGain  ─┐
 *                                     ├─► masterGain ─► lowpass ─► comp ─► out
 *     music voices ─► trackGain ─► musicGain ─► duckGain ─┘
 *
 *   - sfxGain / musicGain are separate buses so duck() only touches music.
 *   - the master lowpass is the slow-motion filter (SFX.lowpass).
 *   - the compressor is the safety net: a 12-ball pile-up must not clip.
 *
 * Every entry point is wrapped so that a missing/blocked/suspended AudioContext
 * degrades to a silent no-op. The game calls into this file from hot collision
 * paths — audio failing must never break gameplay.
 * ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* Tunables                                                                */
  /* ---------------------------------------------------------------------- */

  var MAX_VOICES     = 24;    // hard cap on simultaneous one-shots
  var MIN_GAP        = 0.025; // s — default retrigger guard per sound name
  var LOOKAHEAD_MS   = 25;    // music scheduler wake-up interval
  var SCHEDULE_AHEAD = 0.10;  // s — how far ahead the scheduler writes events
  var XFADE          = 0.6;   // s — music crossfade
  var SFX_LEVEL      = 0.55;  // bus trims, chosen so 10 impacts stay under 0 dBFS
  var MUSIC_LEVEL    = 0.30;

  // Sounds that fire in bursts get a tighter guard; slow "announcement" sounds
  // get a wide one so a double event can't stack into a phasey mess.
  var GAP = {
    ball_hit_ball: 0.018,
    paddle_hit:    0.020,
    bumper:        0.020,
    enemy_hurt:    0.030,
    warn:          0.180,
    life_lost:     0.250,
    wave_start:    0.300,
    boss_spawn:    0.500
  };

  // When the voice pool is full these may steal the oldest voice; everything
  // else is simply dropped. Losing a bumper click is invisible; losing the
  // "you died" sound is not.
  var PRIORITY = {
    life_lost: 1, wave_start: 1, wave_clear: 1, boss_spawn: 1, boss_die: 1,
    win: 1, lose: 1, star: 1, chain4: 1, chain5: 1, power_hit: 1,
    slowmo_in: 1, slowmo_out: 1, card_use: 1, ui_error: 1
  };

  /* ---------------------------------------------------------------------- */
  /* State                                                                   */
  /* ---------------------------------------------------------------------- */

  var ctx = null;
  var masterGain, lpFilter, comp, sfxGain, musicGain, duckGain;
  var whiteBuf = null, pinkBuf = null, driveCurve = null;
  var hasPanner = false;

  var muted = false;
  var active = [];   // live one-shot voices, oldest first
  var lastAt = {};   // name → ctx time of last trigger (rate limiting)

  /* ---------------------------------------------------------------------- */
  /* Small helpers                                                           */
  /* ---------------------------------------------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  // MIDI note → Hz. Music is written in note numbers so transposing is trivial.
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* ---------------------------------------------------------------------- */
  /* Init                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Build the graph once, then on every later call just try to resume.
   * Mobile browsers hand out a *suspended* context until a real user gesture,
   * so the game should call this from the first tap AND may safely call it
   * again on any later tap — the resume is the whole point of the repeat call.
   */
  function init() {
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;                       // no Web Audio → stay silent
        ctx = new AC();
        buildGraph();
        buildBuffers();
        hasPanner = (typeof ctx.createStereoPanner === 'function');
        if (typeof ctx.addEventListener === 'function') {
          ctx.addEventListener('statechange', function () {
            SFX.ready = !!ctx && ctx.state === 'running';
          });
        }
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && p.then) {
          p.then(function () {
            SFX.ready = ctx.state === 'running';
            // Music may have been requested before audio was unlocked.
            if (wantedTrack && !muted) startMusic(wantedTrack, true);
          }, function () { /* resume rejected — stay silent, never throw */ });
        }
      }
      SFX.ready = ctx.state === 'running';
      if (wantedTrack && !muted && !schedTimer) startMusic(wantedTrack, true);
    } catch (e) { /* audio is optional; never let it kill the game */ }
  }

  function buildGraph() {
    // Compressor last: it catches the summed peak of every simultaneous impact.
    // Fast attack tames transient stacks, 120 ms release keeps it from pumping
    // audibly under the constant bumper chatter.
    comp = ctx.createDynamicsCompressor();
    setParam(comp.threshold, -10);
    setParam(comp.knee, 14);
    setParam(comp.ratio, 6);
    setParam(comp.attack, 0.003);
    setParam(comp.release, 0.12);
    comp.connect(ctx.destination);

    // The slow-motion filter. Wide open by default so it colours nothing.
    lpFilter = ctx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    setParam(lpFilter.frequency, 20000);
    setParam(lpFilter.Q, 0.0001);
    lpFilter.connect(comp);

    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(lpFilter);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_LEVEL;
    sfxGain.connect(masterGain);

    duckGain = ctx.createGain();       // duck() lives here, music-only
    duckGain.gain.value = 1;
    duckGain.connect(masterGain);

    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_LEVEL;
    musicGain.connect(duckGain);
  }

  function setParam(p, v) { try { p.value = v; } catch (e) {} }

  /**
   * Noise buffers are generated ONCE and shared by every shot. Allocating a
   * buffer per hit would churn megabytes a minute during a heavy wave.
   * Two flavours: white for tick/zap transients, pink for explosion bodies
   * (pink's tilted spectrum reads as "big" instead of "hissy").
   */
  function buildBuffers() {
    var sr = ctx.sampleRate, n = Math.floor(sr * 2), i;

    whiteBuf = ctx.createBuffer(1, n, sr);
    var w = whiteBuf.getChannelData(0);
    for (i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;

    // Paul Kellet's economy pink filter — cheap, and we only run it once.
    pinkBuf = ctx.createBuffer(1, n, sr);
    var p = pinkBuf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0;
    for (i = 0; i < n; i++) {
      var v = w[i];
      b0 = 0.99765 * b0 + v * 0.0990460;
      b1 = 0.96300 * b1 + v * 0.2965164;
      b2 = 0.57000 * b2 + v * 1.0526913;
      p[i] = clamp((b0 + b1 + b2 + v * 0.1848) * 0.22, -1, 1);
    }

    // Soft-clip curve for wave shaping. Adds odd harmonics to sine bodies so
    // low thumps stay audible on a phone speaker with no real bass response.
    driveCurve = new Float32Array(1024);
    for (i = 0; i < 1024; i++) {
      var x = (i / 1023) * 2 - 1;
      driveCurve[i] = Math.tanh(x * 2.5) * 0.85;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Voice — one triggered sound, with self-cleanup                          */
  /* ---------------------------------------------------------------------- */

  function Voice(vol, pan) {
    this.out = ctx.createGain();
    this.out.gain.value = vol;
    this.pan = null;
    this.pending = 0;
    this.dead = false;
    this.nodes = [];   // every gain/filter/shaper this voice built
    this.t0 = ctx.currentTime;

    // StereoPannerNode is missing on some older WebKit builds — degrade to
    // centred mono rather than throwing in a collision handler.
    if (pan && hasPanner) {
      try {
        this.pan = ctx.createStereoPanner();
        this.pan.pan.value = clamp(pan, -1, 1);
        this.out.connect(this.pan);
        this.pan.connect(sfxGain);
      } catch (e) { this.pan = null; }
    }
    if (!this.pan) this.out.connect(sfxGain);

    active.push(this);
    // Belt and braces: if an `ended` event is ever lost the voice still frees.
    var self = this;
    this.timer = global.setTimeout(function () { self.kill(); }, 6000);
  }

  // Every source node registers here so the voice tears itself down when the
  // last one finishes. Without this the graph leaks nodes and the GC pressure
  // shows up as frame stutter twenty waves in.
  Voice.prototype.track = function (node) {
    var self = this;
    this.pending++;
    node.onended = function () {
      try { node.disconnect(); } catch (e) {}
      node.onended = null;
      if (--self.pending <= 0) self.kill();
    };
  };

  // Intermediate nodes (envelopes, filters, shapers) have no `ended` event of
  // their own, so the voice remembers them and tears the whole chain down at
  // once. Relying on GC alone works, but explicit teardown keeps the live node
  // count flat over a 20-minute session.
  Voice.prototype.own = function (n) { this.nodes.push(n); return n; };

  Voice.prototype.kill = function () {
    if (this.dead) return;
    this.dead = true;
    if (this.timer) { global.clearTimeout(this.timer); this.timer = null; }
    for (var i = 0; i < this.nodes.length; i++) {
      try { this.nodes[i].disconnect(); } catch (e) {}
    }
    this.nodes.length = 0;
    try { this.out.disconnect(); } catch (e) {}
    if (this.pan) { try { this.pan.disconnect(); } catch (e) {} }
    var i = active.indexOf(this);
    if (i >= 0) active.splice(i, 1);
  };

  // Stealing: duck the victim out over 6 ms (an instant cut would click) and
  // drop it from the pool immediately so it stops occupying a slot.
  Voice.prototype.steal = function () {
    try {
      var t = ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0.0001, t + 0.006);
    } catch (e) {}
    var i = active.indexOf(this);
    if (i >= 0) active.splice(i, 1);
  };

  /* ---------------------------------------------------------------------- */
  /* Synthesis primitives                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * One enveloped oscillator, optionally through a (sweepable) filter.
   * p = { type, f0, f1, sw, det, t, d, g, a, h, f:{t,f0,f1,q}, to }
   *   f0→f1 is an exponential glide over `sw` seconds (defaults to the whole
   *   note). Exponential ramps are used throughout because pitch and loudness
   *   are both perceived logarithmically — linear ramps sound wrong.
   */
  function tone(v, p) {
    var t = p.t, d = p.d;
    var o = ctx.createOscillator();
    o.type = p.type || 'sine';
    var f0 = Math.max(20, p.f0);
    var f1 = (p.f1 == null) ? f0 : Math.max(20, p.f1);
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + (p.sw == null ? d : p.sw));
    if (p.det) o.detune.setValueAtTime(p.det, t);

    var g = ctx.createGain();
    var pk = (p.g == null) ? 0.25 : p.g;
    var a  = (p.a  == null) ? 0.004 : p.a;   // ~4 ms attack: punchy, no click
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + a);
    if (p.h) g.gain.setValueAtTime(pk, t + a + p.h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);

    var head = v.own(g);
    if (p.f) head = v.own(filterInto(p.f, g, t, d));
    if (p.drive) {
      var ws = v.own(ctx.createWaveShaper());
      ws.curve = driveCurve;   // shared curve — never allocate one per shot
      o.connect(ws); ws.connect(head);
    } else o.connect(head);

    g.connect(p.to || v.out);
    o.start(t);
    o.stop(t + d + 0.02);
    v.track(o);
    return o;
  }

  /** Enveloped noise burst. Shares the pre-built buffers; never allocates. */
  function noise(v, p) {
    var t = p.t, d = p.d;
    var s = ctx.createBufferSource();
    s.buffer = p.pink ? pinkBuf : whiteBuf;
    s.loop = true;
    if (p.pr) s.playbackRate.setValueAtTime(p.pr, t);

    var g = ctx.createGain();
    var pk = (p.g == null) ? 0.25 : p.g;
    var a  = (p.a  == null) ? 0.002 : p.a;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + a);
    if (p.h) g.gain.setValueAtTime(pk, t + a + p.h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);

    v.own(g);
    var head = p.f ? v.own(filterInto(p.f, g, t, d)) : g;
    s.connect(head);
    g.connect(p.to || v.out);
    // Random offset into the 2 s buffer: the same "tick" never repeats sample
    // for sample, which is what stops rapid hits sounding like a machine gun.
    s.start(t, Math.random() * 1.5);
    s.stop(t + d + 0.02);
    v.track(s);
    return s;
  }

  function filterInto(f, dest, t, d) {
    var bq = ctx.createBiquadFilter();
    bq.type = f.t || 'lowpass';
    var a0 = Math.max(30, f.f0);
    var a1 = (f.f1 == null) ? a0 : Math.max(30, f.f1);
    bq.frequency.setValueAtTime(a0, t);
    if (a1 !== a0) bq.frequency.exponentialRampToValueAtTime(a1, t + (f.sw == null ? d : f.sw));
    if (f.q != null) bq.Q.setValueAtTime(f.q, t);
    bq.connect(dest);
    return bq;
  }

  /**
   * Ring modulation: carrier × modulator via an AudioParam multiply.
   * A gain node with gain 0 driven by an audio-rate signal is a multiplier,
   * which gives the inharmonic metallic/glassy sidebands frost wants.
   */
  function ring(v, p) {
    var t = p.t, d = p.d;
    var car = ctx.createOscillator(); car.type = p.type || 'sine';
    car.frequency.setValueAtTime(Math.max(20, p.f), t);
    if (p.f1) car.frequency.exponentialRampToValueAtTime(Math.max(20, p.f1), t + d);

    var mod = ctx.createOscillator(); mod.type = 'sine';
    mod.frequency.setValueAtTime(Math.max(20, p.mf), t);

    var mul = v.own(ctx.createGain());
    mul.gain.setValueAtTime(0, t);   // bipolar: the modulator IS the gain
    mod.connect(mul.gain);
    car.connect(mul);

    var g = v.own(ctx.createGain());
    var pk = (p.g == null) ? 0.2 : p.g;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + (p.a == null ? 0.003 : p.a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    mul.connect(g);
    g.connect(p.to || v.out);

    car.start(t); car.stop(t + d + 0.02);
    mod.start(t); mod.stop(t + d + 0.02);
    v.track(car); v.track(mod);
  }

  /* ---------------------------------------------------------------------- */
  /* The sound bank                                                          */
  /*                                                                         */
  /* Each entry: fn(v, t, r)  —  v = Voice, t = start time, r = pitch rate.   */
  /* Callers pass `rate` scaled by collision velocity, so every frequency in  */
  /* the impact family is multiplied by r and everything is tuned to stay     */
  /* musical across r = 0.7 … 1.5.                                           */
  /* ---------------------------------------------------------------------- */

  var BANK = {

    /* --- UI ------------------------------------------------------------- */

    ui_tap: function (v, t, r) {
      tone(v, { type: 'sine', f0: 980 * r, f1: 880 * r, t: t, d: 0.05, g: 0.20 });
      noise(v, { t: t, d: 0.012, g: 0.05, f: { t: 'highpass', f0: 3000 } });
    },
    ui_back: function (v, t, r) {
      tone(v, { type: 'sine', f0: 640 * r, f1: 420 * r, t: t, d: 0.09, g: 0.20 });
    },
    // Deliberately dull and low so it reads as "no" without being painful.
    ui_error: function (v, t, r) {
      tone(v, { type: 'square', f0: 168 * r, t: t, d: 0.07, g: 0.13, f: { t: 'lowpass', f0: 900 } });
      tone(v, { type: 'square', f0: 148 * r, t: t + 0.085, d: 0.10, g: 0.13, f: { t: 'lowpass', f0: 800 } });
    },

    /* --- Flippers ------------------------------------------------------- */
    /* Solenoid clack = a filtered noise transient plus a tiny wooden body.  */

    flipper_up: function (v, t, r) {
      noise(v, { t: t, d: 0.045, g: 0.30, f: { t: 'bandpass', f0: 1900 * r, f1: 1200 * r, q: 1.4 } });
      tone(v, { type: 'triangle', f0: 150 * r, f1: 70 * r, t: t, d: 0.07, g: 0.22, drive: true });
    },
    flipper_down: function (v, t, r) {
      noise(v, { t: t, d: 0.035, g: 0.14, f: { t: 'lowpass', f0: 1100 * r, f1: 500 } });
      tone(v, { type: 'triangle', f0: 108 * r, f1: 62 * r, t: t, d: 0.05, g: 0.12 });
    },

    /* --- Impacts: the heartbeat ------------------------------------------
     * These fire hundreds of times a minute. Rules:
     *   < 120 ms, bright but not sharp, and randomised every single hit
     *   (±4% pitch + a few cents of detune + a fresh noise offset) so a burst
     *   of ten bounces sounds like a pinball table, not one click on repeat.
     * -------------------------------------------------------------------- */

    paddle_hit: function (v, t, r) {
      var f = 470 * r * rnd(0.96, 1.04);
      tone(v, { type: 'triangle', f0: f, f1: f * 0.55, t: t, d: 0.075, g: 0.30, det: rnd(-12, 12) });
      tone(v, { type: 'square', f0: f * 2.02, f1: f * 1.2, t: t, d: 0.035, g: 0.08 });
      noise(v, { t: t, d: 0.022, g: 0.16, f: { t: 'highpass', f0: 2200 } });
    },

    // Pinball pop bumper: a metallic two-partial ping over a snappy transient.
    bumper: function (v, t, r) {
      var f = 660 * r * rnd(0.95, 1.05);
      tone(v, { type: 'triangle', f0: f, f1: f * 0.62, t: t, d: 0.10, g: 0.30, det: rnd(-15, 15) });
      tone(v, { type: 'square', f0: f * 1.51, f1: f * 1.0, t: t, d: 0.055, g: 0.10 });
      noise(v, { t: t, d: 0.028, g: 0.20, f: { t: 'bandpass', f0: 2600 * r, f1: 1400 * r, q: 1.1 } });
    },

    // Ball-on-ball is the quietest of the three — it happens most often, and
    // a click that draws attention would be exhausting after a minute.
    ball_hit_ball: function (v, t, r) {
      var f = 900 * r * rnd(0.93, 1.07);
      tone(v, { type: 'sine', f0: f, f1: f * 0.5, t: t, d: 0.045, g: 0.20 });
      noise(v, { t: t, d: 0.016, g: 0.13, f: { t: 'bandpass', f0: 3200 * r, q: 0.9 } });
    },

    // Glassy and cold: ring-modulated sidebands plus two high partials tuned
    // to a non-integer ratio so nothing settles into a warm harmonic series.
    frost_hit: function (v, t, r) {
      ring(v, { f: 1500 * r, f1: 1180 * r, mf: 317 * r * rnd(0.97, 1.03), t: t, d: 0.20, g: 0.16 });
      tone(v, { type: 'sine', f0: 2360 * r, f1: 2100 * r, t: t, d: 0.16, g: 0.10 });
      tone(v, { type: 'sine', f0: 3540 * r, t: t, d: 0.09, g: 0.05 });
      noise(v, { t: t, d: 0.05, g: 0.10, f: { t: 'highpass', f0: 5000 } });
    },

    // Signature mechanic. Body first (low thump you feel), then a bright
    // filter-opening sweep upward that says "this ball is now a weapon".
    power_hit: function (v, t, r) {
      tone(v, { type: 'sine', f0: 190 * r, f1: 48, t: t, d: 0.26, g: 0.42, drive: true });
      tone(v, {
        type: 'sawtooth', f0: 300 * r, f1: 2100 * r, sw: 0.20, t: t, d: 0.30, g: 0.20,
        f: { t: 'lowpass', f0: 700, f1: 6500, sw: 0.20, q: 5 }
      });
      tone(v, { type: 'square', f0: 620 * r, f1: 1240 * r, sw: 0.14, t: t, d: 0.18, g: 0.09 });
      noise(v, { t: t, d: 0.16, g: 0.18, pink: true, f: { t: 'bandpass', f0: 900, f1: 4200, q: 0.8 } });
    },

    // Launch bumper: a real whoosh — bandpassed noise sweeping up hard, with
    // a saw riding it so the pitch rise is unmistakable on a phone speaker.
    launch_hit: function (v, t, r) {
      noise(v, { t: t, d: 0.30, g: 0.28, a: 0.03, f: { t: 'bandpass', f0: 420, f1: 4600 * r, sw: 0.24, q: 1.6 } });
      tone(v, { type: 'sawtooth', f0: 210 * r, f1: 1250 * r, sw: 0.24, t: t, d: 0.28, g: 0.16, f: { t: 'lowpass', f0: 3000 } });
      tone(v, { type: 'triangle', f0: 150 * r, f1: 90, t: t, d: 0.10, g: 0.22 });
    },

    // Small explosion: pink noise through a fast-closing lowpass (the classic
    // "boom" gesture) over a short sine body for the punch.
    bumper_blast: function (v, t, r) {
      noise(v, { t: t, d: 0.34, g: 0.40, pink: true, f: { t: 'lowpass', f0: 4200 * r, f1: 220, sw: 0.26, q: 1.2 } });
      tone(v, { type: 'sine', f0: 130 * r, f1: 40, t: t, d: 0.24, g: 0.38, drive: true });
      noise(v, { t: t, d: 0.03, g: 0.24, f: { t: 'highpass', f0: 3000 } });
    },

    // Electric arc: 4–5 very short high zaps at random pitches, chaining
    // downward in level. Randomised so no two shocks are the same.
    bumper_shock: function (v, t, r) {
      var n = 4 + (Math.random() * 2 | 0);
      for (var i = 0; i < n; i++) {
        var ti = t + i * rnd(0.022, 0.042);
        var f = rnd(1600, 3600) * r;
        tone(v, { type: 'square', f0: f, f1: f * 0.6, t: ti, d: 0.03, g: 0.13 * (1 - i / (n + 1)) });
        noise(v, { t: ti, d: 0.02, g: 0.10, f: { t: 'bandpass', f0: f * 1.4, q: 3 } });
      }
      tone(v, { type: 'sawtooth', f0: 220 * r, f1: 110, t: t, d: 0.10, g: 0.10, f: { t: 'highpass', f0: 400 } });
    },

    /* --- Enemy reactions -------------------------------------------------- */

    armor_crack: function (v, t, r) {
      noise(v, { t: t, d: 0.07, g: 0.32, f: { t: 'bandpass', f0: 2800 * r, f1: 1500 * r, q: 2.2 } });
      tone(v, { type: 'square', f0: 1240 * r, f1: 900 * r, t: t, d: 0.05, g: 0.10 });
      tone(v, { type: 'square', f0: 1690 * r, f1: 1300 * r, t: t + 0.02, d: 0.05, g: 0.07 });
    },

    // Two blips fanning apart in pitch — one ball became two.
    split: function (v, t, r) {
      tone(v, { type: 'triangle', f0: 620 * r, f1: 880 * r, t: t, d: 0.10, g: 0.20 });
      tone(v, { type: 'triangle', f0: 620 * r, f1: 460 * r, t: t + 0.015, d: 0.10, g: 0.18 });
      noise(v, { t: t, d: 0.04, g: 0.12, f: { t: 'bandpass', f0: 2400, q: 1 } });
    },

    enemy_hurt: function (v, t, r) {
      tone(v, { type: 'square', f0: 540 * r * rnd(0.95, 1.05), f1: 380 * r, t: t, d: 0.06, g: 0.13, f: { t: 'lowpass', f0: 2400 } });
      noise(v, { t: t, d: 0.02, g: 0.07, f: { t: 'highpass', f0: 2000 } });
    },

    enemy_die: function (v, t, r) {
      tone(v, { type: 'triangle', f0: 620 * r * rnd(0.96, 1.04), f1: 150, t: t, d: 0.18, g: 0.26 });
      noise(v, { t: t, d: 0.14, g: 0.20, pink: true, f: { t: 'lowpass', f0: 3000, f1: 500, q: 1 } });
    },

    enemy_die_big: function (v, t, r) {
      tone(v, { type: 'sawtooth', f0: 420 * r, f1: 90, t: t, d: 0.34, g: 0.24, f: { t: 'lowpass', f0: 2600, f1: 600 } });
      tone(v, { type: 'sine', f0: 150, f1: 42, t: t, d: 0.30, g: 0.36, drive: true });
      noise(v, { t: t, d: 0.30, g: 0.26, pink: true, f: { t: 'lowpass', f0: 3600, f1: 260, sw: 0.24, q: 1.2 } });
    },

    /* --- Economy & building ---------------------------------------------- */

    // Coin-bright: a clean two-step rise, no noise at all. Reward sounds stay
    // pure so they cut through the impact chatter without being loud.
    energy_pickup: function (v, t, r) {
      tone(v, { type: 'triangle', f0: 880 * r, t: t, d: 0.06, g: 0.18 });
      tone(v, { type: 'triangle', f0: 1320 * r, t: t + 0.045, d: 0.11, g: 0.16 });
      tone(v, { type: 'sine', f0: 2640 * r, t: t + 0.045, d: 0.09, g: 0.05 });
    },

    place: function (v, t, r) {
      tone(v, { type: 'sine', f0: 210 * r, f1: 80, t: t, d: 0.12, g: 0.28, drive: true });
      tone(v, { type: 'square', f0: 660 * r, t: t + 0.03, d: 0.07, g: 0.09, f: { t: 'lowpass', f0: 2600 } });
      noise(v, { t: t, d: 0.03, g: 0.12, f: { t: 'lowpass', f0: 1800 } });
    },

    // Rising major triad = unambiguous "better than before".
    upgrade: function (v, t, r) {
      var n = [659, 880, 1174];
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'triangle', f0: n[i] * r, t: t + i * 0.055, d: 0.16, g: 0.17 });
        tone(v, { type: 'sine', f0: n[i] * 2 * r, t: t + i * 0.055, d: 0.10, g: 0.05 });
      }
    },

    // Sell is the inverse gesture, quieter: you gave something up.
    sell: function (v, t, r) {
      tone(v, { type: 'triangle', f0: 660 * r, t: t, d: 0.09, g: 0.15 });
      tone(v, { type: 'triangle', f0: 494 * r, t: t + 0.06, d: 0.13, g: 0.13 });
      noise(v, { t: t, d: 0.03, g: 0.06, f: { t: 'highpass', f0: 2500 } });
    },

    /* --- Cards & time ----------------------------------------------------- */

    // Bell: two partials at 1:1.5 with a long-ish tail. It must be noticeable
    // while the player is looking at the playfield, not the tray.
    card_ready: function (v, t, r) {
      tone(v, { type: 'sine', f0: 1046 * r, t: t, d: 0.42, g: 0.16, a: 0.006 });
      tone(v, { type: 'sine', f0: 1568 * r, t: t, d: 0.30, g: 0.09 });
      tone(v, { type: 'sine', f0: 2093 * r, t: t + 0.02, d: 0.20, g: 0.04 });
    },

    card_use: function (v, t, r) {
      noise(v, { t: t, d: 0.20, g: 0.20, a: 0.02, f: { t: 'bandpass', f0: 600, f1: 5000, sw: 0.16, q: 1.4 } });
      var n = [523, 698, 880];
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'sawtooth', f0: n[i] * r, t: t + 0.06, d: 0.22, g: 0.11, f: { t: 'lowpass', f0: 1200, f1: 4000, q: 3 } });
      }
    },

    // Time dilation: everything falls — pitch, filter, and the noise bed with
    // it. The lowpass closing is what actually sells "the world slowed down".
    slowmo_in: function (v, t, r) {
      tone(v, { type: 'sawtooth', f0: 760 * r, f1: 110, sw: 0.40, t: t, d: 0.46, g: 0.20, f: { t: 'lowpass', f0: 6000, f1: 300, sw: 0.40, q: 4 } });
      noise(v, { t: t, d: 0.44, g: 0.14, pink: true, f: { t: 'lowpass', f0: 5000, f1: 400, sw: 0.40 } });
      tone(v, { type: 'sine', f0: 300, f1: 60, t: t, d: 0.30, g: 0.16 });
    },
    slowmo_out: function (v, t, r) {
      tone(v, { type: 'sawtooth', f0: 120, f1: 880 * r, sw: 0.30, t: t, d: 0.34, g: 0.18, f: { t: 'lowpass', f0: 400, f1: 7000, sw: 0.30, q: 4 } });
      noise(v, { t: t, d: 0.30, g: 0.13, pink: true, f: { t: 'highpass', f0: 300, f1: 3000, sw: 0.28 } });
    },

    /* --- Wave / life flow -------------------------------------------------- */

    // A fifth (G→D) stabbed twice: fanfare shorthand, no melody to get old.
    wave_start: function (v, t, r) {
      tone(v, { type: 'square', f0: 392 * r, t: t, d: 0.16, g: 0.16, f: { t: 'lowpass', f0: 2600 } });
      tone(v, { type: 'sawtooth', f0: 196 * r, t: t, d: 0.18, g: 0.12, f: { t: 'lowpass', f0: 1400 } });
      tone(v, { type: 'square', f0: 587 * r, t: t + 0.14, d: 0.30, g: 0.16, f: { t: 'lowpass', f0: 3200 } });
      tone(v, { type: 'sawtooth', f0: 294 * r, t: t + 0.14, d: 0.30, g: 0.11, f: { t: 'lowpass', f0: 1800 } });
      noise(v, { t: t, d: 0.20, g: 0.12, a: 0.05, f: { t: 'bandpass', f0: 800, f1: 4000, q: 1 } });
    },

    wave_clear: function (v, t, r) {
      var n = [523, 659, 784, 1046];
      for (var i = 0; i < 4; i++) {
        tone(v, { type: 'triangle', f0: n[i] * r, t: t + i * 0.07, d: 0.24, g: 0.16 });
        tone(v, { type: 'sine', f0: n[i] * 2 * r, t: t + i * 0.07, d: 0.14, g: 0.05 });
      }
      noise(v, { t: t + 0.21, d: 0.25, g: 0.07, f: { t: 'highpass', f0: 4000 } });
    },

    // Failure: a hollow detuned fall. The two triangles are 22 cents apart so
    // they beat against each other — queasy without being harsh. Kept short:
    // the player is already being punished, don't rub it in for a second.
    life_lost: function (v, t, r) {
      tone(v, { type: 'triangle', f0: 310, f1: 98, sw: 0.42, t: t, d: 0.46, g: 0.26, f: { t: 'lowpass', f0: 1800, f1: 500 } });
      tone(v, { type: 'triangle', f0: 310, f1: 98, sw: 0.42, t: t, d: 0.46, g: 0.22, det: 22 });
      tone(v, { type: 'square', f0: 155, f1: 60, sw: 0.40, t: t, d: 0.40, g: 0.07, f: { t: 'bandpass', f0: 500, f1: 220, q: 2 } });
      noise(v, { t: t, d: 0.30, g: 0.08, pink: true, f: { t: 'lowpass', f0: 1200, f1: 300 } });
    },

    // Alarm: three clipped beeps, dissonant minor second at the top.
    warn: function (v, t, r) {
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'square', f0: (i === 2 ? 700 : 880) * r, t: t + i * 0.115, d: 0.08, g: 0.13, f: { t: 'lowpass', f0: 2800 } });
      }
    },

    /* --- Chain ladder ------------------------------------------------------
     * chain1..5 walk a C major pentatonic upward, each rung brighter and one
     * layer thicker than the last, so the ear reads a *scale*, not five
     * unrelated noises. chain5 ("MEGA HIT") lands with a sub, a splash and a
     * flourish — it is the payoff for the game's signature mechanic.
     * -------------------------------------------------------------------- */

    chain1: function (v, t, r) { chainHit(v, t, r, 0); },
    chain2: function (v, t, r) { chainHit(v, t, r, 1); },
    chain3: function (v, t, r) { chainHit(v, t, r, 2); },
    chain4: function (v, t, r) { chainHit(v, t, r, 3); },
    chain5: function (v, t, r) { chainHit(v, t, r, 4); },

    /* --- Boss -------------------------------------------------------------- */

    // Slow attack, minor triad, sub sweeping down: dread, then an alarm fall.
    boss_spawn: function (v, t, r) {
      tone(v, { type: 'sine', f0: 90, f1: 38, sw: 1.0, t: t, d: 1.20, g: 0.42, a: 0.08, drive: true });
      var n = [146.8, 174.6, 220];   // D minor
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'sawtooth', f0: n[i], t: t, d: 1.30, g: 0.10, a: 0.35, f: { t: 'lowpass', f0: 500, f1: 1600, sw: 0.8, q: 3 } });
      }
      tone(v, { type: 'square', f0: 880, f1: 300, sw: 0.7, t: t + 0.15, d: 0.80, g: 0.08, f: { t: 'bandpass', f0: 1400, f1: 500, q: 3 } });
      noise(v, { t: t, d: 1.20, g: 0.16, pink: true, a: 0.25, f: { t: 'lowpass', f0: 500, f1: 160 } });
    },

    boss_hurt: function (v, t, r) {
      tone(v, { type: 'sine', f0: 180 * r, f1: 58, t: t, d: 0.20, g: 0.36, drive: true });
      noise(v, { t: t, d: 0.13, g: 0.24, pink: true, f: { t: 'bandpass', f0: 1400, f1: 600, q: 1.2 } });
      tone(v, { type: 'square', f0: 320 * r, f1: 200, t: t, d: 0.09, g: 0.08 });
    },

    boss_die: function (v, t, r) {
      // Blast body and sub land on the same sample — trimmed so the pair
      // doesn't hand the compressor a needless 6 dB of gain reduction.
      noise(v, { t: t, d: 1.20, g: 0.36, pink: true, a: 0.01, f: { t: 'lowpass', f0: 5200, f1: 110, sw: 0.9, q: 1.2 } });
      tone(v, { type: 'sine', f0: 140, f1: 30, sw: 0.9, t: t, d: 1.00, g: 0.40, drive: true });
      var n = [440, 349, 262, 196];  // descending minor: the threat collapsing
      for (var i = 0; i < 4; i++) {
        tone(v, { type: 'sawtooth', f0: n[i], t: t + 0.16 + i * 0.14, d: 0.32, g: 0.13, f: { t: 'lowpass', f0: 2200, f1: 800 } });
      }
      tone(v, { type: 'triangle', f0: 98, t: t + 0.80, d: 0.60, g: 0.20, drive: true });
    },

    /* --- Results ----------------------------------------------------------- */

    win: function (v, t, r) {
      var n = [523, 659, 784, 1046];
      for (var i = 0; i < 4; i++) {
        tone(v, { type: 'square', f0: n[i], t: t + i * 0.085, d: 0.30, g: 0.13, f: { t: 'lowpass', f0: 3000 } });
        tone(v, { type: 'triangle', f0: n[i], t: t + i * 0.085, d: 0.30, g: 0.12, det: 6 });
      }
      // Final octave shimmer so the sting resolves instead of just stopping.
      tone(v, { type: 'triangle', f0: 1568, t: t + 0.34, d: 0.55, g: 0.12 });
      tone(v, { type: 'sine', f0: 2093, t: t + 0.34, d: 0.50, g: 0.06 });
      noise(v, { t: t + 0.30, d: 0.35, g: 0.06, f: { t: 'highpass', f0: 4500 } });
    },

    lose: function (v, t, r) {
      var n = [440, 349, 294, 220];  // A minor, walking down and out
      for (var i = 0; i < 4; i++) {
        tone(v, { type: 'triangle', f0: n[i], t: t + i * 0.13, d: 0.36, g: 0.17, f: { t: 'lowpass', f0: 2000, f1: 900 } });
        tone(v, { type: 'sawtooth', f0: n[i] / 2, t: t + i * 0.13, d: 0.36, g: 0.07, f: { t: 'lowpass', f0: 900 } });
      }
      tone(v, { type: 'sine', f0: 110, f1: 55, t: t + 0.42, d: 0.60, g: 0.20, drive: true });
    },

    star: function (v, t, r) {
      var n = [1568, 2093, 2637];
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'triangle', f0: n[i], t: t + i * 0.055, d: 0.22, g: 0.13 });
        tone(v, { type: 'sine', f0: n[i] * 1.5, t: t + i * 0.055, d: 0.14, g: 0.045 });
      }
    }
  };

  // Rungs of the chain ladder: C5 pentatonic upward.
  var CHAIN_NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5];

  function chainHit(v, t, r, i) {
    var f = CHAIN_NOTES[i] * r;
    var big = i / 4;                     // 0 → 1, how much weight to add

    // Core blip, with a small upward bend so each rung feels like it launches.
    tone(v, { type: 'square', f0: f * 0.94, f1: f, sw: 0.03, t: t, d: 0.16 + big * 0.12, g: 0.14 + big * 0.06, f: { t: 'lowpass', f0: 2600 + big * 4000 } });
    tone(v, { type: 'triangle', f0: f, t: t, d: 0.18 + big * 0.14, g: 0.13 + big * 0.05, det: 7 });
    // A fifth above, fading in as the chain climbs — the stack thickens.
    if (i >= 1) tone(v, { type: 'triangle', f0: f * 1.5, t: t, d: 0.14, g: 0.05 + big * 0.05 });
    // Sub thump from rung 3 up: the hit starts to have body.
    if (i >= 2) tone(v, { type: 'sine', f0: f * 0.25, f1: f * 0.16, t: t, d: 0.18, g: 0.16 + big * 0.14, drive: true });
    if (i >= 3) noise(v, { t: t, d: 0.10, g: 0.10, f: { t: 'bandpass', f0: f * 2.2, q: 1.2 } });

    if (i === 4) {
      // MEGA HIT: splash, and a fast triad flourish over the top.
      noise(v, { t: t, d: 0.40, g: 0.22, pink: true, f: { t: 'lowpass', f0: 6000, f1: 700, sw: 0.32, q: 1 } });
      tone(v, { type: 'sine', f0: 150, f1: 40, t: t, d: 0.32, g: 0.40, drive: true });
      var fl = [1318.5, 1661, 1975.5, 2637];
      for (var k = 0; k < 4; k++) {
        tone(v, { type: 'triangle', f0: fl[k], t: t + 0.10 + k * 0.045, d: 0.24, g: 0.10 });
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* play()                                                                  */
  /* ---------------------------------------------------------------------- */

  function play(name, o) {
    // Ordered cheapest-check-first: this runs from collision handlers.
    if (muted || !ctx) return;
    try {
      var fn = BANK[name];
      if (!fn) return;                             // unknown name → silent

      var now = ctx.currentTime;
      var gap = GAP[name] || MIN_GAP;
      var prev = lastAt[name];
      // Retrigger guard. Two identical sounds 5 ms apart don't sound twice as
      // loud, they sound like one comb-filtered mess — and they cost twice.
      if (prev !== undefined && now - prev < gap) return;

      if (active.length >= MAX_VOICES) {
        if (!PRIORITY[name]) return;               // low priority: just drop it
        active[0].steal();                         // else evict the oldest
      }
      lastAt[name] = now;

      o = o || {};
      var vol  = clamp(o.vol == null ? 1 : o.vol, 0, 4);
      var rate = clamp(o.rate == null ? 1 : o.rate, 0.25, 4);
      var pan  = clamp(o.pan == null ? 0 : o.pan, -1, 1);
      if (vol <= 0) return;

      var v = new Voice(vol, pan);
      // Start 3 ms in the future: scheduling exactly at currentTime can land
      // in the past by the time the audio thread runs, which clicks.
      fn(v, now + 0.003, rate);
      if (v.pending === 0) v.kill();               // synth produced nothing
    } catch (e) { /* never throw out of a hot path */ }
  }

  /* ---------------------------------------------------------------------- */
  /* Music — three procedural loops on a lookahead scheduler                 */
  /*                                                                        */
  /* Notes are scheduled against ctx.currentTime ~100 ms ahead by a 25 ms    */
  /* setInterval. setTimeout-per-note would drift audibly within seconds and */
  /* stalls completely when the main thread is busy spawning a wave.         */
  /* ---------------------------------------------------------------------- */

  var schedTimer = null;
  var wantedTrack = null;   // what the game asked for, even if we can't play yet
  var curTrack = null;      // { def, name, gain, step, next }

  // Music voices bypass the one-shot pool: the sequencer already bounds them.
  function mTone(dest, p) {
    var t = p.t, d = p.d;
    var o = ctx.createOscillator();
    o.type = p.type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, p.f0), t);
    if (p.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, p.f1), t + (p.sw == null ? d : p.sw));
    if (p.det) o.detune.setValueAtTime(p.det, t);

    var g = ctx.createGain();
    var a = p.a == null ? 0.008 : p.a;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p.g, t + a);
    if (p.h) g.gain.setValueAtTime(p.g, t + a + p.h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);

    var head = p.f ? filterInto(p.f, g, t, d) : g;
    o.connect(head);
    g.connect(dest);
    o.start(t); o.stop(t + d + 0.02);
    o.onended = function () {
      try { o.disconnect(); g.disconnect(); if (head !== g) head.disconnect(); } catch (e) {}
      o.onended = null;
    };
    return o;
  }

  function mNoise(dest, p) {
    var t = p.t, d = p.d;
    var s = ctx.createBufferSource();
    s.buffer = p.pink ? pinkBuf : whiteBuf;
    s.loop = true;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p.g, t + (p.a == null ? 0.002 : p.a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    var head = p.f ? filterInto(p.f, g, t, d) : g;
    s.connect(head);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + d + 0.02);
    s.onended = function () {
      try { s.disconnect(); g.disconnect(); if (head !== g) head.disconnect(); } catch (e) {}
      s.onended = null;
    };
    return s;
  }

  function kick(dest, t, gain, f0) {
    mTone(dest, { type: 'sine', f0: f0 || 130, f1: 42, sw: 0.06, t: t, d: 0.16, g: gain, a: 0.002 });
    mNoise(dest, { t: t, d: 0.014, g: gain * 0.35, f: { t: 'highpass', f0: 1800 } });
  }
  function hat(dest, t, gain, len) {
    mNoise(dest, { t: t, d: len || 0.028, g: gain, f: { t: 'highpass', f0: 7000 } });
  }

  /* --- menu: slow, sparse, atmospheric --------------------------------- */
  // 8th notes at 72 BPM, 4 bars. A pad changes every 2 bars; a sine arpeggio
  // drops single notes over it. Calm enough to sit under a menu indefinitely.
  var MENU_CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

  function menuStep(step, t, dest) {
    var bar = (step / 8) | 0;
    var ch = MENU_CHORDS[bar % 4];

    if (step % 8 === 0) {
      // Long, slow-attack pad, filtered dark. Detuned pairs give it motion
      // without needing an LFO.
      for (var i = 0; i < 3; i++) {
        mTone(dest, { type: 'sawtooth', f0: mtof(ch[i] - 12), t: t, d: 3.6, g: 0.055, a: 1.1, h: 0.6, det: -5, f: { t: 'lowpass', f0: 620, f1: 900, sw: 1.6, q: 1 } });
        mTone(dest, { type: 'triangle', f0: mtof(ch[i]), t: t, d: 3.4, g: 0.040, a: 1.3, det: 6, f: { t: 'lowpass', f0: 1100 } });
      }
    }
    // Sparse arpeggio: fixed slots, random gate, so it never feels metronomic.
    var s = step % 8;
    if ((s === 0 || s === 3 || s === 6) && Math.random() < 0.72) {
      var note = ch[(s === 6 ? 2 : (s === 3 ? 1 : 0))] + 12;
      mTone(dest, { type: 'sine', f0: mtof(note), t: t, d: 0.9, g: 0.075, a: 0.02 });
      mTone(dest, { type: 'sine', f0: mtof(note + 12), t: t, d: 0.5, g: 0.022, a: 0.02 });
    }
  }

  /* --- battle: driving, hypnotic --------------------------------------- */
  // 126 BPM, 16ths, 4 bars. A repeating pentatonic arp over a four-on-the-floor
  // pulse. Deliberately NOT melodic — the player hears this for whole minutes,
  // so it's a texture with a groove, not a tune that gets stuck in your head.
  var BATTLE_ROOTS = [45, 45, 48, 43];              // A2 A2 C3 G2
  var PENT = [0, 3, 5, 7, 10, 12];                  // minor pentatonic
  var BATTLE_ARP = [0, 2, 1, 3, 0, 4, 1, 2, 5, 2, 1, 3, 4, 3, 2, 1];

  function battleStep(step, t, dest) {
    var s = step % 16;
    var root = BATTLE_ROOTS[(step / 16) | 0];

    if (s === 0 || s === 4 || s === 8 || s === 12) kick(dest, t, 0.34);
    if (s === 2 || s === 6 || s === 10) hat(dest, t, 0.045);
    if (s === 14) hat(dest, t, 0.075, 0.07);        // longer accent hat
    if (s === 7 || s === 15) hat(dest, t, 0.022);

    // Bass: root, with two syncopated pushes per bar.
    if (s === 0 || s === 3 || s === 8 || s === 11) {
      mTone(dest, { type: 'sawtooth', f0: mtof(root), t: t, d: 0.20, g: 0.115, a: 0.006, f: { t: 'lowpass', f0: 620, f1: 300, q: 3 } });
    }
    // 16th arp, two octaves up. The filter breathes across the bar so the
    // loop has movement without any note ever changing.
    var open = 1200 + 1500 * (0.5 + 0.5 * Math.sin(step * 0.19));
    var n = root + 24 + PENT[BATTLE_ARP[s]];
    mTone(dest, {
      type: 'square', f0: mtof(n), t: t, d: 0.115, g: 0.062, a: 0.004,
      f: { t: 'lowpass', f0: open, q: 4 }
    });
    if (s % 4 === 0) mTone(dest, { type: 'triangle', f0: mtof(n + 12), t: t, d: 0.09, g: 0.022 });
  }

  /* --- boss: darker, heavier ------------------------------------------- */
  // 140 BPM, 8th-note kick, low D minor with a tritone push in bar 3.
  // Same hypnotic principle, one octave down and a lot more menace.
  var BOSS_ROOTS = [38, 38, 37, 41];                // D2 D2 C#2 F2
  var MINOR = [0, 3, 7, 10, 12, 14];
  var BOSS_ARP = [0, 0, 2, 1, 0, 3, 2, 1, 0, 4, 2, 1, 3, 2, 1, 0];

  function bossStep(step, t, dest) {
    var s = step % 16;
    var root = BOSS_ROOTS[(step / 16) | 0];

    if (s % 2 === 0) kick(dest, t, s % 4 === 0 ? 0.38 : 0.20, 118);
    if (s === 8) {                                  // backbeat crack
      mNoise(dest, { t: t, d: 0.13, g: 0.16, f: { t: 'bandpass', f0: 1900, f1: 1100, q: 1 } });
    }
    if (s === 3 || s === 11) hat(dest, t, 0.04);

    // Sub drone under everything — the pressure that makes it a boss fight.
    if (s === 0) {
      mTone(dest, { type: 'sine', f0: mtof(root - 12), t: t, d: 1.9, g: 0.13, a: 0.05, h: 1.2 });
      mTone(dest, { type: 'sawtooth', f0: mtof(root), t: t, d: 1.9, g: 0.045, a: 0.30, det: 8, f: { t: 'lowpass', f0: 420, q: 2 } });
    }
    var n = root + 12 + MINOR[BOSS_ARP[s]];
    mTone(dest, {
      type: 'sawtooth', f0: mtof(n), t: t, d: 0.13, g: 0.055, a: 0.004,
      f: { t: 'lowpass', f0: 700 + 900 * (0.5 + 0.5 * Math.sin(step * 0.13)), q: 6 }
    });
    // Occasional tritone stab: unresolved, uncomfortable, on purpose.
    if (s === 14) mTone(dest, { type: 'square', f0: mtof(root + 18), t: t, d: 0.16, g: 0.030, f: { t: 'lowpass', f0: 1600 } });
  }

  var TRACKS = {
    menu:   { bpm: 72,  div: 2, len: 32, step: menuStep },
    battle: { bpm: 126, div: 4, len: 64, step: battleStep },
    boss:   { bpm: 140, div: 4, len: 64, step: bossStep }
  };

  function tick() {
    if (!ctx || !curTrack) return;
    try {
      var spb = 60 / curTrack.def.bpm / curTrack.def.div;
      // If the tab was backgrounded, currentTime has run far past `next`.
      // Resync instead of scheduling a burst of hundreds of stale notes.
      if (curTrack.next < ctx.currentTime) curTrack.next = ctx.currentTime + 0.05;
      var horizon = ctx.currentTime + SCHEDULE_AHEAD;
      while (curTrack.next < horizon) {
        curTrack.def.step(curTrack.step, curTrack.next, curTrack.gain);
        curTrack.step = (curTrack.step + 1) % curTrack.def.len;
        curTrack.next += spb;
      }
    } catch (e) { stopScheduler(); }
  }

  function startScheduler() {
    if (schedTimer) return;
    schedTimer = global.setInterval(tick, LOOKAHEAD_MS);
  }
  function stopScheduler() {
    if (schedTimer) { global.clearInterval(schedTimer); schedTimer = null; }
  }

  function fadeOutTrack(track) {
    if (!track) return;
    var t = ctx.currentTime;
    try {
      track.gain.gain.cancelScheduledValues(t);
      track.gain.gain.setValueAtTime(track.gain.gain.value, t);
      track.gain.gain.linearRampToValueAtTime(0.0001, t + XFADE);
    } catch (e) {}
    // Disconnect after the fade *and* after the longest scheduled tail.
    global.setTimeout(function () {
      try { track.gain.disconnect(); } catch (e) {}
    }, (XFADE + 4) * 1000);
  }

  function startMusic(name, restart) {
    if (!ctx || !TRACKS[name]) return;
    if (!restart && curTrack && curTrack.name === name) return;
    fadeOutTrack(curTrack);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + XFADE);
    g.connect(musicGain);
    curTrack = { name: name, def: TRACKS[name], gain: g, step: 0, next: ctx.currentTime + 0.06 };
    startScheduler();
  }

  function music(name) {
    try {
      if (name !== 'menu' && name !== 'battle' && name !== 'boss') name = null;
      wantedTrack = name;
      if (!ctx) return;                         // remembered; plays after init()
      if (!name) { fadeOutTrack(curTrack); curTrack = null; stopScheduler(); return; }
      if (muted) return;                        // remembered; plays on unmute
      startMusic(name, false);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------- */
  /* Mute / filter / duck                                                    */
  /* ---------------------------------------------------------------------- */

  function setMuted(m) {
    try {
      muted = !!m;
      if (!ctx) return;
      var t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, t + 0.08);

      if (muted) {
        // Silence is not enough — stop generating nodes entirely so a muted
        // game in a pocket isn't burning CPU and battery on a sequencer.
        stopScheduler();
        fadeOutTrack(curTrack);
        curTrack = null;
      } else if (wantedTrack) {
        startMusic(wantedTrack, true);
      }
    } catch (e) {}
  }

  function isMuted() { return muted; }

  /**
   * Slow-motion filter. t is perceptual, not linear: the sweep is exponential
   * from 20 kHz down to 500 Hz, because equal steps of t should sound like
   * equal steps of "muffled".
   */
  function lowpass(t) {
    try {
      if (!ctx) return;
      t = clamp(t == null ? 0 : t, 0, 1);
      var f = 20000 * Math.pow(500 / 20000, t);
      var now = ctx.currentTime;
      lpFilter.frequency.cancelScheduledValues(now);
      lpFilter.frequency.setValueAtTime(lpFilter.frequency.value, now);
      // 80 ms glide: fast enough to feel instant, slow enough to avoid zipper.
      lpFilter.frequency.exponentialRampToValueAtTime(Math.max(60, f), now + 0.08);
      // A touch of resonance as it closes makes the sweep audible rather than
      // just quiet — the same trick a DJ filter uses.
      // Kept at 2.5 max: enough resonance to hear, not enough to hand the
      // compressor a 10 dB peak on top of a full-volume pile-up.
      lpFilter.Q.setTargetAtTime(0.0001 + t * 2.5, now, 0.05);
    } catch (e) {}
  }

  /** Pull the music down under a big moment, then bring it back. */
  function duck(amount, seconds) {
    try {
      if (!ctx) return;
      amount = clamp(amount == null ? 0.6 : amount, 0, 1);
      seconds = clamp(seconds == null ? 0.5 : seconds, 0.02, 10);
      var t = ctx.currentTime;
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(duckGain.gain.value, t);
      duckGain.gain.linearRampToValueAtTime(1 - amount, t + 0.03);   // fast down
      duckGain.gain.setValueAtTime(1 - amount, t + seconds);
      duckGain.gain.linearRampToValueAtTime(1, t + seconds + 0.35);  // slow up
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------- */
  /* Battery: don't sequence music for a tab nobody is looking at.           */
  /* ---------------------------------------------------------------------- */

  try {
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', function () {
        if (global.document.hidden) {
          stopScheduler();
        } else if (!muted && curTrack) {
          curTrack.next = ctx ? ctx.currentTime + 0.06 : 0;
          startScheduler();
        }
      });
    }
  } catch (e) {}

  /* ---------------------------------------------------------------------- */
  /* Public API (docs/CONTRACT.md §5.2)                                      */
  /* ---------------------------------------------------------------------- */

  var SFX = {
    ready: false,
    init: init,
    play: play,
    music: music,
    setMuted: setMuted,
    isMuted: isMuted,
    lowpass: lowpass,
    duck: duck
  };

  global.SFX = SFX;

})(typeof window !== 'undefined' ? window : this);
