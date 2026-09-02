/* MEGABALL — levels.js
 * Level definitions, wave scripts and the meta-progression table.
 *
 * Waves are written as readable "entries" (send N of this type down these
 * lanes, this far apart) and compiled into a flat timeline at wave start.
 * Formations matter as much as counts: dumping ten balls at once is
 * unreadable, whereas a heavy followed by two runners down the flanks is a
 * puzzle the player can actually see coming.
 *
 * Attaches window.LEVELS. Depends on: U.
 */
(function (global) {
  'use strict';

  var U = global.U;
  var LEVELS = {};

  /* Lane shorthands. 0..4 left→right across the top of the table. */
  var L = { LEFT: [0], MIDL: [1], MID: [2], MIDR: [3], RIGHT: [4] };
  var ALL = [0, 1, 2, 3, 4];
  var FLANKS = [0, 4];
  var INNER = [1, 2, 3];

  /* entry: { type, n, gap, delay, lanes, mode }
   *   gap   — seconds between each ball in this entry
   *   delay — seconds after wave start before the entry begins
   *   mode  — 'cycle' walks the lane list, 'random' picks, 'same' locks one */
  function e(type, n, gap, delay, lanes, mode) {
    return { type: type, n: n, gap: gap, delay: delay || 0, lanes: lanes || ALL, mode: mode || 'cycle' };
  }

  /* ---------------------------------------------------------------------- */
  /* Levels                                                                 */
  /* ---------------------------------------------------------------------- */

  LEVELS.list = [
    {
      id: 1,
      name: 'First Bounce',
      subtitle: 'Learn the flippers',
      levelCard: 'kickback',
      startEnergy: 135,
      lives: 5,
      seed: 1011,
      teach: [
        { at: 'start', text: 'Hold the LEFT or RIGHT side of the table to flip' },
        { at: 'wave2', text: 'Tap BUILD to spend Energy on a defense' }
      ],
      waves: [
        { build: 8, entries: [e('basic', 3, 1.5, 0.4, INNER)] },
        { build: 9, entries: [e('basic', 4, 1.25, 0.3, ALL)] },
        { build: 9, entries: [e('basic', 6, 1.0, 0.3, ALL)] }
      ]
    },

    {
      id: 2,
      name: 'Build the Board',
      subtitle: 'Bumpers and runners',
      levelCard: 'kickback',
      startEnergy: 155,
      lives: 5,
      seed: 2022,
      teach: [
        { at: 'start', text: 'Bumpers are always on — build them where balls fall' },
        { at: 'wave3', text: 'Runners are small and fast. Slow them or they slip past' }
      ],
      waves: [
        { build: 9, entries: [e('basic', 4, 1.2, 0.3, ALL)] },
        { build: 9, entries: [e('basic', 4, 1.1, 0.3, INNER), e('fast', 2, 1.4, 3.2, FLANKS)] },
        { build: 10, entries: [e('fast', 4, 0.85, 0.3, ALL), e('basic', 4, 1.0, 3.0, INNER)] },
        { build: 10, entries: [e('basic', 5, 0.9, 0.3, ALL), e('fast', 4, 0.7, 3.6, FLANKS)] }
      ]
    },

    {
      id: 3,
      name: 'Cold Front',
      subtitle: 'Heavies on the line',
      levelCard: 'flashfreeze',
      startEnergy: 170,
      lives: 5,
      seed: 3033,
      teach: [
        { at: 'start', text: 'Upgrade a paddle to FROST — the slow spreads on contact' },
        { at: 'wave3', text: 'Haulers cost 2 lives if they get out' }
      ],
      waves: [
        { build: 10, entries: [e('basic', 5, 1.0, 0.3, ALL)] },
        { build: 10, entries: [e('heavy', 1, 0, 0.4, L.MID), e('fast', 3, 0.9, 2.2, FLANKS)] },
        { build: 11, entries: [e('basic', 5, 0.9, 0.3, ALL), e('heavy', 1, 0, 3.5, L.MIDL)] },
        { build: 11, entries: [e('heavy', 2, 2.4, 0.4, FLANKS), e('fast', 5, 0.7, 2.0, INNER)] },
        { build: 12, entries: [e('basic', 6, 0.8, 0.3, ALL), e('heavy', 2, 2.0, 3.0, INNER), e('fast', 4, 0.6, 6.0, FLANKS)] }
      ]
    },

    {
      id: 4,
      name: 'Chain Reaction',
      subtitle: 'Turn them against each other',
      levelCard: 'overdrive',
      startEnergy: 185,
      lives: 5,
      seed: 4044,
      teach: [
        { at: 'start', text: 'POWER PADDLE ignites a ball — it then destroys the others' },
        { at: 'wave2', text: 'Aim an ignited ball into a cluster for a CHAIN' }
      ],
      /* Tight, clumped formations: the whole level is built to reward
       * launching one empowered ball into a knot of enemies. */
      waves: [
        { build: 11, entries: [e('basic', 6, 0.55, 0.3, INNER, 'random')] },
        { build: 11, entries: [e('basic', 8, 0.45, 0.3, ALL, 'random'), e('fast', 3, 1.0, 4.5, FLANKS)] },
        { build: 12, entries: [e('splitter', 2, 1.6, 0.4, INNER), e('basic', 6, 0.5, 2.5, ALL, 'random')] },
        { build: 12, entries: [e('armored', 2, 2.0, 0.4, FLANKS), e('basic', 8, 0.42, 1.8, INNER, 'random')] },
        { build: 13, entries: [e('splitter', 3, 1.3, 0.4, ALL), e('heavy', 1, 0, 3.0, L.MID), e('basic', 8, 0.4, 4.5, ALL, 'random')] }
      ]
    },

    {
      id: 5,
      name: 'Pinball Siege',
      subtitle: 'Everything at once',
      levelCard: 'lastline',
      startEnergy: 200,
      lives: 5,
      seed: 5055,
      teach: [
        { at: 'start', text: 'Everything you have learned. Hold the line.' },
        { at: 'wave6', text: 'COLOSSUS incoming — it costs 3 lives' }
      ],
      waves: [
        { build: 12, entries: [e('basic', 6, 0.7, 0.3, ALL), e('fast', 3, 0.8, 3.0, FLANKS)] },
        { build: 12, entries: [e('armored', 2, 1.8, 0.3, INNER), e('fast', 5, 0.6, 2.0, ALL)] },
        { build: 13, entries: [e('heavy', 2, 2.2, 0.3, FLANKS), e('splitter', 2, 1.5, 2.4, INNER), e('basic', 6, 0.6, 4.0, ALL, 'random')] },
        { build: 13, entries: [e('armored', 3, 1.4, 0.3, ALL), e('fast', 6, 0.5, 2.2, ALL, 'random'), e('heavy', 1, 0, 6.0, L.MID)] },
        { build: 14, entries: [e('splitter', 4, 1.0, 0.3, ALL), e('heavy', 2, 2.0, 2.5, FLANKS), e('basic', 8, 0.45, 4.0, ALL, 'random')] },
        {
          build: 16, boss: true,
          entries: [e('boss', 1, 0, 0.6, L.MID), e('fast', 4, 1.4, 6.0, FLANKS), e('basic', 6, 1.0, 12.0, ALL, 'random')]
        }
      ]
    }
  ];

  LEVELS.byId = function (id) {
    for (var i = 0; i < LEVELS.list.length; i++) {
      if (LEVELS.list[i].id === id) return LEVELS.list[i];
    }
    return null;
  };

  /* Compile a wave's entries into a sorted timeline of spawn events.
   * Done once at wave start so the per-frame spawner is just a cursor. */
  LEVELS.compile = function (wave, rng, lanes, difficulty) {
    var out = [];
    difficulty = difficulty || 1;
    for (var i = 0; i < wave.entries.length; i++) {
      var en = wave.entries[i];
      var laneIdx = rng.int(0, en.lanes.length - 1);
      for (var k = 0; k < en.n; k++) {
        var lane;
        if (en.mode === 'random') lane = en.lanes[rng.int(0, en.lanes.length - 1)];
        else if (en.mode === 'same') lane = en.lanes[laneIdx];
        else lane = en.lanes[(laneIdx + k) % en.lanes.length];

        out.push({
          t: en.delay + k * en.gap,
          type: en.type,
          lane: lane,
          hpMul: difficulty
        });
      }
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  };

  LEVELS.waveBallCount = function (wave) {
    var n = 0;
    for (var i = 0; i < wave.entries.length; i++) n += wave.entries[i].n;
    return n;
  };

  /* A compact preview of what is coming, for the between-wave banner. */
  LEVELS.wavePreview = function (wave) {
    var counts = {}, order = [];
    for (var i = 0; i < wave.entries.length; i++) {
      var t = wave.entries[i].type;
      if (!counts[t]) { counts[t] = 0; order.push(t); }
      counts[t] += wave.entries[i].n;
    }
    var out = [];
    for (var j = 0; j < order.length; j++) out.push({ type: order[j], n: counts[order[j]] });
    return out;
  };

  /* ---------------------------------------------------------------------- */
  /* Stars & unlocks                                                        */
  /* ---------------------------------------------------------------------- */

  /* Star criteria are deliberately about LEAKS, not score. The thing being
   * defended is the drain, so that is what mastery should measure. */
  LEVELS.stars = function (livesLeft, livesMax) {
    if (livesLeft <= 0) return 0;
    if (livesLeft >= livesMax) return 3;
    if (livesLeft >= Math.ceil(livesMax * 0.5)) return 2;
    return 1;
  };

  LEVELS.UNLOCKS = [
    { stars: 2, kind: 'card', id: 'barrier', label: 'BARRIER card' },
    { stars: 4, kind: 'slot', id: 2, label: '2nd card slot' },
    { stars: 6, kind: 'card', id: 'overcharge', label: 'OVERCHARGE card' },
    { stars: 8, kind: 'card', id: 'megaball', label: 'MEGABALL card' },
    { stars: 10, kind: 'slot', id: 3, label: '3rd card slot' },
    { stars: 12, kind: 'card', id: 'magnet', label: 'MAGNETISE card' },
    { stars: 14, kind: 'card', id: 'shockwave', label: 'SHOCKWAVE card' }
  ];

  /* What the player owns at a given star total. Slot 1 and Slow Time are
   * free from the very first run so the tray is never empty. */
  LEVELS.ownedAt = function (totalStars) {
    var cards = ['slowtime'], slots = 1;
    for (var i = 0; i < LEVELS.UNLOCKS.length; i++) {
      var u = LEVELS.UNLOCKS[i];
      if (totalStars < u.stars) continue;
      if (u.kind === 'card') cards.push(u.id);
      else slots = Math.max(slots, u.id);
    }
    return { cards: cards, slots: slots };
  };

  LEVELS.nextUnlock = function (totalStars) {
    for (var i = 0; i < LEVELS.UNLOCKS.length; i++) {
      if (totalStars < LEVELS.UNLOCKS[i].stars) return LEVELS.UNLOCKS[i];
    }
    return null;
  };

  global.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : this);
