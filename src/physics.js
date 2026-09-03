/* MEGABALL — physics.js
 * A small, deterministic 2D pinball solver.
 *
 * Everything static on the table is modelled as either a CAPSULE (a line
 * segment with a radius) or a CIRCLE. That is deliberate: capsules give
 * smooth, snag-free deflections at any angle, which is what makes a pinball
 * table feel good, and one collision routine covers walls, ramps, posts,
 * flippers and paddles alike.
 *
 * Attaches window.PHYS. Depends on: U.
 */
(function (global) {
  'use strict';

  var U = global.U;
  var PHYS = {};

  /* ---------- tuning ---------------------------------------------------- */
  PHYS.GRAVITY = 660;      // virtual units / s^2 — tuned for reaction time,
                         // not realism: a phone player needs to read the
                         // board and still make the flipper save.
  PHYS.DRAG = 0.055;       // fraction of velocity shed per second
  PHYS.MAX_SPEED = 1750;   // hard clamp: past this, collision starts tunnelling
  PHYS.MIN_SPEED = 0.5;    // below this we treat the ball as stopped

  /* Shared scratch results. Reused every call so the solver never allocates
   * inside the frame loop. Read them immediately; do not hold references. */
  var hit = PHYS.hit = { pen: 0, nx: 0, ny: 0, px: 0, py: 0, speed: 0 };

  /* ---------- primitives ------------------------------------------------ */

  /* Closest point on segment AB to P, written into `hit.px/py`.
   * Returns the parametric t along the segment (0..1). */
  function closestOnSeg(px, py, ax, ay, bx, by) {
    var abx = bx - ax, aby = by - ay;
    var len2 = abx * abx + aby * aby;
    var t = len2 > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    hit.px = ax + abx * t;
    hit.py = ay + aby * t;
    return t;
  }
  PHYS.closestOnSeg = closestOnSeg;

  /* Ball vs capsule. Fills `hit` and returns true on overlap.
   * The normal always points from the capsule toward the ball. */
  PHYS.ballVsCapsule = function (bx, by, br, ax, ay, cx, cy, cr) {
    closestOnSeg(bx, by, ax, ay, cx, cy);
    var dx = bx - hit.px, dy = by - hit.py;
    var d2 = dx * dx + dy * dy;
    var r = br + cr;
    if (d2 > r * r) return false;

    var d = Math.sqrt(d2);
    if (d > 1e-6) {
      hit.nx = dx / d; hit.ny = dy / d;
    } else {
      // Dead centre on the segment: push straight up rather than NaN out.
      hit.nx = 0; hit.ny = -1;
    }
    hit.pen = r - d;
    return true;
  };

  /* Ball vs circle. Fills `hit` and returns true on overlap. */
  PHYS.ballVsCircle = function (bx, by, br, cx, cy, cr) {
    var dx = bx - cx, dy = by - cy;
    var d2 = dx * dx + dy * dy;
    var r = br + cr;
    if (d2 > r * r) return false;
    var d = Math.sqrt(d2);
    if (d > 1e-6) { hit.nx = dx / d; hit.ny = dy / d; }
    else { hit.nx = 0; hit.ny = -1; }
    hit.pen = r - d;
    hit.px = cx + hit.nx * cr;
    hit.py = cy + hit.ny * cr;
    return true;
  };

  /* ---------- resolution ------------------------------------------------ */

  /* Resolve a ball against a surface described by the current `hit`.
   *
   *   restitution — 1.0 is a perfect bounce; bumpers use >1 to add energy.
   *   friction    — 0..1, how much tangential velocity is scrubbed off.
   *   svx, svy    — velocity of the SURFACE at the contact point. This is what
   *                 lets a swinging flipper actually launch a ball instead of
   *                 just reflecting it.
   *   minOut      — enforce at least this much outward speed after the hit
   *                 (bumpers and launchers rely on it for a consistent kick).
   *
   * Returns the impact speed along the normal, which the game uses to scale
   * damage, sound pitch and particle count.
   */
  PHYS.resolve = function (ball, restitution, friction, svx, svy, minOut) {
    var nx = hit.nx, ny = hit.ny;

    // De-penetrate first so the ball can never sink into geometry.
    ball.x += nx * hit.pen;
    ball.y += ny * hit.pen;

    svx = svx || 0; svy = svy || 0;
    var rvx = ball.vx - svx, rvy = ball.vy - svy;
    var vn = rvx * nx + rvy * ny;

    // Already separating: keep the de-penetration, skip the impulse.
    if (vn > 0) return 0;

    var impact = -vn;

    // Split relative velocity into normal and tangential parts so friction
    // only touches the tangential component.
    var tnx = rvx - vn * nx, tny = rvy - vn * ny;
    var nOut = -vn * restitution;
    if (minOut && nOut < minOut) nOut = minOut;

    var f = 1 - (friction || 0);
    ball.vx = svx + tnx * f + nx * nOut;
    ball.vy = svy + tny * f + ny * nOut;

    return impact;
  };

  /* Elastic ball-vs-ball with equal-ish masses. Mass comes from the balls'
   * `mass` field so a heavy ball shoulders a basic one aside convincingly. */
  PHYS.resolvePair = function (a, b, restitution) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d2 = dx * dx + dy * dy;
    var r = a.r + b.r;
    if (d2 > r * r || d2 < 1e-9) return 0;

    var d = Math.sqrt(d2);
    var nx = dx / d, ny = dy / d;
    var pen = r - d;

    var ma = a.mass || 1, mb = b.mass || 1;
    var total = ma + mb;

    // Positional correction weighted by mass.
    a.x -= nx * pen * (mb / total);
    a.y -= ny * pen * (mb / total);
    b.x += nx * pen * (ma / total);
    b.y += ny * pen * (ma / total);

    var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    var vn = rvx * nx + rvy * ny;
    if (vn > 0) return 0;

    var e = restitution === undefined ? 0.92 : restitution;
    var j = -(1 + e) * vn / (1 / ma + 1 / mb);

    a.vx -= (j / ma) * nx;
    a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx;
    b.vy += (j / mb) * ny;

    hit.nx = nx; hit.ny = ny;
    hit.px = a.x + nx * a.r;
    hit.py = a.y + ny * a.r;
    return -vn;
  };

  /* ---------- integration ----------------------------------------------- */

  /* Advance one ball. Kept separate from collision so the game can run
   * several small substeps per frame for fast balls. */
  PHYS.integrate = function (ball, dt, gravityScale) {
    ball.vy += PHYS.GRAVITY * (gravityScale === undefined ? 1 : gravityScale) * dt;

    var drag = 1 - PHYS.DRAG * dt;
    ball.vx *= drag;
    ball.vy *= drag;

    var sp2 = ball.vx * ball.vx + ball.vy * ball.vy;
    if (sp2 > PHYS.MAX_SPEED * PHYS.MAX_SPEED) {
      var s = PHYS.MAX_SPEED / Math.sqrt(sp2);
      ball.vx *= s; ball.vy *= s;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  };

  /* How many substeps this frame needs so that nothing moves more than half
   * a ball radius per step. Tunnelling through a wall is the one bug that
   * makes a pinball game feel broken, so we spend cycles here.
   *
   * `maxSpeed` must account for MOVING geometry as well as the balls: a
   * flipper tip sweeps far faster than the ball speed cap, and sizing the
   * step off the balls alone lets the arm jump clean over one. `cap` raises
   * the ceiling for those brief windows (see game.js).
   */
  PHYS.SUBSTEP_CAP = 8;
  PHYS.substeps = function (maxSpeed, minRadius, dt, cap) {
    cap = cap || PHYS.SUBSTEP_CAP;
    var travel = maxSpeed * dt;
    var n = Math.ceil(travel / (minRadius * 0.5));
    return n < 1 ? 1 : (n > cap ? cap : n);
  };

  /* ---------- capsule helpers ------------------------------------------- */

  /* Build a capsule collider. `kind` is a free-form tag the game reads back
   * on collision (e.g. 'wall', 'slope', 'post'). */
  PHYS.capsule = function (ax, ay, bx, by, r, opts) {
    opts = opts || {};
    return {
      shape: 'capsule',
      ax: ax, ay: ay, bx: bx, by: by, r: r,
      restitution: opts.restitution === undefined ? 0.52 : opts.restitution,
      friction: opts.friction === undefined ? 0.04 : opts.friction,
      kind: opts.kind || 'wall',
      minOut: opts.minOut || 0
    };
  };

  PHYS.circle = function (x, y, r, opts) {
    opts = opts || {};
    return {
      shape: 'circle',
      x: x, y: y, r: r,
      restitution: opts.restitution === undefined ? 0.52 : opts.restitution,
      friction: opts.friction === undefined ? 0.02 : opts.friction,
      kind: opts.kind || 'post',
      minOut: opts.minOut || 0
    };
  };

  /* Test a ball against any collider shape. Fills `hit`. */
  PHYS.test = function (ball, col) {
    if (col.shape === 'circle') {
      return PHYS.ballVsCircle(ball.x, ball.y, ball.r, col.x, col.y, col.r);
    }
    return PHYS.ballVsCapsule(ball.x, ball.y, ball.r,
      col.ax, col.ay, col.bx, col.by, col.r);
  };

  /* Velocity of a point on a body rotating about (cx, cy) at `omega` rad/s.
   * Written into the two-element scratch array to stay allocation free. */
  var pv = PHYS.pointVel = [0, 0];
  PHYS.pointVelocity = function (px, py, cx, cy, omega) {
    var rx = px - cx, ry = py - cy;
    pv[0] = -omega * ry;
    pv[1] = omega * rx;
    return pv;
  };

  global.PHYS = PHYS;
})(typeof window !== 'undefined' ? window : this);
