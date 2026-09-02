/* MEGABALL — render.js
 * All canvas drawing, plus hit-testing for the on-canvas HUD and card tray.
 *
 * Drawing the HUD and tray on the canvas (rather than in DOM) keeps every
 * interactive element in the same virtual coordinate space as the table, so
 * the whole game scales as one piece on any phone and the juice layer can
 * shake and flash the UI along with the board.
 *
 * Attaches window.DRAW. Depends on: U, BOARD, ENT, CARDS, LEVELS, GAME, FX, ART.
 */
(function (global) {
  'use strict';

  var U = global.U, BOARD = global.BOARD, ENT = global.ENT,
    CARDS = global.CARDS, LEVELS = global.LEVELS;
  var C = U.C, TAU = U.TAU;

  var DRAW = {};

  var VW = U.VW, VH = U.VH;
  var TRAY_TOP = U.BAND.trayTop;

  /* Viewport: how the 720x1440 virtual board maps onto the real canvas. */
  var vp = DRAW.vp = { scale: 1, ox: 0, oy: 0, w: VW, h: VH, dpr: 1 };

  DRAW.resize = function (canvas) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    var cw = canvas.clientWidth || global.innerWidth;
    var ch = canvas.clientHeight || global.innerHeight;

    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);

    var scale = Math.min(cw / VW, ch / VH);
    vp.scale = scale;
    vp.ox = (cw - VW * scale) / 2;
    vp.oy = (ch - VH * scale) / 2;
    vp.w = cw; vp.h = ch; vp.dpr = dpr;

    if (global.GAME) global.GAME.setViewport(vp);
  };

  /* ---------------------------------------------------------------------- */
  /* Small drawing helpers                                                  */
  /* ---------------------------------------------------------------------- */

  function rr(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  DRAW.rr = rr;

  function text(ctx, str, x, y, size, color, align, weight, spacing) {
    ctx.font = (weight || '700') + ' ' + size + 'px ' + U.FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (spacing) {
      /* Manual letter-spacing: ctx.letterSpacing is not universal. */
      var total = 0, i;
      for (i = 0; i < str.length; i++) total += ctx.measureText(str[i]).width + spacing;
      total -= spacing;
      var cx = align === 'center' ? x - total / 2 : (align === 'right' ? x - total : x);
      ctx.textAlign = 'left';
      for (i = 0; i < str.length; i++) {
        ctx.fillText(str[i], cx, y);
        cx += ctx.measureText(str[i]).width + spacing;
      }
    } else {
      ctx.fillText(str, x, y);
    }
  }
  DRAW.text = text;

  function outlineText(ctx, str, x, y, size, color, align, lw) {
    ctx.font = '800 ' + size + 'px ' + U.FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw || 5;
    ctx.strokeStyle = C.ink;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function capsule(ctx, ax, ay, bx, by, r) {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 2;
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  /* ---------------------------------------------------------------------- */
  /* Table                                                                  */
  /* ---------------------------------------------------------------------- */

  function drawBackground(ctx, S) {
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, VW, VH);

    var art = global.ART;
    var bg = art && art.get ? art.get('bg_table') : null;
    if (bg) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(bg, 0, 0, VW, TRAY_TOP);
      ctx.globalAlpha = 1;
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, TRAY_TOP);
      g.addColorStop(0, '#0d1424');
      g.addColorStop(0.5, C.table);
      g.addColorStop(1, '#070a12');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, TRAY_TOP);
    }

    /* Vignette so the centre of the field is the darkest area — that is what
     * makes a white ball read instantly no matter where it is. */
    var vg = ctx.createRadialGradient(VW / 2, 620, 120, VW / 2, 620, 700);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, TRAY_TOP);

    /* Lane guides from the spawn gates — subtle, but they telegraph where
     * enemies come from. */
    ctx.strokeStyle = U.rgba(C.line, 0.5);
    ctx.lineWidth = 1.5;
    for (var i = 0; i < BOARD.LANES.length; i++) {
      ctx.beginPath();
      ctx.moveTo(BOARD.LANES[i], BOARD.SPAWN_Y);
      ctx.lineTo(BOARD.LANES[i], 250);
      ctx.stroke();
    }
  }

  /* Painted playfield inserts. A real pinball table is never a bare box —
   * the printed artwork is what gives the field structure. These are drawn
   * under everything and are deliberately dim. */
  function drawDecor(ctx, S) {
    var D = BOARD.DECOR;
    if (!D) return;
    ctx.save();
    ctx.lineCap = 'round';

    for (var i = 0; i < D.arcs.length; i++) {
      var a = D.arcs[i];
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, a.a0, a.a1);
      ctx.lineWidth = a.w;
      ctx.strokeStyle = U.rgba(C.cyan, 0.09);
      ctx.stroke();
    }

    ctx.setLineDash([3, 12]);
    for (var l = 0; l < D.lanes.length; l++) {
      var L = D.lanes[l];
      ctx.beginPath();
      ctx.moveTo(L[0], L[1]);
      ctx.lineTo(L[2], L[3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = U.rgba(C.cyan, 0.14);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* Direction-of-attack chevrons above the flipper deck. */
    for (var v = 0; v < D.chevrons.length; v++) {
      var cvx = D.chevrons[v][0], cvy = D.chevrons[v][1];
      ctx.beginPath();
      ctx.moveTo(cvx - 26, cvy - 9);
      ctx.lineTo(cvx, cvy + 5);
      ctx.lineTo(cvx + 26, cvy - 9);
      ctx.lineWidth = 3;
      ctx.strokeStyle = U.rgba(C.magenta, 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRails(ctx, S) {
    var cols = S.table.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.shape === 'circle') {
        // posts / pegs
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, TAU);
        ctx.fillStyle = C.steel;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x - c.r * 0.25, c.y - c.r * 0.3, c.r * 0.3, 0, TAU);
        ctx.fillStyle = U.rgba(C.cyan, 0.5);
        ctx.fill();
      } else {
        var isSling = c.kind === 'sling';
        ctx.strokeStyle = C.ink;
        capsule(ctx, c.ax, c.ay, c.bx, c.by, c.r + 2);
        ctx.strokeStyle = isSling ? C.cyanDeep : C.steel;
        capsule(ctx, c.ax, c.ay, c.bx, c.by, c.r);
        ctx.strokeStyle = isSling ? U.rgba(C.cyan, 0.95) : U.rgba(C.line, 0.9);
        capsule(ctx, c.ax, c.ay, c.bx, c.by, c.r * 0.35);
      }
    }
  }

  function drawSpawnGates(ctx, S) {
    var t = S.time;
    for (var i = 0; i < BOARD.LANES.length; i++) {
      var x = BOARD.LANES[i];
      var y = BOARD.SPAWN_Y - 30;
      ctx.save();
      ctx.strokeStyle = U.rgba(C.magenta, 0.55 + Math.sin(t * 3 + i) * 0.2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 20, y);
      ctx.lineTo(x, y + 14);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDrain(ctx, S) {
    var y = BOARD.DRAIN_Y;
    var pulse = 0.5 + Math.sin(S.time * 4) * 0.12;

    ctx.save();
    var g = ctx.createLinearGradient(0, y - 46, 0, y + 6);
    g.addColorStop(0, U.rgba(C.magenta, 0));
    g.addColorStop(1, U.rgba(C.magenta, 0.32 * pulse * 2));
    ctx.fillStyle = g;
    ctx.fillRect(U.WALL_L, y - 46, U.WALL_R - U.WALL_L, 52);

    ctx.strokeStyle = U.rgba(C.magenta, 0.85);
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 12]);
    ctx.lineDashOffset = -S.time * 30;
    ctx.beginPath();
    ctx.moveTo(U.WALL_L, y);
    ctx.lineTo(U.WALL_R, y);
    ctx.stroke();
    ctx.setLineDash([]);

    /* Barrier card: a solid shield instead of an open drain. */
    if (S.barrierT > 0) {
      var a = U.clamp(S.barrierT, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(C.cyan, 0.9 * a);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(U.WALL_L, y - 4);
      ctx.lineTo(U.WALL_R, y - 4);
      ctx.stroke();
      ctx.fillStyle = U.rgba(C.cyan, 0.14 * a);
      ctx.fillRect(U.WALL_L, y - 30, U.WALL_R - U.WALL_L, 30);
      ctx.globalCompositeOperation = 'source-over';
      for (var i = 0; i < 12; i++) {
        var hx = U.WALL_L + 26 + i * 56;
        ctx.strokeStyle = U.rgba(C.cyan, 0.5 * a);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx, y - 28);
        ctx.lineTo(hx + 12, y - 6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Flippers                                                               */
  /* ---------------------------------------------------------------------- */

  function drawFlipper(ctx, f, px, py, len, rad, dir) {
    var tipX = px + Math.cos(f.angle) * len;
    var tipY = py + Math.sin(f.angle) * len;
    var hot = f.on ? 1 : 0;

    ctx.save();
    /* Glow underlay while active. */
    if (hot) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(C.cyan, 0.28);
      capsule(ctx, px, py, tipX, tipY, rad + 12);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.strokeStyle = C.ink;
    capsule(ctx, px, py, tipX, tipY, rad + 4);

    ctx.strokeStyle = hot ? C.cyan : C.cyanDeep;
    capsule(ctx, px, py, tipX, tipY, rad);

    ctx.strokeStyle = U.rgba(C.white, hot ? 0.85 : 0.4);
    capsule(ctx, px + Math.cos(f.angle) * 12, py + Math.sin(f.angle) * 12, tipX, tipY, rad * 0.34);

    /* Pivot hub. */
    ctx.beginPath();
    ctx.arc(px, py, rad + 6, 0, TAU);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, rad - 1, 0, TAU);
    ctx.fillStyle = hot ? C.cyan : C.steel;
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Towers                                                                 */
  /* ---------------------------------------------------------------------- */

  function drawTower(ctx, t, S) {
    var pop = t.buildT > 0 ? U.ease.outBack(1 - t.buildT / 0.4) : 1;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(pop, pop);
    ctx.translate(-t.x, -t.y);

    if (t.family === 'paddle') drawPaddleTower(ctx, t, S);
    else drawBumperTower(ctx, t, S);

    ctx.restore();
  }

  function drawPaddleTower(ctx, t, S) {
    var d = t.def;
    var tip = ENT.paddleTip(t);
    var hot = t.swingT > 0;
    var oc = S.overchargeT > 0;

    /* Detection ring — only while idle-scanning or selected, so it does not
     * add permanent clutter. */
    if (S.selectedTower === t || S.buildPick) {
      ctx.strokeStyle = U.rgba(d.color, 0.22);
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, d.range, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    if (hot || oc) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(d.color, hot ? 0.3 : 0.15);
      capsule(ctx, t.x, t.y, tip[0], tip[1], t.armRad + 10);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = C.ink;
    capsule(ctx, t.x, t.y, tip[0], tip[1], t.armRad + 3.5);
    ctx.strokeStyle = hot ? d.color : U.mixHex(d.color, C.table, 0.42);
    capsule(ctx, t.x, t.y, tip[0], tip[1], t.armRad);
    ctx.strokeStyle = U.rgba(C.white, hot ? 0.8 : 0.28);
    capsule(ctx, t.x + (tip[0] - t.x) * 0.25, t.y + (tip[1] - t.y) * 0.25, tip[0], tip[1], t.armRad * 0.32);
    ctx.restore();

    /* Base hub with a cooldown wedge so the player can read readiness. */
    ctx.beginPath();
    ctx.arc(t.x, t.y, 17, 0, TAU);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();

    var ready = t.cd <= 0;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 11, 0, TAU);
    ctx.fillStyle = ready ? d.color : U.mixHex(d.color, C.panel, 0.7);
    ctx.fill();

    if (!ready) {
      var frac = 1 - U.clamp(t.cd / d.cd, 0, 1);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.arc(t.x, t.y, 14, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.closePath();
      ctx.fillStyle = U.rgba(d.color, 0.4);
      ctx.fill();
    }

    if (t.type === 'frost') drawGlyphFrost(ctx, t.x, t.y, 7);
    else if (t.type === 'power') drawGlyphBolt(ctx, t.x, t.y, 8);
  }

  function drawBumperTower(ctx, t, S) {
    var d = t.def;
    var pulse = t.pulse > 0 ? t.pulse / 0.28 : 0;
    var r = t.r + pulse * 5;
    var superheated = S.superheatT > 0;

    if (S.selectedTower === t && d.blastR) {
      ctx.strokeStyle = U.rgba(d.color, 0.2);
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, d.blastR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + 12 + pulse * 10, 0, TAU);
    ctx.fillStyle = U.rgba(d.color, 0.1 + pulse * 0.22 + (superheated ? 0.08 : 0));
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, TAU);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(t.x, t.y, r - 5, 0, TAU);
    ctx.lineWidth = 4;
    ctx.strokeStyle = pulse > 0 ? C.white : d.color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(t.x, t.y, r * 0.5, 0, TAU);
    ctx.fillStyle = U.rgba(d.color, 0.25 + pulse * 0.6);
    ctx.fill();

    if (t.type === 'blast') drawGlyphBurst(ctx, t.x, t.y, 9, d.color);
    else if (t.type === 'shock') drawGlyphBolt(ctx, t.x, t.y, 9, d.color);
    else if (t.type === 'launch') drawGlyphArrow(ctx, t.x, t.y, 9, d.color);
    else {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, TAU);
      ctx.fillStyle = C.white;
      ctx.fill();
    }

    /* Ability cooldown arc for the specialised bumpers. */
    if (d.blastCd || d.chainCd) {
      var max = d.blastCd || d.chainCd;
      if (t.abilityCd > 0) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - t.abilityCd / max));
        ctx.lineWidth = 3;
        ctx.strokeStyle = U.rgba(d.color, 0.8);
        ctx.stroke();
      }
    }
  }

  function drawGlyphFrost(ctx, x, y, r) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  function drawGlyphBolt(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x + r * 0.25, y - r);
    ctx.lineTo(x - r * 0.45, y + r * 0.1);
    ctx.lineTo(x + r * 0.05, y + r * 0.1);
    ctx.lineTo(x - r * 0.25, y + r);
    ctx.lineTo(x + r * 0.5, y - r * 0.15);
    ctx.lineTo(x, y - r * 0.15);
    ctx.closePath();
    ctx.fillStyle = color ? C.ink : C.ink;
    ctx.fill();
    if (color) { ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function drawGlyphBurst(ctx, x, y, r) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  function drawGlyphArrow(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.75, y + r * 0.2);
    ctx.lineTo(x + r * 0.3, y + r * 0.2);
    ctx.lineTo(x + r * 0.3, y + r);
    ctx.lineTo(x - r * 0.3, y + r);
    ctx.lineTo(x - r * 0.3, y + r * 0.2);
    ctx.lineTo(x - r * 0.75, y + r * 0.2);
    ctx.closePath();
    ctx.fillStyle = C.ink;
    ctx.fill();
  }

  /* ---------------------------------------------------------------------- */
  /* Build slots                                                            */
  /* ---------------------------------------------------------------------- */

  function drawSlots(ctx, S) {
    var t = S.time;

    /* Idle state: every free mounting point gets a faint marker. This does
     * double duty — it fills what would otherwise be an empty field, and it
     * silently teaches that defenses go on a lattice, before the player has
     * ever opened build mode. */
    if (!S.buildPick) {
      ctx.save();
      ctx.strokeStyle = U.rgba(C.cyan, 0.11);
      ctx.lineWidth = 1.4;
      for (var k = 0; k < S.table.slots.length; k++) {
        var sl = S.table.slots[k];
        if (sl.occupant) continue;
        ctx.beginPath();
        ctx.moveTo(sl.x, sl.y - 8);
        ctx.lineTo(sl.x + 8, sl.y);
        ctx.lineTo(sl.x, sl.y + 8);
        ctx.lineTo(sl.x - 8, sl.y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    var afford = global.GAME.canAfford(S.buildPick);
    for (var i = 0; i < S.table.slots.length; i++) {
      var s = S.table.slots[i];
      if (s.occupant) continue;
      var hover = S.hoverSlot === s;
      var pulse = 0.5 + Math.sin(t * 5 + i * 0.6) * 0.2;
      var col = afford ? C.cyan : C.magenta;

      ctx.beginPath();
      ctx.arc(s.x, s.y, hover ? 30 : 22, 0, TAU);
      ctx.fillStyle = U.rgba(col, (hover ? 0.3 : 0.1) * (0.6 + pulse));
      ctx.fill();
      ctx.lineWidth = hover ? 4 : 2.5;
      ctx.strokeStyle = U.rgba(col, hover ? 1 : 0.55 + pulse * 0.3);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y);
      ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = U.rgba(col, 0.8);
      ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Enemy balls — the readability centrepiece                              */
  /* ---------------------------------------------------------------------- */

  function drawBall(ctx, b, S) {
    var r = b.r;
    var pop = b.spawnT > 0 ? U.ease.outBack(1 - b.spawnT / 0.35) : 1;
    var ow = b.def.outline;
    var emp = b.empowerT > 0;

    var sp = U.len(b.vx, b.vy);
    var vang = sp > 1 ? Math.atan2(b.vy, b.vx) : 0;

    /* Contact shadow. The table is dark but not black, so darkening a disc
     * around the ball lifts it off the playfield and is the single cheapest
     * thing that makes a white circle read as a physical object. */
    ctx.save();
    var sh = ctx.createRadialGradient(b.x, b.y + r * 0.25, r * 0.7,
      b.x, b.y + r * 0.25, r * 2.2);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(b.x, b.y + r * 0.25, r * 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* Motion smear: a short white streak behind a fast ball. Pinball is about
     * speed, and a hard circle with no smear reads as a slow-moving disc. */
    if (sp > 300) {
      var sl = Math.min(r * 2.6, (sp - 300) * 0.055);
      ctx.save();
      ctx.globalAlpha = Math.min(0.34, (sp - 300) / 1900);
      ctx.strokeStyle = C.white;
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 1.15;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(vang) * sl, b.y - Math.sin(vang) * sl);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    if (pop !== 1) ctx.scale(pop, pop);

    /* Velocity stretch. Kept small — enough to feel fast, never so much that
     * the silhouette stops reading as the ball type. */
    if (sp > 260) {
      var k = Math.min(0.34, (sp - 260) / 2600);
      ctx.rotate(vang);
      ctx.scale(1 + k, 1 - k * 0.55);
      ctx.rotate(-vang);
    }

    /* Empowered corona — the ONLY time a ball is allowed to glow hot. */
    if (emp) {
      var f = 0.6 + Math.sin(S.time * 22) * 0.25;
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.6);
      g.addColorStop(0, U.rgba(C.power, 0.55 * f));
      g.addColorStop(0.5, U.rgba(C.powerHot, 0.28 * f));
      g.addColorStop(1, U.rgba(C.powerHot, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.6, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    /* Status ring sits OUTSIDE the black outline so the silhouette is never
     * compromised (docs/CONTRACT.md §3). */
    if (b.slowT > 0 && !emp) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = U.rgba(C.frost, 0.9);
      ctx.stroke();
      for (var i = 0; i < 6; i++) {
        var a = i * TAU / 6 + S.time * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3));
        ctx.lineTo(Math.cos(a) * (r + 11), Math.sin(a) * (r + 11));
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = U.rgba(C.frost, 0.8);
        ctx.stroke();
      }
    }
    if (emp) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.powerHot;
      ctx.stroke();
    }

    /* --- the ball itself: WHITE fill, THICK BLACK outline --------------- */
    ctx.beginPath();
    ctx.arc(0, 0, r - ow / 2, 0, TAU);
    ctx.fillStyle = b.hurtT > 0 ? '#ffd9e6' : C.white;
    ctx.fill();
    ctx.lineWidth = ow;
    ctx.strokeStyle = C.ink;
    ctx.stroke();

    /* Rotation-locked interior so spin is visible. */
    ctx.save();
    ctx.rotate(b.rot);
    drawBallGlyph(ctx, b, r);
    drawCracks(ctx, b, r);
    ctx.restore();

    /* Specular pip — sells the ball as a physical sphere. */
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.34, r * 0.2, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();

    ctx.restore();

    if (b.def.boss) drawBossBar(ctx, b);
    if (b.hurtT > 0) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 4 + (1 - b.hurtT / 0.12) * 8, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = U.rgba(C.magenta, b.hurtT / 0.12);
      ctx.stroke();
    }
  }

  /* Type is read from the silhouette plus a black glyph — never from colour. */
  function drawBallGlyph(ctx, b, r) {
    var g = b.def.glyph;
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = C.ink;
    ctx.lineCap = 'round';

    if (g === 'speed') {
      ctx.lineWidth = r * 0.26;
      for (var i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.28 - r * 0.16, -r * 0.42);
        ctx.lineTo(i * r * 0.28 + r * 0.16, r * 0.42);
        ctx.stroke();
      }
    } else if (g === 'ring') {
      ctx.lineWidth = r * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.52, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, TAU);
      ctx.fill();
    } else if (g === 'plate') {
      var seg = b.armorHp > 0 ? 6 : 0;
      ctx.lineWidth = r * 0.17;
      for (var k = 0; k < 6; k++) {
        if (k >= seg) break;
        var a0 = k * TAU / 6 + 0.1, a1 = (k + 1) * TAU / 6 - 0.1;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.56, a0, a1);
        ctx.stroke();
      }
      if (!seg) {
        ctx.lineWidth = r * 0.16;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.4, 0.4, 0.4 + Math.PI * 1.2);
        ctx.stroke();
      }
    } else if (g === 'split') {
      ctx.lineWidth = r * 0.18;
      ctx.setLineDash([r * 0.22, r * 0.2]);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.6);
      ctx.lineTo(0, r * 0.6);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (g === 'crown') {
      ctx.lineWidth = r * 0.14;
      for (var s = 0; s < 8; s++) {
        var an = s * TAU / 8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(an) * r * 0.28, Math.sin(an) * r * 0.28);
        ctx.lineTo(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, TAU);
      ctx.fill();
    }
  }

  /* Damage reads as black cracks on the white fill — no health bars needed
   * for regular enemies, which keeps the board clean. */
  function drawCracks(ctx, b, r) {
    var frac = b.hp / b.maxHp;
    if (frac > 0.75) return;
    var n = frac > 0.5 ? 1 : (frac > 0.25 ? 2 : 3);
    var seed = b.id * 2654435761 % 1000;
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var a = ((seed + i * 137) % 360) * Math.PI / 180;
      ctx.lineWidth = r * 0.13;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15);
      ctx.lineTo(Math.cos(a + 0.3) * r * 0.55, Math.sin(a + 0.3) * r * 0.55);
      ctx.lineTo(Math.cos(a + 0.1) * r * 0.8, Math.sin(a + 0.1) * r * 0.8);
      ctx.stroke();
    }
  }

  function drawBossBar(ctx, b) {
    var w = 130, h = 9, x = b.x - w / 2, y = b.y - b.r - 26;
    ctx.fillStyle = U.rgba(C.ink, 0.75);
    rr(ctx, x - 3, y - 3, w + 6, h + 6, 5); ctx.fill();
    ctx.fillStyle = U.rgba(C.white, 0.15);
    rr(ctx, x, y, w, h, 4); ctx.fill();
    ctx.fillStyle = C.magenta;
    rr(ctx, x, y, w * U.clamp(b.hp / b.maxHp, 0, 1), h, 4); ctx.fill();
  }

  /* ---------------------------------------------------------------------- */
  /* HUD                                                                    */
  /* ---------------------------------------------------------------------- */

  var hudHits = [];
  var trayHits = [];

  function drawHud(ctx, S) {
    hudHits.length = 0;

    ctx.save();
    var g = ctx.createLinearGradient(0, 0, 0, U.BAND.hud);
    g.addColorStop(0, 'rgba(5,6,13,0.92)');
    g.addColorStop(1, 'rgba(5,6,13,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, U.BAND.hud + 10);

    /* Lives as shield pips — position matters more than the icon: they sit
     * top-left, where the eye lands first. */
    var lx = 30, ly = 46;
    for (var i = 0; i < S.livesMax; i++) {
      var alive = i < S.lives;
      var x = lx + i * 30;
      ctx.beginPath();
      ctx.moveTo(x, ly - 13);
      ctx.lineTo(x + 11, ly - 7);
      ctx.lineTo(x + 11, ly + 4);
      ctx.lineTo(x, ly + 14);
      ctx.lineTo(x - 11, ly + 4);
      ctx.lineTo(x - 11, ly - 7);
      ctx.closePath();
      ctx.fillStyle = alive ? C.magenta : 'rgba(255,255,255,0.09)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = alive ? C.ink : 'rgba(255,255,255,0.16)';
      ctx.stroke();
    }
    text(ctx, 'LIVES', lx - 11, 72, 12, U.rgba(C.white, 0.42), 'left', '700', 2);

    /* Wave counter, centred. */
    if (S.level) {
      var wn = Math.max(1, S.waveIndex + 1);
      text(ctx, 'WAVE ' + wn + ' / ' + S.level.waves.length, VW / 2, 34, 20, C.white, 'center', '800', 1.5);
      text(ctx, S.level.name.toUpperCase(), VW / 2, 58, 12, U.rgba(C.cyan, 0.7), 'center', '700', 3);
    }

    /* Energy, right-aligned, with the amber currency colour. */
    var ex = VW - 96;
    ctx.beginPath();
    ctx.moveTo(ex - 46, 40); ctx.lineTo(ex - 34, 28);
    ctx.lineTo(ex - 38, 40); ctx.lineTo(ex - 28, 40);
    ctx.lineTo(ex - 44, 58); ctx.lineTo(ex - 40, 44);
    ctx.lineTo(ex - 50, 44);
    ctx.closePath();
    ctx.fillStyle = C.amber;
    ctx.fill();
    text(ctx, String(S.energy | 0), ex - 20, 42, 26, C.amber, 'left', '800');
    text(ctx, 'ENERGY', ex - 50, 68, 12, U.rgba(C.white, 0.42), 'left', '700', 2);

    /* Pause. */
    var pb = { x: VW - 58, y: 18, w: 42, h: 42, id: 'pause' };
    rr(ctx, pb.x, pb.y, pb.w, pb.h, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = U.rgba(C.white, 0.8);
    ctx.fillRect(pb.x + 13, pb.y + 12, 5, 18);
    ctx.fillRect(pb.x + 24, pb.y + 12, 5, 18);
    hudHits.push(pb);

    /* Active modifier chips. */
    var chips = [];
    if (S.overchargeT > 0) chips.push(['OVERCHARGE', C.cyan, S.overchargeT]);
    if (S.slowT > 0) chips.push(['SLOW TIME', C.frost, S.slowT]);
    if (S.barrierT > 0) chips.push(['BARRIER', C.cyan, S.barrierT]);
    if (S.magnetT > 0) chips.push(['MAGNET', C.violet, S.magnetT]);
    if (S.superheatT > 0) chips.push(['SUPERHEAT', C.powerHot, S.superheatT]);
    for (var ci = 0; ci < chips.length; ci++) {
      var cy = 92 + ci * 26;
      ctx.font = '800 12px ' + U.FONT;
      var tw = ctx.measureText(chips[ci][0]).width + 22;
      rr(ctx, VW / 2 - tw / 2, cy - 9, tw, 20, 10);
      ctx.fillStyle = U.rgba(chips[ci][1], 0.18); ctx.fill();
      ctx.strokeStyle = U.rgba(chips[ci][1], 0.7); ctx.lineWidth = 1.5; ctx.stroke();
      text(ctx, chips[ci][0], VW / 2, cy + 1, 12, chips[ci][1], 'center', '800', 1);
    }

    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Tray: build buttons + cards                                            */
  /* ---------------------------------------------------------------------- */

  var CELL_W = 104, CELL_H = 132, CELL_Y = 1272, GAP = 8;

  function trayCells(S) {
    /* Six slots across: 2 build buttons + up to 4 cards. Uniform cells keep
     * every touch target the same generous size. */
    var items = [];
    items.push({ kind: 'build', type: 'paddle' });
    items.push({ kind: 'build', type: 'bumper' });
    for (var i = 0; i < S.cards.length && items.length < 6; i++) {
      items.push({ kind: 'card', index: i });
    }
    var n = items.length;
    var total = n * CELL_W + (n - 1) * GAP;
    var x0 = (VW - total) / 2;
    for (var k = 0; k < n; k++) {
      items[k].x = x0 + k * (CELL_W + GAP);
      items[k].y = CELL_Y;
      items[k].w = CELL_W;
      items[k].h = CELL_H;
    }
    return items;
  }

  function drawTray(ctx, S) {
    trayHits.length = 0;

    ctx.save();
    ctx.fillStyle = '#070a13';
    ctx.fillRect(0, TRAY_TOP, VW, VH - TRAY_TOP);
    ctx.strokeStyle = U.rgba(C.cyan, 0.28);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, TRAY_TOP + 1); ctx.lineTo(VW, TRAY_TOP + 1);
    ctx.stroke();

    if (S.selectedTower) { drawUpgradePanel(ctx, S); ctx.restore(); return; }

    var items = trayCells(S);
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'build') drawBuildCell(ctx, S, items[i]);
      else drawCardCell(ctx, S, items[i]);
      trayHits.push(items[i]);
    }
    ctx.restore();
  }

  function drawBuildCell(ctx, S, it) {
    var d = ENT.TOWERS[it.type];
    var afford = S.energy >= d.cost;
    var active = S.buildPick === it.type;

    rr(ctx, it.x, it.y, it.w, it.h, 14);
    ctx.fillStyle = active ? U.rgba(C.cyan, 0.2) : 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = active ? C.cyan : (afford ? U.rgba(C.cyan, 0.35) : 'rgba(255,255,255,0.1)');
    ctx.stroke();

    var cx = it.x + it.w / 2, cy = it.y + 46;
    ctx.save();
    ctx.globalAlpha = afford ? 1 : 0.35;
    if (it.type === 'paddle') {
      ctx.strokeStyle = C.ink;
      capsule(ctx, cx - 24, cy + 12, cx + 22, cy - 8, 11);
      ctx.strokeStyle = C.cyan;
      capsule(ctx, cx - 24, cy + 12, cx + 22, cy - 8, 8);
      ctx.beginPath(); ctx.arc(cx - 24, cy + 12, 8, 0, TAU);
      ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.ink; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy + 2, 24, 0, TAU);
      ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 4.5; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 2, 19, 0, TAU);
      ctx.lineWidth = 3.5; ctx.strokeStyle = C.cyan; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 2, 8, 0, TAU);
      ctx.fillStyle = U.rgba(C.cyan, 0.5); ctx.fill();
    }
    ctx.restore();

    text(ctx, it.type === 'paddle' ? 'PADDLE' : 'BUMPER', cx, it.y + 92, 13,
      afford ? C.white : 'rgba(255,255,255,0.32)', 'center', '800', 1.2);

    ctx.beginPath();
    ctx.moveTo(cx - 26, it.y + 114); ctx.lineTo(cx - 21, it.y + 108);
    ctx.lineTo(cx - 23, it.y + 114); ctx.lineTo(cx - 18, it.y + 114);
    ctx.lineTo(cx - 26, it.y + 123); ctx.lineTo(cx - 24, it.y + 116);
    ctx.lineTo(cx - 29, it.y + 116);
    ctx.closePath();
    ctx.fillStyle = afford ? C.amber : 'rgba(255,176,32,0.35)';
    ctx.fill();
    text(ctx, String(d.cost), cx + 4, it.y + 115, 17,
      afford ? C.amber : 'rgba(255,176,32,0.35)', 'center', '800');
  }

  function drawCardCell(ctx, S, it) {
    var inst = S.cards[it.index];
    var d = inst.def;
    var ready = inst.cd <= 0;
    var frac = ready ? 1 : 1 - inst.cd / inst.cdMax;
    var pulse = inst.readyPulse > 0 ? inst.readyPulse / 0.6 : 0;

    ctx.save();
    if (pulse > 0) {
      ctx.globalCompositeOperation = 'lighter';
      rr(ctx, it.x - 4 * pulse, it.y - 4 * pulse, it.w + 8 * pulse, it.h + 8 * pulse, 16);
      ctx.fillStyle = U.rgba(d.color, 0.25 * pulse);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    rr(ctx, it.x, it.y, it.w, it.h, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    /* Card art, clipped into the cell. */
    var art = global.ART && d.art ? global.ART.get(d.art) : null;
    if (art) {
      ctx.save();
      rr(ctx, it.x + 2, it.y + 2, it.w - 4, it.h - 4, 12);
      ctx.clip();
      ctx.globalAlpha = ready ? 0.92 : 0.32;
      ctx.drawImage(art, it.x + 2, it.y + 2, it.w - 4, it.w - 4);
      ctx.globalAlpha = 1;
      /* Fade the bottom so the name always reads. */
      var lg = ctx.createLinearGradient(0, it.y + it.h - 60, 0, it.y + it.h);
      lg.addColorStop(0, 'rgba(7,10,19,0)');
      lg.addColorStop(1, 'rgba(7,10,19,0.96)');
      ctx.fillStyle = lg;
      ctx.fillRect(it.x, it.y + it.h - 62, it.w, 62);
      ctx.restore();
    } else {
      ctx.save();
      rr(ctx, it.x + 2, it.y + 2, it.w - 4, it.w - 4, 12);
      ctx.clip();
      var rg = ctx.createRadialGradient(it.x + it.w / 2, it.y + it.w / 2, 4,
        it.x + it.w / 2, it.y + it.w / 2, it.w * 0.6);
      rg.addColorStop(0, U.rgba(d.color, ready ? 0.6 : 0.2));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(it.x, it.y, it.w, it.w);
      ctx.restore();
    }

    /* Cooldown sweep: a vertical wipe reads faster than a radial arc at this
     * size, and leaves the art legible. */
    if (!ready) {
      ctx.save();
      rr(ctx, it.x + 2, it.y + 2, it.w - 4, it.h - 4, 12);
      ctx.clip();
      ctx.fillStyle = 'rgba(5,6,13,0.68)';
      ctx.fillRect(it.x, it.y, it.w, it.h * (1 - frac));
      ctx.strokeStyle = U.rgba(d.color, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(it.x, it.y + it.h * (1 - frac));
      ctx.lineTo(it.x + it.w, it.y + it.h * (1 - frac));
      ctx.stroke();
      ctx.restore();
      text(ctx, Math.ceil(inst.cd) + 's', it.x + it.w / 2, it.y + it.w / 2, 26,
        U.rgba(C.white, 0.85), 'center', '800');
    }

    ctx.lineWidth = ready ? 3 : 2;
    ctx.strokeStyle = ready ? U.rgba(d.color, 0.95) : 'rgba(255,255,255,0.12)';
    rr(ctx, it.x, it.y, it.w, it.h, 14);
    ctx.stroke();

    text(ctx, d.name.toUpperCase(), it.x + it.w / 2, it.y + it.h - 30, 12,
      ready ? C.white : 'rgba(255,255,255,0.4)', 'center', '800', 0.6);

    if (inst.levelCard) {
      rr(ctx, it.x + it.w / 2 - 26, it.y + it.h - 18, 52, 14, 7);
      ctx.fillStyle = U.rgba(d.color, 0.22); ctx.fill();
      text(ctx, 'LEVEL', it.x + it.w / 2, it.y + it.h - 11, 9, d.color, 'center', '800', 1.5);
    } else {
      text(ctx, 'TAP TO USE', it.x + it.w / 2, it.y + it.h - 12, 9,
        ready ? U.rgba(d.color, 0.85) : 'rgba(255,255,255,0.22)', 'center', '700', 1);
    }
    ctx.restore();
  }

  /* Upgrade panel replaces the tray while a tower is selected — on a phone
   * that beats a floating popover, which would cover the board. */
  function drawUpgradePanel(ctx, S) {
    var t = S.selectedTower;
    var d = t.def;

    text(ctx, d.name.toUpperCase(), 30, TRAY_TOP + 30, 18, d.color, 'left', '800', 1.5);
    text(ctx, d.blurb, 30, TRAY_TOP + 54, 13, 'rgba(255,255,255,0.55)', 'left', '600');

    var back = { x: VW - 92, y: TRAY_TOP + 14, w: 66, h: 34, id: 'closeTower' };
    rr(ctx, back.x, back.y, back.w, back.h, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, 'CLOSE', back.x + back.w / 2, back.y + back.h / 2, 12, U.rgba(C.white, 0.8), 'center', '800', 1);
    trayHits.push(back);

    var ups = d.upgrades || [];
    var n = ups.length + 1;
    var w = Math.min(150, (VW - 60 - (n - 1) * 10) / n);
    var x0 = 30;
    var y = TRAY_TOP + 76;
    var h = 92;

    for (var i = 0; i < ups.length; i++) {
      var ud = ENT.TOWERS[ups[i]];
      var afford = S.energy >= ud.cost;
      var b = { x: x0 + i * (w + 10), y: y, w: w, h: h, id: 'upgrade', to: ups[i] };
      rr(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = afford ? U.rgba(ud.color, 0.14) : 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = afford ? U.rgba(ud.color, 0.8) : 'rgba(255,255,255,0.1)';
      ctx.stroke();
      text(ctx, ud.name.toUpperCase(), b.x + b.w / 2, b.y + 20, 12,
        afford ? ud.color : 'rgba(255,255,255,0.3)', 'center', '800', 0.8);
      wrapText(ctx, ud.blurb, b.x + b.w / 2, b.y + 42, b.w - 16, 12,
        afford ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.25)');
      text(ctx, ud.cost + ' E', b.x + b.w / 2, b.y + b.h - 14, 15,
        afford ? C.amber : 'rgba(255,176,32,0.3)', 'center', '800');
      trayHits.push(b);
    }

    var sb = { x: x0 + ups.length * (w + 10), y: y, w: w, h: h, id: 'sell' };
    rr(ctx, sb.x, sb.y, sb.w, sb.h, 12);
    ctx.fillStyle = 'rgba(255,46,136,0.1)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = U.rgba(C.magenta, 0.5); ctx.stroke();
    text(ctx, 'SELL', sb.x + sb.w / 2, sb.y + 26, 14, C.magenta, 'center', '800', 1.2);
    text(ctx, '+' + ENT.sellValue(t) + ' E', sb.x + sb.w / 2, sb.y + 54, 16, C.amber, 'center', '800');
    trayHits.push(sb);
  }

  function wrapText(ctx, str, cx, y, maxW, size, color) {
    ctx.font = '600 ' + size + 'px ' + U.FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    var words = str.split(' '), line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    for (var k = 0; k < lines.length && k < 3; k++) {
      ctx.fillText(lines[k], cx, y + k * (size + 3));
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Wave banner (build phase)                                              */
  /* ---------------------------------------------------------------------- */

  /* The build banner is docked to the SPAWN ZONE (y 112-246) — the one band
   * of the table with no tower slots in it. Earlier versions put a big panel
   * across the middle of the field with the START button at y=700, which had
   * two problems: it hid the slot lattice exactly when the player was trying
   * to read it, and the button silently swallowed every placement tap that
   * landed near the centre of the board. Docking it up here keeps the entire
   * build field visible and untouched while you build. */
  var BANNER_Y0 = 112, BANNER_H = 134;
  var readyBtn = { x: 438, y: BANNER_Y0 + 34, w: 224, h: 66, id: 'ready' };

  function drawBanner(ctx, S) {
    var b = S.banner;
    if (!b || S.mode !== 'build') return;

    var t = U.clamp(b.t / 0.35, 0, 1);
    var slide = (1 - U.ease.outCubic(t)) * -40;
    var accent = b.boss ? C.magenta : C.cyan;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, slide);

    rr(ctx, 40, BANNER_Y0, 640, BANNER_H, 16);
    ctx.fillStyle = 'rgba(6,9,18,0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = U.rgba(accent, 0.75);
    ctx.stroke();

    /* Countdown hairline across the top edge of the panel — reads at a glance
     * without needing to parse a number. */
    var wave = S.level.waves[S.waveIndex + 1];
    var frac = wave ? U.clamp(S.buildT / wave.build, 0, 1) : 0;
    ctx.beginPath();
    ctx.moveTo(56, BANNER_Y0 + 2);
    ctx.lineTo(56 + 608 * frac, BANNER_Y0 + 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = U.rgba(accent, 0.9);
    ctx.lineCap = 'round';
    ctx.stroke();

    text(ctx, b.boss ? 'FINAL WAVE' : 'INCOMING', 64, BANNER_Y0 + 30, 12,
      U.rgba(accent, 0.9), 'left', '800', 3.5);

    /* Enemy preview drawn as the actual white balls, so the player learns the
     * silhouettes before they ever arrive. */
    var pv = b.preview;
    var px = 76;
    for (var i = 0; i < pv.length && px < 410; i++) {
      var def = ENT.BALL_TYPES[pv[i].type];
      var r = Math.min(def.boss ? 26 : 19, def.r * 0.72);
      var yy = BANNER_Y0 + 74;
      ctx.beginPath();
      ctx.arc(px, yy, r - def.outline * 0.32, 0, TAU);
      ctx.fillStyle = C.white; ctx.fill();
      ctx.lineWidth = def.outline * 0.66; ctx.strokeStyle = C.ink; ctx.stroke();
      text(ctx, 'x' + pv[i].n, px, yy + r + 16, 13, C.white, 'center', '800');
      text(ctx, def.name.toUpperCase(), px, yy + r + 31, 8,
        U.rgba(C.white, 0.4), 'center', '700', 1);
      px += 78;
    }

    readyBtn.y = BANNER_Y0 + 34;
    rr(ctx, readyBtn.x, readyBtn.y, readyBtn.w, readyBtn.h, 14);
    ctx.fillStyle = U.rgba(accent, 0.2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.stroke();
    text(ctx, 'START', readyBtn.x + readyBtn.w / 2, readyBtn.y + 26, 20, accent, 'center', '800', 2);
    text(ctx, Math.max(0, Math.ceil(S.buildT)) + 's', readyBtn.x + readyBtn.w / 2,
      readyBtn.y + 48, 13, U.rgba(C.white, 0.55), 'center', '800', 1);
    text(ctx, 'BUILD YOUR DEFENSES', readyBtn.x + readyBtn.w / 2, BANNER_Y0 + 116, 9,
      U.rgba(C.white, 0.4), 'center', '700', 2);

    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Toast                                                                  */
  /* ---------------------------------------------------------------------- */

  function drawToast(ctx, S) {
    if (S.toastT <= 0 || !S.toastText) return;
    var a = U.clamp(S.toastT / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '800 15px ' + U.FONT;
    var w = ctx.measureText(S.toastText).width + 44;
    var x = VW / 2 - w / 2, y = 1080;
    rr(ctx, x, y, w, 42, 21);
    ctx.fillStyle = 'rgba(5,6,13,0.9)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = U.rgba(C.cyan, 0.6); ctx.stroke();
    text(ctx, S.toastText, VW / 2, y + 21, 15, C.white, 'center', '800');
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Frame                                                                  */
  /* ---------------------------------------------------------------------- */

  DRAW.frame = function (ctx, S) {
    var FX = global.FX;

    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    ctx.translate(vp.ox, vp.oy);
    ctx.scale(vp.scale, vp.scale);

    /* Screen shake applies to the board only — a shaking HUD is unreadable. */
    var cam = FX && FX.camera ? FX.camera() : null;

    if (!S.table) { ctx.restore(); return; }

    ctx.save();
    if (cam) {
      ctx.translate(VW / 2 + cam.x, 700 + cam.y);
      if (cam.rot) ctx.rotate(cam.rot);
      ctx.translate(-VW / 2, -700);
    }

    drawBackground(ctx, S);
    drawDecor(ctx, S);
    if (FX && FX.drawBelow) FX.drawBelow(ctx);
    drawRails(ctx, S);
    drawSpawnGates(ctx, S);
    drawSlots(ctx, S);

    for (var i = 0; i < S.towers.length; i++) drawTower(ctx, S.towers[i], S);

    drawFlipper(ctx, S.flipL, BOARD.FLIP.lx, BOARD.FLIP.y, BOARD.FLIP.len, BOARD.FLIP.rad, 1);
    drawFlipper(ctx, S.flipR, BOARD.FLIP.rx, BOARD.FLIP.y, BOARD.FLIP.len, BOARD.FLIP.rad, -1);

    for (var b = 0; b < S.balls.length; b++) {
      if (!S.balls[b].dead) drawBall(ctx, S.balls[b], S);
    }

    drawDrain(ctx, S);
    if (FX && FX.drawAbove) FX.drawAbove(ctx);
    ctx.restore();

    /* Mask anything that strays outside the table into the tray band. */
    ctx.fillStyle = C.void;
    ctx.fillRect(0, TRAY_TOP, VW, VH - TRAY_TOP);
    ctx.fillRect(0, 0, U.WALL_L - 8, TRAY_TOP);
    ctx.fillRect(U.WALL_R + 8, 0, VW - U.WALL_R - 8, TRAY_TOP);

    drawBanner(ctx, S);
    drawToast(ctx, S);
    drawHud(ctx, S);
    drawTray(ctx, S);

    ctx.restore();
  };

  /* ---------------------------------------------------------------------- */
  /* Hit testing                                                            */
  /* ---------------------------------------------------------------------- */

  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  DRAW.hitHud = function (x, y) {
    for (var i = 0; i < hudHits.length; i++) {
      if (inRect(x, y, hudHits[i])) {
        if (hudHits[i].id === 'pause') global.GAME.togglePause();
        return true;
      }
    }
    return false;
  };

  DRAW.hitTray = function (x, y) {
    var S = global.GAME.state;
    for (var i = 0; i < trayHits.length; i++) {
      var h = trayHits[i];
      if (!inRect(x, y, h)) continue;
      if (h.id === 'closeTower') { S.selectedTower = null; return true; }
      if (h.id === 'upgrade') { global.GAME.upgradeTower(S.selectedTower, h.to); return true; }
      if (h.id === 'sell') { global.GAME.sellTower(S.selectedTower); return true; }
      if (h.kind === 'build') { global.GAME.pickBuild(h.type); return true; }
      if (h.kind === 'card') { global.GAME.useCard(h.index); return true; }
    }
    return false;
  };

  DRAW.hitBanner = function (x, y) {
    var S = global.GAME.state;
    if (S.mode !== 'build' || !S.banner) return false;
    /* While a defense is being placed the field belongs to placement — the
     * player is aiming, not trying to start the wave. */
    if (S.buildPick) return false;
    return inRect(x, y, readyBtn);
  };

  global.DRAW = DRAW;
})(typeof window !== 'undefined' ? window : this);
