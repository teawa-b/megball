/* MEGABALL — game.js
 * The simulation: state machine, economy, waves, towers, collisions and input.
 *
 * Frame shape:
 *   1. FX.update() runs on UNSCALED time so juice never freezes itself.
 *   2. timeScale = hitstop/slowmo (FX) * card slow * build-mode slow.
 *   3. Physics runs in substeps sized to the fastest ball, because tunnelling
 *      through a wall is the one bug that makes a pinball game feel broken.
 *
 * Attaches window.GAME. Depends on: U, PHYS, BOARD, ENT, CARDS, LEVELS, FX, SFX, DRAW, UI.
 */
(function (global) {
  'use strict';

  var U = global.U, PHYS = global.PHYS, BOARD = global.BOARD,
    ENT = global.ENT, CARDS = global.CARDS, LEVELS = global.LEVELS;
  var C = U.C;

  var GAME = {};

  /* Late-bound so load order inside index.html stays flexible. */
  function FX() { return global.FX; }
  function SFXm() { return global.SFX; }

  function sfx(name, o) { var s = global.SFX; if (s && s.play) s.play(name, o); }

  /* ====================================================================== */
  /* State                                                                  */
  /* ====================================================================== */

  var S = GAME.state = {
    mode: 'boot',        // boot | menu | build | wave | paused | won | lost
    level: null,
    table: null,
    rng: null,

    balls: [],
    towers: [],

    lives: 5, livesMax: 5,
    energy: 0,
    waveIndex: -1,
    waveTimeline: null,
    waveCursor: 0,
    waveT: 0,
    buildT: 0,
    spawnedThisWave: 0,
    killsThisWave: 0,
    leaks: 0,
    totalKills: 0,
    earned: 0,

    /* timed global modifiers */
    slowT: 0, slowMul: 1,
    overchargeT: 0,
    barrierT: 0,
    magnetT: 0,
    superheatT: 0,

    /* cards */
    cards: [],           // CARDS.instance[]  (player slots + level card last)

    /* build UI */
    buildOpen: false,
    buildPick: null,     // tower type string being placed
    buildHint: false,    // pulse the tray build buttons (nothing built this phase)
    firstBuild: false,   // big mid-field callout: nothing built on the board yet
    placedThisPhase: false,
    inspect: null,       // card detail popout (freezes the sim while open)
    selectedTower: null,
    selFor: null,        // the tower the upgrade panel is open for
    selT: 0,             // real seconds since it opened (drives the pop-in)
    hoverSlot: null,

    /* flippers */
    flipL: { on: false, angle: 0, omega: 0, prev: 0 },
    flipR: { on: false, angle: 0, omega: 0, prev: 0 },

    /* objective tracking — high-water marks, see noteBoard() */
    peakTowers: 0,
    peakFamily: null,
    builtTypes: null,
    bestChain: 0,

    /* misc */
    toastText: '', toastT: 0,
    banner: null,
    notice: null,        // pop-out explainer / question (freezes the sim)
    towerHold: null,     // { tower, p } while a defense is being held open
    towerHintShown: false,
    comboT: 0,
    time: 0,
    shakeBudget: 0,
    tutorialsShown: {}
  };

  /* Persistent progress. */
  var PROG = GAME.progress = U.loadSave('megaball.save', {
    stars: {},           // { levelId: stars }
    loadout: ['slowtime'],
    muted: false,
    seen: false
  });

  function saveProgress() { U.save('megaball.save', PROG); }
  GAME.saveProgress = saveProgress;

  GAME.totalStars = function () {
    var n = 0;
    for (var k in PROG.stars) if (PROG.stars.hasOwnProperty(k)) n += PROG.stars[k];
    return n;
  };

  GAME.levelUnlocked = function (id) {
    if (id === 1) return true;
    return (PROG.stars[id - 1] || 0) > 0;
  };

  /* ====================================================================== */
  /* World interface handed to cards                                        */
  /* ====================================================================== */

  var world = {
    balls: S.balls,
    towers: S.towers,
    fx: null,
    sfx: sfx,
    setGlobalSlow: function (mul, dur) {
      S.slowMul = mul; S.slowT = Math.max(S.slowT, dur);
      var s = global.SFX; if (s && s.lowpass) s.lowpass(0.7);
    },
    setOvercharge: function (dur) { S.overchargeT = Math.max(S.overchargeT, dur); },
    setBarrier: function (dur) { S.barrierT = Math.max(S.barrierT, dur); },
    setMagnet: function (dur) { S.magnetT = Math.max(S.magnetT, dur); },
    setSuperheat: function (dur) { S.superheatT = Math.max(S.superheatT, dur); },
    toast: function (t) { GAME.toast(t); }
  };

  GAME.toast = function (text, dur) {
    S.toastText = text;
    S.toastT = dur || 2.6;
  };

  /* ====================================================================== */
  /* Level lifecycle                                                        */
  /* ====================================================================== */

  GAME.startLevel = function (id, loadout) {
    S.inspect = null;
    S.notice = null;
    var def = LEVELS.byId(id);
    if (!def) return;

    S.level = def;
    S.table = BOARD.build(def);
    /* Endless rolls a fresh seed every run and starts from an empty wave
     * list; ensureWave() writes each wave the moment it is needed. */
    if (def.endless) {
      def.waves = [];
      S.rng = U.rng((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
    } else {
      S.rng = U.rng(def.seed);
    }

    S.balls.length = 0;
    S.towers.length = 0;
    world.balls = S.balls;
    world.towers = S.towers;

    S.lives = S.livesMax = def.lives;
    S.energy = def.startEnergy;
    ENT.repairScale = 1;
    S.waveIndex = -1;
    S.leaks = 0; S.totalKills = 0; S.earned = 0;
    S.peakTowers = 0;
    S.peakFamily = { paddle: 0, bumper: 0 };
    S.builtTypes = {};
    S.bestChain = 0;
    S.slowT = 0; S.slowMul = 1;
    S.overchargeT = S.barrierT = S.magnetT = S.superheatT = 0;
    S.buildOpen = false; S.buildPick = null; S.selectedTower = null;
    S.firstBuild = false;
    S.towerHold = null;
    S.towerHintShown = false;
    S.tutorialsShown = {};
    S.time = 0;
    S.comboT = 0;
    S.banner = null;

    /* Cards: the player's chosen loadout, then the level's own card. */
    S.cards.length = 0;
    var owned = LEVELS.ownedAt(GAME.totalStars());
    var chosen = (loadout && loadout.length ? loadout : PROG.loadout).slice(0, owned.slots);
    for (var i = 0; i < chosen.length; i++) {
      var cd = CARDS.PLAYER[chosen[i]];
      if (cd) S.cards.push(CARDS.instance(cd, false));
    }
    var lc = CARDS.LEVEL[def.levelCard];
    if (lc) S.cards.push(CARDS.instance(lc, true));

    if (global.FX) global.FX.reset();
    world.fx = global.FX;

    var s = global.SFX;
    if (s) { s.init(); s.lowpass(0); s.music(def.id === 5 ? 'battle' : 'battle'); }

    S.flipL.angle = S.flipL.prev = restAngleL();
    S.flipR.angle = S.flipR.prev = restAngleR();

    /* First visit to Level 1 runs the interactive tutorial instead of the
     * build countdown; it hands control back through GAME.endTutorial. */
    var tut = global.TUT && global.TUT.shouldRun(def, PROG);
    S.pendingTutorial = !!tut;
    if (!tut) teach('start');
    beginBuildPhase(true);
    S.mode = 'build';
    if (tut) global.TUT.start(S);
    /* Endless is reachable from the lobby, from a results screen and from
     * GAME.startEndless, and every one of those lands here — so the tutorial
     * offer belongs here rather than on any single entry point. */
    else if (def.endless) offerEndlessTutorial();
  };

  /* Called by the tutorial when it finishes or is skipped. Restores the normal
   * pre-wave build phase from a clean slate. */
  GAME.endTutorial = function (completed) {
    if (S.mode !== 'tutorial') return;
    for (var i = 0; i < S.balls.length; i++) {
      if (global.FX) global.FX.dropTrail('b' + S.balls[i].id);
    }
    S.balls.length = 0;
    S.selectedTower = null;
    S.buildPick = null;
    S.hoverSlot = null;
    S.waveIndex = -1;
    /* The card fired during the lesson comes back charged, and any slow it
     * left behind is cleared, so Wave 1 starts from a clean board. */
    for (var c = 0; c < S.cards.length; c++) { S.cards[c].cd = 0; S.cards[c].uses = 0; }
    S.slowT = 0; S.slowMul = 1;
    var sfxm = global.SFX; if (sfxm && sfxm.lowpass) sfxm.lowpass(0);
    PROG.tutorialDone = true;
    PROG.tutorialV = global.TUT ? global.TUT.VERSION : 2;
    saveProgress();
    if (completed) {
      /* The bumper built during the lesson is a gift, not a purchase. */
      addEnergy(ENT.TOWERS.bumper.cost, 360, 560, 'ON THE HOUSE  +' + ENT.TOWERS.bumper.cost);
      sfx('wave_clear');
    }
    S.pendingTutorial = false;
    S.mode = 'build';
    S.toastT = 0;
    beginBuildPhase(true);
  };

  /* Drop a single ball anywhere — used by the tutorial for its demo balls. */
  GAME.spawnBallAt = function (type, x, y, o) {
    var b = ENT.makeBall(type, x, y, o || {});
    S.balls.push(b);
    var f = global.FX;
    if (f) {
      f.ring(x, y, { r0: b.r + 4, r1: b.r + 40, color: C.magenta, life: 0.4, width: 3 });
      f.spark(x, y, { count: 6, color: C.magenta, speed: 120, life: 0.3, size: 2.5 });
    }
    return b;
  };

  GAME.quitToMenu = function () {
    var fromEndless = !!(S.level && S.level.endless);
    S.mode = 'menu';
    S.notice = null;
    S.inspect = null;
    S.balls.length = 0;
    S.towers.length = 0;
    var s = global.SFX; if (s) { s.lowpass(0); s.music('menu'); }
    if (global.UI) global.UI.showScreen(fromEndless ? 'title' : 'levelSelect');
  };

  GAME.startEndless = function (loadout) {
    GAME.startLevel('endless', loadout || PROG.loadout);
  };

  function teach(tag) {
    var t = S.level && S.level.teach;
    if (!t || S.tutorialsShown[tag]) return;
    for (var i = 0; i < t.length; i++) {
      if (t[i].at === tag) { S.tutorialsShown[tag] = true; GAME.toast(t[i].text, 4.2); return; }
    }
  }

  /* ====================================================================== */
  /* Notices                                                                */
  /* ====================================================================== */

  /* A pop-out card that stops the table to say one thing, or to ask one
   * question. Deliberately the same shape as the hold-to-read card popout:
   * the table freezes, the field dims, and nothing the player was doing can
   * cost them a ball while they read. A toast is not enough for a rule the
   * player has not met before — they are watching the balls, not the strip at
   * the bottom of the screen.
   *
   *   { kicker, title, lines[], color, glyph, buttons[{ id, label, tone }] }
   *
   * One button = tap anywhere to dismiss. Two = a real choice, and only the
   * buttons take the tap. */
  GAME.showNotice = function (n) {
    if (S.notice) return;
    n.t = 0;
    S.notice = n;
    S.buildPick = null;
    S.selectedTower = null;
    sfx('ui_tap', { rate: 0.85 });
    var s = global.SFX; if (s && s.lowpass) s.lowpass(0.6);
  };

  GAME.noticeAction = function (id) {
    var n = S.notice;
    if (!n) return;
    S.notice = null;
    var s = global.SFX;
    if (s && s.lowpass && S.slowT <= 0) s.lowpass(0);
    if (id === 'tutorialYes') {
      sfx('ui_tap');
      S.pendingTutorial = true;
      S.toastT = 0;
      S.banner = null;
      if (global.TUT) global.TUT.start(S);
      return;
    }
    sfx('ui_back');
  };

  /* Shown once, ever, the first time anything on the board actually wears
   * down. Explaining it up front on a fresh board would be a rule about
   * nothing; explaining it the moment the player can see a scuffed bumper is
   * the moment it means something. */
  function noticeWear() {
    if (PROG.seenWear || S.mode === 'tutorial') return;
    PROG.seenWear = true;
    saveProgress();
    GAME.showNotice({
      kicker: 'MAINTENANCE',
      title: 'DEFENSES WEAR OUT',
      color: C.amber,
      glyph: 'wear',
      lines: [
        'Every impact scuffs the defense that took it, and a heavy ball scuffs hardest.',
        'A worn defense hits softer. An exhausted one breaks and leaves its slot empty.',
        'BUMPERS wear fastest — they are always on. PADDLES last far longer, and every upgrade raises durability.',
        'Tap any defense to REPAIR it before it goes.'
      ],
      buttons: [{ id: 'ok', label: 'GOT IT' }]
    });
  }

  /* Offered at the top of an Endless run to anyone who has not been through
   * the lesson. Asked once: a prompt that returns every single run stops
   * being an offer and becomes a door to close. */
  function offerEndlessTutorial() {
    if (!global.TUT) return false;
    if (PROG.tutorialV === global.TUT.VERSION) return false;
    if (PROG.endlessTutAsked) return false;
    PROG.endlessTutAsked = true;
    saveProgress();
    GAME.showNotice({
      kicker: 'ENDLESS',
      title: 'FIRST TIME?',
      color: C.cyan,
      glyph: 'learn',
      lines: [
        'Endless keeps sending waves until you run out of lives. A boss arrives every 5 waves.',
        'Want the two-minute lesson on flippers, building and upgrades first?'
      ],
      buttons: [
        { id: 'tutorialYes', label: 'TEACH ME', tone: 'go' },
        { id: 'ok', label: 'I KNOW HOW' }
      ]
    });
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Waves                                                                  */
  /* ---------------------------------------------------------------------- */

  /* Endless has no authored waves: write wave `i` if it does not exist yet. */
  function ensureWave(i) {
    if (S.level && S.level.endless && !S.level.waves[i]) {
      S.level.waves[i] = LEVELS.endlessWave(i, S.rng);
    }
    return S.level ? S.level.waves[i] : null;
  }

  /* Upkeep gets dearer as an Endless run climbs. Refreshed wherever the wave
   * number can change, so the price on the REPAIR button and the price
   * actually charged are always the same number. */
  function syncRepairScale() {
    ENT.repairScale = (S.level && S.level.endless)
      ? Math.min(8, 1 + Math.max(0, S.waveIndex) * 0.18)
      : 1;
  }
  GAME.syncRepairScale = syncRepairScale;

  function beginBuildPhase(first) {
    syncRepairScale();
    var next = ensureWave(S.waveIndex + 1);
    if (!next) { winLevel(); return; }
    S.mode = 'build';
    S.buildT = first ? next.build : next.build;
    /* Build-phase nudge. A new player will happily bank Energy and send the
     * next wave into an empty board, so if they can afford a defense and have
     * not placed one this phase, the tray buttons pulse and we say so once. */
    S.placedThisPhase = false;
    S.buildHint = false;
    /* An empty board on the opening phase is the one moment a player can lose
     * the whole level to not understanding the tray, so that phase gets a
     * full callout in mid-field rather than a toast at the bottom of the
     * screen and a pulse on two small buttons. It clears the instant anything
     * is built. Later phases keep the quieter nudge. */
    S.firstBuild = !S.towers.length && !S.pendingTutorial && S.mode !== 'tutorial';
    /* Never nag over the tutorial — it is already telling them what to do. */
    if (!S.firstBuild && !S.pendingTutorial && S.mode !== 'tutorial' &&
      S.energy >= ENT.TOWERS.bumper.cost && S.towers.length < 4) {
      GAME.toast('Spend your Energy — tap PADDLE or BUMPER to build', 4.2);
    }
    S.banner = {
      title: S.level.endless ? 'WAVE ' + (S.waveIndex + 2)
        : 'WAVE ' + (S.waveIndex + 2) + ' OF ' + S.level.waves.length,
      preview: LEVELS.wavePreview(next),
      boss: !!(next.boss || next.mini),
      label: next.boss ? (S.level.endless ? 'BOSS WAVE' : 'FINAL WAVE')
        : (next.mini ? 'MINI BOSS' : 'INCOMING'),
      t: 0
    };
    if (next.boss || next.mini) sfx('warn');
  }

  /* Energy paid per second of build countdown handed back by starting early.
   * Climbs with the run so the offer stays worth taking once a wave clear is
   * paying hundreds, but capped so late Endless cannot be farmed by rushing.
   * `S.waveIndex` is the last wave CLEARED during a build phase, so the wave
   * about to start is one on from it. */
  function earlyRate() {
    return Math.min(12, 3 + Math.max(0, S.waveIndex + 1) * 0.7);
  }

  /* What the player would be paid for pressing START right now. The renderer
   * puts this on the button so the offer visibly shrinks as the clock runs. */
  GAME.earlyBonus = function () {
    if (S.mode !== 'build' || !S.level) return 0;
    var n = Math.round(Math.max(0, S.buildT) * earlyRate());
    return n < 2 ? 0 : n;
  };

  function startWave() {
    /* Sending the wave early is only a real decision if going early PAYS.
     * Skipping the countdown otherwise costs prep time and buys nothing, so
     * the button was there but there was never a reason to press it — the
     * trade is now "less time to build, more to build WITH". Falls out to
     * zero on the automatic start, where nothing was handed back. */
    var early = GAME.earlyBonus();

    S.waveIndex++;
    syncRepairScale();
    var w = ensureWave(S.waveIndex);
    if (!w) { winLevel(); return; }

    /* Gentle intra-level HP creep on top of the authored escalation, so late
     * waves of the same enemy still demand a stronger board. Endless has no
     * authored escalation, so its curve lives in LEVELS. */
    var diff = S.level.endless ? LEVELS.endlessDifficulty(S.waveIndex) : 1 + S.waveIndex * 0.06;
    S.waveTimeline = LEVELS.compile(w, S.rng, S.table.lanes, diff);
    S.waveCursor = 0;
    S.waveT = 0;
    S.spawnedThisWave = 0;
    S.killsThisWave = 0;
    S.mode = 'wave';
    S.banner = null;
    S.buildOpen = false;
    S.buildPick = null;
    S.selectedTower = null;

    sfx('wave_start');
    if (early > 0) {
      addEnergy(early, 360, 300, 'EARLY START  +' + early);
      sfx('card_ready', { vol: 0.7 });
    }
    if (w.boss || w.mini) { sfx('boss_spawn'); var s = global.SFX; if (s) s.music('boss'); }
    teach('wave' + (S.waveIndex + 1));
  }
  /* The opening build phase is not optional any more.
   *
   * A first-time player who taps START on an empty board loses wave 1 to a
   * rule nobody told them, and "you MAY build" is not something a new player
   * reads as "you must". So before wave 1 the countdown holds and the wave
   * cannot be sent until one defense is down — and the prompt points at where
   * to put it. Strictly the OPENING phase only: once the run is under way,
   * selling down to nothing is the player's business, not the game's. */
  GAME.mustBuild = function () {
    return S.mode === 'build' && S.waveIndex < 0 && !S.towers.length &&
      !S.pendingTutorial;
  };

  /* Where to point a first-time player. The middle of the build field is the
   * honest answer: it is where the scatter posts funnel traffic, so a defense
   * there meets every lane. Nearest FREE slot to that point, so the marker
   * can never land on an occupied one. */
  GAME.guideSlot = function () {
    if (!GAME.mustBuild() || !S.table) return null;
    var best = null, bd = 1e9;
    for (var i = 0; i < S.table.slots.length; i++) {
      var sl = S.table.slots[i];
      if (sl.occupant) continue;
      var d = U.dist2(sl.x, sl.y, 360, 630);
      if (d < bd) { bd = d; best = sl; }
    }
    return best;
  };

  /* Every way of sending a wave by hand funnels through here, so the opening
   * gate cannot be walked around by the banner, the keyboard, or the tray. */
  function requestStartWave() {
    if (GAME.mustBuild()) {
      sfx('ui_error');
      GAME.toast('Build a defense first — tap PADDLE or BUMPER below', 2.8);
      S.buildHint = true;
      return false;
    }
    startWave();
    return true;
  }
  GAME.requestStartWave = requestStartWave;

  GAME.startWaveNow = function () { if (S.mode === 'build') requestStartWave(); };

  /* ---------------------------------------------------------------------- */
  /* Calling the next wave in during the tail of this one                    */
  /* ---------------------------------------------------------------------- */

  /* What is left of the wave being fought: balls not yet spawned, plus balls
   * still on the table. */
  GAME.waveTail = function () {
    if (S.mode !== 'wave' || !S.waveTimeline) return null;
    var total = S.waveTimeline.length;
    if (!total) return null;
    var alive = 0, boss = false;
    for (var i = 0; i < S.balls.length; i++) {
      var b = S.balls[i];
      if (b.dead) continue;
      alive++;
      if (b.def.boss) boss = true;
    }
    return { total: total, unspawned: total - S.waveCursor, alive: alive, boss: boss };
  };

  /* May the player call the next wave in right now?
   *
   * The end of a wave is its dullest stretch: two stragglers ricocheting
   * around while the player waits for a counter to reach zero. Every tower
   * defense lets you skip that, so this one does too.
   *
   *   ENDLESS ONLY — the campaign's authored pacing and its leak-budget stars
   *     both assume a wave is fought out to the end.
   *   FULLY SPAWNED — the gates have to be quiet, both because "the wave is
   *     nearly over" is not true while it is still arriving, and because the
   *     button sits in the spawn zone and must never cover an incoming ball.
   *   NO BOSS — a boss IS the wave, not its tail.
   *   A TAIL, not a wave: at most 30% of the wave still breathing. */
  GAME.EARLY_TAIL = 0.3;
  GAME.canEndWaveEarly = function () {
    if (!S.level || !S.level.endless || S.mode !== 'wave') return false;
    if (S.inspect || S.notice || S.selectedTower || S.buildPick) return false;
    var t = GAME.waveTail();
    if (!t || t.boss || t.unspawned > 0) return false;
    return t.alive > 0 && t.alive <= Math.max(1, Math.ceil(t.total * GAME.EARLY_TAIL));
  };

  GAME.endWaveEarly = function () {
    if (!GAME.canEndWaveEarly()) { sfx('ui_error'); return false; }
    sfx('ui_tap');
    var f = global.FX;
    if (f) f.text(360, 700, 'NEXT WAVE', { color: C.amber, size: 32, life: 1.1, rise: 30, pop: 1 });
    /* The stragglers are NOT swept up. They stay in play through the build
     * phase and on into the next wave, where they can still reach the drain
     * and still cost lives — which is what stops this from being a free skip
     * and makes calling it in an actual decision. */
    endWave();
    return true;
  };

  /* How many balls may be in flight at once. Readability is still the
   * constraint, but a FIXED dozen is what made late endless feel like a
   * metronome: the wave got no denser, only slightly tougher, and a decent
   * board could hold it without the player touching the phone. In endless it
   * now climbs with the wave; the campaign keeps its authored pacing. */
  function ballCap() {
    if (S.level && S.level.endless) {
      return LEVELS.endlessConcurrency(Math.max(0, S.waveIndex));
    }
    return 13;
  }
  GAME.ballCap = ballCap;

  function spawnFromTimeline(dt) {
    S.waveT += dt;
    var tl = S.waveTimeline;
    var cap = ballCap();
    while (S.waveCursor < tl.length && tl[S.waveCursor].t <= S.waveT) {
      var ev = tl[S.waveCursor++];
      /* Difficulty still comes from combinations first — the cap is what
       * stops a backlog from dumping thirty balls in one frame. A boss is
       * never held back: it is the wave. */
      if (S.balls.length >= cap && !ENT.BALL_TYPES[ev.type].boss) {
        S.waveT -= dt * 0.5; S.waveCursor--; break;
      }
      spawnBall(ev);
    }
  }

  function spawnBall(ev) {
    var lanes = S.table.lanes;
    var x = lanes[U.clamp(ev.lane, 0, lanes.length - 1)];
    var b = ENT.makeBall(ev.type, x, S.table.spawnY, {
      hpMul: ev.hpMul,
      vx: U.jit(45),
      vy: 40
    });
    S.balls.push(b);
    S.spawnedThisWave++;
    var f = global.FX;
    if (f) {
      f.ring(x, S.table.spawnY, { r0: b.r + 4, r1: b.r + 40, color: C.magenta, life: 0.4, width: 3 });
      f.spark(x, S.table.spawnY, { count: 6, color: C.magenta, speed: 120, life: 0.3, size: 2.5 });
    }
  }

  function waveComplete() {
    if (S.mode !== 'wave') return false;
    if (S.waveCursor < S.waveTimeline.length) return false;
    for (var i = 0; i < S.balls.length; i++) if (!S.balls[i].dead) return false;
    return true;
  }

  function endWave() {
    /* Endless caps the clear bonus: a linear reward against fixed tower
     * prices would make wave 30 a free-build festival. */
    var reward = 45 + S.waveIndex * 18;
    if (S.level.endless) reward = Math.min(reward, 240);
    addEnergy(reward, 360, 620, 'WAVE CLEAR  +' + reward);
    sfx('wave_clear');
    var f = global.FX;
    if (f) {
      f.flash({ color: C.green, alpha: 0.16, life: 0.35 });
      f.text(360, 560, 'WAVE CLEAR', { color: C.green, size: 44, life: 1.4, rise: 40, pop: 1 });
    }
    if (S.level.endless) {
      var cleared = S.waveIndex + 1;
      if (cleared > (PROG.endlessBest || 0)) { PROG.endlessBest = cleared; saveProgress(); }
      /* Boss down: one life back and the battle theme returns. */
      if (S.level.waves[S.waveIndex].boss) {
        var s = global.SFX; if (s) s.music('battle');
        if (S.lives < S.livesMax) {
          S.lives++;
          if (f) f.text(360, 500, 'LIFE RESTORED', { color: C.magenta, size: 30, life: 1.4, rise: 34, pop: 1 });
        }
      }
      beginBuildPhase(false);
      return;
    }
    if (S.waveIndex + 1 >= S.level.waves.length) { winLevel(); return; }
    beginBuildPhase(false);
  }

  function winLevel() {
    S.mode = 'won';
    var run = runSummary(true, false);
    var objectives = LEVELS.objectives(S.level, run);
    var stars = LEVELS.stars(S.level, run);
    var prev = PROG.stars[S.level.id] || 0;
    var improved = stars > prev;
    if (improved) PROG.stars[S.level.id] = stars;

    var before = GAME.totalStars() - (improved ? (stars - prev) : 0);
    var after = GAME.totalStars();
    var newUnlocks = [];
    for (var i = 0; i < LEVELS.UNLOCKS.length; i++) {
      var u = LEVELS.UNLOCKS[i];
      if (u.stars > before && u.stars <= after) newUnlocks.push(u);
    }
    /* Auto-slot anything newly unlocked so the reward is immediately
     * playable rather than buried in a menu. */
    var owned = LEVELS.ownedAt(after);
    for (var j = 0; j < newUnlocks.length; j++) {
      if (newUnlocks[j].kind === 'card' && PROG.loadout.indexOf(newUnlocks[j].id) < 0
        && PROG.loadout.length < owned.slots) {
        PROG.loadout.push(newUnlocks[j].id);
      }
    }
    while (PROG.loadout.length > owned.slots) PROG.loadout.pop();
    saveProgress();

    sfx('win');
    var s = global.SFX; if (s) { s.music('menu'); s.lowpass(0); }
    if (global.UI) {
      global.UI.showScreen('results', {
        win: true, level: S.level, stars: stars, prevStars: prev,
        objectives: objectives,
        lives: S.lives, livesMax: S.livesMax, kills: S.totalKills,
        earned: S.earned, leaks: S.leaks, unlocks: newUnlocks,
        totalStars: after, hasNext: !!LEVELS.byId(S.level.id + 1)
      });
    }
  }

  function loseLevel() {
    S.mode = 'lost';
    sfx('lose');
    var s = global.SFX; if (s) { s.music('menu'); s.lowpass(0); }
    if (S.level.endless) {
      /* Waves survived = fully cleared waves. Dying mid-wave 12 is "11". */
      var survived = S.waveIndex;
      var prevBest = PROG.endlessBest || 0;
      var newBest = survived > 0 && survived >= prevBest && survived > (PROG.endlessBestShown || 0);
      if (survived > prevBest) { PROG.endlessBest = survived; }
      PROG.endlessBestShown = PROG.endlessBest || 0;
      PROG.endlessRuns = (PROG.endlessRuns || 0) + 1;
      saveProgress();
      if (global.UI) {
        global.UI.showScreen('results', {
          win: false, endless: true, level: S.level, stars: 0, objectives: null,
          lives: 0, livesMax: S.livesMax, kills: S.totalKills,
          earned: S.earned, leaks: S.leaks, unlocks: [],
          totalStars: GAME.totalStars(), hasNext: false,
          wave: survived, best: PROG.endlessBest || 0, newBest: newBest
        });
      }
      return;
    }
    if (global.UI) {
      global.UI.showScreen('results', {
        win: false, level: S.level, stars: 0,
        objectives: LEVELS.objectives(S.level, runSummary(false, true)),
        lives: 0, livesMax: S.livesMax, kills: S.totalKills,
        earned: S.earned, leaks: S.leaks, unlocks: [],
        totalStars: GAME.totalStars(), hasNext: false,
        wave: S.waveIndex + 1, waves: S.level.waves.length
      });
    }
  }

  /* ====================================================================== */
  /* Economy                                                                */
  /* ====================================================================== */

  function addEnergy(n, x, y, label) {
    S.energy += n;
    S.earned += n;
    var f = global.FX;
    if (f && x !== undefined) {
      f.text(x, y, label || ('+' + n), { color: C.amber, size: label ? 30 : 22, life: 0.9, rise: 34, pop: 1 });
    }
  }
  GAME.addEnergy = addEnergy;

  function spend(n) {
    if (S.energy < n) { sfx('ui_error'); return false; }
    S.energy -= n;
    return true;
  }

  /* ====================================================================== */
  /* Objective tracking                                                     */
  /* ====================================================================== */

  /* Objectives are scored off high-water marks rather than the live board.
   * A "never more than 8 defenses" challenge read from S.towers.length could
   * be beaten by parking twelve towers through the hard wave and selling
   * four before the last ball drained, which is the opposite of the mastery
   * the challenge is asking for. Peaks cannot be un-rung. */
  function noteBoard() {
    if (S.towers.length > S.peakTowers) S.peakTowers = S.towers.length;
    var byFam = { paddle: 0, bumper: 0 };
    for (var i = 0; i < S.towers.length; i++) {
      var f = S.towers[i].family;
      byFam[f] = (byFam[f] || 0) + 1;
    }
    for (var k in byFam) {
      if (byFam[k] > (S.peakFamily[k] || 0)) S.peakFamily[k] = byFam[k];
    }
  }

  /* The shape LEVELS.objectives / LEVELS.stars read. `won` and `lost` are
   * passed in because a summary is also built mid-level for the HUD tracker,
   * where neither is decided yet. */
  function runSummary(won, lost) {
    return {
      won: !!won, lost: !!lost,
      leaks: S.leaks,
      peakTowers: S.peakTowers,
      peakFamily: S.peakFamily || { paddle: 0, bumper: 0 },
      built: S.builtTypes || {},
      bestChain: S.bestChain
    };
  }
  GAME.runSummary = runSummary;

  /* Live objective rows for the build-phase tracker. */
  GAME.liveObjectives = function () {
    if (!S.level) return null;
    return LEVELS.objectives(S.level, runSummary(false, false));
  };

  /* ====================================================================== */
  /* Building                                                               */
  /* ====================================================================== */

  GAME.canAfford = function (type) { return S.energy >= ENT.TOWERS[type].cost; };

  GAME.pickBuild = function (type) {
    if (S.buildPick === type) { S.buildPick = null; sfx('ui_back'); return; }
    S.buildPick = type;
    S.selectedTower = null;
    sfx('ui_tap');
  };

  GAME.cancelBuild = function () {
    S.buildPick = null;
    S.selectedTower = null;
    S.buildOpen = false;
  };

  GAME.placeAt = function (slot) {
    var type = S.buildPick;
    if (!type || !slot || slot.occupant) { sfx('ui_error'); return false; }
    if (!spend(ENT.TOWERS[type].cost)) return false;

    var t = ENT.makeTower(type, slot);
    slot.occupant = t;
    S.towers.push(t);
    S.builtTypes[type] = true;
    noteBoard();
    S.buildPick = null;
    S.placedThisPhase = true;
    S.buildHint = false;
    S.firstBuild = false;

    sfx('place');
    var f = global.FX;
    if (f) {
      f.ring(slot.x, slot.y, { r0: 6, r1: 74, color: ENT.TOWERS[type].color, life: 0.45, width: 5 });
      f.spark(slot.x, slot.y, { count: 14, color: ENT.TOWERS[type].color, speed: 220, life: 0.4 });
      f.shake(3, 0.12);
    }
    if (S.mode === 'tutorial' && global.TUT) global.TUT.event('place', t);
    return true;
  };

  GAME.upgradeTower = function (t, toType) {
    var d = ENT.TOWERS[toType];
    if (!t || !t.slot || !d) return false;
    if (!spend(d.cost)) return false;

    S.placedThisPhase = true;
    S.buildHint = false;
    var slot = t.slot;
    var nt = ENT.makeTower(toType, slot);
    slot.occupant = nt;
    for (var i = 0; i < S.towers.length; i++) {
      if (S.towers[i] === t) { S.towers[i] = nt; break; }
    }
    /* The pick is a decision, and the decision is made: close it. Keeping the
     * new tower selected re-opened the modal on a bare SELL / CLOSE row, so
     * every upgrade needed a second tap to dismiss a screen offering nothing. */
    S.selectedTower = null;
    S.builtTypes[toType] = true;
    noteBoard();

    sfx('upgrade');
    var f = global.FX;
    if (f) {
      f.ring(slot.x, slot.y, { r0: 8, r1: 96, color: d.color, life: 0.55, width: 7 });
      f.burst(slot.x, slot.y, { count: 20, color: d.color, color2: C.white, power: 240, life: 0.5 });
      f.shake(5, 0.18);
      f.text(slot.x, slot.y - 46, d.name.toUpperCase(), { color: d.color, size: 20, life: 1.1, rise: 26 });
    }
    return true;
  };

  GAME.sellTower = function (t) {
    if (!t || !t.slot) return;
    var refund = ENT.sellValue(t);
    S.energy += refund;
    t.slot.occupant = null;
    for (var i = 0; i < S.towers.length; i++) {
      if (S.towers[i] === t) { U.swapRemove(S.towers, i); break; }
    }
    S.selectedTower = null;
    sfx('sell');
    var f = global.FX;
    if (f) {
      f.spark(t.x, t.y, { count: 12, color: C.amber, speed: 200, life: 0.4 });
      f.text(t.x, t.y - 30, '+' + refund, { color: C.amber, size: 22, life: 0.8, rise: 30 });
    }
  };

  /* ====================================================================== */
  /* Flippers                                                               */
  /* ====================================================================== */

  var F = BOARD.FLIP;
  var REST = F.restDeg * Math.PI / 180;
  var SWING = F.swingDeg * Math.PI / 180;

  function restAngleL() { return REST; }
  function activeAngleL() { return REST - SWING; }
  function restAngleR() { return Math.PI - REST; }
  function activeAngleR() { return Math.PI - REST + SWING; }

  /* Angular speeds, rad/s. The up-swing is much faster than the return: that
   * asymmetry is what makes a flipper feel like it snaps rather than sweeps.
   * UP_SPEED over a 132-unit arm puts the tip at ~4500 units/s, well past the
   * ball speed cap — which is why the substep count below has to know about
   * it, and why tryFlipper needs a swept test. */
  var FLIP_UP_SPEED = 34, FLIP_DOWN_SPEED = 15;
  var FLIP_TIP_SPEED = FLIP_UP_SPEED * F.len;

  function updateFlipper(f, rest, active, dt) {
    var target = f.on ? active : rest;
    f.prev = f.angle;
    var speed = f.on ? FLIP_UP_SPEED : FLIP_DOWN_SPEED;
    var d = target - f.angle;
    var step = speed * dt;
    if (Math.abs(d) <= step) f.angle = target;
    else f.angle += U.sign(d) * step;
    f.omega = dt > 0 ? (f.angle - f.prev) / dt : 0;
  }

  function setFlipper(side, on) {
    var f = side === 'L' ? S.flipL : S.flipR;
    if (f.on === on) return;
    f.on = on;
    sfx(on ? 'flipper_up' : 'flipper_down', { pan: side === 'L' ? -0.5 : 0.5 });
    if (on && global.FX) {
      var px = side === 'L' ? F.lx : F.rx;
      global.FX.spark(px, F.y, { count: 4, color: C.cyan, speed: 130, life: 0.22, size: 2 });
    }
  }
  GAME.setFlipper = setFlipper;

  /* Flipper as a capsule, written into scratch to avoid per-frame garbage. */
  var flipCap = { ax: 0, ay: 0, bx: 0, by: 0, r: F.rad };
  function flipperCapsule(f, px) {
    flipCap.ax = px; flipCap.ay = F.y;
    flipCap.bx = px + Math.cos(f.angle) * F.len;
    flipCap.by = F.y + Math.sin(f.angle) * F.len;
    return flipCap;
  }
  GAME.flipperCapsule = flipperCapsule;

  /* ====================================================================== */
  /* Tower behaviour                                                        */
  /* ====================================================================== */

  function updateTowers(dt) {
    var oc = S.overchargeT > 0;
    for (var i = 0; i < S.towers.length; i++) {
      var t = S.towers[i];
      if (t.buildT > 0) t.buildT -= dt;
      if (t.hitFlash > 0) t.hitFlash -= dt;
      if (t.abilityCd > 0) t.abilityCd -= dt;
      if (t.pulse > 0) t.pulse -= dt;
      if (t.wearFlash > 0) t.wearFlash -= dt;
      if (t.frozenT > 0) t.frozenT -= dt;

      if (t.family === 'paddle') updatePaddle(t, dt, oc);
      else t.r = t.def.r;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Wear                                                                   */
  /* ---------------------------------------------------------------------- */

  /* Scuff a tower by `amount` and handle the moment it comes apart. Every
   * path that lets a ball touch a defense funnels through here, so there is
   * exactly one place that decides what a broken tower looks and sounds like.
   */
  function wearTower(t, amount) {
    if (!t || t.broken) return;
    var band = ENT.wearBand(t);
    if (ENT.wear(t, amount)) { breakTower(t); return; }
    if (ENT.wearBand(t) !== band) {
      /* First time anything on the board crosses into WORN, explain it — the
       * player is about to watch their defenses die and needs to know that is
       * the design rather than a bug. */
      noticeWear();
      var f = global.FX;
      if (f) {
        f.spark(t.x, t.y, {
          count: 6, color: C.amber, speed: 130, life: 0.4, size: 2.2
        });
      }
      sfx('armor_crack', { vol: 0.35, rate: 1.35 });
    }
  }

  function breakTower(t) {
    var f = global.FX;
    if (f) {
      f.burst(t.x, t.y, { count: 22, color: C.steel, color2: C.amber, power: 260, life: 0.6, size: 4 });
      f.shard(t.x, t.y, { count: 10, color: C.steel, speed: 280, life: 0.6, size: 7 });
      f.ring(t.x, t.y, { r0: 8, r1: 82, color: C.amber, life: 0.4, width: 5 });
      f.shake(7, 0.24);
      f.text(t.x, t.y - 34, 'BROKEN', { color: C.amber, size: 22, life: 1.2, rise: 30, pop: 1 });
    }
    sfx('sell', { vol: 0.9, rate: 0.65 });
    if (t.slot) t.slot.occupant = null;
    for (var i = 0; i < S.towers.length; i++) {
      if (S.towers[i] === t) { U.swapRemove(S.towers, i); break; }
    }
    if (S.selectedTower === t) S.selectedTower = null;
    GAME.toast(t.def.name.toUpperCase() + ' broke — rebuild or repair sooner', 3.4);
  }

  /* Pay to top a tower back up. Offered from the tower's own panel, so the
   * decision sits right next to SELL and the upgrade options. */
  GAME.repairTower = function (t) {
    if (!t || t.broken) return false;
    var cost = ENT.repairCost(t);
    if (cost <= 0) { sfx('ui_error'); return false; }
    if (!spend(cost)) return false;
    t.dur = t.durMax;
    t.wearFlash = 0.5;
    sfx('upgrade', { vol: 0.7, rate: 1.15 });
    var f = global.FX;
    if (f) {
      f.ring(t.x, t.y, { r0: 8, r1: 70, color: C.green, life: 0.45, width: 5 });
      f.spark(t.x, t.y, { count: 16, color: C.green, speed: 200, life: 0.45, size: 2.6, glow: 1 });
      f.text(t.x, t.y - 38, 'REPAIRED', { color: C.green, size: 20, life: 1.0, rise: 26 });
    }
    return true;
  };

  function updatePaddle(t, dt, overcharged) {
    var d = t.def;
    /* A frozen paddle is inert: no scan, no swing, no cooldown progress.
     * That is the Rimewall's whole threat — it turns a corner of the board
     * off for a few seconds rather than shooting at it. */
    if (t.frozenT > 0) { t.omega = 0; return; }
    if (t.cd > 0) t.cd -= dt * (overcharged ? 2.4 : 1);

    var prev = t.angle;

    if (t.swingT > 0) {
      t.swingT -= dt;
      var total = 0.34;
      var e = 1 - (t.swingT / total);
      /* Fast snap out (12% of the cycle), slow reset — same asymmetry as the
       * player flippers so auto paddles read as the same machinery. */
      var k = e < 0.28 ? U.ease.outQuart(e / 0.28) : 1 - U.ease.inOutQuad((e - 0.28) / 0.72);
      t.angle = t.restAngle + (t.activeAngle - t.restAngle) * k;
      if (t.swingT <= 0) { t.angle = t.restAngle; t.swingT = 0; }
    } else if (t.cd <= 0) {
      /* Trigger on where the ball WILL be when the arm reaches full extension
       * (~0.07s), not where it is now. Without the lead a paddle constantly
       * swings behind a fast ball and connects almost never. */
      var range = d.range * (overcharged ? 1.2 : 1);
      var r2 = range * range;
      for (var i = 0; i < S.balls.length; i++) {
        var b = S.balls[i];
        if (b.dead || b.empowerT > 0) continue;   // never swat our own weapon
        var lx = b.x + b.vx * 0.07, ly = b.y + b.vy * 0.07;
        if (U.dist2(b.x, b.y, t.x, t.y) < r2 || U.dist2(lx, ly, t.x, t.y) < r2) {
          t.swingT = 0.34;
          t.cd = d.cd * (overcharged ? 0.42 : 1);
          sfx('paddle_hit', { vol: 0.35, rate: U.rand(0.9, 1.1), pan: (t.x / U.VW - 0.5) * 1.2 });
          break;
        }
      }
    }
    t.omega = dt > 0 ? (t.angle - prev) / dt : 0;
  }

  /* ====================================================================== */
  /* Collisions                                                             */
  /* ====================================================================== */

  var hit = PHYS.hit;

  function ballVsStatic(b, dt) {
    var cols = S.table.colliders;
    /* The Colossus is wider than some gaps between the scatter posts, so it
     * simply shoulders through the small furniture instead of wedging in it.
     * Reads as mass; prevents an unwinnable final wave. A ball that the wedge
     * watchdog below has just freed borrows the same privilege briefly. */
    var noSmall = b.def.boss || b.ghostT > 0;

    /* Pinch detection. Summing the contact normals is the cheapest honest
     * test for "squeezed": two surfaces pushing the ball opposite ways cancel
     * out, where two surfaces meeting at a corner do not. See updateBalls for
     * what happens when it persists. */
    var nHit = 0, sumX = 0, sumY = 0;

    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      if (noSmall && (col.kind === 'peg' || col.kind === 'post')) continue;
      if (!PHYS.test(b, col)) continue;
      nHit++; sumX += hit.nx; sumY += hit.ny;
      var imp = PHYS.resolve(b, col.restitution, col.friction, 0, 0, col.minOut);
      if (imp > 120) {
        var f = global.FX;
        var strong = imp > 520;
        if (col.kind === 'sling') {
          /* Guarantee an upward exit, but never AMPLIFY: clamping instead of
           * negate-and-add is the difference between a lively table and a
           * perpetual motion machine that never lets the wave finish. */
          if (b.vy > -240) b.vy = -240;
          b.vx = U.clamp(b.vx, -520, 520);
          if (f) {
            f.spark(hit.px, hit.py, {
              count: 8, color: C.cyan, dir: Math.atan2(hit.ny, hit.nx),
              spread: 0.8, speed: 260, life: 0.28, size: 2.6, glow: 1
            });
            f.ring(hit.px, hit.py, { r0: 4, r1: 34, color: C.cyan, life: 0.24, width: 3 });
          }
          sfx('bumper', { vol: 0.5, rate: U.rand(1.15, 1.35), pan: (b.x / U.VW - 0.5) * 1.2 });
        } else if (f && strong) {
          f.spark(hit.px, hit.py, {
            count: 4, color: C.steel, dir: Math.atan2(hit.ny, hit.nx),
            spread: 1.0, speed: 150, life: 0.2, size: 2
          });
          sfx('ball_hit_ball', { vol: 0.18, rate: U.rand(0.7, 0.9) });
        }
      }
    }

    /* Two or more surfaces whose normals very nearly cancel = the ball is in
     * a channel narrower than itself. Flagged here, timed in updateBalls. */
    if (nHit >= 2 && sumX * sumX + sumY * sumY < 0.7) b.pinch = true;
  }

  function ballVsFlippers(b) {
    tryFlipper(b, S.flipL, F.lx, 'L');
    tryFlipper(b, S.flipR, F.rx, 'R');
  }

  /* Signed perpendicular distance from a point to the arm's LINE, positive on
   * the playfield side of it, plus the along-arm parameter (0 at the pivot,
   * 1 at the tip) written into `armT`. The two flippers mirror each other, so
   * `sgn` flips the sense for the right one; neither arm's travel crosses
   * vertical, so the convention holds through the whole swing. */
  var armT = 0;
  function armSide(x, y, angle, pivotX, sgn) {
    var ax = Math.cos(angle), ay = Math.sin(angle);
    var dx = x - pivotX, dy = y - F.y;
    armT = (dx * ax + dy * ay) / F.len;
    return sgn * (ax * dy - ay * dx);
  }

  function tryFlipper(b, f, px, side) {
    var sgn = side === 'L' ? -1 : 1;

    /* --- swept guard --------------------------------------------------
     * The overlap test below only sees where things are RIGHT NOW. The arm
     * tip out-runs every ball, so on a late save at speed the ball and the
     * arm can swap sides within one substep — and then the closest-point
     * normal points DOWN, so an ordinary resolve de-penetrates the ball
     * straight through the deck and it drains. That is the "ball phased
     * through the flipper" bug.
     *
     * So: if the ball was above the arm line at the start of the step and is
     * below it now, treat it as a crossing and put it back on the face,
     * whichever of the two actually moved. Restricted to the arm's own span
     * (0..1) so a ball legitimately draining past the tip, which crosses the
     * same line extended, is left alone. */
    var sNow = armSide(b.x, b.y, f.angle, px, sgn);
    var tNow = armT;
    var swept = false;
    if (sNow < 0 && tNow >= 0 && tNow <= 1 &&
        armSide(b.lastX, b.lastY, f.prev, px, sgn) > 0) {
      var ax = Math.cos(f.angle), ay = Math.sin(f.angle);
      hit.nx = -sgn * ay; hit.ny = sgn * ax;
      hit.pen = (b.r + F.rad) - sNow;
      hit.px = b.x - hit.nx * sNow;
      hit.py = b.y - hit.ny * sNow;
      swept = true;
    } else {
      var cap = flipperCapsule(f, px);
      if (!PHYS.ballVsCapsule(b.x, b.y, b.r, cap.ax, cap.ay, cap.bx, cap.by, cap.r)) return;
    }

    var pv = PHYS.pointVelocity(hit.px, hit.py, px, F.y, f.omega);
    /* A swinging flipper gets a guaranteed minimum launch so a well-timed
     * save always feels decisive, not mushy. A ball recovered by the swept
     * guard always gets some kick: it has just been lifted back onto the
     * face, and leaving it to settle there would read as the same phase-
     * through, only slower. */
    var minOut = (f.on && Math.abs(f.omega) > 6) ? 620 : (swept ? 240 : 0);
    var imp = PHYS.resolve(b, 0.62, 0.06, pv[0], pv[1], minOut);

    /* Tutorial: any flipper contact that sends the ball back up counts as
     * "you flipped it" — a held-up flipper is a legitimate first save too. */
    if (S.mode === 'tutorial' && global.TUT && (minOut || imp > 90) && b.vy < -150) {
      global.TUT.event('flipHit', b);
    }

    if (imp > 90 || minOut) {
      var fx = global.FX;
      if (fx) {
        var ang = Math.atan2(hit.ny, hit.nx);
        fx.spark(hit.px, hit.py, {
          count: minOut ? 12 : 5, color: C.cyan, dir: ang, spread: 0.7,
          speed: minOut ? 340 : 180, life: 0.26, size: 2.6, glow: 1
        });
        if (minOut) {
          fx.ring(hit.px, hit.py, { r0: 6, r1: 40, color: C.cyan, life: 0.25, width: 3 });
          fx.shake(3.5, 0.1);
        }
      }
      sfx('paddle_hit', {
        vol: U.clamp(0.35 + imp / 1400, 0.35, 0.95),
        rate: U.clamp(0.85 + imp / 1600, 0.8, 1.4),
        pan: side === 'L' ? -0.4 : 0.4
      });
    }
  }

  function ballVsTowers(b, dt) {
    for (var i = 0; i < S.towers.length; i++) {
      var t = S.towers[i];
      if (t.buildT > 0.15) continue;   // still popping in
      if (t.family === 'paddle') towerPaddleHit(t, b);
      else towerBumperHit(t, b, dt);
      /* A hit can break the tower, and breaking removes it with a swap —
       * which drops the last tower into this index. Step back so it still
       * gets its turn instead of being skipped for the substep. */
      if (S.towers[i] !== t) i--;
    }
  }

  function towerPaddleHit(t, b) {
    var tip = ENT.paddleTip(t);
    if (!PHYS.ballVsCapsule(b.x, b.y, b.r, t.x, t.y, tip[0], tip[1], t.armRad)) return;

    var d = t.def;
    /* A swing is live for its whole cycle, not only while the arm is moving
     * fast. The paddle leads the ball by ~0.07s, so the ball usually arrives
     * at full extension or on the slow reset, where the arm's angular speed
     * is near zero; gating damage on that speed meant the ball got kicked,
     * sparked and made the sound, and took no damage. The outward stroke and
     * the extension carry the full launch, the reset a softer one. */
    var swinging = t.swingT > 0;
    var early = t.swingT > 0.34 * 0.5;
    /* The arm's own velocity only helps on the outward stroke; on the reset
     * it would drag the ball inward, so the reset relies on the minimum kick. */
    var pv = PHYS.pointVelocity(hit.px, hit.py, t.x, t.y, early ? t.omega : 0);
    var force = swinging ? d.force * (early ? 1 : 0.55) * (S.overchargeT > 0 ? 1.5 : 1) : 0;
    var imp = PHYS.resolve(b, 0.6, 0.05, pv[0], pv[1], force);

    if (!swinging && imp < 80) return;
    /* One damage instance per ball per swing: the reset is slow enough that a
     * ball can sit against the arm for several frames. */
    if (swinging) {
      if (S.time - (t.hitCds[b.id] || 0) < 0.3) return;
      t.hitCds[b.id] = S.time;
    }

    t.hitFlash = 0.18;
    var fx = global.FX;
    var ang = Math.atan2(hit.ny, hit.nx);

    if (swinging) {
      /* The swing that lands is also the swing that wears the arm, by the
       * struck ball's mass. A Colossus takes a real bite out of a paddle. */
      wearTower(t, b.mass * (b.def.contactWear || 1));
      if (t.broken) return;
      var dmg = d.dmg * (S.overchargeT > 0 ? 1.8 : 1) * ENT.outputMul(t);
      dealDamage(b, dmg, 'paddle', hit.px, hit.py);

      if (t.type === 'frost') {
        ENT.applySlow(b, d.slowDur, d.slowMul, 1);
        sfx('frost_hit', { vol: 0.7, rate: U.rand(0.95, 1.15) });
        if (fx) {
          fx.spark(hit.px, hit.py, { count: 12, color: C.frost, dir: ang, spread: 1.4, speed: 220, life: 0.4, size: 2.4, glow: 1 });
          fx.ring(b.x, b.y, { r0: b.r, r1: b.r + 30, color: C.frost, life: 0.35, width: 3 });
        }
      } else if (t.type === 'power' && !b.dead) {
        ENT.empower(b, d.empowerDur);
        sfx('power_hit', { vol: 1.0 });
        if (fx) {
          fx.flash({ color: C.power, alpha: 0.18, life: 0.25 });
          fx.ring(b.x, b.y, { r0: b.r, r1: b.r + 90, color: C.powerHot, life: 0.45, width: 7 });
          fx.burst(b.x, b.y, { count: 18, color: C.power, color2: C.powerHot, power: 280, life: 0.45 });
          fx.shake(7, 0.2);
          fx.hitstop(0.05);
          fx.text(b.x, b.y - b.r - 26, 'IGNITED', { color: C.power, size: 22, life: 0.9, rise: 26 });
        }
      } else {
        sfx('paddle_hit', { vol: 0.8, rate: U.rand(0.95, 1.15), pan: (t.x / U.VW - 0.5) * 1.2 });
      }

      if (fx && t.type !== 'frost') {
        fx.spark(hit.px, hit.py, { count: 10, color: d.color, dir: ang, spread: 0.7, speed: 300, life: 0.3, size: 2.8, glow: 1 });
        fx.ring(hit.px, hit.py, { r0: 5, r1: 42, color: d.color, life: 0.26, width: 3 });
        fx.shake(4, 0.12);
      }
    } else if (fx) {
      fx.spark(hit.px, hit.py, { count: 3, color: d.color, dir: ang, spread: 1, speed: 130, life: 0.2, size: 2 });
    }
  }

  function towerBumperHit(t, b, dt) {
    if (!PHYS.ballVsCircle(b.x, b.y, b.r, t.x, t.y, t.r)) return;

    /* Per-ball cooldown so a ball resting on a bumper does not machine-gun. */
    var last = t.hitCds[b.id] || 0;
    var d = t.def;
    PHYS.resolve(b, d.restitution, 0.02, 0, 0, d.kick);

    if (t.type === 'launch' && t.frozenT <= 0) {
      /* Launch bumper's whole point is time, not damage: send it home. */
      b.vy = -d.launchUp;
      b.vx = U.clamp(b.vx * 0.4 + U.jit(140), -320, 320);
    }

    if (S.time - last < d.hitCd) return;
    t.hitCds[b.id] = S.time;

    /* A bumper is always on, so it takes a scuff on every registered contact
     * — which is exactly why it wears so much faster than a paddle even
     * though the per-hit cost is the same. A Breaker tears in three times as
     * deep. Wear is charged in the tutorial too, but nothing there lives long
     * enough to matter, and exempting it would need a second code path. */
    wearTower(t, b.mass * (b.def.contactWear || 1));
    if (t.broken) return;

    /* A frozen bumper still bounces — it is a lump of metal — but its lamps
     * are out and it deals nothing. */
    if (t.frozenT > 0) return;

    t.pulse = 0.28;
    t.hitFlash = 0.2;
    var fx = global.FX;
    var ang = Math.atan2(hit.ny, hit.nx);
    var superheated = S.superheatT > 0;

    dealDamage(b, d.dmg * ENT.outputMul(t), 'bumper', hit.px, hit.py);
    if (S.mode === 'tutorial' && global.TUT) global.TUT.event('bumperHit', b, t);

    if (fx) {
      fx.ring(t.x, t.y, { r0: t.r, r1: t.r + 30, color: d.color, life: 0.26, width: 4 });
      fx.spark(hit.px, hit.py, { count: 8, color: d.color, dir: ang, spread: 0.9, speed: 280, life: 0.28, size: 2.6, glow: 1 });
      fx.shake(3, 0.1);
    }
    sfx('bumper', { vol: 0.6, rate: U.rand(0.92, 1.25), pan: (t.x / U.VW - 0.5) * 1.2 });

    if ((t.type === 'blast' && t.abilityCd <= 0) || superheated) {
      blastAt(t.x, t.y, t.type === 'blast' ? d.blastR : 96,
        t.type === 'blast' ? d.blastDmg : 1.8, t);
      if (t.type === 'blast') t.abilityCd = d.blastCd;
    }
    if (t.type === 'shock' && t.abilityCd <= 0) {
      shockChain(t, b);
      t.abilityCd = d.chainCd;
    }
    if (t.type === 'launch') {
      sfx('launch_hit', { vol: 0.8 });
      if (fx) fx.spark(t.x, t.y - t.r, { count: 10, color: C.green, dir: -Math.PI / 2, spread: 0.6, speed: 380, life: 0.35 });
    }
  }

  function blastAt(x, y, radius, dmg, src) {
    var fx = global.FX;
    if (fx) {
      fx.ring(x, y, { r0: 10, r1: radius, color: C.magenta, life: 0.34, width: 8 });
      fx.burst(x, y, { count: 18, color: C.magenta, color2: C.amber, power: 300, life: 0.42 });
      fx.shake(7, 0.2);
      fx.hitstop(0.035);
    }
    sfx('bumper_blast', { vol: 0.9, rate: U.rand(0.9, 1.1) });

    for (var i = 0; i < S.balls.length; i++) {
      var b = S.balls[i];
      if (b.dead) continue;
      var d2 = U.dist2(b.x, b.y, x, y);
      if (d2 > radius * radius) continue;
      var falloff = 1 - Math.sqrt(d2) / radius;
      dealDamage(b, dmg * (0.5 + falloff * 0.5), 'blast', b.x, b.y);
      var dd = Math.sqrt(d2) || 1;
      b.vx += ((b.x - x) / dd) * 240;
      b.vy += ((b.y - y) / dd) * 240;
    }
  }

  function shockChain(t, first) {
    var d = t.def;
    var fx = global.FX;
    var hitList = [first];
    var dmg = d.chainDmg;
    var from = first;

    dealDamage(first, dmg, 'shock', first.x, first.y);
    if (fx) fx.ring(first.x, first.y, { r0: 4, r1: 26, color: C.violet, life: 0.22, width: 3 });

    for (var jump = 1; jump < d.chainMax; jump++) {
      dmg *= d.chainFalloff;
      var best = null, bestD = d.chainR * d.chainR;
      for (var i = 0; i < S.balls.length; i++) {
        var b = S.balls[i];
        if (b.dead || hitList.indexOf(b) >= 0) continue;
        var dd = U.dist2(b.x, b.y, from.x, from.y);
        if (dd < bestD) { bestD = dd; best = b; }
      }
      if (!best) break;
      hitList.push(best);
      dealDamage(best, dmg, 'shock', best.x, best.y);
      if (fx) {
        fx.arc ? fx.arc(from.x, from.y, best.x, best.y, { color: C.violet, life: 0.18 })
          : fx.spark((from.x + best.x) / 2, (from.y + best.y) / 2,
            { count: 6, color: C.violet, speed: 200, life: 0.2, size: 2, glow: 1 });
        fx.ring(best.x, best.y, { r0: 4, r1: 24, color: C.violet, life: 0.22, width: 3 });
      }
      from = best;
    }
    sfx('bumper_shock', { vol: 0.85 });
  }

  /* ---------------------------------------------------------------------- */
  /* Ball vs ball — including the signature empowered-ball mechanic          */
  /* ---------------------------------------------------------------------- */

  function ballVsBalls() {
    var arr = S.balls;
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (a.dead) continue;
      for (var j = i + 1; j < arr.length; j++) {
        var b = arr[j];
        if (b.dead) continue;

        var imp = PHYS.resolvePair(a, b, 0.9);
        if (imp <= 0) continue;

        var aPow = a.empowerT > 0, bPow = b.empowerT > 0;

        if (aPow !== bPow) {
          var atk = aPow ? a : b;
          var vic = aPow ? b : a;
          empoweredStrike(atk, vic);
        } else {
          if (imp > 140) {
            sfx('ball_hit_ball', {
              vol: U.clamp(0.2 + imp / 1600, 0.2, 0.7),
              rate: U.rand(0.85, 1.2),
              pan: (a.x / U.VW - 0.5) * 1.1
            });
            var fx = global.FX;
            if (fx) fx.spark(hit.px, hit.py, { count: 4, color: C.white, speed: 150, life: 0.2, size: 2 });
          }
          /* Frost is contagious: a chilled ball passes a weaker chill on. */
          spreadFrost(a, b);
          spreadFrost(b, a);
        }
      }
    }
  }

  function spreadFrost(from, to) {
    if (from.slowT <= 0 || from.contagion <= 0 || to.empowerT > 0) return;
    from.contagion -= 1;
    ENT.applySlow(to, from.slowT * 0.6, Math.min(1, from.slowMul + 0.15), from.contagion - 1);
    var fx = global.FX;
    if (fx) {
      fx.spark(to.x, to.y, { count: 6, color: C.frost, speed: 130, life: 0.3, size: 2, glow: 1 });
      fx.ring(to.x, to.y, { r0: to.r, r1: to.r + 18, color: C.frost, life: 0.28, width: 2.5 });
    }
  }

  /* The payoff moment. An empowered ball smashing an enemy escalates:
   * more damage, bigger juice, louder chain text. */
  function empoweredStrike(atk, vic) {
    var dmg = 7 + atk.chain * 2.5;
    var killed = vic.hp - dmg <= 0;
    dealDamage(vic, dmg, 'chain', vic.x, vic.y);

    /* Deflect the weapon rather than letting it stall inside the crowd. */
    var dx = vic.x - atk.x, dy = vic.y - atk.y;
    var dd = U.len(dx, dy) || 1;
    atk.vx -= (dx / dd) * 180;
    atk.vy -= (dy / dd) * 180;
    if (atk.vy > -180) atk.vy = -320;

    var fx = global.FX;
    if (killed) {
      atk.chain++;
      atk.empowerT = Math.max(atk.empowerT, 1.1);  // reward keeps it alive
      S.comboT = 1.2;
      if (atk.chain > S.bestChain) S.bestChain = atk.chain;

      var n = atk.chain;
      var label = n >= 5 ? 'MEGA HIT' : 'CHAIN x' + n;
      var col = n >= 5 ? C.powerHot : (n >= 3 ? C.power : C.amber);
      var mag = U.clamp(5 + n * 2.5, 5, 18);

      if (fx) {
        fx.text(vic.x, vic.y - 34, label, {
          color: col, size: 26 + Math.min(n, 5) * 5, life: 1.0, rise: 40, pop: 1
        });
        fx.burst(vic.x, vic.y, { count: 14 + n * 4, color: C.power, color2: C.powerHot, power: 260 + n * 40, life: 0.5 });
        fx.ring(vic.x, vic.y, { r0: 8, r1: 80 + n * 18, color: C.powerHot, life: 0.4, width: 5 + n });
        fx.shake(mag, 0.18 + n * 0.02);
        fx.hitstop(U.clamp(0.03 + n * 0.012, 0.03, 0.1));
        if (n >= 3) fx.flash({ color: C.power, alpha: 0.1 + n * 0.03, life: 0.3 });
        if (n >= 4) fx.slowmo(0.3, 0.28);
      }
      sfx('chain' + U.clamp(n, 1, 5), { vol: 0.9 });
    } else {
      if (fx) {
        fx.spark(vic.x, vic.y, { count: 8, color: C.power, speed: 240, life: 0.3, size: 2.6, glow: 1 });
        fx.shake(3, 0.1);
      }
      sfx('enemy_hurt', { vol: 0.7 });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Damage, death, leaks                                                   */
  /* ---------------------------------------------------------------------- */

  function dealDamage(b, amount, src, x, y) {
    if (b.dead) return;
    var before = b.hp;
    ENT.damage(b, amount, src);

    /* A locked boss (Prism / Crucible) shrugged that off. Say so, out loud
     * and on the ball — a player who cannot tell "immune" from "missed" will
     * keep feeding it the one thing that does not work. Rate-limited so a
     * bumper nest does not paint the screen with the word. */
    if (b.deflected) {
      b.deflected = false;
      if (S.time - (b.deflectT || -9) > 0.9) {
        b.deflectT = S.time;
        var fd = global.FX;
        if (fd) {
          fd.ring(b.x, b.y, { r0: b.r, r1: b.r + 26, color: C.steel, life: 0.3, width: 4 });
          fd.text(b.x, b.y - b.r - 20, 'IMMUNE',
            { color: C.steel, size: 18, life: 0.8, rise: 22 });
        }
        sfx('ui_error', { vol: 0.35 });
      }
      return;
    }

    if (b.armorBroke) {
      b.armorBroke = false;
      sfx('armor_crack');
      var f0 = global.FX;
      if (f0) {
        f0.shard(b.x, b.y, { count: 8, color: C.steel, speed: 260, life: 0.5, size: 6 });
        f0.ring(b.x, b.y, { r0: b.r, r1: b.r + 34, color: C.white, life: 0.3, width: 3 });
      }
    }

    if (b.dead && before > 0) killBall(b, src);
  }
  GAME.dealDamage = dealDamage;

  function killBall(b, src) {
    S.totalKills++;
    S.killsThisWave++;
    if (S.mode === 'tutorial' && global.TUT) global.TUT.event('kill', b);

    var bonus = S.comboT > 0 ? 1.35 : 1;
    var gain = Math.round(b.bounty * bonus);
    addEnergy(gain, b.x, b.y - b.r - 8, '+' + gain);

    var fx = global.FX;
    var big = b.def.boss || b.r >= 24;
    if (fx) {
      fx.burst(b.x, b.y, {
        count: big ? 30 : 16, color: C.white, color2: C.magenta,
        power: big ? 380 : 240, life: big ? 0.6 : 0.42, size: big ? 5 : 3.5
      });
      fx.shard(b.x, b.y, { count: big ? 12 : 6, color: C.white, speed: big ? 340 : 240, life: 0.55, size: b.r * 0.34 });
      fx.ring(b.x, b.y, { r0: b.r * 0.6, r1: b.r + (big ? 90 : 44), color: C.white, life: 0.32, width: big ? 6 : 3 });
      fx.shake(big ? 10 : 3.5, big ? 0.28 : 0.11);
      if (big) { fx.hitstop(0.06); fx.flash({ color: C.white, alpha: 0.14, life: 0.2 }); }
      fx.dropTrail('b' + b.id);
    }
    sfx(b.def.boss ? 'boss_die' : (big ? 'enemy_die_big' : 'enemy_die'), {
      vol: big ? 1.0 : 0.7, rate: U.rand(0.92, 1.1), pan: (b.x / U.VW - 0.5) * 1.1
    });

    /* Splitters divide on death — introduced late because it raises the
     * object count, which is the one thing that hurts readability. */
    if (b.def.splitInto && S.balls.length < ballCap() + 2) {
      for (var i = 0; i < b.def.splitCount; i++) {
        var ang = -Math.PI / 2 + (i - (b.def.splitCount - 1) / 2) * 0.9;
        var s = ENT.makeBall(b.def.splitInto, b.x, b.y, {
          vx: Math.cos(ang) * 240 + b.vx * 0.3,
          vy: Math.sin(ang) * 200 + b.vy * 0.3
        });
        S.balls.push(s);
      }
      sfx('split');
    }

    if (b.def.boss) {
      if (fx) {
        fx.flash({ color: C.white, alpha: 0.5, life: 0.6 });
        fx.slowmo(0.25, 0.7);
        fx.shake(20, 0.6);
      }
    }
  }

  function leakBall(b) {
    b.leaked = true;
    b.dead = true;
    S.leaks++;
    S.lives -= b.lifeCost;
    if (S.lives < 0) S.lives = 0;

    sfx('life_lost');
    var fx = global.FX;
    if (fx) {
      fx.flash({ color: C.magenta, alpha: 0.3, life: 0.4 });
      fx.shake(10, 0.32);
      fx.burst(b.x, BOARD.DRAIN_Y, { count: 18, color: C.magenta, color2: C.white, power: 260, life: 0.5 });
      fx.text(b.x, BOARD.DRAIN_Y - 40, '-' + b.lifeCost + ' LIFE', { color: C.magenta, size: 28, life: 1.1, rise: 36, pop: 1 });
      fx.dropTrail('b' + b.id);
    }

    if (S.lives <= 0) loseLevel();
  }

  /* ====================================================================== */
  /* Ball update                                                            */
  /* ====================================================================== */

  function updateBalls(dt) {
    var magnet = S.magnetT > 0;

    for (var i = 0; i < S.balls.length; i++) {
      var b = S.balls[i];
      if (b.dead) continue;

      if (b.spawnT > 0) b.spawnT -= dt;
      if (b.hurtT > 0) b.hurtT -= dt;
      if (b.slowT > 0) { b.slowT -= dt; if (b.slowT <= 0) { b.slowMul = 1; b.contagion = 0; } }
      if (b.empowerT > 0) {
        b.empowerT -= dt;
        if (b.empowerT <= 0) {
          b.chain = 0;
          if (global.FX) global.FX.dropTrail('b' + b.id);
        }
      }

      /* Magnetise: nudge toward the nearest tower so dead lanes still
       * produce interactions. Deliberately gentle — it should feel like
       * help, not like the ball is on rails. */
      if (magnet && S.towers.length) {
        var best = null, bd = 1e9;
        for (var k = 0; k < S.towers.length; k++) {
          var d2 = U.dist2(b.x, b.y, S.towers[k].x, S.towers[k].y);
          if (d2 < bd) { bd = d2; best = S.towers[k]; }
        }
        if (best) {
          var dd = Math.sqrt(bd) || 1;
          b.vx += ((best.x - b.x) / dd) * 420 * dt;
          b.vy += ((best.y - b.y) / dd) * 260 * dt;
        }
      }

      var mul = ENT.ballSpeedMul(b);
      var bdt = dt * mul;

      /* Anti-stall gravity ramp. A ball can also refuse to die by staying in
       * fast motion forever (bouncing a lively circuit and never reaching the
       * bottom). Leaning on gravity after 18 seconds pulls it down without
       * ever looking like the game cheated. */
      b.aliveT = (b.aliveT || 0) + dt;
      /* Bosses live on a much longer leash. The escalations below assume a
       * ball that has got stuck, but surviving a long fight is a boss's whole
       * job: on the old timings the Colossus was ALWAYS retired by the 40s
       * backstop at about three-quarters health, so its bar visibly crawled
       * and then it simply vanished. The backstop still exists for it, just
       * far enough out that only a real trap can reach it. */
      var stallT = b.def.boss ? 70 : 18;
      var retireT = b.def.boss ? 150 : 40;
      if (b.aliveT > stallT && b.empowerT <= 0) {
        b.grav = b.def.grav * Math.min(3.2, 1 + (b.aliveT - stallT) * 0.12);

        /* Hard backstop. Gravity alone cannot free a ball that is orbiting a
         * pocket, because it keeps being handed its energy back. After 28
         * seconds we start steering it bodily toward the drain mouth and
         * bleeding its speed. No ball in normal play lives anywhere near this
         * long, so it is invisible — but it makes a soft-lock impossible. */
        /* Absolute backstop. If every escalation above has failed, the ball is
         * in a trap we did not anticipate. Retire it: the player keeps their
         * lives and gets the bounty, and the wave can always finish. This
         * should never fire — it exists so that a geometry bug can degrade
         * into a small oddity instead of an unwinnable level. */
        if (b.aliveT > retireT) {
          b.dead = true;
          S.totalKills++;
          addEnergy(b.bounty, b.x, b.y, '+' + b.bounty);
          if (global.FX) {
            global.FX.burst(b.x, b.y, { count: 12, color: C.steel, power: 200, life: 0.4 });
            global.FX.dropTrail('b' + b.id);
          }
          continue;
        }

        if (b.aliveT > stallT + 10) {
          var esc = U.clamp((b.aliveT - (stallT + 10)) / 10, 0, 1);
          var tx = 360 - b.x, ty = BOARD.DRAIN_Y - b.y;
          var td = U.len(tx, ty) || 1;
          b.vx += (tx / td) * 1600 * esc * dt;
          b.vy += (ty / td) * 1600 * esc * dt;
          var bleed = 1 - 2.2 * esc * dt;
          b.vx *= bleed; b.vy *= bleed;
        }
      }

      /* Wedge watchdog. The stall check below only catches a ball that has
       * gone QUIET; a big ball squeezed into a channel narrower than itself
       * — the classic one was a Hauler between the side wall and an outer
       * peg — keeps being shoved back and forth at speed and never trips it.
       * ballVsStatic flags the pinch by summing its contact normals; if the
       * squeeze persists, we free the ball outright: it may pass through the
       * small furniture for a moment and is pushed toward open table. The
       * geometry that caused the original trap is fixed in board.js — this is
       * the guarantee that the NEXT one degrades into a shrug. */
      if (b.pinch) {
        b.pinch = false;
        b.pinchT = (b.pinchT || 0) + dt;
        if (b.pinchT > 0.3) {
          b.pinchT = 0;
          b.ghostT = 0.5;
          var away = b.x < U.VW / 2 ? 1 : -1;
          b.vx = away * 320;
          b.vy = Math.min(b.vy, -160);
          if (global.FX) {
            global.FX.ring(b.x, b.y, { r0: b.r, r1: b.r + 36, color: C.steel, life: 0.32, width: 3 });
          }
        }
      } else {
        b.pinchT = 0;
      }
      if (b.ghostT > 0) b.ghostT -= dt;

      /* Ball-search watchdog. Any physics table can wedge a ball somewhere it
       * cannot escape (a corner, a flipper notch, between two bumpers), and a
       * wedged ball means the wave never completes and the level soft-locks.
       * Real machines solve this by kicking the ball loose; so do we. */
      if (b.slowT <= 0 && U.len2(b.vx, b.vy) < 900) {
        b.stillT = (b.stillT || 0) + dt;
        if (b.stillT > 1.5) {
          b.stillT = 0;
          b.vx += U.jit(340);
          b.vy = -300;
          if (global.FX) {
            global.FX.ring(b.x, b.y, { r0: b.r, r1: b.r + 30, color: C.steel, life: 0.3, width: 3 });
          }
        }
      } else {
        b.stillT = 0;
      }

      /* Where the ball started this substep. tryFlipper needs it to tell a
       * genuine crossing from a ball that was already under the arm. */
      b.lastX = b.x; b.lastY = b.y;

      PHYS.integrate(b, bdt, b.grav);
      b.rot += b.spin * bdt + b.vx * bdt * 0.02;

      /* Empowered balls fight gravity a little so the weapon stays in play
       * long enough to actually hit something. */
      if (b.empowerT > 0) {
        b.vy -= 260 * bdt;
        if (global.FX) {
          global.FX.trail('b' + b.id, b.x, b.y, { color: C.power, width: b.r * 1.5, life: 0.28, glow: 1 });
        }
      } else if (b.slowT > 0 && global.FX) {
        global.FX.trail('b' + b.id, b.x, b.y, { color: C.frost, width: b.r * 0.9, life: 0.22 });
      }

      /* Boss ability: periodic acceleration burst + a small escort. */
      if (b.def.boss) updateBoss(b, bdt);
    }
  }

  /* One ability tick per boss. The shared part — phases, the downward surge,
   * the escort — is the Colossus; each variant then does its own thing on top
   * so the archetype is legible from what happens on screen, not from a name
   * on the health bar. */
  function updateBoss(b, dt) {
    b.abilityCd -= dt;
    var d = b.def;
    var tint = d.tint || C.magenta;
    var phase = b.hp / b.maxHp < 0.34 ? 2 : (b.hp / b.maxHp < 0.67 ? 1 : 0);
    if (phase !== b.phase) {
      b.phase = phase;
      sfx('boss_hurt', { vol: 1 });
      var fx = global.FX;
      if (fx) {
        fx.ring(b.x, b.y, { r0: b.r, r1: b.r + 140, color: tint, life: 0.5, width: 8 });
        fx.shake(12, 0.35);
        fx.text(b.x, b.y - b.r - 30, 'PHASE ' + (phase + 1), { color: tint, size: 26, life: 1.1, rise: 30, pop: 1 });
      }
    }
    if (b.abilityCd > 0) return;

    b.abilityCd = (d.mini ? 8.5 : 7) - phase * 1.6;
    var f2 = global.FX;

    if (d.freezeR) {
      /* RIMEWALL. Kills the lamps on everything around it for a few seconds.
       * The answer is to not have every defense in one nest — which is
       * exactly the board a player builds if nothing ever punishes it. */
      var froze = 0;
      var inRing = [];
      for (var k = 0; k < S.towers.length; k++) {
        var tw = S.towers[k];
        if (U.dist2(tw.x, tw.y, b.x, b.y) > d.freezeR * d.freezeR) continue;
        tw.frozenT = Math.max(tw.frozenT, d.freezeDur);
        froze++;
        if (f2) f2.ring(tw.x, tw.y, { r0: 6, r1: 44, color: C.frost, life: 0.45, width: 3 });
        inRing.push(tw);
      }

      /* The freeze grips everything in the ring, but only the CLOSEST few
       * actually crack. Spreading the damage over every tower in range looked
       * fair and was a trap: it walks the whole nest toward zero at the same
       * rate, they fail together, and the board's output falls off a cliff
       * mid-fight. That is a death spiral, not a hard boss — a measured sweep
       * lost the wave at every AoE value from 8 upward while dealing less
       * total damage than this does. Concentrated, it is a bill the player can
       * see coming and answer: repair those two, or give ground. */
      if (d.wrecker && inRing.length) {
        inRing.sort(function (p, q) {
          return U.dist2(p.x, p.y, b.x, b.y) - U.dist2(q.x, q.y, b.x, b.y);
        });
        var nWreck = Math.min(d.wreckN || 1, inRing.length);
        for (var w2 = 0; w2 < nWreck; w2++) {
          if (f2) {
            f2.spark(inRing[w2].x, inRing[w2].y,
              { count: 12, color: C.frost, speed: 240, life: 0.45, size: 2.6, glow: 1 });
          }
          wearTower(inRing[w2], d.wrecker);
        }
      }
      if (f2) {
        f2.ring(b.x, b.y, { r0: b.r, r1: d.freezeR, color: C.frost, life: 0.55, width: 7 });
        f2.shake(8, 0.24);
        if (froze) f2.text(b.x, b.y - b.r - 28, 'FROZEN x' + froze, { color: C.frost, size: 22, life: 1.1, rise: 28, pop: 1 });
      }
      sfx('frost_hit', { vol: 1, rate: 0.6 });

    } else if (d.wrecker) {
      /* BREAKER. Slams the nearest defense outright, so a board it is allowed
       * to sit in front of simply dissolves. The flippers are the one thing
       * it cannot break, which is the point: pick it up and keep it moving. */
      var best = null, bd = 260 * 260;
      for (var w = 0; w < S.towers.length; w++) {
        var dd = U.dist2(S.towers[w].x, S.towers[w].y, b.x, b.y);
        if (dd < bd) { bd = dd; best = S.towers[w]; }
      }
      if (f2) {
        f2.ring(b.x, b.y, { r0: b.r, r1: b.r + 130, color: C.amber, life: 0.45, width: 7 });
        f2.shake(11, 0.3);
      }
      sfx('bumper_blast', { vol: 1, rate: 0.7 });
      if (best) {
        if (f2) {
          f2.spark(best.x, best.y, { count: 16, color: C.amber, speed: 300, life: 0.5, size: 3, glow: 1 });
          f2.text(best.x, best.y - 34, 'WRECKED', { color: C.amber, size: 20, life: 1.0, rise: 26 });
        }
        wearTower(best, d.wrecker);
      }

    } else if (d.dash) {
      /* VECTOR. Dashes sideways across the table instead of surging down, so
       * a static nest never gets a second contact. Has to be intercepted. */
      b.vx = (b.x < U.VW / 2 ? 1 : -1) * d.dash;
      b.vy = Math.min(b.vy, 120);
      if (f2) {
        f2.ring(b.x, b.y, { r0: b.r, r1: b.r + 70, color: C.green, life: 0.35, width: 5 });
        f2.shake(6, 0.18);
      }
      sfx('warn', { vol: 0.8, rate: 1.4 });

    } else {
      b.vy += 300;
      if (f2) {
        f2.ring(b.x, b.y, { r0: b.r, r1: b.r + 90, color: tint, life: 0.4, width: 5 });
        f2.shake(6, 0.2);
      }
      sfx('warn', { vol: 0.7 });
    }

    /* Escort. The concurrency ceiling rises with the run, so a late boss can
     * actually bring a crowd instead of the flat dozen the old cap allowed. */
    if (!d.mini && S.balls.length < ballCap() - 2) {
      for (var i = 0; i < 2; i++) {
        S.balls.push(ENT.makeBall('fast', b.x + U.jit(60), b.y + 40, { vx: U.jit(200), vy: 120 }));
      }
    }
  }

  function reapBalls() {
    for (var i = S.balls.length - 1; i >= 0; i--) {
      var b = S.balls[i];
      if (b.dead) { U.swapRemove(S.balls, i); continue; }

      /* Leak / barrier check. */
      if (b.y - b.r > BOARD.DRAIN_Y) {
        if (S.mode === 'tutorial') {
          /* A lesson never costs a life: the tutorial decides what happens. */
          b.dead = true;
          if (global.FX) global.FX.dropTrail('b' + b.id);
          U.swapRemove(S.balls, i);
          if (global.TUT) global.TUT.event('drain', b);
          continue;
        }
        if (S.barrierT > 0) {
          b.y = BOARD.DRAIN_Y - b.r;
          b.vy = -Math.abs(b.vy) * 0.85 - 380;
          var fx = global.FX;
          if (fx) {
            fx.ring(b.x, BOARD.DRAIN_Y, { r0: 6, r1: 60, color: C.cyan, life: 0.3, width: 4 });
            fx.spark(b.x, BOARD.DRAIN_Y, { count: 10, color: C.cyan, dir: -Math.PI / 2, spread: 0.9, speed: 300, life: 0.3 });
          }
          sfx('bumper', { vol: 0.7, rate: 0.75 });
        } else {
          leakBall(b);
          U.swapRemove(S.balls, i);
        }
        continue;
      }

      /* Hard containment. Collision resolution is sequential, so where the
       * side wall and a ramp end overlap it is possible for the later
       * collider to push a ball out past the earlier one, and once it is
       * clear of the wall nothing pulls it back. Rather than hand-tuning that
       * junction, the invariant is enforced directly: a ball is never allowed
       * outside the playfield. The 8-unit tolerance keeps this from fighting
       * ordinary wall contact. */
      var lo = U.WALL_L + b.r, hi = U.WALL_R - b.r;
      if (b.x < lo - 8 || b.x > hi + 8) {
        b.x = U.clamp(b.x, lo, hi);
        b.vx *= -0.3;
      }
      if (b.y < BOARD.CEIL + b.r - 8) {
        b.y = BOARD.CEIL + b.r;
        b.vy = Math.abs(b.vy) * 0.4;
      }
    }
  }

  /* One frame of table physics: flippers, balls, and every collision, run in
   * substeps small enough that nothing tunnels. Lifted out of GAME.update so
   * the BUILD phase can run it too — a wave the player ended early leaves
   * stragglers on the table, and they have to keep playing. */
  function stepWorld(dt, dtReal) {
    if (dt <= 0) {
      /* Frozen (hitstop): still poll the flippers so input feels live. */
      updateFlipper(S.flipL, restAngleL(), activeAngleL(), dtReal);
      updateFlipper(S.flipR, restAngleR(), activeAngleR(), dtReal);
      return;
    }

    /* Substep count is driven by the fastest thing on the table so nothing
     * tunnels — and while a flipper is travelling that is the flipper, not
     * any ball. Its tip covers ~4500 units/s against a 1750 ball cap, so
     * sizing the step off the balls alone is what let a late save swing
     * clean over an incoming ball. The raised cap only applies during the
     * ~50ms of an actual swing. */
    var maxSp = 0, minR = 999;
    for (var i = 0; i < S.balls.length; i++) {
      var b = S.balls[i];
      var sp = U.len(b.vx, b.vy);
      if (sp > maxSp) maxSp = sp;
      if (b.r < minR) minR = b.r;
    }
    if (minR === 999) minR = 13;
    var cap = PHYS.SUBSTEP_CAP;
    if (S.flipL.angle !== (S.flipL.on ? activeAngleL() : restAngleL()) ||
        S.flipR.angle !== (S.flipR.on ? activeAngleR() : restAngleR())) {
      if (FLIP_TIP_SPEED > maxSp) maxSp = FLIP_TIP_SPEED;
      cap = 16;
    }
    var steps = PHYS.substeps(maxSp, minR, dt, cap);
    var sdt = dt / steps;

    for (var st = 0; st < steps; st++) {
      updateFlipper(S.flipL, restAngleL(), activeAngleL(), sdt);
      updateFlipper(S.flipR, restAngleR(), activeAngleR(), sdt);
      updateBalls(sdt);
      for (var bi = 0; bi < S.balls.length; bi++) {
        var bb = S.balls[bi];
        if (bb.dead) continue;
        ballVsStatic(bb, sdt);
        ballVsTowers(bb, sdt);
        ballVsFlippers(bb);
      }
      ballVsBalls();
    }
  }

  /* ====================================================================== */
  /* Main update                                                            */
  /* ====================================================================== */

  GAME.update = function (dtReal) {
    var fx = global.FX;
    if (fx) fx.update(dtReal);

    if (S.toastT > 0) S.toastT -= dtReal;
    if (S.banner) S.banner.t += dtReal;

    /* Upgrade panel clock. Opening one drops the table into bullet time
     * (see the time scaling below) and muffles the mix; the render side
     * reads selT to pop the options in. Tracked ahead of the mode gate so
     * quitting with a panel open still lifts the filter. */
    if (S.selectedTower !== S.selFor) {
      S.selFor = S.selectedTower;
      S.selT = 0;
      var lp = global.SFX;
      if (S.selFor) { sfx('slowmo_in', { vol: 0.6 }); if (lp && lp.lowpass) lp.lowpass(0.75); }
      else if (lp && lp.lowpass && S.slowT <= 0) lp.lowpass(0);
    }
    if (S.selFor) S.selT += dtReal;

    if (S.mode === 'menu' || S.mode === 'boot' || S.mode === 'paused' ||
      S.mode === 'won' || S.mode === 'lost') {
      return;
    }

    /* --- tray press-and-hold -------------------------------------------- */
    var heldCard = updateHolds(dtReal);
    updateTowerHolds(dtReal);
    for (var hi = 0; hi < S.cards.length; hi++) {
      S.cards[hi].lift = U.damp(S.cards[hi].lift || 0,
        hi === heldCard ? 1 : 0, 0.45, dtReal);
    }
    if (S.inspect) {
      /* Frozen while a card is open: reading one must never cost a ball. */
      S.inspect.t += dtReal;
      return;
    }

    /* Same contract for a notice: the table waits while it is on screen, so
     * an explainer can never be the reason a wave got through. */
    if (S.notice) { S.notice.t += dtReal; return; }

    /* --- time scaling ------------------------------------------------- */
    var ts = fx ? fx.timeScale() : 1;
    if (S.slowT > 0) {
      S.slowT -= dtReal;
      ts *= S.slowMul;
      if (S.slowT <= 0) {
        S.slowMul = 1;
        var s = global.SFX; if (s) { s.lowpass(0); s.play('slowmo_out'); }
      }
    }
    /* Build mode heavily slows rather than hard-pausing: the table stays
     * alive so the player can see what they are building against. */
    if (S.mode === 'wave' && S.buildPick) ts *= 0.22;
    /* An open upgrade panel is a decision, so the table nearly stops: a
     * quarter-second ramp into 12% speed, so the ball smears to a crawl
     * rather than snapping. */
    if (S.selectedTower) ts *= 1 - 0.88 * Math.min(1, S.selT / 0.25);
    /* Tutorial owns the clock: bullet time on the lesson ball, a full freeze
     * while a card is on screen. Its own step timer runs on real time. */
    if (S.mode === 'tutorial' && global.TUT) {
      global.TUT.update(S, dtReal);
      if (S.mode !== 'tutorial') return;   // it just ended; next frame is a build frame
      ts *= global.TUT.timeScale();
    }

    var dt = dtReal * ts;
    if (dt > 0.05) dt = 0.05;    // never let a tab-switch spike explode physics
    S.time += dtReal;

    if (S.comboT > 0) S.comboT -= dtReal;
    if (S.overchargeT > 0) S.overchargeT -= dt;
    if (S.barrierT > 0) S.barrierT -= dt;
    if (S.magnetT > 0) S.magnetT -= dt;
    if (S.superheatT > 0) S.superheatT -= dt;

    /* --- cards --------------------------------------------------------- */
    for (var ci = 0; ci < S.cards.length; ci++) {
      if (CARDS.update(S.cards[ci], dtReal)) sfx('card_ready', { vol: 0.5 });
    }

    /* --- build phase --------------------------------------------------- */
    if (S.mode === 'build') {
      S.buildHint = !S.placedThisPhase && S.energy >= ENT.TOWERS.bumper.cost;
      if (S.towers.length) S.firstBuild = false;
      /* The countdown holds while the opening defense is still owed —
       * otherwise the guidance is decoration and wave 1 arrives anyway. */
      if (!GAME.mustBuild()) S.buildT -= dtReal;
      if (S.balls.length) {
        /* Stragglers from a wave the player called time on keep playing right
         * through the build phase. That overlap IS the price of the time they
         * just bought: those balls can still reach the drain and still cost
         * lives while the player is shopping. The table therefore runs at
         * full speed rather than the usual build-phase crawl. */
        updateTowers(dt);
        stepWorld(dt, dtReal);
        reapBalls();
      } else {
        updateFlipper(S.flipL, restAngleL(), activeAngleL(), dtReal);
        updateFlipper(S.flipR, restAngleR(), activeAngleR(), dtReal);
        updateTowers(dtReal * 0.35);
      }
      /* Belt and braces: the clock is already held above, but the opening
       * gate must not be walked around by a stale countdown either. */
      if (S.buildT <= 0 && !GAME.mustBuild()) startWave();
      return;
    }

    /* --- wave ----------------------------------------------------------- */
    if (dt > 0) {
      if (S.mode === 'wave') spawnFromTimeline(dt);
      updateTowers(dt);
    }
    stepWorld(dt, dtReal);
    reapBalls();

    if (S.mode === 'wave' && waveComplete()) endWave();
  };

  /* ====================================================================== */
  /* Cards                                                                  */
  /* ====================================================================== */

  GAME.useCard = function (index) {
    var inst = S.cards[index];
    if (!inst) return;
    if (!CARDS.canUse(inst)) { sfx('ui_error'); return; }
    world.fx = global.FX;
    if (CARDS.use(inst, world)) {
      if (!inst.def.activate.silent) sfx('card_use', { vol: 0.8 });
    }
  };

  /* ====================================================================== */
  /* Input                                                                  */
  /* ====================================================================== */

  var pointers = {};

  /* How long a finger must rest on a card before it pops out. Short enough
   * that it never feels like a wait, long enough that a quick tap to fire the
   * card is never mistaken for a request to read it. */
  var HOLD_TIME = 0.2;

  function openInspect(index, cell) {
    var inst = S.cards[index];
    if (!inst || !global.DRAW || !global.DRAW.inspectRect) return;
    S.inspect = {
      index: index,
      def: inst.def,
      ready: inst.cd <= 0,
      cd: inst.cd,
      frac: inst.cd <= 0 ? 1 : 1 - inst.cd / inst.cdMax,
      levelCard: inst.levelCard,
      hotkey: index + 1,
      from: { x: cell.x, y: cell.y, w: cell.w, h: cell.h },
      to: global.DRAW.inspectRect(),
      t: 0
    };
    sfx('ui_tap', { rate: 0.9 });
  }

  function closeInspect() {
    if (!S.inspect) return;
    S.inspect = null;
    sfx('ui_back');
  }
  GAME.closeInspect = closeInspect;

  /* Advances every held tray press and returns the card index currently under
   * a finger, so the tray can lift it. */
  /* How long a finger must rest on a defense mid-wave before its panel opens.
   * A little longer than the tray's card hold: a stray touch on the playfield
   * is far likelier than one on a tray cell. */
  var TOWER_HOLD = 0.3;

  function updateTowerHolds(dt) {
    S.towerHold = null;
    for (var k in pointers) {
      var pt = pointers[k];
      if (!pt.towerHold) continue;
      /* A tower that broke or was sold under the finger cannot be opened. */
      if (S.towers.indexOf(pt.towerHold) < 0) { pt.towerHold = null; continue; }
      pt.towerHoldT += dt;
      if (pt.towerHoldT < TOWER_HOLD) {
        S.towerHold = { tower: pt.towerHold, p: pt.towerHoldT / TOWER_HOLD };
        continue;
      }
      S.selectedTower = pt.towerHold;
      pt.towerHold = null;
      sfx('ui_tap', { rate: 0.9 });
      /* The flip already happened on the press. Drop the flipper now rather
       * than leaving the arm stuck up behind an open panel. */
      if (pt.role === 'L' || pt.role === 'R') {
        var stillHeld = false;
        for (var k2 in pointers) {
          if (k2 !== k && pointers[k2].role === pt.role) stillHeld = true;
        }
        if (!stillHeld) setFlipper(pt.role, false);
        pt.role = 'ui';
      }
    }
  }

  function updateHolds(dt) {
    var held = -1;
    for (var k in pointers) {
      var pt = pointers[k];
      if (!pt.hold || pt.hold.kind !== 'card') continue;
      pt.holdT += dt;
      held = pt.hold.index;
      if (!S.inspect && pt.holdT >= HOLD_TIME) openInspect(pt.hold.index, pt.hold);
    }
    return S.inspect ? S.inspect.index : held;
  }


  /* Converts a DOM event position into virtual board coordinates. */
  GAME.setViewport = function (vp) { GAME.vp = vp; };

  function toVirtual(clientX, clientY) {
    var vp = GAME.vp;
    return {
      x: (clientX - vp.ox) / (vp.scaleX || vp.scale),
      y: (clientY - vp.oy) / (vp.scaleY || vp.scale)
    };
  }
  GAME.toVirtual = toVirtual;

  GAME.pointerDown = function (id, cx, cy) {
    var s = global.SFX; if (s) s.init();
    var p = toVirtual(cx, cy);

    /* A card popout swallows the next touch anywhere on screen. */
    if (S.inspect) { closeInspect(); return; }

    /* So does a notice — but a notice that is asking a QUESTION only listens
     * to its own buttons, so a stray tap can never answer for the player. */
    if (S.notice) {
      var nb = global.DRAW && global.DRAW.hitNotice ? global.DRAW.hitNotice(p.x, p.y) : null;
      if (nb) GAME.noticeAction(nb);
      else if (S.notice.buttons.length < 2) GAME.noticeAction(S.notice.buttons[0].id);
      return;
    }

    pointers[id] = { x: p.x, y: p.y, role: null };

    if (S.mode !== 'wave' && S.mode !== 'build' && S.mode !== 'tutorial') return;

    /* 0. Tutorial gate sits at the top of the chain: it can swallow a tap
     * (tap-to-continue, or a tap on something the lesson has not reached
     * yet) before anything below can flip a flipper or place a tower. */
    if (S.mode === 'tutorial' && global.TUT && global.TUT.pointerDown(p.x, p.y)) {
      pointers[id].role = 'ui';
      return;
    }

    /* 0b. An open upgrade pick owns its buttons. A tap on the HUD or tray
     * just closes it; a tap on the field falls through, so it can re-target
     * another tower or close-and-flip (see 4). */
    if (S.selectedTower && global.DRAW && global.DRAW.hitUpgrade) {
      if (global.DRAW.hitUpgrade(p.x, p.y)) { pointers[id].role = 'ui'; return; }
      if (p.y >= U.BAND.trayTop || p.y < U.BAND.hud) {
        pointers[id].role = 'ui';
        S.selectedTower = null;
        sfx('ui_back');
        return;
      }
    }

    /* 1. Tray (cards + build bar) owns everything below the drain. */
    if (p.y >= U.BAND.trayTop) {
      pointers[id].role = 'ui';
      var h = global.DRAW && global.DRAW.pickTray ? global.DRAW.pickTray(p.x, p.y) : null;
      if (h && h.kind === 'card') {
        /* Deferred until release: a tap fires the card, a hold opens it. */
        pointers[id].hold = h;
        pointers[id].holdT = 0;
      } else if (h) {
        global.DRAW.applyTray(h);
      }
      return;
    }

    /* 2. HUD strip: pause button. */
    if (p.y < U.BAND.hud) {
      pointers[id].role = 'ui';
      if (global.DRAW && global.DRAW.hitHud) global.DRAW.hitHud(p.x, p.y);
      return;
    }

    /* 3. Build phase: the START button lives on the banner in mid-field. */
    if (S.mode === 'build' && global.DRAW && global.DRAW.hitBanner &&
      global.DRAW.hitBanner(p.x, p.y)) {
      pointers[id].role = 'ui';
      if (requestStartWave()) sfx('ui_tap');
      return;
    }

    /* 3b. During a wave's tail the same seat offers the NEXT WAVE. Checked
     * before the field falls through to the flippers; canEndWaveEarly gates
     * it to the quiet end of a wave, so it can only ever steal a tap in a
     * window where there is nothing left to flip at. */
    if (S.mode === 'wave' && global.DRAW && global.DRAW.hitNextWave &&
      global.DRAW.hitNextWave(p.x, p.y)) {
      pointers[id].role = 'ui';
      GAME.endWaveEarly();
      return;
    }

    /* 4. Placing a tower: the field becomes a placement surface. */
    if (S.buildPick) {
      pointers[id].role = 'ui';
      var slot = BOARD.slotAt(S.table, p.x, p.y, 52);
      if (slot && !slot.occupant) GAME.placeAt(slot);
      else { S.buildPick = null; sfx('ui_back'); }
      return;
    }

    /* 5. An existing tower.
     *
     * In a BUILD phase a tap opens its panel outright — nothing else wants
     * the tap there. During a WAVE it must not, because the whole field is
     * also the flipper surface: a tap meant for a flipper that happened to
     * land on a bumper opened its panel and dropped the table into bullet
     * time, and losing a save that way is infuriating.
     *
     * An earlier fix gave the flippers priority whenever a ball was low or a
     * rally was under way, which fixed the accident and created a worse one —
     * during a busy wave that is nearly always true, so managing a tower
     * became impossible exactly when the player most wanted to. The two
     * intents are separated by GESTURE now instead of by timing: a tap flips,
     * a HOLD opens the panel. Same press-and-hold the tray already uses to
     * read a card, and a ring fills on the tower while you hold it, so it is
     * never a surprise and never a race. */
    var t = towerAt(p.x, p.y);
    if (t && S.mode !== 'wave') {
      pointers[id].role = 'ui';
      S.selectedTower = (S.selectedTower === t) ? null : t;
      sfx('ui_tap');
      return;
    }
    if (S.selectedTower) {
      /* Tapping away closes the panel — but still counts as a flip, because
       * losing a ball to a menu would be infuriating. */
      S.selectedTower = null;
    }

    /* 6. Otherwise: the whole field is the flipper control surface. A press
     * over a tower flips exactly like any other, and merely starts the hold
     * timer alongside — so the flip is never traded away for the gesture. */
    pointers[id].role = p.x < U.VW / 2 ? 'L' : 'R';
    if (t) { pointers[id].towerHold = t; pointers[id].towerHoldT = 0; }
    setFlipper(pointers[id].role, true);
  };

  GAME.pointerMove = function (id, cx, cy) {
    var pt = pointers[id];
    if (!pt) return;
    var p = toVirtual(cx, cy);
    pt.x = p.x; pt.y = p.y;
    if (pt.hold && global.DRAW && global.DRAW.pickTray) {
      var over = global.DRAW.pickTray(p.x, p.y);
      if (S.inspect) {
        /* Slide along the tray to flip straight to a neighbour's details. */
        if (over && over.kind === 'card' && over.index !== S.inspect.index) {
          openInspect(over.index, over);
          pt.hold = over;
        }
      } else if (!over || over.kind !== 'card' || over.index !== pt.hold.index) {
        pt.hold = null;   // dragged off the cell: cancel rather than misfire
      }
    }
    /* Slid off the defense: that was a swipe, not a hold. */
    if (pt.towerHold && towerAt(p.x, p.y) !== pt.towerHold) pt.towerHold = null;
    if (S.buildPick) {
      S.hoverSlot = BOARD.slotAt(S.table, p.x, p.y, 52);
    }
  };

  GAME.pointerUp = function (id) {
    var pt = pointers[id];
    if (!pt) return;
    if (pt.towerHold) {
      /* Let go too soon. Said once per level, because a player who taps a
       * defense mid-wave and gets nothing has no way to discover the hold. */
      if (!S.towerHintShown) {
        S.towerHintShown = true;
        GAME.toast('HOLD a defense to open it during a wave', 3.2);
      }
      pt.towerHold = null;
    }
    if (pt.hold) {
      if (S.inspect) closeInspect();
      else if (global.DRAW && global.DRAW.applyTray) global.DRAW.applyTray(pt.hold);
      pt.hold = null;
    }
    if (pt.role === 'L' || pt.role === 'R') {
      /* Only release the flipper if no other finger is still holding it. */
      var stillHeld = false;
      for (var k in pointers) {
        if (k !== String(id) && pointers[k].role === pt.role) stillHeld = true;
      }
      if (!stillHeld) setFlipper(pt.role, false);
    }
    delete pointers[id];
  };

  GAME.clearPointers = function () {
    for (var k in pointers) delete pointers[k];
    /* A notice is deliberately NOT cleared here: backgrounding the app must
     * not silently answer a question the player has not read. */
    S.inspect = null;
    setFlipper('L', false);
    setFlipper('R', false);
  };

  GAME.keyDown = function (code) {
    /* Counted so the side-rail legend can fade back once the player has
     * clearly found the keys (see drawKeyRails in src/render.js). */
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'KeyZ') { U.INPUT.keyUses++; setFlipper('L', true); }
    else if (code === 'ArrowRight' || code === 'KeyD' || code === 'Slash') { U.INPUT.keyUses++; setFlipper('R', true); }
    else if (code === 'Digit1') GAME.useCard(0);
    else if (code === 'Digit2') GAME.useCard(1);
    else if (code === 'Digit3') GAME.useCard(2);
    else if (code === 'Digit4') GAME.useCard(3);
    else if (code === 'Space' || code === 'Enter') {
      if (S.mode === 'build') requestStartWave();
      else if (S.mode === 'wave' && GAME.canEndWaveEarly()) GAME.endWaveEarly();
      else if (S.mode === 'tutorial' && global.TUT) global.TUT.advance();
    }
    else if (code === 'Escape') {
      if (S.inspect) closeInspect();
      else if (S.notice) GAME.noticeAction(S.notice.buttons[S.notice.buttons.length - 1].id);
      else GAME.togglePause();
    }
  };

  GAME.keyUp = function (code) {
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'KeyZ') setFlipper('L', false);
    else if (code === 'ArrowRight' || code === 'KeyD' || code === 'Slash') setFlipper('R', false);
  };

  function towerAt(x, y) {
    for (var i = 0; i < S.towers.length; i++) {
      var t = S.towers[i];
      var rr = (t.family === 'bumper' ? t.r + 12 : 34);
      if (U.dist2(x, y, t.x, t.y) < rr * rr) return t;
    }
    return null;
  }
  GAME.towerAt = towerAt;

  GAME.togglePause = function () {
    if (S.mode === 'wave' || S.mode === 'build' || S.mode === 'tutorial') {
      S._resume = S.mode;
      S.mode = 'paused';
      GAME.clearPointers();
      if (global.UI) global.UI.showScreen('paused');
    } else if (S.mode === 'paused') {
      S.mode = S._resume || 'build';
      if (global.UI) global.UI.showScreen(null);
    }
  };

  GAME.resume = function () {
    if (S.mode === 'paused') {
      S.mode = S._resume || 'build';
      if (global.UI) global.UI.showScreen(null);
    }
  };

  GAME.restartLevel = function () {
    if (S.level) GAME.startLevel(S.level.id, PROG.loadout);
    if (global.UI) global.UI.showScreen(null);
  };

  GAME.nextLevel = function () {
    var next = S.level && !S.level.endless ? LEVELS.byId(S.level.id + 1) : null;
    if (next) {
      GAME.startLevel(next.id, PROG.loadout);
      if (global.UI) global.UI.showScreen(null);
    } else {
      GAME.quitToMenu();
    }
  };

  global.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
