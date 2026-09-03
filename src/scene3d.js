/* MEGABALL — scene3d.js
 * The physical machine, rendered in WebGL with three.js.
 *
 * Everything with mass lives here: the graphite table slab and its aluminium
 * frame, rails, pegs, slingshots, spawn gates, the drain LED strip, the empty
 * mounting slots, every TOWER and both FLIPPERS. Balls, particles and UI stay
 * on the transparent 2D canvas above (render.js) so they remain pin-sharp.
 *
 * Coordinate contract: gameplay is in virtual units (720x1440, y DOWN). World
 * space is (x, -y, z) with z pointing at the camera; the table surface is the
 * plane z = 0. The camera looks straight down that axis, so a point on z = 0
 * lands on exactly the same screen pixel as the 2D layer draws it — that is
 * what lets a 2D ball roll convincingly between 3D bumpers. Objects only gain
 * perspective through their height, which is the depth cue we want.
 *
 * Every geometry here is procedural (primitives, extruded capsules, generated
 * canvas textures): no model files, nothing to load, nothing to fetch.
 *
 * Attaches window.SCENE3D. Depends on: THREE (vendor), U, BOARD, ENT.
 */
(function (global) {
  'use strict';

  var U = global.U, BOARD = global.BOARD;
  var C = U.C;
  var VW = U.VW, VH = U.VH;
  var WL = U.WALL_L, WR = U.WALL_R;
  var TRAY_TOP = U.BAND.trayTop;

  var SCENE3D = {};
  var THREE = null;

  var renderer = null, scene = null, camera = null;
  var pivot = null, board = null;       // shake pivot -> board (virtual space)
  var keyLight = null;
  var vp = { scale: 1, ox: 0, oy: 0, w: VW, h: VH, dpr: 1 };

  /* Camera: a perspective camera whose z = 0 footprint is exactly VW x VH. */
  var FOV = 44;
  var CAM_Z = (VH / 2) / Math.tan(FOV * Math.PI / 360);

  /* Materials are shared, created once. */
  var M = {};
  var ledCache = {};
  var G = {};   // shared geometries

  /* Per-level table meshes, rebuilt when GAME.state.table changes. */
  var tableGroup = null, tableRef = null;

  /* Live tower meshes keyed by tower id. */
  var towerNodes = {};
  var flipL = null, flipR = null;

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  function col(hex) { return new THREE.Color(hex); }

  /* Virtual (x, y) -> world position on the board group. */
  function place(obj, x, y, z) { obj.position.set(x, -y, z || 0); return obj; }

  /* A stadium (capsule outline) as a 2D shape from (0,0) to (len,0). */
  function stadiumShape(len, r) {
    var s = new THREE.Shape();
    s.moveTo(0, -r);
    s.lineTo(len, -r);
    s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, r);
    s.absarc(0, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    return s;
  }

  /* Extruded capsule with a soft bevel — the workhorse for rails, arms and
   * flippers. The result is oriented along +x from its pivot at the origin;
   * callers rotate it by -angle (world y is flipped). */
  function capsuleGeo(len, r, h, bevel) {
    bevel = bevel === undefined ? Math.min(4, r * 0.35) : bevel;
    var g = new THREE.ExtrudeGeometry(stadiumShape(len, r - bevel), {
      depth: h - bevel, bevelEnabled: true, bevelThickness: bevel,
      bevelSize: bevel, bevelSegments: 3, curveSegments: 12, steps: 1
    });
    g.translate(0, 0, bevel * 0.5);
    g.computeVertexNormals();
    return g;
  }

  function capsuleMesh(ax, ay, bx, by, r, h, mat) {
    var len = U.dist(ax, ay, bx, by);
    var m = new THREE.Mesh(capsuleGeo(len, r, h), mat);
    m.rotation.z = -Math.atan2(by - ay, bx - ax);
    place(m, ax, ay, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function roundedRectShape(x, y, w, h, r) {
    var s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h);
    s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r);
    s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  /* Merge one geometry translated to many positions into a single mesh, so a
   * field of 19 pegs or 28 mounting slots costs one draw call. Positions are
   * virtual (x, y). */
  function mergeAt(geo, points, mat) {
    var pos = geo.attributes.position, nor = geo.attributes.normal;
    var idx = geo.index;
    var n = points.length, vc = pos.count;
    var P = new Float32Array(vc * 3 * n), N = new Float32Array(vc * 3 * n);
    var I = new (vc * n > 65535 ? Uint32Array : Uint16Array)(idx.count * n);
    for (var k = 0; k < n; k++) {
      var ox = points[k][0], oy = -points[k][1];
      for (var v = 0; v < vc; v++) {
        var o = (k * vc + v) * 3;
        P[o] = pos.getX(v) + ox; P[o + 1] = pos.getY(v) + oy; P[o + 2] = pos.getZ(v);
        N[o] = nor.getX(v); N[o + 1] = nor.getY(v); N[o + 2] = nor.getZ(v);
      }
      for (var i = 0; i < idx.count; i++) I[k * idx.count + i] = idx.getX(i) + k * vc;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /* Cylinder standing on the table (axis along z), base at z = 0. */
  function postGeo(r, h, rTop) {
    var g = new THREE.CylinderGeometry(rTop === undefined ? r : rTop, r, h, 24, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  }

  function ringGeo(r, tube) {
    var g = new THREE.TorusGeometry(r, tube, 8, 40);
    return g;
  }

  /* LED material per colour — emissive plastic that reads through ACES. */
  function led(hex, intensity) {
    var key = hex + ':' + (intensity || 1);
    var m = ledCache[key];
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: col(hex).multiplyScalar(0.25),
        emissive: col(hex), emissiveIntensity: intensity || 1,
        roughness: 0.4, metalness: 0
      });
      ledCache[key] = m;
    }
    return m;
  }

  /* ---------------------------------------------------------------------- */
  /* Generated textures                                                     */
  /* ---------------------------------------------------------------------- */

  /* The playfield print: matte graphite with faint PCB traces, lane marks and
   * a soft vignette that keeps the centre of the field darkest — a white ball
   * must read instantly wherever it is. Drawn once at boot. */
  function playfieldTexture() {
    var w = 720, h = 1190, top = 60;   // covers virtual y 60..1250
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d1424');
    g.addColorStop(0.5, C.table);
    g.addColorStop(1, '#070a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* Fine speckle so the surface reads as material, not flat paint. */
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    var seed = 1234567;
    for (var i = 0; i < d.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      var n = ((seed >>> 16) & 255) / 255 - 0.5;
      d[i] += n * 9; d[i + 1] += n * 9; d[i + 2] += n * 10;
    }
    ctx.putImageData(img, 0, 0);

    /* Circuit-trace print in the player's cyan: orthogonal runs with bends
     * and round pads, dim enough to stay under the gameplay pieces. */
    var rng = U.rng(77);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var t = 0; t < 46; t++) {
      var x = WL + 30 + rng() * (WR - WL - 60), y = 200 - top + rng() * 900;
      var dir = rng() < 0.5 ? 1 : -1;
      ctx.strokeStyle = 'rgba(63,224,255,' + (0.05 + rng() * 0.05) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      var segs = 2 + Math.floor(rng() * 3);
      for (var s = 0; s < segs; s++) {
        var L = 30 + rng() * 110;
        if (s % 2 === 0) y += L * (rng() < 0.5 ? 1 : -1); else x += L * dir;
        x = U.clamp(x, WL + 20, WR - 20); y = U.clamp(y, 120, 1000);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(63,224,255,0.12)';
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, U.TAU); ctx.fill();
      ctx.fillStyle = C.table;
      ctx.beginPath(); ctx.arc(x, y, 1.3, 0, U.TAU); ctx.fill();
    }

    /* Structural print: two large arcs and the centre ring (BOARD.DECOR). */
    ctx.strokeStyle = 'rgba(63,224,255,0.11)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(360, 250 - top, 250, 0.18, Math.PI - 0.18); ctx.stroke();
    ctx.beginPath(); ctx.arc(360, 980 - top, 300, Math.PI + 0.35, -0.35); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(360, 600 - top, 168, 0, U.TAU); ctx.stroke();

    /* Lane hairlines from the spawn gates. */
    ctx.setLineDash([4, 10]);
    ctx.strokeStyle = 'rgba(63,224,255,0.16)';
    ctx.lineWidth = 1.5;
    for (var l = 0; l < BOARD.LANES.length; l++) {
      ctx.beginPath();
      ctx.moveTo(BOARD.LANES[l], BOARD.SPAWN_Y - top);
      ctx.lineTo(BOARD.LANES[l], 250 - top);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* Drain approach: chevrons and a darker apron so the exit reads as the
     * dangerous end of the table. */
    var ap = ctx.createLinearGradient(0, 1080 - top, 0, 1250 - top);
    ap.addColorStop(0, 'rgba(0,0,0,0)');
    ap.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = ap;
    ctx.fillRect(WL, 1080 - top, WR - WL, 170);
    ctx.strokeStyle = 'rgba(255,46,136,0.22)';
    ctx.lineWidth = 3;
    for (var v = 0; v < 2; v++) {
      var cy = 962 + v * 30 - top;
      ctx.beginPath();
      ctx.moveTo(334, cy - 9); ctx.lineTo(360, cy + 5); ctx.lineTo(386, cy - 9);
      ctx.stroke();
    }

    /* Vignette. */
    var vg = ctx.createRadialGradient(360, 620 - top, 140, 360, 620 - top, 760);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /* A tiny gradient cubemap used as the environment, so aluminium and
   * polycarbonate pick up a believable studio reflection without any image
   * asset. Top face bright (softbox), sides graded, floor dark. */
  function studioEnvironment() {
    var faces = [];
    var size = 32;
    for (var f = 0; f < 6; f++) {
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var ctx = cv.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, size);
      if (f === 2) {          // +y: overhead softbox, cool white
        g.addColorStop(0, '#e6f4ff'); g.addColorStop(1, '#8fb4d0');
      } else if (f === 3) {   // -y: floor
        g.addColorStop(0, '#141c30'); g.addColorStop(1, '#05060d');
      } else {                // sides: a cyan-tinted arcade room
        g.addColorStop(0, '#9fd6e8'); g.addColorStop(0.55, '#243352'); g.addColorStop(1, '#05060d');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      if (f === 0) {          // +x: one long key-light strip for a highlight
        ctx.fillStyle = 'rgba(200,245,255,0.8)';
        ctx.fillRect(4, 3, 8, 26);
      }
      faces.push(cv);
    }
    var cube = new THREE.CubeTexture(faces);
    cube.colorSpace = THREE.SRGBColorSpace;
    cube.needsUpdate = true;
    return cube;
  }

  /* ---------------------------------------------------------------------- */
  /* Materials                                                              */
  /* ---------------------------------------------------------------------- */

  /* Materials follow the locked art direction (CONTRACT.md §3): a futuristic
   * toy pinball machine. Dark navy plastics, blue-steel metal, and cyan light
   * for everything the player owns. Magenta is reserved for danger. */
  function buildMaterials() {
    M.slab = new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 0.9, metalness: 0.05 });
    M.field = new THREE.MeshStandardMaterial({ map: playfieldTexture(), roughness: 0.78, metalness: 0.1 });
    /* The frame: gloss black-navy toy plastic with a steel-blue bevel. */
    M.frame = new THREE.MeshStandardMaterial({ color: 0x141b2e, roughness: 0.38, metalness: 0.55 });
    M.rail = new THREE.MeshStandardMaterial({ color: col(C.steel), roughness: 0.4, metalness: 0.7 });
    M.alu = new THREE.MeshStandardMaterial({ color: 0x4d5f8a, roughness: 0.35, metalness: 0.85 });
    M.aluDark = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.5, metalness: 0.7 });
    M.rubber = new THREE.MeshStandardMaterial({ color: 0x05060d, roughness: 0.95, metalness: 0 });
    /* "poly" is the player's machinery: deep cyan plastic that the LED strips
     * sit on, so flippers and paddle arms read as cyan-family even unlit. */
    M.poly = new THREE.MeshStandardMaterial({ color: col(C.cyanDeep), roughness: 0.4, metalness: 0.15 });
    M.polyDark = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, roughness: 0.5, metalness: 0.2 });
    M.slot = new THREE.MeshStandardMaterial({ color: 0x121a2c, roughness: 0.6, metalness: 0.5, emissive: col(C.cyan), emissiveIntensity: 0.06 });
    M.slotHole = new THREE.MeshStandardMaterial({ color: 0x030408, roughness: 1, metalness: 0 });
  }

  /* ---------------------------------------------------------------------- */
  /* Static machine (built once)                                            */
  /* ---------------------------------------------------------------------- */

  function buildStatic() {
    var g;

    /* Slab: the body of the table under the print. */
    var slab = new THREE.Mesh(new THREE.BoxGeometry(VW, 1190, 18), M.slab);
    place(slab, VW / 2, 60 + 1190 / 2, -9.2);
    slab.receiveShadow = true;
    board.add(slab);

    /* Playfield print on top of the slab (this is z = 0). */
    var field = new THREE.Mesh(new THREE.PlaneGeometry(VW, 1190), M.field);
    place(field, VW / 2, 60 + 1190 / 2, 0);
    field.receiveShadow = true;
    board.add(field);

    /* Aluminium frame: a rounded ring standing 26 units proud of the print.
     * Its inner edge sits exactly where the wall colliders (r = 8) stop the
     * ball, so what you see is what the ball hits. */
    var outer = roundedRectShape(6, -(TRAY_TOP + 20), VW - 12, TRAY_TOP + 20 - 66, 26);
    var inner = roundedRectShape(WL + 8, -(TRAY_TOP + 4), WR - WL - 16, TRAY_TOP + 4 - (BOARD.CEIL + 8), 44);
    outer.holes.push(inner);
    g = new THREE.ExtrudeGeometry(outer, {
      depth: 22, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 3, curveSegments: 10
    });
    var frame = new THREE.Mesh(g, M.frame);
    frame.castShadow = true;
    frame.receiveShadow = true;
    board.add(frame);

    /* A dark rubber gasket line just inside the frame — the seam between
     * metal and print that every real machine has. */
    var gasket = roundedRectShape(WL + 8, -(TRAY_TOP + 4), WR - WL - 16, TRAY_TOP + 4 - (BOARD.CEIL + 8), 44);
    var gasketInner = roundedRectShape(WL + 12, -TRAY_TOP, WR - WL - 24, TRAY_TOP - (BOARD.CEIL + 12), 40);
    gasket.holes.push(gasketInner);
    var gk = new THREE.Mesh(new THREE.ExtrudeGeometry(gasket, { depth: 3, bevelEnabled: false }), M.rubber);
    board.add(gk);

    /* Cyan edge light along the top of the frame's inner lip — the neon line
     * that makes the machine read as a toy pinball cabinet from the very
     * first frame. Sits at the frame's full height so it is never occluded. */
    var rimOuter = roundedRectShape(WL + 4, -(TRAY_TOP + 8), WR - WL - 8, TRAY_TOP + 8 - (BOARD.CEIL + 4), 46);
    var rimInner = roundedRectShape(WL + 7, -(TRAY_TOP + 5), WR - WL - 14, TRAY_TOP + 5 - (BOARD.CEIL + 7), 44);
    rimOuter.holes.push(rimInner);
    var rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimOuter, { depth: 2, bevelEnabled: false }), led(C.cyan, 1.3));
    rim.position.z = 25.5;
    board.add(rim);

    /* Spawn gates: five aluminium chutes let into the top rail, each with a
     * coral LED slit so the player always knows where the threat enters. */
    for (var i = 0; i < BOARD.LANES.length; i++) {
      var x = BOARD.LANES[i];
      var housing = new THREE.Mesh(new THREE.BoxGeometry(56, 34, 30), M.aluDark);
      place(housing, x, BOARD.CEIL - 2, 15);
      housing.castShadow = true;
      board.add(housing);
      var mouth = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 18), M.slotHole);
      place(mouth, x, BOARD.CEIL + 12, 9);
      board.add(mouth);
      var slit = new THREE.Mesh(new THREE.BoxGeometry(36, 3, 3), led(C.magenta, 1.6));
      place(slit, x, BOARD.CEIL + 19, 19);
      board.add(slit);
    }

    /* Drain: a recessed mouth with a coral LED strip along its lip. */
    var mouthBox = new THREE.Mesh(new THREE.BoxGeometry(WR - WL - 16, 30, 12), M.slotHole);
    place(mouthBox, VW / 2, BOARD.DRAIN_Y + 16, -5);
    board.add(mouthBox);
    var strip = new THREE.Mesh(new THREE.BoxGeometry(WR - WL - 20, 4, 3), led(C.magenta, 1.4));
    place(strip, VW / 2, BOARD.DRAIN_Y, 1.6);
    board.add(strip);
    SCENE3D._drainLed = strip;

    /* Flipper hubs are fixed; the blades are built in buildFlippers. */
    G.hub = postGeo(BOARD.FLIP.rad + 7, 12);
    var hubL = new THREE.Mesh(G.hub, M.alu); place(hubL, BOARD.FLIP.lx, BOARD.FLIP.y, 0); board.add(hubL);
    var hubR = new THREE.Mesh(G.hub, M.alu); place(hubR, BOARD.FLIP.rx, BOARD.FLIP.y, 0); board.add(hubR);
    hubL.castShadow = hubR.castShadow = true;
  }

  function buildFlippers() {
    var F = BOARD.FLIP;
    function make(px) {
      var grp = new THREE.Group();
      var blade = new THREE.Mesh(capsuleGeo(F.len, F.rad, 18, 4), M.poly);
      blade.castShadow = true;
      blade.receiveShadow = true;
      grp.add(blade);
      /* Rubber tip band: the part that actually meets the ball. */
      var tip = new THREE.Mesh(capsuleGeo(F.len * 0.42, F.rad + 0.6, 12, 2), M.rubber);
      tip.position.set(F.len * 0.58, 0, 4);
      grp.add(tip);
      /* LED strip along the blade — lights up while the flipper is held. */
      var strip = new THREE.Mesh(new THREE.BoxGeometry(F.len * 0.6, 3.2, 2.4), led(C.cyan, 0.15));
      strip.position.set(F.len * 0.46, 0, 18.8);
      grp.add(strip);
      /* Pivot cap. */
      var cap = new THREE.Mesh(postGeo(F.rad - 2, 21), M.aluDark);
      grp.add(cap);
      grp.userData.strip = strip;
      place(grp, px, F.y, 0);
      board.add(grp);
      return grp;
    }
    flipL = make(F.lx);
    flipR = make(F.rx);
  }

  /* ---------------------------------------------------------------------- */
  /* Per-level table furniture                                              */
  /* ---------------------------------------------------------------------- */

  function buildTable(table) {
    if (tableGroup) { board.remove(tableGroup); disposeGroup(tableGroup); }
    tableGroup = new THREE.Group();
    tableRef = table;

    var pegs = [], posts = [];
    var cols = table.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.shape === 'circle') {
        (c.kind === 'peg' ? pegs : posts).push([c.x, c.y]);
        continue;
      }
      /* The straight outer walls are the frame itself; everything else is a
       * physical rail. */
      if (c.kind === 'wall') continue;
      if (c.kind === 'sling') {
        var sl = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r, 22, M.poly);
        tableGroup.add(sl);
        var band = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r + 0.8, 8, M.rubber);
        band.position.z = 8;
        tableGroup.add(band);
        var strip = capsuleMesh(c.ax, c.ay, c.bx, c.by, 2.2, 2, led(C.cyan, 1.1));
        strip.position.z = 22.4;
        strip.castShadow = false;
        tableGroup.add(strip);
      } else {
        var rail = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r, 24, M.rail);
        tableGroup.add(rail);
        /* Neon edge along every rail: the 2D table drew rails as steel with a
         * lit centre line, and that is what makes the funnel read at speed. */
        var top = capsuleMesh(c.ax, c.ay, c.bx, c.by, Math.max(2.2, c.r * 0.3), 2, led(C.cyan, 0.9));
        top.position.z = 24.2;
        top.castShadow = false;
        tableGroup.add(top);
      }
    }

    /* Pegs and posts: aluminium pins with a rubber sleeve. One draw call per
     * material thanks to mergeAt. */
    if (pegs.length) {
      tableGroup.add(mergeAt(postGeo(9, 20, 8.2), pegs, M.alu));
      tableGroup.add(mergeAt(sleeveGeo(9.8, 7, 9), pegs, M.rubber));
      /* Lit cap: the cyan pip the 2D table always had, so pegs read as part
       * of the machine rather than as holes in it. */
      var pegCap = mergeAt(sleeveGeo(4.5, 2.2, 20), pegs, led(C.cyan, 1.2));
      pegCap.castShadow = false;
      tableGroup.add(pegCap);
    }
    if (posts.length) {
      tableGroup.add(mergeAt(postGeo(11, 24, 10), posts, M.alu));
      tableGroup.add(mergeAt(sleeveGeo(11.8, 8, 11), posts, M.rubber));
      var postCap = mergeAt(sleeveGeo(5.5, 2.2, 24), posts, led(C.cyan, 1.2));
      postCap.castShadow = false;
      tableGroup.add(postCap);
    }

    /* Mounting slots: a shallow machined disc with a dark centre hole. The
     * lattice silently teaches where defenses go, before build mode opens. */
    var pts = [];
    for (var s = 0; s < table.slots.length; s++) pts.push([table.slots[s].x, table.slots[s].y]);
    if (pts.length) {
      var disc = mergeAt(postGeo(15, 1.6), pts, M.slot);
      disc.castShadow = false;
      tableGroup.add(disc);
      var hole = mergeAt(postGeo(5, 1.9), pts, M.slotHole);
      hole.castShadow = false;
      tableGroup.add(hole);
      var screws = [];
      for (var q = 0; q < pts.length; q++) {
        for (var k = 0; k < 4; k++) {
          var a = k * Math.PI / 2 + Math.PI / 4;
          screws.push([pts[q][0] + Math.cos(a) * 10.5, pts[q][1] + Math.sin(a) * 10.5]);
        }
      }
      var sc = mergeAt(postGeo(1.6, 2.2), screws, M.aluDark);
      sc.castShadow = false;
      tableGroup.add(sc);
    }

    board.add(tableGroup);
  }

  function sleeveGeo(r, h, z0) {
    var g = new THREE.CylinderGeometry(r, r, h, 24, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, z0 + h / 2);
    return g;
  }

  function disposeGroup(grp) {
    grp.traverse(function (o) {
      if (o.geometry && o.geometry !== G.hub) o.geometry.dispose();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Towers                                                                 */
  /* ---------------------------------------------------------------------- */

  function makePaddle(t) {
    var d = t.def;
    var grp = new THREE.Group();

    var base = new THREE.Mesh(postGeo(19, 6, 18), M.aluDark);
    base.castShadow = true; grp.add(base);
    var hub = new THREE.Mesh(postGeo(15, 22, 14), M.alu);
    hub.castShadow = true; grp.add(hub);
    var ring = new THREE.Mesh(ringGeo(12.5, 3), led(d.color, 1));
    ring.position.z = 22.5;
    grp.add(ring);
    /* Ground halo: a flat lit disc under the hub so the tower's colour reads
     * from across the table, the way the 2D glow underlay did. */
    var halo = new THREE.Mesh(postGeo(24, 0.8), led(d.color, 0.35));
    halo.position.z = 0.4;
    grp.add(halo);
    var cap = new THREE.Mesh(postGeo(8, 3), M.polyDark);
    cap.position.z = 22;
    grp.add(cap);

    var arm = new THREE.Group();
    var blade = new THREE.Mesh(capsuleGeo(t.armLen, t.armRad, 14, 3), M.poly);
    blade.castShadow = true; blade.receiveShadow = true;
    blade.position.z = 6;
    arm.add(blade);
    var band = new THREE.Mesh(capsuleGeo(t.armLen * 0.4, t.armRad + 0.6, 9, 1.5), M.rubber);
    band.position.set(t.armLen * 0.6, 0, 8.5);
    arm.add(band);
    var strip = new THREE.Mesh(new THREE.BoxGeometry(t.armLen * 0.55, 2.6, 2), led(d.color, 0.3));
    strip.position.set(t.armLen * 0.5, 0, 20.6);
    arm.add(strip);
    grp.add(arm);

    grp.userData = { arm: arm, ring: ring, strip: strip, kind: 'paddle' };
    place(grp, t.x, t.y, 0);
    return grp;
  }

  function makeBumper(t) {
    var d = t.def;
    var grp = new THREE.Group();
    var r = t.r;

    var base = new THREE.Mesh(postGeo(r + 3, 5, r + 1), M.aluDark);
    base.castShadow = true; grp.add(base);
    var body = new THREE.Mesh(postGeo(r, 14, r - 1.5), M.polyDark);
    body.castShadow = true; body.receiveShadow = true; body.position.z = 4; grp.add(body);
    var ring = new THREE.Mesh(ringGeo(r - 2.5, 3.2), led(d.color, 1));
    ring.position.z = 18.5;
    grp.add(ring);
    var halo = new THREE.Mesh(postGeo(r + 14, 0.8), led(d.color, 0.3));
    halo.position.z = 0.4;
    grp.add(halo);
    /* Domed white cap: the bit that lights up when it fires. */
    var domeG = new THREE.SphereGeometry(r - 5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    domeG.rotateX(Math.PI / 2);
    domeG.scale(1, 1, 0.55);
    var dome = new THREE.Mesh(domeG, M.poly);
    dome.position.z = 18;
    dome.castShadow = true;
    grp.add(dome);
    var pip = new THREE.Mesh(postGeo(4, 2.5), led(d.color, 1.5));
    pip.position.z = 18 + (r - 5) * 0.55 - 0.5;
    grp.add(pip);

    grp.userData = { ring: ring, dome: dome, pip: pip, body: body, kind: 'bumper', r: r };
    place(grp, t.x, t.y, 0);
    return grp;
  }

  function syncTowers(S) {
    var seen = {};
    for (var i = 0; i < S.towers.length; i++) {
      var t = S.towers[i];
      var node = towerNodes[t.id];
      if (!node) {
        node = t.family === 'paddle' ? makePaddle(t) : makeBumper(t);
        towerNodes[t.id] = node;
        board.add(node);
      }
      seen[t.id] = true;

      var pop = t.buildT > 0 ? U.ease.outBack(1 - t.buildT / 0.4) : 1;
      if (pop < 0.02) pop = 0.02;
      node.scale.set(pop, pop, pop);

      var ud = node.userData;
      if (ud.kind === 'paddle') {
        ud.arm.rotation.z = -t.angle;
        var hot = t.swingT > 0;
        var ready = t.cd <= 0;
        var oc = S.overchargeT > 0;
        ud.ring.material = led(t.def.color, ready ? (oc ? 2.4 : 1.4) : 0.3);
        ud.strip.material = led(t.def.color, hot ? 3.2 : (ready ? 0.9 : 0.2));
      } else {
        var pulse = t.pulse > 0 ? t.pulse / 0.28 : 0;
        var sh = S.superheatT > 0;
        node.scale.z = pop * (1 - pulse * 0.18);
        ud.dome.material = pulse > 0.15 ? led(C.white, 0.6 + pulse) : M.poly;
        ud.ring.material = led(t.def.color, 1.3 + pulse * 3 + (sh ? 0.8 : 0));
        ud.pip.material = led(t.def.color, 1.8 + pulse * 3);
      }
    }
    for (var id in towerNodes) {
      if (!seen[id]) {
        board.remove(towerNodes[id]);
        disposeGroup(towerNodes[id]);
        delete towerNodes[id];
      }
    }
  }

  function syncFlippers(S) {
    flipL.rotation.z = -S.flipL.angle;
    flipR.rotation.z = -S.flipR.angle;
    flipL.userData.strip.material = led(C.cyan, S.flipL.on ? 3 : 0.15);
    flipR.userData.strip.material = led(C.cyan, S.flipR.on ? 3 : 0.15);
  }

  /* ---------------------------------------------------------------------- */
  /* Public                                                                 */
  /* ---------------------------------------------------------------------- */

  SCENE3D.active = false;

  /* Create the renderer and the static machine. Returns false (and leaves
   * the 2D fallback in charge) if WebGL is unavailable for any reason. */
  SCENE3D.init = function (canvas) {
    THREE = global.THREE;
    if (!THREE || !canvas) return false;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, alpha: false, stencil: false,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      return false;
    }
    renderer.setClearColor(col(C.void), 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    scene.background = col(C.void);
    scene.environment = studioEnvironment();
    if ('environmentIntensity' in scene) scene.environmentIntensity = 0.42;

    camera = new THREE.PerspectiveCamera(FOV, VW / VH, 200, CAM_Z + 400);
    camera.position.set(VW / 2, -VH / 2, CAM_Z);
    camera.lookAt(VW / 2, -VH / 2, 0);
    scene.add(camera);

    /* Lighting: one warm-neutral key from the upper left with soft shadows,
     * a cool hemisphere fill, and a faint blue kicker from below so metal
     * edges catch the player's colour. */
    var hemi = new THREE.HemisphereLight(0xbfe6ff, 0x05060d, 0.8);
    scene.add(hemi);
    keyLight = new THREE.DirectionalLight(0xf4f9ff, 2.2);
    keyLight.position.set(-260, -140, 1500);
    keyLight.target.position.set(VW / 2, -680, 0);
    scene.add(keyLight.target);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -820;
    keyLight.shadow.camera.right = 820;
    keyLight.shadow.camera.top = 900;
    keyLight.shadow.camera.bottom = -900;
    keyLight.shadow.camera.near = 400;
    keyLight.shadow.camera.far = 2400;
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 1.5;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);
    var kick = new THREE.DirectionalLight(col(C.cyan), 0.5);
    kick.position.set(400, -1500, 600);
    scene.add(kick);
    var kick2 = new THREE.DirectionalLight(col(C.magenta), 0.25);
    kick2.position.set(-500, 200, 500);
    scene.add(kick2);

    /* Shake pivot: the 2D layer rotates about (VW/2, 700) — so do we. */
    pivot = new THREE.Group();
    pivot.position.set(VW / 2, -700, 0);
    board = new THREE.Group();
    board.position.set(-VW / 2, 700, 0);
    pivot.add(board);
    scene.add(pivot);

    buildMaterials();
    buildStatic();
    buildFlippers();

    SCENE3D.active = true;
    return true;
  };

  SCENE3D.resize = function (v) {
    vp = v;
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(v.w, v.h, false);
  };

  var _time = 0;

  /* Draw the machine for this frame. `cam` is FX.camera() or null. */
  SCENE3D.render = function (S, cam, zm) {
    if (!renderer) return;

    if (S && S.table && S.table !== tableRef) buildTable(S.table);
    if (!S || !S.table) {
      if (tableGroup) { board.remove(tableGroup); disposeGroup(tableGroup); tableGroup = null; tableRef = null; }
      for (var id in towerNodes) { board.remove(towerNodes[id]); disposeGroup(towerNodes[id]); delete towerNodes[id]; }
    } else {
      syncTowers(S);
      syncFlippers(S);
      _time = S.time || 0;
      /* Drain strip breathes; brighter while the barrier is up. */
      SCENE3D._drainLed.material = S.barrierT > 0
        ? led(C.cyan, 2.2)
        : led(C.magenta, 1.1 + Math.sin(_time * 4) * 0.35);
    }

    /* `zm` (optional, from TUT.cam()) is a zoom about focal (fx,fy) that lands
     * on screen anchor (ax,ay). The 2D layer applies the identical transform
     * (translate anchor → rotate → scale → translate -focal), so the pivot
     * carries anchor+scale+rotation and the board inside carries -focal. */
    var zfx = zm ? zm.fx : VW / 2, zfy = zm ? zm.fy : 700;
    var zax = zm ? zm.ax : VW / 2, zay = zm ? zm.ay : 700;
    var zs = zm ? zm.zoom : 1;
    pivot.position.set(zax + (cam ? cam.x : 0), -(zay + (cam ? cam.y : 0)), 0);
    pivot.rotation.z = -((cam && cam.rot) || 0);
    pivot.scale.set(zs, zs, zs);
    board.position.set(-zfx, zfy, 0);

    /* Letterbox: clear the whole canvas, then draw into the same rectangle
     * the 2D layer uses so both layers share one pixel grid. */
    var w = VW * vp.scale, h = VH * vp.scale;
    var x = vp.ox, y = vp.h - (vp.oy + h);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, vp.w, vp.h);
    renderer.clear(true, true, false);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
  };

  /* Renderer statistics for the last frame (draw calls, triangles). Used by
   * the playtest tooling to keep the mobile budget honest. */
  SCENE3D.stats = function () {
    if (!renderer) return null;
    var r = renderer.info.render, m = renderer.info.memory;
    return { calls: r.calls, triangles: r.triangles, geometries: m.geometries, textures: m.textures };
  };

  global.SCENE3D = SCENE3D;
})(typeof window !== 'undefined' ? window : this);
