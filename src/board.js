/* MEGABALL — board.js
 * The pinball table geometry, purpose-built for a 720x1440 portrait screen.
 *
 * Layout reasoning (this is the part that decides whether the game plays well
 * on a phone):
 *
 *   - The playfield interior is 640 units wide. That is ~19 basic-ball
 *     diameters, which is enough for real lateral movement but narrow enough
 *     that a single well-placed tower meaningfully covers a lane.
 *   - Enemies enter through five gates across the top. Immediately below them
 *     sits a scatter row of static posts so balls fan out instead of falling
 *     in straight columns — that is what turns "objects descending" into
 *     pinball.
 *   - The middle 740 units are the BUILD FIELD: a staggered lattice of tower
 *     slots. Staggering (4 wide / 5 wide alternating) means every slot has
 *     diagonal neighbours, so chains of bumpers form natural pinball nests.
 *   - The bottom is a classic flipper deck: two slingshots that kick the ball
 *     back up, two flippers with a one-ball drain gap between them, and two
 *     narrow outlanes on the sides for tension.
 *
 * Attaches window.BOARD. Depends on: U, PHYS.
 */
(function (global) {
  'use strict';

  var U = global.U, PHYS = global.PHYS;
  var BOARD = {};

  var WL = U.WALL_L, WR = U.WALL_R;
  var CEIL = 112;
  var DRAIN_Y = 1240;

  BOARD.CEIL = CEIL;
  BOARD.DRAIN_Y = DRAIN_Y;

  /* Flipper rig. The drain gap is the single most important number on the
   * table. A ball at REST in the middle of the gap is supported by both tips
   * unless gap > 2*(ballRadius + flipperRadius) — at 54 units the basic ball
   * (r17) needed 60 and simply wedged there forever. The gap is therefore set
   * to ~84, which also clears the Hauler (r26, needs 78) and works out at
   * 13% of the playfield width — the same ratio a real table uses. */
  BOARD.FLIP = {
    y: 1100,
    lx: 198,
    rx: 522,
    len: 132,
    rad: 13,
    restDeg: 25,      // resting droop, measured down from horizontal
    swingDeg: 57      // travel to the raised position
  };

  /* Spawn gates across the top. */
  BOARD.LANES = [150, 255, 360, 465, 570];
  BOARD.SPAWN_Y = 158;

  /* ---------------------------------------------------------------------- */
  /* Tower slot lattice                                                     */
  /* ---------------------------------------------------------------------- */

  var ROWS = [270, 390, 510, 630, 750, 870];
  var COLS_WIDE = [168, 296, 424, 552];       // even rows: 4 slots
  var COLS_NARROW = [104, 232, 360, 488, 616]; // odd rows: 5 slots, offset

  function buildSlots(blocked) {
    var slots = [], id = 0;
    for (var r = 0; r < ROWS.length; r++) {
      var cols = (r % 2 === 0) ? COLS_WIDE : COLS_NARROW;
      for (var c = 0; c < cols.length; c++) {
        var key = r + ':' + c;
        if (blocked && blocked.indexOf(key) >= 0) continue;
        slots.push({
          id: id++,
          key: key,
          x: cols[c],
          y: ROWS[r],
          row: r,
          col: c,
          occupant: null   // set to a tower when built
        });
      }
    }
    return slots;
  }
  BOARD.SLOT_RADIUS = 40;  // tap/highlight radius for a slot

  /* ---------------------------------------------------------------------- */
  /* Static geometry                                                        */
  /* ---------------------------------------------------------------------- */

  var W = { restitution: 0.5, friction: 0.05, kind: 'wall' };
  /* Slingshots add energy on purpose, but a guaranteed kick along the surface
   * normal alone is a perpetual-motion machine: two facing slingshots will
   * volley a ball horizontally forever. game.js therefore also forces the
   * outgoing direction upward, and the numbers here stay conservative. */
  var SLING = { restitution: 0.92, friction: 0.02, kind: 'sling', minOut: 300 };
  var RAIL = { restitution: 0.62, friction: 0.03, kind: 'rail' };

  function buildColliders(def) {
    var c = [];

    /* --- outer shell ---------------------------------------------------- */
    c.push(PHYS.capsule(WL, CEIL, WR, CEIL, 8, W));          // ceiling
    c.push(PHYS.capsule(WL, CEIL, WL, DRAIN_Y, 8, W));       // left wall
    c.push(PHYS.capsule(WR, CEIL, WR, DRAIN_Y, 8, W));       // right wall

    /* Rounded top corners so balls launched upward sweep across instead of
     * jamming in a 90-degree pocket. */
    c.push(PHYS.capsule(WL + 4, CEIL + 52, WL + 52, CEIL + 4, 7, RAIL));
    c.push(PHYS.capsule(WR - 4, CEIL + 52, WR - 52, CEIL + 4, 7, RAIL));

    /* --- scatter row under the spawn gates ------------------------------ */
    /* Offset from the gate centres so a ball dropping straight down always
     * clips a post and picks a side. Nothing falls in a straight line. */
    var scatterY = 218;
    c.push(PHYS.circle(176, scatterY, 11, { restitution: 0.78, kind: 'post' }));
    c.push(PHYS.circle(284, scatterY, 11, { restitution: 0.78, kind: 'post' }));
    c.push(PHYS.circle(436, scatterY, 11, { restitution: 0.78, kind: 'post' }));
    c.push(PHYS.circle(544, scatterY, 11, { restitution: 0.78, kind: 'post' }));

    /* --- mid-field pegs -------------------------------------------------- */
    /* Sit in the gaps between slot rows, so they add scatter without ever
     * overlapping a place-able slot. */
    /* Pegs live in the gaps BETWEEN slot rows, so they add scatter and visual
     * texture without ever colliding with a place-able slot.
     *
     * CLEARANCE RULE: every peg must leave more than one Hauler-diameter
     * (2 x r26 = 52) between itself and the side wall, whose inner surface is
     * at WL+8 / WR-8. The outer pegs of the middle row used to sit at 104 and
     * 616, leaving a 47-unit channel — narrower than the biggest ordinary
     * ball. A Hauler that found one wedged there permanently, jittering
     * between the wall pushing it in and the peg pushing it out, and the wave
     * could not finish. They now stand at 128 / 592 for a 71-unit channel.
     * See the wedge watchdog in game.js for the general case. */
    var pegs = def.pegs || [
      [232, 330], [360, 330], [488, 330],
      [168, 450], [296, 450], [424, 450], [552, 450],
      [128, 570], [296, 570], [424, 570], [592, 570],
      [168, 690], [360, 690], [552, 690],
      [232, 810], [424, 810], [488, 810],
      [296, 930], [424, 930]
    ];
    for (var i = 0; i < pegs.length; i++) {
      c.push(PHYS.circle(pegs[i][0], pegs[i][1], 9,
        { restitution: 0.82, friction: 0.01, kind: 'peg' }));
    }

    /* --- lower funnel ---------------------------------------------------
     * Rewritten twice after playtesting found ball traps. Two rules now:
     *
     *  1. NO CONCAVE JUNCTIONS. Each ramp runs in ONE straight line from the
     *     wall to the flipper PIVOT, and uses the same radius as the flipper
     *     (13) so the ramp's end cap and the flipper's pivot cap are the same
     *     circle. The surface therefore continues smoothly from ramp to
     *     flipper arm, and because the arm is the shallower of the two, the
     *     bend is convex — a ball always rolls on through it. An earlier
     *     version ended the ramp beside the pivot and every ball that reached
     *     the seam sat in the notch forever.
     *  2. NOTHING FORMS A NARROW CHANNEL WITH A LIVE SURFACE. The slingshots
     *     used to sit in a 44-unit slot against the ramp, and since a
     *     slingshot always returns the ball upward, that slot was a perpetual
     *     motion machine. They now stand in the open with a ball-width of
     *     clearance on both sides.
     *
     * The only way off the table is the gap between the two flipper tips.
     * One gate to defend reads far better on a phone than a scatter of lanes. */
    c.push(PHYS.capsule(WL + 8, 940, 198, 1100, 13, RAIL));
    c.push(PHYS.capsule(WR - 8, 940, 522, 1100, 13, RAIL));

    c.push(PHYS.capsule(236, 972, 292, 1042, 11, SLING));
    c.push(PHYS.capsule(484, 972, 428, 1042, 11, SLING));

    /* --- per-level extra geometry ---------------------------------------- */
    if (def.walls) {
      for (var w = 0; w < def.walls.length; w++) {
        var s = def.walls[w];
        c.push(PHYS.capsule(s[0], s[1], s[2], s[3], s[4] || 9, RAIL));
      }
    }

    return c;
  }


  /* Painted playfield inserts. Purely cosmetic — no collision — but they are
   * what stops a mostly-empty build field from looking unfinished, the same
   * way the painted artwork does on a real table. */
  BOARD.DECOR = {
    arcs: [
      { x: 360, y: 250, r: 250, a0: 0.18, a1: Math.PI - 0.18, w: 3, c: 'line' },
      { x: 360, y: 980, r: 300, a0: Math.PI + 0.35, a1: -0.35, w: 3, c: 'line' },
      { x: 360, y: 600, r: 168, a0: 0, a1: Math.PI * 2, w: 1.5, c: 'line' }
    ],
    lanes: [
      [96, 300, 96, 900], [624, 300, 624, 900]
    ],
    chevrons: [
      [360, 962], [360, 992]
    ]
  };

  /* ---------------------------------------------------------------------- */
  /* Public                                                                 */
  /* ---------------------------------------------------------------------- */

  /* Build a fresh table for a level definition.
   * `def` may supply { blockedSlots, pegs, walls, lanes }. */
  BOARD.build = function (def) {
    def = def || {};
    return {
      colliders: buildColliders(def),
      slots: buildSlots(def.blockedSlots),
      lanes: def.lanes || BOARD.LANES,
      spawnY: BOARD.SPAWN_Y,
      drainY: DRAIN_Y,
      ceil: CEIL
    };
  };

  /* Nearest free slot to a point, or null. Used by build-mode tapping —
   * a generous radius here is the difference between "responsive" and
   * "fiddly" on a phone. */
  BOARD.slotAt = function (table, x, y, radius) {
    radius = radius || 46;
    var best = null, bestD = radius * radius;
    for (var i = 0; i < table.slots.length; i++) {
      var s = table.slots[i];
      var d = U.dist2(x, y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  /* Is this point inside the playable table (as opposed to the tray/HUD)? */
  BOARD.inField = function (x, y) {
    return x > WL && x < WR && y > CEIL && y < DRAIN_Y;
  };

  global.BOARD = BOARD;
})(typeof window !== 'undefined' ? window : this);
