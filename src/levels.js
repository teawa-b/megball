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
      leakBudget: 2,
      challenge: { kind: 'noLeak', text: 'Clear without a single leak', short: 'NO LEAKS' },
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
      leakBudget: 2,
      challenge: { kind: 'has', any: ['blast', 'shock', 'launch'],
        text: 'Build an upgraded Bumper', short: 'UPGRADED BUMPER' },
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
      leakBudget: 1,
      challenge: { kind: 'has', any: ['frost'],
        text: 'Build a Frost Paddle', short: 'FROST PADDLE' },
      teach: [
        { at: 'start', text: 'Upgrade a paddle to FROST — the slow spreads on contact' },
        { at: 'wave3', text: 'Haulers cost 2 lives if they get out' },
        { at: 'wave5', text: 'WARDEN incoming — a small Colossus. Focus everything on it' }
      ],
      waves: [
        { build: 10, entries: [e('basic', 5, 1.0, 0.3, ALL)] },
        { build: 10, entries: [e('heavy', 1, 0, 0.4, L.MID), e('fast', 3, 0.9, 2.2, FLANKS)] },
        { build: 11, entries: [e('basic', 5, 0.9, 0.3, ALL), e('heavy', 1, 0, 3.5, L.MIDL)] },
        { build: 11, entries: [e('heavy', 2, 2.4, 0.4, FLANKS), e('fast', 5, 0.7, 2.0, INNER)] },
        /* Mini-boss finale. The Warden is a Colossus a Level-3 board can
         * actually kill, so the real one on Level 5 is a test rather than an
         * ambush. Its escort is deliberately thin: the lesson is "focus one
         * big target", and a pile-up would drown that out. */
        {
          build: 14, mini: true,
          entries: [
            e('basic', 5, 0.85, 0.3, ALL),
            e('bossWarden', 1, 0, 3.0, L.MID),
            e('fast', 4, 0.7, 7.5, FLANKS),
            e('heavy', 1, 0, 12.0, L.MIDR)
          ]
        }
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
      leakBudget: 1,
      challenge: { kind: 'stat', stat: 'bestChain', min: 4,
        text: 'Land a 4-ball chain', short: '4-CHAIN' },
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
      leakBudget: 0,
      challenge: { kind: 'maxTowers', n: 8,
        text: 'Never have more than 8 defenses on the board', short: 'MAX 8 DEFENSES' },
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

  /* ---------------------------------------------------------------------- */
  /* Endless                                                                */
  /* ---------------------------------------------------------------------- */

  /* Endless is a level whose wave list is grown on demand rather than
   * authored: GAME asks for wave N the moment it is about to be previewed,
   * and LEVELS.endlessWave writes it from a points budget that climbs every
   * wave. It reuses the whole level pipeline (build phase, banner, compile,
   * results) so the mode costs almost nothing in new plumbing. The waves
   * array is reset by GAME at the start of every run; `seed` is null so each
   * run rolls its own. */
  LEVELS.ENDLESS = {
    id: 'endless',
    endless: true,
    name: 'Endless',
    subtitle: 'Survive as long as you can',
    levelCard: 'lastline',
    startEnergy: 190,
    lives: 5,
    seed: null,
    leakBudget: 0,
    challenge: null,
    teach: [
      { at: 'wave2', text: 'No end to this one. Every 5th wave is a boss: clear it for a life back' }
    ],
    waves: []
  };

  /* Which enemies the generator may draw from, and from which wave (0-based)
   * each joins the pool. Weight = its share of the wave's points budget. */
  var ENDLESS_POOL = [
    { type: 'basic',      from: 0,  cost: 1.0 },
    { type: 'fast',       from: 1,  cost: 1.2 },
    { type: 'heavy',      from: 2,  cost: 3.0 },
    { type: 'armored',    from: 4,  cost: 2.5 },
    { type: 'splitter',   from: 6,  cost: 2.6 },
    /* From the teens an ordinary wave can carry a Warden of its own, so the
     * gap between boss waves stops being downtime. */
    { type: 'bossWarden', from: 11, cost: 9.0 }
  ];

  /* Enemy HP multiplier for endless wave `n`. Linear early so the first few
   * waves feel like the campaign, then a quadratic that actually bites: the
   * old curve reached only 2x by wave 10, which a lightly upgraded board beat
   * without the player touching the phone. */
  LEVELS.endlessDifficulty = function (n) {
    return 1 + n * 0.10 + n * n * 0.0055;
  };

  /* How many balls may be in flight at once. Readability is still the
   * constraint, but it is a RISING one — "more and more on screen" is the
   * main thing that makes late endless feel like a siege rather than a
   * metronome. game.js reads this for its spawn throttle. */
  LEVELS.endlessConcurrency = function (n) {
    return Math.min(30, 12 + Math.floor(n * 0.9));
  };

  /* Bosses every FIFTH wave. Ten was far enough apart that a run could coast
   * through the gaps. */
  LEVELS.BOSS_EVERY = 5;
  LEVELS.isBossWave = function (n) { return (n + 1) % LEVELS.BOSS_EVERY === 0; };

  /* The boss rota. Each entry asks a different question of the board, and the
   * order is the order they are learned in: a plain wall first, then the two
   * that punish a one-note board (frost / durability), then speed, then the
   * two damage-source locks. Past the end of the list they come in PAIRS,
   * drawn from the whole roster, which is where a run really ends. */
  LEVELS.BOSS_ORDER = ['boss', 'bossRime', 'bossBreaker', 'bossVector', 'bossPrism', 'bossCrucible'];

  /* Which boss (or bosses) wave `n` fields, plus the marquee line for it. */
  LEVELS.endlessBoss = function (n, rng) {
    var tier = Math.floor((n + 1) / LEVELS.BOSS_EVERY);       // 1, 2, 3, ...
    var order = LEVELS.BOSS_ORDER;
    if (tier <= order.length) {
      return { types: [order[tier - 1]], tier: tier };
    }
    /* Beyond the rota: two at once, never the same one twice. */
    var a = rng.int(0, order.length - 1);
    var b = (a + 1 + rng.int(0, order.length - 2)) % order.length;
    return { types: [order[a], order[b]], tier: tier };
  };

  /* Write endless wave `n` (0-based) using the run's rng. */
  LEVELS.endlessWave = function (n, rng) {
    var build = Math.max(7, 12 - n * 0.22);
    if (LEVELS.isBossWave(n)) {
      /* Boss waves: the boss (or pair) plus a rising escort. Their own HP
       * scales with the shared multiplier, so the 30th-wave boss is a wall. */
      var bs = LEVELS.endlessBoss(n, rng);
      var tier = bs.tier;
      var bentries = [];
      for (var bi = 0; bi < bs.types.length; bi++) {
        bentries.push(e(bs.types[bi], 1, 0, 0.6 + bi * 2.2,
          bs.types.length > 1 ? (bi === 0 ? L.MIDL : L.MIDR) : L.MID));
      }
      bentries.push(e('fast', 3 + tier * 2, 1.0, 5.0, FLANKS));
      bentries.push(e('basic', 4 + tier * 3, 0.7, 9.0, ALL, 'random'));
      if (tier >= 3) bentries.push(e('armored', tier, 1.6, 14.0, INNER));
      return {
        build: build + 4, boss: true, endlessIndex: n,
        bosses: bs.types, entries: bentries
      };
    }

    /* Budget is the wave's total "points" of enemy. The quadratic term is
     * what puts twenty-odd balls on the table by the twenties instead of the
     * dozen the old linear budget topped out at. */
    var budget = 7 + n * 2.6 + n * n * 0.035;
    var pool = [];
    for (var i = 0; i < ENDLESS_POOL.length; i++) {
      if (n >= ENDLESS_POOL[i].from) pool.push(ENDLESS_POOL[i]);
    }

    /* One backbone entry of fodder, then one to three "specials" from the
     * heavier end of the pool. Fodder always stays: a wave of nothing but
     * Haulers is a slog, not a puzzle. */
    var entries = [];
    var fodder = rng() < 0.35 && n >= 1 ? 'fast' : 'basic';
    var fodderShare = pool.length > 1 ? rng.range(0.42, 0.6) : 1;
    var fodderCost = fodder === 'fast' ? 1.2 : 1.0;
    var fodderN = Math.max(3, Math.round(budget * fodderShare / fodderCost));
    var laneSets = [ALL, INNER, FLANKS, ALL];
    var gap = Math.max(0.26, 1.15 - n * 0.045);
    entries.push(e(fodder, fodderN, gap, 0.3, rng.pick(laneSets), rng() < 0.4 ? 'random' : 'cycle'));

    var left = budget - fodderN * fodderCost;
    var specials = pool.length > 1 ? Math.min(3, 1 + Math.floor(n / 7)) : 0;
    var delay = 1.6;
    /* Each special type appears at most ONCE per wave. Drawing the same one
     * twice used to stack — four Wardens in a single wave 21, which is not a
     * harder wave so much as an unreadable one. */
    var used = {};
    for (var k = 0; k < specials && left > 1.5; k++) {
      /* Bias toward the newest unlock so a wave that introduces Bulwarks
       * actually shows some. */
      var cand = [];
      for (var ci = 1; ci < pool.length; ci++) {
        if (!used[pool[ci].type] && pool[ci].cost <= left) cand.push(pool[ci]);
      }
      if (!cand.length) break;
      var pickIdx = rng() < 0.45 ? cand.length - 1 : rng.int(0, cand.length - 1);
      var sp = cand[pickIdx];
      used[sp.type] = true;
      var share = k === specials - 1 ? 1 : rng.range(0.4, 0.7);
      var cnt = Math.max(1, Math.floor(left * share / sp.cost));
      /* A Warden is a fight, not a formation: never more than a pair, and
       * only late, or the between-boss waves become boss waves. */
      cnt = Math.min(cnt, sp.type === 'bossWarden'
        ? Math.min(2, 1 + Math.floor(n / 22))
        : 5 + Math.floor(n / 3));
      left -= cnt * sp.cost;
      var lanes = sp.type === 'heavy' ? (rng() < 0.5 ? FLANKS : INNER) : rng.pick(laneSets);
      var sgap = sp.type === 'fast' ? 0.6 : (sp.type === 'heavy' ? 2.0 : 1.3);
      entries.push(e(sp.type, cnt, sgap, delay + rng.range(0, 1.4), lanes,
        sp.type === 'basic' ? 'random' : 'cycle'));
      delay += 2.2;
    }

    return { build: build, entries: entries, endlessIndex: n };
  };

  LEVELS.byId = function (id) {
    if (id === 'endless') return LEVELS.ENDLESS;
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

  /* Three stars are three SEPARATE objectives, not one sliding scale:
   *
   *   1. Clear it        — survive every wave
   *   2. Hold the line   — stay inside the level's leak budget
   *   3. Challenge       — a bespoke, level-specific ask
   *
   * The clear is always the first star, so failing a challenge never gates
   * the next level (LEVELS unlock on >= 1 star). That is the whole reason
   * the challenge sits in the third slot rather than the second: it can be
   * as demanding as the level deserves without ever walling anybody.
   *
   * Star criteria stay about LEAKS rather than score — the thing being
   * defended is the drain, so that is what mastery should measure.
   */

  /* A run summary, built by GAME. Every field is a high-water mark rather
   * than a live count, so selling a tower at the last second cannot buy back
   * a constraint the player already broke.
   *
   *   { won, leaks, peakTowers, peakFamily:{paddle,bumper}, built:{type:true},
   *     bestChain }
   */

  /* Has this run met the level's challenge? */
  LEVELS.challengeMet = function (level, run) {
    var c = level && level.challenge;
    if (!c || !run) return false;
    switch (c.kind) {
      case 'noLeak':
        return run.leaks === 0;
      case 'has':
        for (var i = 0; i < c.any.length; i++) {
          if (run.built && run.built[c.any[i]]) return true;
        }
        return false;
      case 'maxTowers':
        return run.peakTowers <= c.n;
      case 'maxFamily':
        return (run.peakFamily[c.family] || 0) <= c.n;
      case 'stat':
        return (run[c.stat] || 0) >= c.min;
    }
    return false;
  };

  /* Is the challenge already unwinnable? Constraint challenges blow the
   * moment the limit is crossed; build/stat challenges stay reachable right
   * up to the final ball, so they never report failed early. The HUD needs
   * this to grey a tracker out honestly instead of dangling a star the
   * player can no longer reach. */
  LEVELS.challengeFailed = function (level, run) {
    var c = level && level.challenge;
    if (!c || !run) return false;
    switch (c.kind) {
      case 'noLeak': return run.leaks > 0;
      case 'maxTowers': return run.peakTowers > c.n;
      case 'maxFamily': return (run.peakFamily[c.family] || 0) > c.n;
    }
    return false;
  };

  /* The three objectives as display rows, each with its own met/failed state.
   * Both the pre-level card and the results screen render from this, so the
   * promise and the verdict can never drift apart. */
  LEVELS.objectives = function (level, run) {
    var budget = level.leakBudget === undefined ? 0 : level.leakBudget;
    var ch = level.challenge;
    return [
      {
        text: 'Clear every wave',
        short: 'CLEAR',
        met: !!(run && run.won),
        failed: !!(run && run.lost)
      },
      {
        text: budget === 0 ? 'Do not leak a single ball'
          : 'Leak no more than ' + budget + (budget === 1 ? ' ball' : ' balls'),
        short: budget === 0 ? 'NO LEAKS' : 'LEAKS ≤ ' + budget,
        met: !!(run && run.won && run.leaks <= budget),
        failed: !!(run && run.leaks > budget)
      },
      {
        text: ch ? ch.text : 'Clear every wave',
        short: ch ? ch.short : 'CLEAR',
        met: !!(run && run.won && LEVELS.challengeMet(level, run)),
        failed: !!(run && LEVELS.challengeFailed(level, run))
      }
    ];
  };

  /* A compact live label for the in-game tracker. Constraint challenges show
   * the running count against the limit, because "MAX 8 DEFENSES" is only
   * actionable if you can also see that you are on seven. */
  LEVELS.challengeProgress = function (level, run) {
    var c = level && level.challenge;
    if (!c) return '';
    if (c.kind === 'maxTowers' && run) return 'DEFENSES ' + run.peakTowers + ' / ' + c.n;
    if (c.kind === 'maxFamily' && run) {
      return c.family.toUpperCase() + 'S ' + (run.peakFamily[c.family] || 0) + ' / ' + c.n;
    }
    if (c.kind === 'stat' && run) return c.short + '  ' + (run[c.stat] || 0) + ' / ' + c.min;
    return c.short;
  };

  LEVELS.stars = function (level, run) {
    if (!run || !run.won) return 0;
    var objs = LEVELS.objectives(level, run);
    var n = 0;
    for (var i = 0; i < objs.length; i++) if (objs[i].met) n++;
    return n;
  };

  /* Thresholds are tuned against the star curve of a competent-but-not
   * perfect player, not against the 15-star ceiling. Under the old
   * lives-only rule two stars a level came almost automatically; with three
   * independent objectives the same player banks closer to two-thirds of
   * what is on the table, so a top unlock at 14 would have been unreachable
   * for nearly everyone. Every unlock now lands inside a clear-plus-one
   * pace. */
  LEVELS.UNLOCKS = [
    { stars: 2, kind: 'card', id: 'barrier', label: 'BARRIER card' },
    { stars: 3, kind: 'slot', id: 2, label: '2nd card slot' },
    { stars: 5, kind: 'card', id: 'overcharge', label: 'OVERCHARGE card' },
    { stars: 9, kind: 'slot', id: 3, label: '3rd card slot' },
    { stars: 11, kind: 'card', id: 'magnet', label: 'MAGNETISE card' },
    { stars: 12, kind: 'card', id: 'shockwave', label: 'SHOCKWAVE card' }
  ];

  /* What the player owns at a given star total. Slot 1, Slow Time and
   * Megaball are free from the very first run: the tray is never empty, and
   * the game's signature play is in the deck from the first level rather
   * than sitting behind seven stars. */
  LEVELS.ownedAt = function (totalStars) {
    var cards = ['slowtime', 'megaball'], slots = 1;
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
