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
  var vp = DRAW.vp = {
    scale: 1, scaleX: 1, scaleY: 1, ox: 0, oy: 0, w: VW, h: VH, dpr: 1,
    /* Virtual y at the top and bottom screen edges, and how far the HUD and
     * tray bands have been pushed out to use spare height (see resize). */
    viewTop: U.VIEW_TOP, viewBottom: VH, hudShift: 0, trayShift: 0
  };

  DRAW.resize = function (canvas) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    var cw = canvas.clientWidth || global.innerWidth;
    var ch = canvas.clientHeight || global.innerHeight;

    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);

    /* Fitting the board onto a real viewport.
     *
     * The scale is uniform: the board is never stretched, so a ball is a
     * circle on every phone. What varies is how much cabinet is shown.
     *
     *  - A short viewport (desktop, landscape, a phone with browser chrome)
     *    is height-limited: it shows y = VIEW_TOP..VH and gets slim side bars.
     *  - A tall phone is width-limited and has spare height. Rather than
     *    black bars, that height becomes machine: the HUD rises into the head
     *    panel above the table (up to U.UI.headMax units, enough to uncover
     *    the spawn gates) and the rest goes to the card tray below, whose
     *    contents scale up to fill it (see trayXform).
     *
     * Every layer honours the result: input divides by scale (game.js
     * toVirtual), the HUD and tray read hudShift / trayShift from here, and
     * the WebGL layer opens its frustum to the same viewTop..viewBottom band
     * (scene3d.js), so the 3D machine and the 2D balls stay registered. */
    var minViewH = VH - U.VIEW_TOP;
    var scale = Math.min(cw / VW, ch / minViewH);
    /* A hidden or not-yet-laid-out canvas reports 0x0; keep the maths
     * finite so the first real resize finds a sane state to overwrite. */
    if (!(scale > 0)) scale = 1;
    var extra = Math.max(0, ch / scale - minViewH);
    var headExtra = Math.min(extra, U.UI.headMax);
    var trayExtra = extra - headExtra;

    vp.scale = vp.scaleX = vp.scaleY = scale;
    vp.viewTop = U.VIEW_TOP - headExtra;
    vp.viewBottom = VH + trayExtra;
    vp.hudShift = -headExtra;
    vp.trayShift = trayExtra;
    vp.ox = (cw - VW * scale) / 2;
    /* oy is where virtual y = 0 lands: the visible band starts at viewTop. */
    vp.oy = -vp.viewTop * scale;
    vp.w = cw; vp.h = ch; vp.dpr = dpr;
    trayXform();

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

  /* The pixel face (src/fonts.js) for readouts and captions, so the canvas
   * UI speaks the same language as the backglass menus. Single weight. */
  var PXF = '"Ken Pixel","Segoe UI",system-ui,sans-serif';
  function ptext(ctx, str, x, y, size, color, align, spacing) {
    ctx.font = size + 'px ' + PXF;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (spacing) {
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
  DRAW.ptext = ptext;

  /* Dot-matrix readouts for the HUD. A string is rasterised through the
   * pixel face into a small bitmap once and painted as dots into a cached
   * canvas, so per frame a readout costs one drawImage. The pixel face draws
   * 14-dot capitals at 16px and 7-dot capitals at 8px. */
  var dmdCache = {}, dmdKeys = [];
  function dmdSprite(str, size, color) {
    var key = str + '|' + size + '|' + color;
    var c = dmdCache[key];
    if (c) return c;
    var off = document.createElement('canvas');
    var o = off.getContext('2d', { willReadFrequently: true });
    o.font = size + 'px ' + PXF;
    var w = Math.ceil(o.measureText(str).width) + 2;
    var h = Math.ceil(size * 0.875) + 2;
    off.width = w; off.height = h;
    o.font = size + 'px ' + PXF;
    o.fillStyle = '#fff'; o.textBaseline = 'alphabetic'; o.textAlign = 'left';
    o.fillText(str, 1, h - 1);
    var px = o.getImageData(0, 0, w, h).data;
    var P = 4;
    var cv = document.createElement('canvas'); cv.width = w * P; cv.height = h * P;
    var g = cv.getContext('2d');
    g.fillStyle = color;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 110) {
          g.beginPath(); g.arc(x * P + P / 2, y * P + P / 2, P * 0.42, 0, TAU); g.fill();
        }
      }
    }
    c = { cv: cv, w: w, h: h };
    dmdCache[key] = c; dmdKeys.push(key);
    if (dmdKeys.length > 48) delete dmdCache[dmdKeys.shift()];
    return c;
  }
  /* Paint a readout with its dots `pitch` units apart, anchored at the top
   * edge and by `align` horizontally. Returns the width drawn. */
  function dmdText(ctx, str, x, y, size, pitch, color, align) {
    var sp = dmdSprite(str, size, color);
    var w = sp.w * pitch, h = sp.h * pitch;
    var dx = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
    ctx.drawImage(sp.cv, dx, y, w, h);
    return w;
  }
  DRAW.dmdText = dmdText;

  /* The unlit dot grid behind every display, as a repeating pattern. */
  var glassPat = null;
  function glassPattern(ctx) {
    if (glassPat) return glassPat;
    var c = document.createElement('canvas'); c.width = c.height = 8;
    var g = c.getContext('2d');
    g.fillStyle = 'rgba(63,224,255,0.13)';
    g.beginPath(); g.arc(4, 4, 1.5, 0, TAU); g.fill();
    glassPat = ctx.createPattern(c, 'repeat');
    return glassPat;
  }

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

  /* Scanlines over the glass, as a repeating pattern. */
  var scanPat = null;
  function scanPattern(ctx) {
    if (scanPat) return scanPat;
    var c = document.createElement('canvas'); c.width = 4; c.height = 3;
    var g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(0, 0, 4, 1);
    scanPat = ctx.createPattern(c, 'repeat');
    return scanPat;
  }

  /* A bezel screw: chrome dot, slot, catchlight. */
  function screw(ctx, x, y) {
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU);
    ctx.fillStyle = C.steel; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.1, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
  }

  /* What the ticker line on the backglass says. Active card effects come
   * first (the player is timing them); otherwise, during the build the next
   * wave and the star challenge take turns, and during a wave it counts the
   * balls still to deal with. Returns [text, colour]. */
  function hudTicker(S) {
    var mods = [];
    if (S.overchargeT > 0) mods.push(['OVERCHARGE ' + Math.ceil(S.overchargeT) + 'S', C.cyan]);
    if (S.slowT > 0) mods.push(['SLOW TIME ' + Math.ceil(S.slowT) + 'S', C.frost]);
    if (S.barrierT > 0) mods.push(['BARRIER ' + Math.ceil(S.barrierT) + 'S', C.cyan]);
    if (S.magnetT > 0) mods.push(['MAGNET ' + Math.ceil(S.magnetT) + 'S', C.violet]);
    if (S.superheatT > 0) mods.push(['SUPERHEAT ' + Math.ceil(S.superheatT) + 'S', C.powerHot]);
    if (mods.length) return mods[Math.floor(S.time * 0.8) % mods.length];

    var dim = 'rgba(63,224,255,0.85)';
    if (S.mode === 'tutorial') return ['TUTORIAL', dim];
    var lv = S.level, GAME = global.GAME, L = global.LEVELS;
    if (S.mode === 'build') {
      var slot = Math.floor(S.time / 2.6) % 2;
      if (slot === 0 && S.banner && S.banner.preview && S.banner.preview.length) {
        var parts = [];
        for (var i = 0; i < S.banner.preview.length; i++) {
          var pv = S.banner.preview[i], def = ENT.BALL_TYPES[pv.type];
          parts.push('X' + pv.n + ' ' + (def ? def.name : pv.type).toUpperCase());
        }
        return [(S.banner.boss ? 'BOSS  ' : 'NEXT  ') + parts.join('  '), S.banner.boss ? C.magenta : '#dffaff'];
      }
      if (lv && lv.challenge && L && GAME && GAME.runSummary) {
        var run = GAME.runSummary(false, false);
        var failed = L.challengeFailed(lv, run);
        var met = !failed && L.challengeMet(lv, run);
        return ['STAR  ' + L.challengeProgress(lv, run) + (failed ? '  LOST' : ''),
          failed ? 'rgba(255,46,136,0.8)' : (met ? C.amber : dim)];
      }
      return ['BUILD PHASE', dim];
    }
    if (S.mode === 'wave') {
      var left = S.waveTimeline ? Math.max(0, S.waveTimeline.length - S.spawnedThisWave) : 0;
      for (var b = 0; b < S.balls.length; b++) if (!S.balls[b].dead) left++;
      return [left > 0 ? left + (left === 1 ? ' BALL LEFT' : ' BALLS LEFT') : 'WAVE CLEAR', '#dffaff'];
    }
    return ['MEGABALL', dim];
  }

  /* The head of the machine is its backglass: one black display plate on
   * the dot grid, running the width of the cabinet, with the lives as insert
   * lamps, the wave and energy as dot-matrix readouts and a cabinet pause
   * button. A tall phone sees more head panel (vp.hudShift < 0): the glass
   * grows to two rows and the spare one carries the ticker, so the extra
   * height reads as display rather than as margin; what is left above it is
   * cabinet. A short viewport keeps the one-row glass lapping the frame top.
   * A pill floating on a grey plate, with margins all round, was the thing
   * that made the in-game view look unlike the menus. */
  function drawHud(ctx, S) {
    hudHits.length = 0;
    var croppedX = Math.max(0, -vp.ox / vp.scale);
    var rightEdge = VW - croppedX;

    ctx.save();
    var top = vp.viewTop;
    var bandBot = 96 + 8 * U.clamp((top + 68) / 100, 0, 1);
    var bandH = bandBot - top;
    var tall = bandH >= 130;
    var sx0 = croppedX + 8, sx1 = rightEdge - 8;
    var sy1 = bandBot - 4;
    var gh = Math.min(sy1 - (top + (tall ? 8 : 2)), tall ? 124 : 66);
    var sy0 = sy1 - gh;
    var gw = sx1 - sx0;
    var rad = tall ? 10 : 8;

    /* The glass: dot grid, scanlines, shadow under the top bezel, a breath
     * of cyan along the bottom edge where it meets the pinstripe. */
    ctx.save();
    rr(ctx, sx0, sy0, gw, gh, rad);
    ctx.fillStyle = 'rgba(3,5,10,0.94)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = glassPattern(ctx);
    ctx.fillRect(sx0, sy0, gw, gh);
    ctx.fillStyle = scanPattern(ctx);
    ctx.fillRect(sx0, sy0, gw, gh);
    var sh = ctx.createLinearGradient(0, sy0, 0, sy0 + 30);
    sh.addColorStop(0, 'rgba(0,0,0,0.6)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(sx0, sy0, gw, 30);
    var lift = ctx.createLinearGradient(0, sy1 - 22, 0, sy1);
    lift.addColorStop(0, 'rgba(63,224,255,0)');
    lift.addColorStop(1, 'rgba(63,224,255,0.07)');
    ctx.fillStyle = lift;
    ctx.fillRect(sx0, sy1 - 22, gw, 22);
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(63,224,255,0.30)';
    rr(ctx, sx0, sy0, gw, gh, rad);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    rr(ctx, sx0 + 3, sy0 + 3, gw - 6, gh - 6, rad - 2);
    ctx.stroke();
    if (tall) {
      screw(ctx, sx0 + 11, sy0 + 11); screw(ctx, sx1 - 11, sy0 + 11);
      screw(ctx, sx0 + 11, sy1 - 11); screw(ctx, sx1 - 11, sy1 - 11);
    }

    /* The readouts are laid out in a 60-unit box (y = 40..100) and docked
     * to the bottom of the glass, nearest the table; the pause hit rect
     * carries the same offset. */
    var shift = sy1 - 4 - 100;
    ctx.save();
    ctx.translate(0, shift);

    /* Lives: insert lamps, top-left where the eye lands first. */
    var lx = croppedX + 42, ly = 56;
    for (var i = 0; i < S.livesMax; i++) {
      var alive = i < S.lives, x = lx + i * 26;
      ctx.beginPath(); ctx.arc(x, ly, 8.5, 0, TAU);
      ctx.fillStyle = alive ? C.magenta : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = alive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.14)';
      ctx.stroke();
      if (alive) {
        ctx.beginPath(); ctx.arc(x - 2.5, ly - 3, 2.6, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      }
    }
    ptext(ctx, 'LIVES', croppedX + 32, 88, 12, 'rgba(143,232,255,0.7)', 'left', 1);

    /* Wave counter in dots, the level name under it. */
    if (S.level) {
      var wn = Math.max(1, S.waveIndex + 1);
      var sub = S.mode === 'tutorial' ? 'TUTORIAL' : S.level.name.toUpperCase();
      var head;
      if (S.level.endless) {
        /* No total to show against: the counter is the score, and the
         * record sits under it so beating it is a live target. */
        var best = global.GAME && global.GAME.progress ? (global.GAME.progress.endlessBest || 0) : 0;
        head = 'WAVE ' + wn;
        sub = best ? 'ENDLESS   BEST ' + best : 'ENDLESS';
      } else {
        head = 'WAVE ' + wn + '/' + S.level.waves.length;
      }
      dmdText(ctx, head, VW / 2, 38, 16, 2.4, '#dffaff', 'center');
      dmdText(ctx, sub, VW / 2, 82, 8, 1.9, 'rgba(63,224,255,0.85)', 'center');
    }

    /* Energy: amber dots with a bolt lamp, label under. */
    var ex = rightEdge - 92;
    var ew = dmdText(ctx, String(S.energy | 0), ex, 38, 16, 2.4, C.amber, 'right');
    ptext(ctx, 'ENERGY', ex, 88, 12, 'rgba(255,210,74,0.7)', 'right', 1);
    var bx = ex - ew - 16, byy = 57;
    ctx.beginPath();
    ctx.moveTo(bx + 3, byy - 12); ctx.lineTo(bx - 6, byy + 2); ctx.lineTo(bx - 1, byy + 2);
    ctx.lineTo(bx - 3, byy + 12); ctx.lineTo(bx + 6, byy - 2); ctx.lineTo(bx + 1, byy - 2);
    ctx.closePath();
    ctx.fillStyle = C.amber;
    ctx.fill();

    /* Pause: a small cabinet button. */
    var pcx = rightEdge - 46, pcy = 62;
    ctx.beginPath(); ctx.arc(pcx, pcy, 22, 0, TAU);
    ctx.fillStyle = '#0a0d18'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(63,224,255,0.55)'; ctx.stroke();
    var pg = ctx.createRadialGradient(pcx, pcy - 6, 2, pcx, pcy, 18);
    pg.addColorStop(0, 'rgba(63,224,255,0.30)');
    pg.addColorStop(1, 'rgba(63,224,255,0.04)');
    ctx.beginPath(); ctx.arc(pcx, pcy, 17, 0, TAU); ctx.fillStyle = pg; ctx.fill();
    ctx.fillStyle = 'rgba(223,248,255,0.9)';
    ctx.fillRect(pcx - 7, pcy - 8, 4.5, 16);
    ctx.fillRect(pcx + 2.5, pcy - 8, 4.5, 16);
    hudHits.push({ x: pcx - 24, y: pcy - 24 + shift, w: 48, h: 48, id: 'pause' });
    ctx.restore();

    if (tall) {
      /* Second row: plate captions in the corners and the ticker between
       * them and the readouts, the way the menu displays carry a label on
       * their bezel and a message on the glass. */
      ptext(ctx, 'MEGABALL', sx0 + 26, sy0 + 13, 9, 'rgba(143,232,255,0.45)', 'left', 1.2);
      var tag = S.mode === 'tutorial' ? 'TUTORIAL'
        : (S.level ? (S.level.endless ? 'ENDLESS' : 'STAGE ' + S.level.id) : '');
      if (tag) ptext(ctx, tag, sx1 - 26, sy0 + 13, 9, 'rgba(143,232,255,0.45)', 'right', 1.2);
      var tk = hudTicker(S);
      var tcy = (sy0 + 20 + shift + 40) / 2;
      dmdText(ctx, tk[0], VW / 2, tcy - 8, 8, 2.2, tk[1], 'center');
    } else {
      /* One-row glass: active modifier chips sit under it, over the frame. */
      var chips = [];
      if (S.overchargeT > 0) chips.push(['OVERCHARGE', C.cyan, S.overchargeT]);
      if (S.slowT > 0) chips.push(['SLOW TIME', C.frost, S.slowT]);
      if (S.barrierT > 0) chips.push(['BARRIER', C.cyan, S.barrierT]);
      if (S.magnetT > 0) chips.push(['MAGNET', C.violet, S.magnetT]);
      if (S.superheatT > 0) chips.push(['SUPERHEAT', C.powerHot, S.superheatT]);
      for (var ci = 0; ci < chips.length; ci++) {
        var cy = sy1 + 16 + ci * 26;
        ctx.font = '12px ' + PXF;
        var tw = ctx.measureText(chips[ci][0]).width + 34;
        rr(ctx, VW / 2 - tw / 2, cy - 10, tw, 21, 10);
        ctx.fillStyle = 'rgba(3,5,10,0.85)'; ctx.fill();
        ctx.strokeStyle = U.rgba(chips[ci][1], 0.7); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(VW / 2 - tw / 2 + 11, cy + 0.5, 3.5, 0, TAU);
        ctx.fillStyle = chips[ci][1]; ctx.fill();
        ptext(ctx, chips[ci][0], VW / 2 + 5, cy + 1, 12, chips[ci][1], 'center', 1);
      }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Tray: build buttons + cards                                            */
  /* ---------------------------------------------------------------------- */

  /* Rogue-like hand: the cards fan out of a chamfered panel in the middle of
   * the apron, and the two build buttons sit either side of it as card piles,
   * the way a deck and a discard pile flank a hand. Cards overlap a little
   * and tilt away from the centre, so four in hand still read as a fan and
   * not a toolbar. */
  var CARD_W = 88, CARD_H = 108, HAND_Y = 1254;
  var PILE_W = 86, PILE_H = 118, PILE_Y = 1250;
  function panelRect() { return { x: 108, y: 1246, w: TX.W - 216, h: VH - 1246 - 6, cut: 16 }; }

  /* Tray transform. The tray is laid out in the 130-unit band at the foot
   * of the board (y = TRAY_TOP..VH). On a tall phone DRAW.resize hands it
   * more room (vp.trayShift); the whole band then scales up by TX.s (capped
   * at U.UI.trayScaleMax) and is centred in the room it has, so the cards
   * get bigger rather than the apron getting emptier. Horizontal layout
   * happens in a TX.W = VW / s wide space, so scaling about x = 0 lands the
   * build piles back on the screen edges. Hit rects are kept in tray space:
   * pickTray maps taps in, trayRects / upgradeRects map rects out. */
  var TX = { s: 1, W: VW, top: TRAY_TOP };
  function trayXform() {
    var bandH = VH - TRAY_TOP + vp.trayShift;
    var s = Math.min(U.UI.trayScaleMax, bandH / (VH - TRAY_TOP));
    TX.s = s;
    TX.W = VW / s;
    TX.top = TRAY_TOP + (bandH - (VH - TRAY_TOP) * s) / 2;
  }
  function applyTrayXform(ctx) {
    ctx.translate(0, TX.top);
    ctx.scale(TX.s, TX.s);
    ctx.translate(0, -TRAY_TOP);
  }
  /* Tray-space rect -> board space, keeping the identifying fields. */
  function trayToBoard(r) {
    var s = TX.s;
    var o = { x: r.x * s, y: TX.top + (r.y - TRAY_TOP) * s, w: r.w * s, h: r.h * s };
    if (r.kind !== undefined) o.kind = r.kind;
    if (r.type !== undefined) o.type = r.type;
    if (r.index !== undefined) o.index = r.index;
    if (r.id !== undefined) o.id = r.id;
    if (r.to !== undefined) o.to = r.to;
    return o;
  }

  function trayCells(S) {
    var items = [];
    var P = panelRect();
    items.push({ kind: 'build', type: 'paddle', x: 12, y: PILE_Y, w: PILE_W, h: PILE_H });
    items.push({ kind: 'build', type: 'bumper', x: TX.W - 12 - PILE_W, y: PILE_Y, w: PILE_W, h: PILE_H });

    var n = Math.min(S.cards.length, 4);
    if (n > 0) {
      /* Spread the hand across the panel; overlap once it will not fit flat. */
      var inner = P.w - 24;
      var step = n > 1 ? Math.min(CARD_W + 6, (inner - CARD_W) / (n - 1)) : 0;
      var total = CARD_W + step * (n - 1);
      var x0 = P.x + (P.w - total) / 2;
      var mid = (n - 1) / 2;
      for (var i = 0; i < n; i++) {
        var k = i - mid;
        items.push({
          kind: 'card', index: i,
          x: x0 + i * step,
          /* A shallow arc: outer cards sit a touch lower, like a held fan. */
          y: HAND_Y + Math.abs(k) * Math.abs(k) * 2,
          w: CARD_W, h: CARD_H,
          rot: k * 0.055
        });
      }
    }
    return items;
  }

  /* Octagon with clipped corners — the same silhouette the DOM menus use. */
  function oct(ctx, x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  }

  /* The hand sits in a well let into the apron glass: darker than the
   * plate, the top edge in shadow, a breath of cyan along the bottom lip and
   * a caption plate breaking the edge, as the menu displays have. It used to
   * be a bright-bordered box sitting on a box. */
  function drawHandPanel(ctx, S) {
    var P = panelRect();
    ctx.save();
    oct(ctx, P.x, P.y, P.w, P.h, P.cut);
    ctx.fillStyle = 'rgba(2,4,9,0.80)';
    ctx.fill();
    ctx.save();
    oct(ctx, P.x, P.y, P.w, P.h, P.cut);
    ctx.clip();
    ctx.fillStyle = glassPattern(ctx);
    ctx.fillRect(P.x, P.y, P.w, P.h);
    var sh = ctx.createLinearGradient(0, P.y, 0, P.y + 28);
    sh.addColorStop(0, 'rgba(0,0,0,0.75)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(P.x, P.y, P.w, 28);
    var lift = ctx.createLinearGradient(0, P.y + P.h - 18, 0, P.y + P.h);
    lift.addColorStop(0, 'rgba(63,224,255,0)');
    lift.addColorStop(1, 'rgba(63,224,255,0.09)');
    ctx.fillStyle = lift;
    ctx.fillRect(P.x, P.y + P.h - 18, P.w, 18);
    ctx.restore();
    oct(ctx, P.x, P.y, P.w, P.h, P.cut);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = U.rgba(C.cyan, 0.24);
    ctx.stroke();

    /* Caption plate on the lip. */
    var lab = 'POWER CARDS';
    ctx.font = '8px ' + PXF;
    var lw = ctx.measureText(lab).width + lab.length * 0.8 + 12;
    var lx = P.x + P.w - P.cut - lw - 2;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(lx, P.y - 5, lw, 10);
    ptext(ctx, lab, lx + lw / 2, P.y + 0.5, 8, 'rgba(143,232,255,0.55)', 'center', 0.8);

    if (!S.cards.length) {
      micro(ctx, 'NO CARDS IN HAND', P.x + P.w / 2, P.y + P.h / 2, CTX3, 'center', 10);
    }
    ctx.restore();
  }

  function drawTray(ctx, S) {
    trayHits.length = 0;

    ctx.save();
    /* The apron plate from the 3D machine shows through here; the 2D
     * fallback has already painted the band void. */
    applyTrayXform(ctx);
    drawHandPanel(ctx, S);

    var items = trayCells(S);
    var held = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      trayHits.push(it);
      if (it.kind === 'build') { drawBuildCell(ctx, S, it); continue; }
      /* A lifted card is drawn last so it rises over its neighbours. */
      if ((S.cards[it.index].lift || 0) > 0.01 && (!held ||
        S.cards[it.index].lift > S.cards[held.index].lift)) {
        if (held) drawCardCell(ctx, S, held);
        held = it;
        continue;
      }
      drawCardCell(ctx, S, it);
    }
    if (held) drawCardCell(ctx, S, held);
    ctx.restore();
  }

  /* A build button drawn as a small pile of cards with the tower on the top
   * one and its price on a plate underneath. */
  function drawBuildCell(ctx, S, it) {
    var d = ENT.TOWERS[it.type];
    var afford = S.energy >= d.cost;
    var active = S.buildPick === it.type;
    var col = C.cyan;

    var cw = it.w - 16, ch = 80;
    var cx0 = it.x + 8, cy0 = it.y + 6;

    ctx.save();
    /* Two cards peeking out underneath. */
    for (var s = 2; s >= 1; s--) {
      rr(ctx, cx0 + s * 3, cy0 - s * 3, cw, ch, 10);
      ctx.fillStyle = s === 2 ? '#0a1020' : '#0e1730';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = active ? U.rgba(col, 0.4) : 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }

    if (active) {
      ctx.shadowColor = U.rgba(col, 0.7);
      ctx.shadowBlur = 18;
    }
    rr(ctx, cx0, cy0, cw, ch, 10);
    var g = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
    g.addColorStop(0, active ? '#12314a' : '#111c33');
    g.addColorStop(1, active ? '#0a1a2c' : '#080c18');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = active ? 2.5 : 1.75;
    ctx.strokeStyle = active ? col : (afford ? U.rgba(col, 0.45) : 'rgba(255,255,255,0.12)');
    ctx.stroke();

    /* Art. */
    var cx = cx0 + cw / 2, cy = cy0 + 30;
    ctx.save();
    ctx.globalAlpha = afford ? 1 : 0.35;
    if (it.type === 'paddle') {
      ctx.strokeStyle = C.ink;
      capsule(ctx, cx - 17, cy + 8, cx + 15, cy - 6, 9);
      ctx.strokeStyle = col;
      capsule(ctx, cx - 17, cy + 8, cx + 15, cy - 6, 6.5);
      ctx.beginPath(); ctx.arc(cx - 17, cy + 8, 6.5, 0, TAU);
      ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy + 1, 17, 0, TAU);
      ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 1, 13, 0, TAU);
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 1, 6, 0, TAU);
      ctx.fillStyle = U.rgba(col, 0.5); ctx.fill();
    }
    ctx.restore();

    /* Name band across the bottom of the top card. */
    rr(ctx, cx0 + 5, cy0 + ch - 24, cw - 10, 18, 6);
    ctx.fillStyle = active ? U.rgba(col, 0.95) : (afford ? U.rgba(col, 0.22) : 'rgba(255,255,255,0.06)');
    ctx.fill();
    micro(ctx, it.type === 'paddle' ? 'PADDLE' : 'BUMPER', cx, cy0 + ch - 14.5,
      active ? 'rgba(0,0,0,0.88)' : (afford ? C.white : 'rgba(255,255,255,0.32)'), 'center', 8.5);

    /* Price under the pile: a bolt lamp and the cost in amber dots, the
     * same readout language as the energy counter on the backglass. */
    var py = cy0 + ch + 8;
    var pc = afford ? C.amber : 'rgba(255,176,32,0.35)';
    var dw = dmdText(ctx, String(d.cost), cx + 7, py, 8, 2.0, pc, 'center');
    var bx = cx + 7 - dw / 2 - 10, by = py + 9;
    ctx.beginPath();
    ctx.moveTo(bx + 2.5, by - 7); ctx.lineTo(bx - 3.5, by + 1); ctx.lineTo(bx - 0.5, by + 1);
    ctx.lineTo(bx - 2.5, by + 7); ctx.lineTo(bx + 3.5, by - 1); ctx.lineTo(bx + 0.5, by - 1);
    ctx.closePath();
    ctx.fillStyle = pc;
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Card faces                                                              */
  /*                                                                         */
  /* One routine draws every card in the game at any size: the small tray    */
  /* cell and the big hold-to-read popout are the same face scaled, so the   */
  /* popout reads as the tray card growing rather than as a separate panel.  */
  /* ---------------------------------------------------------------------- */

  /* Local neutrals. Kept here rather than in a shared table so this block
   * stays self-contained — it is the only part of the tray that needs them. */
  var CTX2 = 'rgba(255,255,255,0.60)';
  var CTX3 = 'rgba(255,255,255,0.36)';
  var CHAIR = 'rgba(255,255,255,0.10)';

  /* Short uppercase caption, matching the tracking used elsewhere in the HUD. */
  function micro(ctx, str, x, y, color, align, size) {
    var sz = (size || 10) + 0.5;
    ptext(ctx, str, x, y, sz, color, align || 'center', sz * 0.06);
  }

  function wrapLines(ctx, str, maxW, size, weight) {
    ctx.font = (weight || '600') + ' ' + size + 'px ' + U.FONT;
    var words = String(str).split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* Shrink a label until it fits rather than clipping it — a card name the
   * player cannot read is worse than one drawn a point smaller. */
  function fitText(ctx, str, maxW, size, weight, spacing) {
    var s = size;
    while (s > 7) {
      ctx.font = (weight || '800') + ' ' + s + 'px ' + U.FONT;
      if (ctx.measureText(str).width + (spacing || 0) * (str.length - 1) <= maxW) break;
      s -= 0.5;
    }
    return s;
  }

  function fitPx(ctx, str, maxW, size, spacing) {
    var s = size;
    while (s > 7) {
      ctx.font = s + 'px ' + PXF;
      if (ctx.measureText(str).width + (spacing || 0) * (str.length - 1) <= maxW) break;
      s -= 0.5;
    }
    return s;
  }

  function cardLayout(R, big) {
    var pad = R.w * 0.055;
    var artW = R.w - pad * 2;
    return {
      pad: pad,
      rad: R.w * 0.115,
      artX: R.x + pad,
      artY: R.y + pad,
      artW: artW,
      /* The tray cell is nearly all picture; the popout gives that height back
       * to the description, which is the whole reason it opened. */
      artH: Math.min(artW * 0.82, R.h * (big ? 0.42 : 0.58)),
      plateH: Math.max(18, Math.min(R.w * 0.20, 44))
    };
  }

  /* A small pill anchored to one end of a centred inner width. */
  function chip(ctx, cx, y, label, color, side, innerW) {
    ctx.font = '10px ' + PXF;
    var w = ctx.measureText(label).width + label.length * 1.33 + 20;
    var x = side === 'right' ? cx + innerW / 2 - w : side === 'center' ? cx - w / 2 : cx - innerW / 2;
    rr(ctx, x, y - 10, w, 20, 10);
    ctx.fillStyle = U.rgba(color, 0.14);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = U.rgba(color, 0.5);
    ctx.stroke();
    micro(ctx, label, x + w / 2, y + 0.5, U.rgba(color, 0.95), 'center', 9.5);
  }

  /* R = {x,y,w,h}. `o` carries runtime state: readiness, cooldown, the hotkey
   * digit, and whether there is room for the long description. */
  function cardFace(ctx, R, def, o) {
    o = o || {};
    var big = !!o.detail;
    var L = cardLayout(R, big);
    var col = def.color;
    var ready = o.ready !== false;

    ctx.save();

    /* Body. */
    var g = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
    g.addColorStop(0, '#101a2e');
    g.addColorStop(1, '#070a13');
    rr(ctx, R.x, R.y, R.w, R.h, L.rad);
    ctx.fillStyle = g;
    ctx.fill();

    /* --- art window ----------------------------------------------------- */
    ctx.save();
    rr(ctx, L.artX, L.artY, L.artW, L.artH, L.rad * 0.6);
    ctx.clip();
    ctx.fillStyle = C.panel;
    ctx.fillRect(L.artX, L.artY, L.artW, L.artH);

    var art = global.ART && def.art ? global.ART.get(def.art) : null;
    if (art && art.width) {
      /* Cover-fit: the source is square, the window is not. */
      var s = Math.max(L.artW / art.width, L.artH / art.height);
      var dw = art.width * s, dh = art.height * s;
      ctx.globalAlpha = ready ? 1 : (big ? 0.82 : 0.4);
      ctx.drawImage(art, L.artX + (L.artW - dw) / 2, L.artY + (L.artH - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      var rg = ctx.createRadialGradient(
        L.artX + L.artW / 2, L.artY + L.artH / 2, 4,
        L.artX + L.artW / 2, L.artY + L.artH / 2, L.artW * 0.62);
      rg.addColorStop(0, U.rgba(col, ready ? 0.55 : 0.18));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(L.artX, L.artY, L.artW, L.artH);
    }

    /* A breath of the card's own colour along the bottom of the window ties
     * the art to the palette without tinting the whole image. */
    var wash = ctx.createLinearGradient(0, L.artY + L.artH * 0.45, 0, L.artY + L.artH);
    wash.addColorStop(0, 'rgba(0,0,0,0)');
    wash.addColorStop(1, U.rgba(col, ready ? 0.32 : (big ? 0.24 : 0.10)));
    ctx.fillStyle = wash;
    ctx.fillRect(L.artX, L.artY, L.artW, L.artH);
    ctx.restore();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CHAIR;
    rr(ctx, L.artX + 0.75, L.artY + 0.75, L.artW - 1.5, L.artH - 1.5, L.rad * 0.6);
    ctx.stroke();

    /* --- name plate ------------------------------------------------------ */
    var py = L.artY + L.artH + L.pad * 0.6;
    rr(ctx, L.artX, py, L.artW, L.plateH, L.rad * 0.42);
    ctx.fillStyle = U.rgba(col, ready ? 0.95 : (big ? 0.8 : 0.32));
    ctx.fill();

    var nm = def.name.toUpperCase();
    var track = big ? 1.6 : 0.7;
    var ns = fitPx(ctx, nm, L.artW - (big ? 22 : 12), big ? 19 : 12, track);
    /* Ink on the accent band: every accent in this palette is bright enough
     * that black out-contrasts white on it. */
    ptext(ctx, nm, L.artX + L.artW / 2, py + L.plateH / 2 + 0.5, ns,
      ready || big ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.5)', 'center', track);

    /* --- body ------------------------------------------------------------ */
    var by = py + L.plateH;
    if (big) {
      var innerW = L.artW - 10;
      var cy = by + 22;

      /* The two facts the player is deciding on: what it costs in time, and
       * whether the card is theirs or on loan from the level. */
      chip(ctx, R.x + R.w / 2, cy, def.cd + 'S COOLDOWN', col, 'left', innerW);
      chip(ctx, R.x + R.w / 2, cy, o.levelCard ? 'LEVEL CARD' : 'SLOT ' + (o.hotkey || 1),
        o.levelCard ? C.green : C.cyan, 'right', innerW);

      var ty = cy + 32;
      var bl = wrapLines(ctx, def.blurb, innerW, 14.5, '700');
      for (var i = 0; i < bl.length; i++) {
        text(ctx, bl[i], R.x + R.w / 2, ty, 14.5, U.rgba(col, 0.95), 'center', '700');
        ty += 19;
      }
      if (def.long) {
        ty += 6;
        var ll = wrapLines(ctx, def.long, innerW, 13, '500');
        for (var j = 0; j < ll.length && j < 4; j++) {
          text(ctx, ll[j], R.x + R.w / 2, ty, 13, CTX2, 'center', '500');
          ty += 17;
        }
      }

      /* Pinned to the bottom, but never allowed to land on the description. */
      micro(ctx, ready ? 'RELEASE TO CLOSE' : 'READY IN ' + Math.ceil(o.cd || 0) + 'S',
        R.x + R.w / 2, Math.max(ty + 4, R.y + R.h - L.pad - 6),
        ready ? CTX3 : U.rgba(col, 0.8), 'center', 10);
    } else {
      var midY = by + (R.y + R.h - by) / 2;
      if (!ready) {
        ptext(ctx, Math.ceil(o.cd || 0) + 'S', R.x + R.w / 2, midY, 15,
          U.rgba(col, 0.9), 'center');
      } else if (o.levelCard) {
        micro(ctx, 'LEVEL', R.x + R.w / 2, midY, U.rgba(C.green, 0.9), 'center', 8.5);
      } else {
        micro(ctx, 'READY', R.x + R.w / 2, midY, U.rgba(col, 0.9), 'center', 8.5);
      }
    }

    /* --- cooldown wipe ---------------------------------------------------- */
    if (!ready && o.frac !== undefined) {
      ctx.save();
      rr(ctx, R.x, R.y, R.w, R.h, L.rad);
      ctx.clip();
      var cut = R.y + R.h * (1 - o.frac);
      ctx.fillStyle = 'rgba(5,6,13,0.6)';
      ctx.fillRect(R.x, R.y, R.w, R.h * (1 - o.frac));
      ctx.strokeStyle = U.rgba(col, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(R.x, cut); ctx.lineTo(R.x + R.w, cut);
      ctx.stroke();
      ctx.restore();
    }

    /* --- hotkey badge ----------------------------------------------------- */
    if (o.hotkey) {
      var bs = Math.max(18, R.w * 0.185);
      var bx = L.artX + (big ? 8 : 5), byy = L.artY + (big ? 8 : 5);
      rr(ctx, bx, byy, bs, bs, bs * 0.32);
      ctx.fillStyle = 'rgba(5,6,13,0.82)';
      ctx.fill();
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = U.rgba(col, ready ? 0.85 : 0.3);
      ctx.stroke();
      ptext(ctx, String(o.hotkey), bx + bs / 2, byy + bs / 2 + 0.5, bs * 0.6,
        ready ? U.rgba(col, 0.95) : CTX3, 'center');
    }

    /* --- frame ------------------------------------------------------------ */
    rr(ctx, R.x, R.y, R.w, R.h, L.rad);
    ctx.lineWidth = ready ? 2 : 1.5;
    ctx.strokeStyle = ready ? U.rgba(col, 0.75) : CHAIR;
    ctx.stroke();

    ctx.restore();
  }

  function drawCardCell(ctx, S, it) {
    var inst = S.cards[it.index];
    var d = inst.def;
    var ready = inst.cd <= 0;
    var pulse = inst.readyPulse > 0 ? inst.readyPulse / 0.6 : 0;
    var lift = inst.lift || 0;

    /* A held card rises out of the tray and grows slightly, so the popout
     * that follows reads as this card lifting rather than a new panel. */
    var gw = it.w * (1 + 0.06 * lift);
    var gh = it.h * (1 + 0.06 * lift);
    var R = {
      x: it.x - (gw - it.w) / 2,
      y: it.y - (gh - it.h) / 2 - 18 * lift,
      w: gw,
      h: gh
    };

    ctx.save();

    /* Fan tilt about the card's bottom edge; a lifted card straightens up. */
    var rot = (it.rot || 0) * (1 - lift);
    if (rot) {
      var px = R.x + R.w / 2, py = R.y + R.h;
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.translate(-px, -py);
    }

    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = -3;
    ctx.shadowOffsetY = 3;
    rr(ctx, R.x, R.y, R.w, R.h, R.w * 0.115);
    ctx.fillStyle = '#070a13';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (pulse > 0) {
      rr(ctx, R.x - 4 * pulse, R.y - 4 * pulse, R.w + 8 * pulse, R.h + 8 * pulse, 16);
      ctx.fillStyle = U.rgba(d.color, 0.18 * pulse);
      ctx.fill();
    }

    if (lift > 0.01) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 22 * lift;
      ctx.shadowOffsetY = 8 * lift;
    }

    cardFace(ctx, R, d, {
      ready: ready,
      cd: inst.cd,
      frac: ready ? 1 : 1 - inst.cd / inst.cdMax,
      levelCard: inst.levelCard,
      hotkey: it.index + 1
    });

    ctx.restore();
  }

  /* Where a held card grows to. Exposed so game.js can hand the animation its
   * source and destination rects without duplicating this layout. */
  DRAW.inspectRect = function () {
    return { x: (VW - 330) / 2, y: 626, w: 330, h: 520 };
  };

  /* The hold-to-read popout. The card grows out of its own tray cell, the
   * board behind it dims, and the simulation is frozen while it is open —
   * reading a card should never cost the player a ball. */
  function drawInspect(ctx, S) {
    var ins = S.inspect;
    if (!ins) return;

    var e = U.ease.outCubic(U.clamp(ins.t / 0.17, 0, 1));

    ctx.save();
    ctx.fillStyle = U.rgba(C.void, 0.8 * e);
    ctx.fillRect(0, -800, VW, VH + 1600);

    var src = trayToBoard(ins.from), dst = ins.to;
    var R = {
      x: U.lerp(src.x, dst.x, e),
      y: U.lerp(src.y, dst.y, e),
      w: U.lerp(src.w, dst.w, e),
      h: U.lerp(src.h, dst.h, e)
    };

    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 40 * e;
    ctx.shadowOffsetY = 14 * e;

    /* The detail copy only exists on the big face, and 11px text scaled up is
     * unreadable mush — so it appears once the card is most of the way there. */
    cardFace(ctx, R, ins.def, {
      ready: ins.ready,
      cd: ins.cd,
      frac: e > 0.55 ? undefined : ins.frac,
      levelCard: ins.levelCard,
      hotkey: ins.hotkey,
      detail: e > 0.55
    });

    ctx.restore();
  }

  /* Upgrade pick. Tapping a tower used to swap the tray for a strip of
   * small buttons; now it is the level-up screen of a roguelike: the table
   * drops to a crawl, the field dims, and the choices arrive as big cards
   * in the middle of the screen, one after another from the bottom edge.
   * Laid out in board space; hit rects are the same rects the painter uses,
   * and DRAW.upgradeRects hands them to the tutorial for its spotlights. */
  var upHits = [];
  var UP_CARD_H = 330, UP_CY = 680;
  function upgradeLayout(t) {
    var d = t.def;
    var ups = d.upgrades || [];
    var n = ups.length;
    var cw = n >= 3 ? 206 : 236, gap = 16;
    var x0 = (VW - (n * cw + (n - 1) * gap)) / 2;
    var y = UP_CY - UP_CARD_H / 2;
    var out = { ups: [], head: y - 96, n: n };
    for (var i = 0; i < n; i++) {
      out.ups.push({ x: x0 + i * (cw + gap), y: y, w: cw, h: UP_CARD_H, id: 'upgrade', to: ups[i] });
    }
    /* SELL and CLOSE share a row under the cards (or sit alone, mid-screen,
     * on a tower that has nothing left to become). */
    var by = n ? y + UP_CARD_H + 30 : UP_CY - 36;
    out.sell = { x: 102, y: by, w: 300, h: 72, id: 'sell' };
    out.back = { x: 418, y: by, w: 200, h: 72, id: 'closeTower' };
    return out;
  }
  DRAW.upgradeRects = function (S) {
    S = S || global.GAME.state;
    if (!S || !S.selectedTower) return null;
    return upgradeLayout(S.selectedTower);
  };
  /* Board-space tap against the open pick; true if a button took it. */
  DRAW.hitUpgrade = function (x, y) {
    for (var i = upHits.length - 1; i >= 0; i--) {
      if (inRect(x, y, upHits[i])) return DRAW.applyTray(upHits[i]);
    }
    return false;
  };

  /* Each option rises from below the screen edge in turn, left to right,
   * overshooting its seat and settling (outBack) -- the level-up pick of a
   * roguelike rather than a panel that is simply there. Applies transform +
   * alpha to the current context; the caller saves and restores. `sel` is
   * the seconds the pick has been open, `i` the option's order. */
  function popIn(ctx, b, sel, i) {
    var p = U.clamp((sel - i * 0.09) / 0.42, 0, 1);
    var e = U.ease.outBack(p);
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var sc = 0.78 + 0.22 * e;
    ctx.translate(cx, cy + (1 - e) * (VH + 60 - b.y));
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, p * 2.5);
  }

  /* The tower's silhouette, big, as the card's art. */
  function towerGlyph(ctx, ud, cx, cy, on) {
    var col = on ? ud.color : 'rgba(255,255,255,0.22)';
    ctx.save();
    ctx.lineCap = 'round';
    if (on) { ctx.shadowColor = ud.color; ctx.shadowBlur = 26; }
    if (ud.family === 'paddle') {
      ctx.translate(cx, cy);
      ctx.rotate(-0.55);
      rr(ctx, -46, -11, 92, 22, 11);
      ctx.fillStyle = U.rgba(col, on ? 0.22 : 0.4); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke();
      ctx.beginPath(); ctx.arc(-46, 0, 8, 0, TAU);
      ctx.fillStyle = col; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, 40, 0, TAU);
      ctx.fillStyle = U.rgba(col, on ? 0.16 : 0.4); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, TAU);
      ctx.lineWidth = 3; ctx.strokeStyle = U.rgba(col, 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU);
      ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
  }

  /* What a tower's cooldown means in words, for the upgrade pick. Paddles
   * have a swing cooldown, the specialised bumpers a re-arm on their ability,
   * plain and launch bumpers are always on. */
  function towerCdLabel(ud) {
    if (ud.family === 'paddle') return ud.cd + 'S SWING CD';
    if (ud.blastCd) return ud.blastCd + 'S BLAST CD';
    if (ud.chainCd) return ud.chainCd + 'S CHAIN CD';
    return 'NO COOLDOWN';
  }

  function drawUpgradeModal(ctx, S) {
    upHits.length = 0;
    var t = S.selectedTower;
    if (!t) return;
    var d = t.def;
    var L = upgradeLayout(t);
    var sel = S.selT || 0;
    var e = U.ease.outCubic(U.clamp(sel / 0.22, 0, 1));

    ctx.save();
    /* The field goes dark under the pick: this is a decision, not a glance. */
    ctx.fillStyle = U.rgba(C.void, 0.8 * e);
    ctx.fillRect(0, -800, VW, VH + 1600);

    /* Heading: what you tapped, and what it does now. */
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(0, (1 - e) * -18);
    ptext(ctx, L.n ? 'CHOOSE AN UPGRADE' : 'DEFENSE', VW / 2, L.head - 40, 12, C.amber, 'center', 3);
    ptext(ctx, d.name.toUpperCase(), VW / 2, L.head, 30, d.color, 'center', 1.5);
    text(ctx, d.blurb, VW / 2, L.head + 34, 14, 'rgba(255,255,255,0.62)', 'center', '600');
    /* The tower's cooldown, and where it is in it right now. */
    var curCd = d.family === 'paddle' ? t.cd : t.abilityCd;
    var curMax = d.family === 'paddle' ? d.cd : (d.blastCd || d.chainCd || 0);
    var hdrLabel = towerCdLabel(d);
    if (curMax && curCd > 0) hdrLabel += '  /  READY IN ' + curCd.toFixed(1) + 'S';
    else if (curMax) hdrLabel += '  /  READY';
    chip(ctx, VW / 2, L.head + 62, hdrLabel, curMax && curCd > 0 ? C.amber : d.color, 'center', 0);
    ctx.restore();

    for (var i = 0; i < L.ups.length; i++) {
      var ud = ENT.TOWERS[L.ups[i].to];
      var b = L.ups[i];
      var afford = S.energy >= ud.cost;
      ctx.save();
      popIn(ctx, b, sel, i);

      /* Plate: dark glass, the option's colour as edge and glow. */
      if (afford) { ctx.shadowColor = U.rgba(ud.color, 0.55); ctx.shadowBlur = 34; }
      rr(ctx, b.x, b.y, b.w, b.h, 22);
      ctx.fillStyle = 'rgba(7,10,20,0.97)'; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = afford ? U.rgba(ud.color, 0.12) : 'rgba(255,255,255,0.03)'; ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = afford ? U.rgba(ud.color, 0.9) : 'rgba(255,255,255,0.14)';
      ctx.stroke();
      /* Header band. */
      ctx.save();
      rr(ctx, b.x, b.y, b.w, b.h, 22); ctx.clip();
      ctx.fillStyle = afford ? U.rgba(ud.color, 0.2) : 'rgba(255,255,255,0.05)';
      ctx.fillRect(b.x, b.y, b.w, 58);
      ctx.restore();
      var nm = ud.name.toUpperCase().split(' ');
      ptext(ctx, nm[0], b.x + b.w / 2, b.y + 22, 17, afford ? ud.color : 'rgba(255,255,255,0.35)', 'center', 1);
      ptext(ctx, nm.slice(1).join(' '), b.x + b.w / 2, b.y + 42, 12, afford ? U.rgba(ud.color, 0.8) : 'rgba(255,255,255,0.28)', 'center', 2);

      towerGlyph(ctx, ud, b.x + b.w / 2, b.y + 128, afford);

      wrapText(ctx, ud.blurb, b.x + b.w / 2, b.y + 196, b.w - 30, 14.5,
        afford ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.28)', 3);

      /* Cooldown readout: how often this tower can act. */
      chip(ctx, b.x + b.w / 2, b.y + b.h - 80, towerCdLabel(ud),
        afford ? ud.color : 'rgba(255,255,255,0.35)', 'center', 0);

      /* Price plate at the foot. */
      rr(ctx, b.x + 16, b.y + b.h - 62, b.w - 32, 46, 12);
      ctx.fillStyle = afford ? 'rgba(255,176,32,0.14)' : 'rgba(255,255,255,0.04)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = afford ? U.rgba(C.amber, 0.7) : 'rgba(255,255,255,0.1)'; ctx.stroke();
      if (afford) {
        ptext(ctx, ud.cost + ' E', b.x + b.w / 2, b.y + b.h - 39, 22, C.amber, 'center', 1);
      } else {
        ptext(ctx, ud.cost + ' E', b.x + b.w / 2, b.y + b.h - 47, 16, 'rgba(255,176,32,0.4)', 'center', 1);
        ptext(ctx, 'NEED ' + (ud.cost - S.energy) + ' MORE', b.x + b.w / 2, b.y + b.h - 29, 10, U.rgba(C.magenta, 0.8), 'center', 2);
      }
      ctx.restore();
      upHits.push(b);
    }

    /* SELL and CLOSE arrive together, last. */
    var sb = L.sell, back = L.back, k = L.ups.length;
    ctx.save();
    popIn(ctx, sb, sel, k);
    rr(ctx, sb.x, sb.y, sb.w, sb.h, 16);
    ctx.fillStyle = 'rgba(40,6,24,0.96)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = U.rgba(C.magenta, 0.75); ctx.stroke();
    ptext(ctx, 'SELL', sb.x + 96, sb.y + sb.h / 2 + 1, 20, C.magenta, 'center', 2);
    ptext(ctx, '+' + ENT.sellValue(t) + ' E', sb.x + sb.w - 86, sb.y + sb.h / 2 + 1, 20, C.amber, 'center', 1);
    ctx.restore();
    upHits.push(sb);

    ctx.save();
    popIn(ctx, back, sel, k);
    rr(ctx, back.x, back.y, back.w, back.h, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.stroke();
    ptext(ctx, 'CLOSE', back.x + back.w / 2, back.y + back.h / 2 + 1, 18, U.rgba(C.white, 0.85), 'center', 2);
    ctx.restore();
    upHits.push(back);

    ctx.restore();
  }

  function wrapText(ctx, str, cx, y, maxW, size, color, maxLines) {
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
    var cap = maxLines || 3;
    for (var k = 0; k < lines.length && k < cap; k++) {
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
    var pulse = 0.5 + 0.5 * Math.sin(S.time * 4);

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, slide);

    /* A dark display plate on the dot grid, like the backbox glass. */
    ctx.save();
    rr(ctx, 40, BANNER_Y0, 640, BANNER_H, 14);
    ctx.fillStyle = 'rgba(3,5,10,0.94)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = glassPattern(ctx);
    ctx.fillRect(40, BANNER_Y0, 640, BANNER_H);
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = U.rgba(accent, 0.55);
    rr(ctx, 40, BANNER_Y0, 640, BANNER_H, 14);
    ctx.stroke();

    /* Countdown hairline across the top edge of the panel: reads at a glance
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

    /* Label with its lamp. */
    ctx.beginPath(); ctx.arc(66, BANNER_Y0 + 28, 8, 0, TAU);
    ctx.fillStyle = U.rgba(accent, 0.18 + 0.18 * pulse); ctx.fill();
    ctx.beginPath(); ctx.arc(66, BANNER_Y0 + 28, 4.5, 0, TAU);
    ctx.fillStyle = accent; ctx.fill();
    ptext(ctx, b.label || (b.boss ? 'FINAL WAVE' : 'INCOMING'), 82, BANNER_Y0 + 28, 13,
      U.rgba(accent, 0.95), 'left', 2);

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
      ptext(ctx, 'X' + pv[i].n, px, yy + r + 16, 13, C.white, 'center');
      ptext(ctx, def.name.toUpperCase(), px, yy + r + 31, 8,
        U.rgba(C.white, 0.45), 'center', 0.5);
      px += 78;
    }

    /* START: the cabinet button, amber like the one on the backglass. */
    var rb = readyBtn;
    rb.y = BANNER_Y0 + 34;
    ctx.lineWidth = 6;
    ctx.strokeStyle = U.rgba(C.amber, 0.10 + 0.22 * pulse);
    rr(ctx, rb.x - 3, rb.y - 3, rb.w + 6, rb.h + 6, 19);
    ctx.stroke();
    rr(ctx, rb.x, rb.y, rb.w, rb.h, 16);
    ctx.fillStyle = '#0a0d18'; ctx.fill();
    var bg = ctx.createRadialGradient(rb.x + rb.w / 2, rb.y + rb.h * 0.25, 4, rb.x + rb.w / 2, rb.y + rb.h / 2, rb.w * 0.6);
    bg.addColorStop(0, '#fff1bf');
    bg.addColorStop(0.35, '#ffcf4a');
    bg.addColorStop(0.75, '#f39316');
    bg.addColorStop(1, '#8f4306');
    rr(ctx, rb.x + 4, rb.y + 4, rb.w - 8, rb.h - 8, 13);
    ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    rr(ctx, rb.x + 16, rb.y + 8, rb.w - 32, 9, 4.5); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = U.rgba(C.amber, 0.45);
    rr(ctx, rb.x, rb.y, rb.w, rb.h, 16); ctx.stroke();
    ptext(ctx, 'START', rb.x + rb.w / 2, rb.y + 27, 24, '#3a1600', 'center', 1);
    ptext(ctx, Math.max(0, Math.ceil(S.buildT)) + 'S', rb.x + rb.w / 2,
      rb.y + 50, 11, 'rgba(90,38,0,0.9)', 'center', 1);
    drawChallengeChip(ctx, S, rb.x, BANNER_Y0 + 104, rb.w);

    ctx.restore();
  }

  /* The third star, tracked live. Slotted under the START button — the one
   * pocket of the banner that is neither preview balls nor placeable slots,
   * so nothing that matters gets covered while the player is building.
   *
   * Only the CHALLENGE is drawn here. The other two objectives are already
   * on screen: the wave counter is the clear, and the lives pips are the
   * leak budget. A third readout of what you can already see is noise, but
   * "you are on your seventh of eight defenses" is not visible anywhere
   * else, and finding that out on the results screen is too late to act. */
  function drawChallengeChip(ctx, S, x, y, w) {
    var lv = S.level;
    if (!lv || !lv.challenge || !global.LEVELS || !global.GAME) return;
    var run = global.GAME.runSummary ? global.GAME.runSummary(false, false) : null;
    if (!run) return;

    var L = global.LEVELS;
    var failed = L.challengeFailed(lv, run);
    var met = !failed && L.challengeMet(lv, run);
    var label = L.challengeProgress(lv, run);
    var col = failed ? C.magenta : (met ? C.amber : C.white);
    var a = failed ? 0.5 : (met ? 1 : 0.55);

    rr(ctx, x, y, w, 26, 8);
    ctx.fillStyle = U.rgba(col, failed ? 0.08 : (met ? 0.16 : 0.05));
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = U.rgba(col, failed ? 0.45 : (met ? 0.8 : 0.22));
    ctx.stroke();

    /* Lamp for the state, then the label. */
    ctx.beginPath(); ctx.arc(x + 14, y + 13, 4, 0, TAU);
    ctx.fillStyle = met ? C.amber : (failed ? C.magenta : 'rgba(255,255,255,0.12)');
    ctx.fill();
    if (!met && !failed) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke(); }
    ptext(ctx, label, x + w / 2 + 8, y + 14, 11, U.rgba(col, a), 'center', 0.6);

  }

  /* ---------------------------------------------------------------------- */
  /* Build-phase nudge                                                      */
  /* ---------------------------------------------------------------------- */

  /* A pulsing amber rim and a bobbing chevron over the build buttons while
   * the player is sitting on spendable Energy and has placed nothing this
   * phase. Drawn here, from the public tray geometry, rather than inside the
   * tray painter — that keeps the tray cells under a single owner. */
  function drawBuildHint(ctx, S) {
    if (S.mode !== 'build' || !S.buildHint || S.selectedTower) return;
    var cells = DRAW.trayRects(S).cells;
    var pulse = 0.5 + 0.5 * Math.sin(S.time * 5);
    var bob = Math.sin(S.time * 5) * 5;

    ctx.save();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.kind !== 'build' || S.energy < ENT.TOWERS[c.type].cost) continue;

      rr(ctx, c.x - 5, c.y - 5, c.w + 10, c.h + 10, 18);
      ctx.lineWidth = 3;
      ctx.strokeStyle = U.rgba(C.amber, 0.3 + 0.55 * pulse);
      ctx.stroke();

      var cx = c.x + c.w / 2, cy = c.y - 20 + bob;
      ctx.beginPath();
      ctx.moveTo(cx - 13, cy - 7);
      ctx.lineTo(cx, cy + 7);
      ctx.lineTo(cx + 13, cy - 7);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = U.rgba(C.amber, 0.55 + 0.45 * pulse);
      ctx.stroke();
    }
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
    ctx.font = '15px ' + PXF;
    var w = ctx.measureText(S.toastText).width + 60;
    var x = VW / 2 - w / 2, y = 1080;
    rr(ctx, x, y, w, 42, 21);
    ctx.fillStyle = 'rgba(3,5,10,0.92)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = U.rgba(C.cyan, 0.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 20, y + 21, 4.5, 0, TAU);
    ctx.fillStyle = C.cyan; ctx.fill();
    ptext(ctx, S.toastText, VW / 2 + 8, y + 22, 15, C.white, 'center');
    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Frame                                                                  */
  /* ---------------------------------------------------------------------- */

  /* When the WebGL layer (src/scene3d.js) is running, the physical machine —
   * table, rails, pegs, towers, flippers — is rendered there and this canvas
   * only paints what must stay crisp on top: balls, FX, highlights and UI.
   * index.html sets this after SCENE3D.init(); false means the 2D fallback
   * paints the whole table itself, exactly as before. */
  DRAW.use3D = false;

  DRAW.frame = function (ctx, S) {
    var FX = global.FX;
    var three = DRAW.use3D ? global.SCENE3D : null;

    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.clearRect(0, 0, vp.w, vp.h);
    if (!three) {
      ctx.fillStyle = C.void;
      ctx.fillRect(0, 0, vp.w, vp.h);
    }

    ctx.save();
    ctx.translate(vp.ox, vp.oy);
    ctx.scale(vp.scaleX || vp.scale, vp.scaleY || vp.scale);

    /* Screen shake applies to the board only — a shaking HUD is unreadable. */
    var cam = FX && FX.camera ? FX.camera() : null;

    if (!S.table) {
      if (three) three.render(S, null);
      ctx.restore();
      return;
    }

    /* Tutorial camera: a zoom about a focal point (fx,fy) that lands on the
     * screen anchor (ax,ay). With no tutorial it is the identity. */
    var zm = (S.mode === 'tutorial' && global.TUT && global.TUT.cam) ? global.TUT.cam() : null;

    /* The 3D layer draws first; it applies the same shake offset and zoom so
     * the two layers never drift apart. */
    if (three) three.render(S, cam, zm);

    ctx.save();
    if (cam || zm) {
      var zfx = zm ? zm.fx : VW / 2, zfy = zm ? zm.fy : 700;
      var zax = zm ? zm.ax : VW / 2, zay = zm ? zm.ay : 700;
      ctx.translate(zax + (cam ? cam.x : 0), zay + (cam ? cam.y : 0));
      if (cam && cam.rot) ctx.rotate(cam.rot);
      if (zm && zm.zoom !== 1) ctx.scale(zm.zoom, zm.zoom);
      ctx.translate(-zfx, -zfy);
    }

    if (!three) {
      drawBackground(ctx, S);
      drawDecor(ctx, S);
    }
    if (FX && FX.drawBelow) FX.drawBelow(ctx);
    if (!three) {
      drawRails(ctx, S);
      drawSpawnGates(ctx, S);
    }
    drawSlots(ctx, S);

    if (!three) {
      for (var i = 0; i < S.towers.length; i++) drawTower(ctx, S.towers[i], S);
      drawFlipper(ctx, S.flipL, BOARD.FLIP.lx, BOARD.FLIP.y, BOARD.FLIP.len, BOARD.FLIP.rad, 1);
      drawFlipper(ctx, S.flipR, BOARD.FLIP.rx, BOARD.FLIP.y, BOARD.FLIP.len, BOARD.FLIP.rad, -1);
    } else {
      drawTowerOverlays(ctx, S);
    }

    /* Balls are clipped to the playfield so one that strays into the bezel
     * never draws over the 3D rails (the 2D fallback masks with paint below). */
    ctx.save();
    ctx.beginPath();
    ctx.rect(U.WALL_L - 8, 0, U.WALL_R - U.WALL_L + 16, TRAY_TOP);
    ctx.clip();
    for (var b = 0; b < S.balls.length; b++) {
      if (!S.balls[b].dead) drawBall(ctx, S.balls[b], S);
    }
    ctx.restore();

    drawDrain(ctx, S);
    if (FX && FX.drawAbove) FX.drawAbove(ctx);
    ctx.restore();

    if (!three) {
      /* Mask anything that strays outside the table into the tray band. */
      ctx.fillStyle = C.void;
      ctx.fillRect(0, TRAY_TOP, VW, VH - TRAY_TOP + 800);
      ctx.fillRect(0, 0, U.WALL_L - 8, TRAY_TOP);
      ctx.fillRect(U.WALL_R + 8, 0, VW - U.WALL_R - 8, TRAY_TOP);
    }

    drawBanner(ctx, S);
    drawToast(ctx, S);
    drawHud(ctx, S);
    drawTray(ctx, S);
    drawBuildHint(ctx, S);
    drawUpgradeModal(ctx, S);
    /* Tutorial overlay sits above the HUD and tray (it points at them) but
     * below an open card popout, which must always win the screen. */
    if (S.mode === 'tutorial' && global.TUT && global.TUT.draw) global.TUT.draw(ctx, S);
    drawInspect(ctx, S);

    ctx.restore();
  };

  /* In 3D mode the tower bodies live in WebGL; the 2D layer adds only the
   * readouts that need to stay pin-sharp: range rings while placing or
   * selected, a selection halo, and ability cooldown arcs. */
  function drawTowerOverlays(ctx, S) {
    for (var i = 0; i < S.towers.length; i++) {
      var t = S.towers[i], d = t.def;
      var sel = S.selectedTower === t;
      if (t.family === 'paddle' && (sel || S.buildPick)) {
        ctx.strokeStyle = U.rgba(d.color, 0.28);
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, d.range, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel && d.blastR) {
        ctx.strokeStyle = U.rgba(d.color, 0.25);
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, d.blastR, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel) {
        ctx.strokeStyle = U.rgba(C.white, 0.9);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(t.x, t.y, (t.family === 'bumper' ? t.r : 22) + 10, 0, TAU);
        ctx.stroke();
      }
      var max = d.blastCd || d.chainCd;
      if (max && t.abilityCd > 0) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - t.abilityCd / max));
        ctx.lineWidth = 3;
        ctx.strokeStyle = U.rgba(d.color, 0.85);
        ctx.stroke();
      }
    }
  }

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

  /* Split into pick and apply so game.js can sit on a press for a moment
   * before committing to it — see the hold-to-inspect flow in pointerDown. */
  /* The tray's current cell rects, for anything that needs to point at one —
   * the onboarding tutorial highlights individual cells. Recomputed from the
   * same layout the renderer uses, so it is correct even before the first
   * frame is painted (unlike the internal hit list, which drawTray rebuilds).
   * `band` is the whole tray strip. */
  DRAW.trayRects = function (S) {
    S = S || global.GAME.state;
    var cells = S && S.cards ? trayCells(S) : [], out = [];
    for (var i = 0; i < cells.length; i++) out.push(trayToBoard(cells[i]));
    return {
      band: { x: 0, y: TRAY_TOP, w: VW, h: VH - TRAY_TOP + vp.trayShift },
      cells: out
    };
  };

  DRAW.pickTray = function (x, y) {
    /* Taps arrive in board space; the hit rects live in tray space. */
    var lx = x / TX.s, ly = TRAY_TOP + (y - TX.top) / TX.s;
    /* Cards overlap in the fan; the later one is drawn on top, so it wins. */
    for (var i = trayHits.length - 1; i >= 0; i--) {
      if (inRect(lx, ly, trayHits[i])) return trayHits[i];
    }
    return null;
  };

  DRAW.applyTray = function (h) {
    if (!h) return false;
    var S = global.GAME.state;
    if (h.id === 'closeTower') { S.selectedTower = null; return true; }
    if (h.id === 'upgrade') { global.GAME.upgradeTower(S.selectedTower, h.to); return true; }
    if (h.id === 'sell') { global.GAME.sellTower(S.selectedTower); return true; }
    if (h.kind === 'build') { global.GAME.pickBuild(h.type); return true; }
    if (h.kind === 'card') { global.GAME.useCard(h.index); return true; }
    return false;
  };

  DRAW.hitTray = function (x, y) {
    return DRAW.applyTray(DRAW.pickTray(x, y));
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
