/* MEGABALL — tutorial.js
 * The World 1 · Level 1 onboarding: a scripted, interactive walkthrough that
 * runs on the real table with real physics before the first wave.
 *
 * It is a small step machine. Each step owns: a message card, an optional
 * pointer (tap / hold / arrow) aimed at something, an optional spotlight
 * mask, a time-scale target (bullet time or a full freeze), a camera zoom
 * target, and either a tap-to-continue or a condition the player satisfies
 * by playing (hold a flipper, flip a ball, place a bumper, ...).
 *
 * game.js drives it: GAME.update calls TUT.update, physics is multiplied by
 * TUT.timeScale(), and collision code raises TUT.event(...). render.js asks
 * TUT.cam() for the zoom and calls TUT.draw for the overlay. Everything here
 * is drawn in virtual 720x1440 coordinates on the 2D canvas, so it lands
 * identically on every phone.
 *
 * Attaches window.TUT. Depends on: U, BOARD, ENT. Late-binds GAME, DRAW, FX, SFX.
 */
(function (global) {
  'use strict';

  var U = global.U, BOARD = global.BOARD, ENT = global.ENT;
  var C = U.C, TAU = U.TAU;
  var VW = U.VW, VH = U.VH;

  var TUT = {};
  var T = null;          // live tutorial state, null when idle
  var S = null;          // GAME.state while running

  function sfx(n, o) { var s = global.SFX; if (s && s.play) s.play(n, o); }
  function fx() { return global.FX; }

  /* ====================================================================== */
  /* Camera + time                                                          */
  /* ====================================================================== */

  /* Default focal/anchor = the shake pivot the renderers already use, so a
   * zoom of 1 is byte-for-byte the normal view. */
  var PIV_X = VW / 2, PIV_Y = 700;
  var LOOK_X = VW / 2, LOOK_Y = 640;   // where a zoomed-in subject is parked

  var cam = { zoom: 1, fx: PIV_X, fy: PIV_Y, ax: PIV_X, ay: PIV_Y };
  TUT.cam = function () { return T ? cam : null; };
  TUT.timeScale = function () { return T ? T.ts : 1; };
  TUT.active = function () { return !!T && S && S.mode === 'tutorial'; };

  /* Board coordinate -> screen (virtual) coordinate under the current zoom,
   * including the FX shake so pointers stick to what they point at. */
  function toScreen(x, y) {
    var c = fx() && fx().camera ? fx().camera() : null;
    var sx = cam.ax + (x - cam.fx) * cam.zoom + (c ? c.x : 0);
    var sy = cam.ay + (y - cam.fy) * cam.zoom + (c ? c.y : 0);
    return { x: sx, y: sy };
  }

  function updateCam(dt) {
    /* Where the camera wants to look. */
    var tz = T.zoomTarget, tfx, tfy;
    if (T.follow && !T.follow.dead) { tfx = T.follow.x; tfy = T.follow.y; }
    else if (T.focus) { tfx = T.focus.x; tfy = T.focus.y; }
    else { tfx = PIV_X; tfy = PIV_Y; }
    if (tz <= 1.001) { tfx = PIV_X; tfy = PIV_Y; }

    cam.zoom = U.damp(cam.zoom, tz, 0.11, dt);
    if (Math.abs(cam.zoom - tz) < 0.002) cam.zoom = tz;
    cam.fx = U.damp(cam.fx, tfx, 0.22, dt);
    cam.fy = U.damp(cam.fy, tfy, 0.22, dt);

    /* Anchor slides from "focal stays put" (zoom 1) to "subject parked at
     * LOOK" as the zoom deepens, so a zoom-in pans the subject to centre. */
    var k = U.clamp((cam.zoom - 1) / 0.5, 0, 1);
    k = U.ease.inOutQuad(k);
    /* Park point, clamped so the table's edges never come inside the
     * HUD/tray frame — a subject at the very top is shown lower instead of
     * revealing the void above the machine. */
    var z = cam.zoom;
    var lx = U.clamp(LOOK_X, VW - (VW - cam.fx) * z, cam.fx * z);
    var ly = U.clamp(LOOK_Y, 1200 - (BOARD.DRAIN_Y - cam.fy) * z, U.BAND.hud + cam.fy * z);
    cam.ax = U.lerp(cam.fx, lx, k);
    cam.ay = U.lerp(cam.fy, ly, k);
    if (cam.zoom === 1) { cam.ax = cam.fx; cam.ay = cam.fy; }

    /* Time scale. */
    T.ts = U.damp(T.ts, T.tsTarget, T.tsRate, dt);
    if (Math.abs(T.ts - T.tsTarget) < 0.01) T.ts = T.tsTarget;
  }

  function slow(scale, rate) { T.tsTarget = scale; T.tsRate = rate || 0.3; }
  function zoom(z, focus, follow) {
    T.zoomTarget = z;
    T.focus = focus || null;
    T.follow = follow || null;
  }

  /* ====================================================================== */
  /* Helpers the steps use                                                  */
  /* ====================================================================== */

  function say(title, body, o) {
    o = o || {};
    T.msg = { title: title, body: body, pos: o.pos || 'top', tap: o.tap !== false, t: 0 };
    T.pointer = null;
    T.spot = null;
    sfx('ui_tap', { vol: 0.5, rate: 1.25 });
  }
  function hush() { T.msg = null; }

  function point(kind, x, y, o) {
    o = o || {};
    T.pointer = { kind: kind, x: x, y: y, dir: o.dir || 'down', label: o.label || '',
      board: !!o.board, ball: o.ball || null, tray: o.tray || null };
  }
  function spot(list) { T.spot = list; }

  /* Tray geometry comes from the renderer's own layout routines so the
   * pointers land exactly on the buttons the player sees. */
  function trayRect(pred) {
    var D = global.DRAW;
    var tr = D && D.trayRects ? D.trayRects(S) : null;
    var cells = tr ? tr.cells : [];
    for (var i = 0; i < cells.length; i++) if (pred(cells[i])) return cells[i];
    return null;
  }
  function buildCell(type) { return trayRect(function (h) { return h.kind === 'build' && h.type === type; }); }
  function cardCell(i) { return trayRect(function (h) { return h.kind === 'card' && h.index === i; }); }
  function upgradeRect(to) {
    var D = global.DRAW;
    var L = D && D.upgradeRects ? D.upgradeRects(S) : null;
    if (!L) return null;
    for (var i = 0; i < L.ups.length; i++) if (L.ups[i].to === to) return L.ups[i];
    return null;
  }
  function sellRect() {
    var D = global.DRAW;
    var L = D && D.upgradeRects ? D.upgradeRects(S) : null;
    return L ? L.sell : null;
  }

  function rectCenter(r) { return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; }

  function spawnBall(x, y, o) {
    var G = global.GAME;
    if (!G || !G.spawnBallAt) return null;
    var b = G.spawnBallAt('basic', x, y, o || {});
    T.ball = b;
    T.lastX = x; T.lastY = y; T.stuckT = 0; T.sampleT = 0;
    return b;
  }

  function retireBall(b) {
    if (!b || b.dead) return;
    b.dead = true;
    var f = fx();
    if (f) {
      f.spark(b.x, b.y, { count: 10, color: C.steel, speed: 160, life: 0.3, size: 2 });
      f.ring(b.x, b.y, { r0: b.r, r1: b.r + 26, color: C.steel, life: 0.3, width: 3 });
      f.dropTrail('b' + b.id);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Safe geometry                                                          */
  /*                                                                        */
  /* The table's pegs sit at x = 104,168,232,...,616 — the SAME columns as   */
  /* the tower slots — on rows exactly halfway between the slot rows. So a   */
  /* ball dropped straight down a slot column lands dead centre on a peg and */
  /* balances there, and a demo ball spawned 300 above a slot spawns inside  */
  /* the peg row. Both are unwatchable in a tutorial, so the lesson uses     */
  /* hand-checked geometry instead of arbitrary positions.                   */
  /* ---------------------------------------------------------------------- */

  /* Columns that clear every peg and post from the ceiling to the flippers
   * (32 units of clearance, against the 26 a ball needs). */
  var CLEAR_X = [328, 392];

  /* The only slots the lesson lets you build in: row y=630, the three middle
   * columns. Each has a clear 150-unit drop above it AND a clear spawn point
   * at y=480, so the demo ball always falls straight onto the bumper. */
  var SAFE_SLOTS = [[232, 630], [360, 630], [488, 630]];
  var DROP_H = 150;

  function isSafeSlot(s) {
    if (!s) return false;
    for (var i = 0; i < SAFE_SLOTS.length; i++) {
      if (s.x === SAFE_SLOTS[i][0] && s.y === SAFE_SLOTS[i][1]) return true;
    }
    return false;
  }

  function safeSlots() {
    var out = [];
    for (var i = 0; i < S.table.slots.length; i++) {
      var s = S.table.slots[i];
      if (!s.occupant && isSafeSlot(s)) out.push(s);
    }
    return out;
  }

  function pickSlot() {
    /* The middle one is the recommended pick — the pointer aims here. */
    var list = safeSlots();
    for (var i = 0; i < list.length; i++) if (list[i].x === 360) return list[i];
    return list[0] || null;
  }

  /* Nothing in a tutorial may sit still. A ball that has barely moved across
   * three consecutive real-time samples gets shoved off whatever it is
   * balanced on. Sampling in REAL time matters: under bullet time the
   * simulation's own anti-stall watchdog takes several seconds to notice. */
  function unstick(dt) {
    var b = T.ball;
    if (!b || b.dead || T.tsTarget <= 0.05) { T.stuckT = 0; T.sampleT = 0; return; }
    T.sampleT += dt;
    if (T.sampleT < 0.3) return;
    T.sampleT = 0;
    var moved = U.dist2(b.x, b.y, T.lastX, T.lastY);
    T.lastX = b.x; T.lastY = b.y;
    T.stuckT = moved < 30 * 30 ? T.stuckT + 0.3 : 0;
    if (T.stuckT < 0.9) return;
    T.stuckT = 0;
    b.vx += (b.x < VW / 2 ? -1 : 1) * 150 + U.jit(90);
    b.vy = Math.max(b.vy, 200);
    b.aliveT = 0;
    var f = fx();
    if (f) f.spark(b.x, b.y, { count: 6, color: C.steel, speed: 150, life: 0.25, size: 2 });
  }

  function floatText(x, y, str, color, size) {
    var f = fx();
    if (f) f.text(x, y, str, { color: color || C.cyan, size: size || 30, life: 1.0, rise: 34, pop: 1 });
  }

  /* Combat text lives in the board layer, UNDER the tutorial's message card.
   * Anything meant as a reply to a mis-tap therefore has to be kept clear of
   * whichever band the card is currently occupying. */
  function nudgeText(x, y, str, color) {
    var lo = (T.msg && T.msg.pos !== 'top') ? 340 : 360;
    floatText(U.clamp(x, 130, VW - 130), U.clamp(y, lo, 1140), str, color, 22);
  }

  /* ====================================================================== */
  /* The script                                                             */
  /* ====================================================================== */

  var STEPS = {};

  STEPS.welcome = {
    enter: function () {
      slow(1, 0.5); zoom(1);
      say('WELCOME TO MEGABALL',
        'Enemy balls drop in from the top and roll for the DRAIN at the bottom. Every one that gets out costs you a life.',
        { pos: 'top' });
      spot([{ kind: 'rect', x: U.WALL_L, y: 1176, w: U.WALL_R - U.WALL_L, h: 60, r: 12 }]);
      point('arrow', VW / 2, 1150, { dir: 'down', label: 'THE DRAIN' });
    },
    next: 'flipL'
  };

  STEPS.flipL = {
    enter: function () {
      say('YOUR FLIPPERS', 'Hold the LEFT side of the table to raise the left flipper.', { tap: false });
      spot([{ kind: 'rect', x: U.WALL_L, y: 720, w: 320, h: 480, r: 24 }]);
      point('hold', 200, 960, { label: 'HOLD' });
    },
    update: function () {
      if (S.flipL.on && !T.flag) { T.flag = true; T.wait = 0.55; floatText(BOARD.FLIP.lx + 40, BOARD.FLIP.y - 50, 'LEFT!'); }
      if (T.flag) { T.wait -= T.dt; if (T.wait <= 0) return 'flipR'; }
    }
  };

  STEPS.flipR = {
    enter: function () {
      say('YOUR FLIPPERS', 'Now hold the RIGHT side for the right flipper.', { tap: false });
      spot([{ kind: 'rect', x: 360, y: 720, w: 320, h: 480, r: 24 }]);
      point('hold', 520, 960, { label: 'HOLD' });
    },
    update: function () {
      if (S.flipR.on && !T.flag) { T.flag = true; T.wait = 0.55; floatText(BOARD.FLIP.rx - 40, BOARD.FLIP.y - 50, 'RIGHT!'); }
      if (T.flag) { T.wait -= T.dt; if (T.wait <= 0) return 'both'; }
    }
  };

  STEPS.both = {
    enter: function () {
      say('BOTH AT ONCE', 'Hold BOTH sides at the same time. Go on, try it.', { tap: false });
      spot([{ kind: 'rect', x: U.WALL_L, y: 720, w: U.WALL_R - U.WALL_L, h: 480, r: 24 }]);
      point('hold', 200, 960, { label: 'HOLD' });
      T.pointer2 = { kind: 'hold', x: 520, y: 960, label: 'HOLD' };
    },
    update: function () {
      if (S.flipL.on && S.flipR.on && !T.flag) { T.flag = true; T.wait = 0.9; floatText(VW / 2, BOARD.FLIP.y - 70, 'BOTH!', C.amber, 34); }
      if (T.flag) { T.wait -= T.dt; if (T.wait <= 0) return 'bothJoke'; }
    },
    exit: function () { T.pointer2 = null; }
  };

  STEPS.bothJoke = {
    enter: function () {
      say('...YEP.', 'You can keep them up as long as you like. It parks a ball for a moment. It will not win you the level.', { pos: 'top' });
    },
    next: 'spawn'
  };

  STEPS.spawn = {
    enter: function () {
      hush();
      T.spawnT = 0.5;
      T.flag = false;
    },
    update: function () {
      T.spawnT -= T.dt;
      if (!T.flag && T.spawnT <= 0) {
        T.flag = true;
        var b = spawnBall(CLEAR_X[0], S.table.spawnY, { vx: 0, vy: 70 });
        sfx('warn', { vol: 0.5 });
        slow(0.08, 0.5);
        zoom(2.3, null, b);
        T.wait = 0.9;
      } else if (T.flag) {
        T.wait -= T.dt;
        if (T.wait <= 0 && !T.msg) {
          say('THE ENEMY', 'This is an enemy ball. It only wants one thing: to reach the drain. Tap anywhere to let it go.', { pos: 'low' });
          point('arrow', 0, 0, { dir: 'down', ball: T.ball, board: true, label: 'ENEMY' });
        }
      }
    },
    next: 'fall'
  };

  STEPS.fall = {
    enter: function () {
      slow(1, 0.12);
      zoom(1);
      say('FLIP IT', 'Let it fall. When it reaches a flipper, HOLD that side to knock it back up.', { tap: false });
      point('arrow', 0, 0, { dir: 'down', ball: T.ball, board: true });
      T.flag = false;
    },
    update: function () {
      var b = T.ball;
      if (!b || b.dead) return;
      /* Bullet time as it drops into the flipper zone: a first-timer gets a
       * real chance to react instead of learning by losing. */
      var low = b.y > 930 && b.vy > 0;
      if (low && !T.flag) { T.flag = true; slow(0.28, 0.35); sfx('slowmo_in', { vol: 0.6 }); }
      if (T.flag && (b.y < 900 || b.vy < 0)) { T.flag = false; slow(1, 0.2); }
      T.flipCue = low && b.y > 960;
    },
    on: function (ev, b) {
      if (ev === 'flipHit') return 'hit';
      if (ev === 'drain') {
        T.misses++;
        say('MISSED', 'Here comes another one. Wait until it is ON the flipper, then hold that side.', { tap: false });
        point('arrow', 0, 0, { dir: 'down', ball: null, board: true });
        var nb = spawnBall(CLEAR_X[T.misses % CLEAR_X.length], S.table.spawnY, { vx: 0, vy: 70 });
        T.pointer.ball = nb;
        T.flag = false;
        slow(1, 0.3);
      }
    },
    exit: function () { T.flipCue = false; }
  };

  STEPS.hit = {
    enter: function () {
      hush();
      sfx('slowmo_in', { vol: 0.7 });
      slow(0.22, 0.4);
      zoom(1.7, null, T.ball);
      T.wait = 1.05;
      T.flag = false;
    },
    update: function () {
      T.wait -= T.dt;
      if (T.wait <= 0 && !T.flag) {
        T.flag = true;
        slow(0, 0.5);   // hang the ball mid-air while we talk
        say('NICE HIT', 'Flippers knock balls back up the table... but a flipper can never DESTROY one.', { pos: 'low' });
      }
    },
    next: 'defend'
  };

  STEPS.defend = {
    enter: function () {
      zoom(1);
      if (S.energy < ENT.TOWERS.bumper.cost) S.energy = ENT.TOWERS.bumper.cost;
      say('DEFENSES', 'To destroy balls you build DEFENSES. BUMPERS and PADDLES sit in the slots on the table and fight on their own.', { pos: 'top' });
      point('arrow', 0, 0, { dir: 'down', tray: 'bumper', label: 'BUMPER' });
    },
    /* The arrow points at real buttons, so an eager tap on BUMPER counts:
     * it picks the bumper and skips straight to placing it. */
    allow: function (x, y) {
      var r = buildCell('bumper');
      return !!(r && inRect(x, y, r));
    },
    update: function () { if (S.buildPick === 'bumper') return 'placeBumper'; },
    next: 'pickBumper'
  };

  STEPS.pickBumper = {
    enter: function () {
      if (S.energy < ENT.TOWERS.bumper.cost) S.energy = ENT.TOWERS.bumper.cost;
      say('BUILD A BUMPER', 'Tap BUMPER in the tray.', { tap: false, pos: 'top' });
      point('tap', 0, 0, { tray: 'bumper' });
    },
    allow: function (x, y) {
      var r = buildCell('bumper');
      return !!(r && inRect(x, y, r));
    },
    update: function () { if (S.buildPick === 'bumper') return 'placeBumper'; }
  };

  STEPS.placeBumper = {
    enter: function () {
      T.slot = pickSlot();
      say('PLACE IT', 'Tap one of the GLOWING slots. Bumpers belong where balls fall.', { tap: false, pos: 'top' });
      if (T.slot) point('tap', T.slot.x, T.slot.y, { board: true });
      /* Only the hand-checked slots are offered: anywhere else and the demo
       * ball would land on a peg instead of the new bumper. */
      var list = safeSlots(), holes = [];
      for (var i = 0; i < list.length; i++) {
        holes.push({ kind: 'circle', x: list[i].x, y: list[i].y, r: 52 });
      }
      spot(holes);
    },
    allow: function (x, y) {
      if (S.buildPick !== 'bumper') return false;
      return isSafeSlot(BOARD.slotAt(S.table, x, y, 52));
    },
    deny: function (x, y) {
      if (y > U.BAND.hud && y < U.BAND.trayTop) {
        sfx('ui_error');
        nudgeText(x, y - 30, 'USE A GLOWING SLOT', C.magenta);
      }
    },
    on: function (ev, t) { if (ev === 'place') { T.tower = t; return 'demo'; } }
  };

  STEPS.demo = {
    enter: function () {
      var t = T.tower;
      retireBall(T.ball);
      T.ball = null;
      hush();
      zoom(1.6, { x: t.x, y: t.y - 60 });
      slow(1, 0.3);
      T.wait = 0.6;
      T.flag = false;
      T.demoT = 0;
    },
    update: function () {
      T.demoT += T.dt;
      if (!T.flag) {
        T.wait -= T.dt;
        if (T.wait <= 0) {
          T.flag = true;
          dropDemoBall();
          say('ALWAYS ON', 'Watch. Bumpers need no input at all.', { tap: false, pos: 'low' });
        }
      } else if (T.demoT > 7) {
        /* Something deflected it. Try again rather than stranding the player. */
        T.demoT = 0;
        if (T.ball && !T.ball.dead) retireBall(T.ball);
        dropDemoBall();
      }
    },
    on: function (ev, b) {
      if (ev === 'bumperHit') { slow(0.1, 0.9); }
      if (ev === 'kill') return 'destroyed';
      if (ev === 'drain') { T.demoT = 0; dropDemoBall(); }
    }
  };

  function dropDemoBall() {
    var t = T.tower;
    /* Exactly DROP_H above the bumper: far enough to watch it fall, close
     * enough that the only peg row in the way is one the safe slots clear. */
    var y = Math.max(BOARD.CEIL + 40, t.y - DROP_H);
    var b = spawnBall(t.x, y, { vx: 0, vy: 40 });
    if (b) b.hp = Math.min(b.hp, 1);   // one clean hit finishes it: the lesson, not a fight
    slow(0.55, 0.3);
    zoom(1.6, { x: t.x, y: t.y - 60 });
  }

  STEPS.destroyed = {
    enter: function () {
      slow(0.12, 0.5);
      T.wait = 0.7;
      T.flag = false;
    },
    update: function () {
      T.wait -= T.dt;
      if (T.wait <= 0 && !T.flag) {
        T.flag = true;
        slow(1, 0.25);
        zoom(1);
        say('DESTROYED', 'Bumpers damage and kick anything that touches them. Every kill pays out ENERGY. Spend it on more defenses.', { pos: 'mid' });
        point('arrow', VW - 110, 100, { dir: 'up', label: 'ENERGY' });
      }
    },
    next: 'paddle'
  };

  STEPS.paddle = {
    enter: function () {
      say('PADDLES', 'The other defense: a robot flipper that swings at anything in reach. Mix bumpers and paddles. You will build one later.', { pos: 'top' });
      point('arrow', 0, 0, { dir: 'down', tray: 'paddle', label: 'PADDLE' });
    },
    next: 'upgradeOpen'
  };

  /* The lesson makes the player HOLD, not tap, because that is the gesture
   * that works when it matters. Mid-wave the whole playfield is the flipper
   * surface, so a tap there flips and only a hold reaches a defense; teaching
   * the tap would teach something that stops working the moment the first
   * wave starts. The ring that fills under the finger is the game's own
   * affordance, so the lesson is really just pointing at it. */
  STEPS.upgradeOpen = {
    enter: function () {
      say('UPGRADES',
        'Defenses can be upgraded. HOLD your bumper for a moment to open it — during a wave a tap works the flippers, so holding is how you reach a defense.',
        { tap: false, pos: 'top' });
      point('hold', T.tower.x, T.tower.y, { board: true, label: 'HOLD' });
    },
    allow: function (x, y) {
      var G = global.GAME;
      return !!(G && G.towerAt && G.towerAt(x, y) === T.tower);
    },
    deny: function (x, y) {
      if (y > U.BAND.hud && y < U.BAND.trayTop) {
        sfx('ui_error');
        nudgeText(T.tower.x, T.tower.y - 60, 'HOLD YOUR BUMPER', C.cyan);
      }
    },
    update: function () { if (S.selectedTower === T.tower) return 'upgBlast'; }
  };

  function upgStep(to, title, body, next) {
    return {
      enter: function () {
        /* The pick's cards fill mid-screen; the lesson reads from under them.
         * This is a tour, not a purchase: the card is dimmed-around and
         * labelled, never offered with a tap cue. */
        say(title, body, { pos: 'low' });
        T.spotTray = to;
        point('arrow', 0, 0, { dir: 'down', tray: to === 'sell' ? 'sell' : 'up:' + to, label: title });
      },
      exit: function () { T.spotTray = null; },
      next: next
    };
  }
  STEPS.upgBlast = upgStep('blast', 'BLAST BUMPER', 'Detonates on every hit. Hurts everything nearby. Built for crowds.', 'upgShock');
  STEPS.upgShock = upgStep('shock', 'SHOCK BUMPER', 'Arcs lightning from ball to ball. Great when they bunch up.', 'upgLaunch');
  STEPS.upgLaunch = upgStep('launch', 'LAUNCH BUMPER', 'Hurls balls back to the top. Buys you time, not kills.', 'upgSell');
  STEPS.upgSell = upgStep('sell', 'SELL', 'Changed your mind? Selling refunds part of the cost. Paddles upgrade too: FROST slows, POWER turns a ball into a weapon.', 'cards');

  /* Which card the lesson points at. SLOW TIME by preference: everyone starts
   * with it, and it is the one card whose effect can be DEMONSTRATED rather
   * than described — the table visibly changes speed. Falls back to the first
   * card for anyone replaying the lesson with a different deck. */
  function lessonCardIndex() {
    for (var i = 0; i < S.cards.length; i++) {
      if (S.cards[i].def.id === 'slowtime') return i;
    }
    return 0;
  }

  /* Keep a couple of balls falling down the safe columns, so there is always
   * something on the table for the card to act on. The step used to run on an
   * empty board: the player tapped SLOW TIME, nothing moved because nothing
   * was moving, and the one card they own stayed an abstraction. */
  function dropCardBall() {
    var live = 0;
    for (var i = 0; i < S.balls.length; i++) if (!S.balls[i].dead) live++;
    if (live >= 3) return;
    var b = spawnBall(CLEAR_X[T.misses++ % CLEAR_X.length], S.table.spawnY,
      { vx: 0, vy: 60 });
    /* Not a fight: these are here to be watched, and a bumper kill mid-demo
     * would empty the table exactly as the player reaches for the card. */
    if (b) { b.hp = 999; b.maxHp = 999; }
    T.ball = null;              // no single ball is "the" ball in this step
  }

  STEPS.cards = {
    enter: function () {
      S.selectedTower = null;
      zoom(1);
      /* Full speed on purpose: the tutorial's own bullet time would mask the
       * very thing this card exists to show. */
      slow(1, 0.5);
      T.misses = 0;
      T.flag = false;
      T.wait = 0;
      dropCardBall();
      var ci = lessonCardIndex();
      var isSlow = S.cards[ci] && S.cards[ci].def.id === 'slowtime';
      say(isSlow ? 'SLOW TIME' : 'CARDS',
        isSlow
          ? 'Cards are one-tap powers on a cooldown. HOLD one to read it. This one drags every ball on the table into slow motion — TAP it and watch.'
          : 'Cards are one-tap powers on a cooldown. HOLD one to read what it does, then TAP it to fire.',
        { tap: false, pos: 'top' });
      point('tap', 0, 0, { tray: 'card' + ci });
    },
    /* The pointed-at card takes the press, and so does the lower field, so the
     * player can flip at the demo balls while they watch. Tower taps are
     * deliberately NOT let through: an upgrade panel here would bury the one
     * thing this step exists to show. */
    allow: function (x, y) {
      var r = cardCell(lessonCardIndex());
      if (r && inRect(x, y, r)) return true;
      return y > 960 && y < U.BAND.trayTop;
    },
    update: function () {
      var c = S.cards[lessonCardIndex()];
      if (!c) return 'stars';
      if (!T.flag) {
        if (c.uses > 0) {
          /* Fired. Hold the step open so the slow motion is actually SEEN —
           * cutting away the instant it is tapped would teach the button and
           * hide the effect. */
          T.flag = true;
          T.wait = 3.4;
          hush();
          floatText(VW / 2, 620, 'SLOW MOTION', C.frost, 34);
        } else {
          dropCardBall();
        }
      } else {
        T.wait -= T.dt;
        if (T.wait <= 0) return 'stars';
      }
    }
  };

  /* Where the rest of the deck comes from. The card the player has just fired
   * is one of seven, and nothing anywhere told them how to get the others —
   * so a player could finish the campaign never knowing that the second and
   * third objectives on every level are what buys them. Said right after
   * firing a card, while "I want more of these" is the live thought. */
  STEPS.stars = {
    enter: function () {
      say('STARS BUY CARDS',
        'Every level is worth THREE stars: clear it, stay inside its leak budget, and beat its own challenge. Stars unlock new cards and extra card slots, so going back for a missed one is how your deck grows. All three are listed before you start a level.',
        { pos: 'mid' });
    },
    next: 'end'
  };

  STEPS.end = {
    enter: function () {
      /* The last thing said before the build banner appears, so it is also
       * the right moment to point at the START button on it — the early-start
       * bonus is invisible as a mechanic until somebody says it is there. */
      say('THAT IS THE GAME', 'Keep the bumper, it is on the house. Built early? Tap START on the banner to send the wave now — you are paid for every second you hand back. Good luck!', { pos: 'mid' });
    },
    next: null
  };

  /* ====================================================================== */
  /* Step machine                                                           */
  /* ====================================================================== */

  function go(id) {
    var cur = T.step;
    if (cur && cur.exit) cur.exit();
    T.flag = false;
    T.wait = 0;
    T.stepT = 0;
    T.msg = null;
    T.pointer = null;
    T.spot = null;
    if (!id) { finish(true); return; }
    T.stepId = id;
    T.step = STEPS[id];
    if (T.step.enter) T.step.enter();
  }

  function advance() {
    if (!T || !T.step) return;
    if (T.msg && T.msg.tap && T.msg.t > 0.35) {
      sfx('ui_tap', { vol: 0.6 });
      if (T.step.next !== undefined) go(T.step.next);
    }
  }
  TUT.advance = advance;
  /* Read-only peek for playtest tooling. */
  TUT.debug = function () {
    return T ? { step: T.stepId, msgT: T.msg ? T.msg.t : null, tap: T.msg ? T.msg.tap : null,
      pointer: T.pointer, ts: T.ts, zoom: cam.zoom } : null;
  };

  function finish(completed) {
    var G = global.GAME;
    T = null;
    if (G && G.endTutorial) G.endTutorial(completed);
  }

  /* ---------------------------------------------------------------------- */
  /* Public lifecycle                                                       */
  /* ---------------------------------------------------------------------- */

  /* Bumped whenever the lesson changes materially. A save written before this
   * version has not seen THIS tutorial, so World 1 Level 1 teaches it again —
   * which is also what re-arms it for anyone whose flag was set by an earlier
   * build. */
  TUT.VERSION = 3;

  TUT.shouldRun = function (def, prog) {
    if (!def || def.id !== 1) return false;
    if (TUT.force) return true;
    return prog.tutorialV !== TUT.VERSION;
  };

  TUT.start = function (state) {
    S = state;
    TUT.force = false;
    T = {
      step: null, stepId: null, stepT: 0, dt: 0,
      ts: 1, tsTarget: 1, tsRate: 0.3,
      zoomTarget: 1, focus: null, follow: null,
      msg: null, pointer: null, pointer2: null, spot: null, spotTray: null,
      ball: null, tower: null, slot: null, misses: 0, flag: false, wait: 0,
      time: 0, flipCue: false,
      stuckT: 0, sampleT: 0, lastX: 0, lastY: 0
    };
    cam.zoom = 1; cam.fx = cam.ax = PIV_X; cam.fy = cam.ay = PIV_Y;
    S.mode = 'tutorial';
    S.banner = null;
    S.tutorialsShown.start = true;
    go('welcome');
  };

  TUT.update = function (state, dt) {
    if (!T) return;
    S = state;
    T.dt = dt;
    T.time += dt;
    T.stepT += dt;
    if (T.msg) T.msg.t += dt;
    updateCam(dt);
    unstick(dt);
    var st = T.step;
    if (st && st.update) {
      var nx = st.update();
      if (nx) { go(nx); return; }
    }
  };

  TUT.event = function (ev, a, b) {
    if (!T || !T.step) return;
    if (T.step.on) {
      var nx = T.step.on(ev, a, b);
      if (nx) go(nx);
    }
  };

  /* Skip pill, just under the HUD's label line, over the spawn gates. */
  var skipBtn = { x: VW / 2 - 100, y: 102, w: 200, h: 34 };

  /* Returns true when the tap was consumed by the tutorial. */
  TUT.pointerDown = function (x, y) {
    if (!T) return false;
    if (inRect(x, y, skipBtn)) { sfx('ui_back'); finish(false); return true; }
    if (y < U.BAND.hud) return false;                 // pause still works
    var st = T.step;
    if (st && st.allow && st.allow(x, y)) return false;   // let it through to the game
    if (T.msg && T.msg.tap) { advance(); return true; }
    if (st && st.allow) {
      if (st.deny) st.deny(x, y);
      return true;                           // swallowed: not part of this step
    }
    return false;
  };

  function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  /* ====================================================================== */
  /* Drawing                                                                */
  /* ====================================================================== */

  function rr(ctx, x, y, w, h, r) {
    if (global.DRAW && global.DRAW.rr) { global.DRAW.rr(ctx, x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Headings and captions take the pixel face the menus use; body copy
   * (weights under 800) stays in the system face for reading. */
  var PXF = '"Ken Pixel","Segoe UI",system-ui,sans-serif';
  function txt(ctx, str, x, y, size, color, align, weight, spacing) {
    var w = weight || '800';
    ctx.font = (w === '800' || w === '900') ? size + 'px ' + PXF : w + ' ' + size + 'px ' + U.FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (spacing && ctx.letterSpacing !== undefined) ctx.letterSpacing = spacing + 'px';
    ctx.fillText(str, x, y);
    if (spacing && ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  }

  function wrap(ctx, str, maxW, size, weight) {
    ctx.font = (weight || '600') + ' ' + size + 'px ' + U.FONT;
    var words = str.split(' '), line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* Resolve a pointer target that lives in the tray (whose rects only exist
   * after the tray has been drawn this frame) or on a moving ball. */
  function resolvePointer(p) {
    var x = p.x, y = p.y;
    if (p.tray) {
      var r = null;
      if (p.tray === 'bumper') r = buildCell('bumper');
      else if (p.tray === 'paddle') r = buildCell('paddle');
      else if (p.tray.indexOf('card') === 0) r = cardCell(+p.tray.slice(4) || 0);
      else if (p.tray === 'sell') r = sellRect();
      else if (p.tray.indexOf('up:') === 0) r = upgradeRect(p.tray.slice(3));
      else if (p.tray === 'builds') {
        var a = buildCell('paddle'), b = buildCell('bumper');
        if (a && b) r = { x: a.x, y: a.y, w: b.x + b.w - a.x, h: a.h };
      }
      if (!r) return null;
      var c = rectCenter(r);
      return { x: c.x, y: r.y - 6, r: r };
    }
    if (p.ball) {
      if (p.ball.dead) return null;
      var s = toScreen(p.ball.x, p.ball.y);
      return { x: s.x, y: s.y - p.ball.r * cam.zoom - 6 };
    }
    if (p.board) {
      var s2 = toScreen(x, y);
      return { x: s2.x, y: s2.y };
    }
    return { x: x, y: y };
  }

  function drawMask(ctx, holes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-200, -200, VW + 400, VH + 400);
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      if (h.kind === 'circle') {
        ctx.moveTo(h.x + h.r, h.y);
        ctx.arc(h.x, h.y, h.r, 0, TAU);
      } else {
        var r = h.r || 12;
        ctx.moveTo(h.x + r, h.y);
        ctx.arcTo(h.x + h.w, h.y, h.x + h.w, h.y + h.h, r);
        ctx.arcTo(h.x + h.w, h.y + h.h, h.x, h.y + h.h, r);
        ctx.arcTo(h.x, h.y + h.h, h.x, h.y, r);
        ctx.arcTo(h.x, h.y, h.x + h.w, h.y, r);
        ctx.closePath();
      }
    }
    ctx.fillStyle = 'rgba(3,4,10,0.58)';
    ctx.fill('evenodd');
    /* Glowing rim on each hole so the cut-out reads as "look here". */
    var live = !(T.msg && T.msg.tap);
    ctx.lineWidth = live ? 3 : 2;
    ctx.strokeStyle = live ? U.rgba(C.cyan, 0.55 + 0.25 * Math.sin(T.time * 5)) : U.rgba(C.amber, 0.6);
    for (var k = 0; k < holes.length; k++) {
      var g = holes[k];
      if (g.kind === 'circle') { ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.stroke(); }
      else { rr(ctx, g.x, g.y, g.w, g.h, g.r || 12); ctx.stroke(); }
    }
    ctx.restore();
  }

  function drawHold(ctx, x, y, label) {
    var t = T.time;
    var press = 0.5 + 0.5 * Math.sin(t * 3.2);      // slow squeeze = "hold"
    var sc = 1 - press * 0.12;
    ctx.save();
    ctx.translate(x, y);
    /* Expanding rings only while "down". */
    for (var i = 0; i < 2; i++) {
      var ph = ((t * 0.8) + i * 0.5) % 1;
      ctx.beginPath();
      ctx.arc(0, 0, 26 + ph * 46, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = U.rgba(C.cyan, (1 - ph) * 0.7 * press);
      ctx.stroke();
    }
    ctx.scale(sc, sc);
    /* Fingertip: white disc, thick black outline — same language as the balls. */
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU);
    ctx.fillStyle = C.white; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU);
    ctx.fillStyle = C.cyan; ctx.fill();
    ctx.restore();
    if (label) txt(ctx, label, x, y + 58, 14, C.cyan, 'center', '800', 3);
  }

  function drawTap(ctx, x, y) {
    var t = T.time;
    var ph = (t * 1.1) % 1;
    var down = ph < 0.25;
    ctx.save();
    ctx.translate(x, y);
    if (down) {
      var rp = ph / 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 22 + rp * 40, 0, TAU);
      ctx.lineWidth = 4; ctx.strokeStyle = U.rgba(C.cyan, 1 - rp); ctx.stroke();
    }
    var sc = down ? 0.86 : 1;
    ctx.scale(sc, sc);
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU);
    ctx.fillStyle = C.white; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU);
    ctx.fillStyle = C.cyan; ctx.fill();
    ctx.restore();
    txt(ctx, 'TAP', x, y + 50, 14, C.cyan, 'center', '800', 3);
  }

  function drawArrow(ctx, x, y, dir, label) {
    var bob = Math.sin(T.time * 6) * 9;
    var ang = dir === 'down' ? Math.PI / 2 : dir === 'up' ? -Math.PI / 2 : dir === 'left' ? Math.PI : 0;
    var off = 44 + bob;
    var ax = x - Math.cos(ang) * off, ay = y - Math.sin(ang) * off;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    /* Chevron arrow pointing +x. */
    ctx.beginPath();
    ctx.moveTo(-30, -20); ctx.lineTo(0, -20); ctx.lineTo(0, -34); ctx.lineTo(30, 0);
    ctx.lineTo(0, 34); ctx.lineTo(0, 20); ctx.lineTo(-30, 20); ctx.closePath();
    ctx.fillStyle = C.cyan; ctx.fill();
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.restore();
    if (label) {
      var lx = ax - Math.cos(ang) * 46, ly = ay - Math.sin(ang) * 46;
      if (dir === 'down' || dir === 'up') txt(ctx, label, lx, ly + (dir === 'down' ? -14 : 14), 14, C.cyan, 'center', '800', 3);
      else txt(ctx, label, lx, ly, 14, C.cyan, dir === 'left' ? 'left' : 'right', '800', 3);
    }
  }

  function drawPointer(ctx, p) {
    var r = resolvePointer(p);
    if (!r) return;
    if (p.kind === 'hold') drawHold(ctx, r.x, r.y, p.label);
    else if (p.kind === 'tap') drawTap(ctx, r.x, r.y);
    else drawArrow(ctx, r.x, r.y, p.dir, p.label);
  }

  var MSG_Y = { top: 128, mid: 560, low: 1040 };

  /* The unlit dot grid behind every display, and an insert lamp. */
  var msgPat = null;
  function dotPattern(ctx) {
    if (msgPat) return msgPat;
    var c = document.createElement('canvas'); c.width = c.height = 8;
    var g = c.getContext('2d');
    g.fillStyle = 'rgba(63,224,255,0.11)';
    g.beginPath(); g.arc(4, 4, 1.5, 0, TAU); g.fill();
    msgPat = ctx.createPattern(c, 'repeat');
    return msgPat;
  }
  function lamp(ctx, x, y, r, col, a) {
    var k = a === undefined ? 1 : a;
    ctx.beginPath(); ctx.arc(x, y, r * 2, 0, TAU);
    ctx.fillStyle = U.rgba(col, 0.18 * k); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = U.rgba(col, k); ctx.fill();
  }

  /* The lesson card is a display plate in the backglass language: dark
   * glass on the dot grid, bezel screws, a lamp before the title, and an
   * amber lamp that breathes beside "tap to continue". Body copy stays in
   * the reading face. */
  function drawMsg(ctx, m) {
    var a = U.clamp(m.t / 0.22, 0, 1);
    var ease = U.ease.outCubic(a);
    var w = 640, x = 40;
    var pad = 26;
    var body = wrap(ctx, m.body, w - pad * 2, 23, '600');
    var h = pad + (m.title ? 28 : 0) + body.length * 29 + (m.tap ? 36 : 14) + 2;
    var y = MSG_Y[m.pos] || MSG_Y.top;
    if (y + h > 1200) y = 1200 - h;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - ease) * (m.pos === 'top' ? -24 : 24));

    ctx.save();
    rr(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(3,5,10,0.95)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = dotPattern(ctx);
    ctx.fillRect(x, y, w, h);
    var sh = ctx.createLinearGradient(0, y, 0, y + 30);
    sh.addColorStop(0, 'rgba(0,0,0,0.5)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, 30);
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = U.rgba(C.cyan, 0.5);
    rr(ctx, x, y, w, h, 14);
    ctx.stroke();
    for (var sx = 0; sx < 2; sx++) {
      ctx.beginPath(); ctx.arc(sx ? x + w - 8 : x + 8, y + h / 2, 3, 0, TAU);
      ctx.fillStyle = '#1c2740'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(143,232,255,0.35)'; ctx.stroke();
    }

    var cy = y + pad;
    if (m.title) {
      lamp(ctx, x + pad + 5, cy + 4, 4.5, C.cyan);
      txt(ctx, m.title, x + pad + 19, cy + 4, 14, C.cyan, 'left', '800', 2);
      cy += 28;
    }
    for (var i = 0; i < body.length; i++) {
      txt(ctx, body[i], x + pad, cy + 13 + i * 29, 23, C.white, 'left', '600');
    }
    if (m.tap) {
      var pulse = 0.5 + 0.5 * Math.sin(T.time * 4);
      lamp(ctx, x + w - pad - 4, y + h - 22, 4, C.amber, 0.35 + 0.65 * pulse);
      txt(ctx, (T.pointer || T.spot || T.spotTray) ? 'TAP ANYWHERE TO CONTINUE' : 'TAP TO CONTINUE', x + w - pad - 17, y + h - 22, 12,
        U.rgba(C.white, 0.4 + 0.4 * pulse), 'right', '800', 2);
    }
    ctx.restore();
  }

  function drawSkip(ctx) {
    var b = skipBtn;
    rr(ctx, b.x, b.y, b.w, b.h, 17);
    ctx.fillStyle = 'rgba(3,5,10,0.85)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(63,224,255,0.35)'; ctx.stroke();
    lamp(ctx, b.x + 18, b.y + b.h / 2, 3.5, C.cyan, 0.9);
    txt(ctx, 'SKIP TUTORIAL', b.x + b.w / 2 + 8, b.y + b.h / 2 + 1, 12,
      U.rgba(C.white, 0.75), 'center', '800', 1.5);
  }

  function drawFlipCue(ctx) {
    var b = T.ball;
    if (!b || b.dead) return;
    var s = toScreen(b.x, b.y);
    var left = b.x < VW / 2;
    var pulse = 0.6 + 0.4 * Math.sin(T.time * 14);
    ctx.save();
    ctx.globalAlpha = pulse;
    txt(ctx, left ? 'HOLD LEFT!' : 'HOLD RIGHT!', s.x + (left ? 60 : -60), s.y - 10, 26,
      C.amber, left ? 'left' : 'right', '900', 2);
    ctx.restore();
  }

  TUT.draw = function (ctx, state) {
    if (!T) return;
    S = state;
    ctx.save();

    /* Spotlight: explicit holes, or the tray button an upgrade step names. */
    var holes = T.spot;
    if (!holes && T.spotTray) {
      var tr = T.spotTray === 'sell' ? sellRect() : upgradeRect(T.spotTray);
      if (tr) holes = [{ kind: 'rect', x: tr.x - 4, y: tr.y - 4, w: tr.w + 8, h: tr.h + 8, r: 14 }];
    }
    if (holes) drawMask(ctx, holes);

    if (T.flipCue) drawFlipCue(ctx);
    if (T.pointer) drawPointer(ctx, T.pointer);
    if (T.pointer2) drawPointer(ctx, T.pointer2);
    if (T.msg) drawMsg(ctx, T.msg);
    drawSkip(ctx);

    ctx.restore();
  };

  global.TUT = TUT;
})(typeof window !== 'undefined' ? window : this);
