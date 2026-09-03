/* MEGABALL — scene3d.js
 * The physical machine, rendered in WebGL with three.js.
 *
 * Everything with mass lives here: the table slab and its glossy cabinet
 * frame, chrome rails, pegs, slingshots, spawn gates, the drain LED strip,
 * the mounting slots, every TOWER and both FLIPPERS — plus the light those
 * things throw (a cheap additive glow layer that stands in for bloom).
 * Balls, particles and UI stay on the transparent 2D canvas above
 * (render.js) so they remain pin-sharp.
 *
 * Coordinate contract: gameplay is in virtual units (720x1440, y DOWN). World
 * space is (x, -y, z) with z pointing at the camera; the table surface is the
 * plane z = 0. The camera looks straight down that axis, so a point on z = 0
 * lands on exactly the same screen pixel as the 2D layer draws it — that is
 * what lets a 2D ball roll convincingly between 3D bumpers. Objects only gain
 * perspective through their height, which is the depth cue we want.
 *
 * Every geometry here is procedural (primitives, extruded capsules, generated
 * canvas textures). The only image is the painted playfield print, which is
 * read from ART (already baked into src/assets.js) once it has loaded, so
 * nothing is fetched.
 *
 * Public API (other modules depend on it — keep it):
 *   SCENE3D.init(canvas) -> bool      false = no WebGL, 2D fallback takes over
 *   SCENE3D.resize(vp)
 *   SCENE3D.render(S, cam, zm)        cam = FX.camera(), zm = TUT.cam() zoom
 *   SCENE3D.stats() -> {calls, triangles, geometries, textures}
 *   SCENE3D.active
 *
 * Attaches window.SCENE3D. Depends on: THREE (vendor), U, BOARD, ENT, ART.
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
  var glowCache = {};
  var G = {};   // shared geometries (never disposed)
  var T = {};   // shared textures

  /* Per-level table meshes, rebuilt when GAME.state.table changes. */
  var tableGroup = null, tableRef = null;

  /* Live tower meshes keyed by tower id. */
  var towerNodes = {};
  var flipL = null, flipR = null;

  /* The playfield print swaps to the painted art once ART has decoded it. */
  var fieldMesh = null, fieldArtApplied = false;

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  function col(hex) { return new THREE.Color(hex); }

  /* Virtual (x, y) -> world position on the board group. */
  function place(obj, x, y, z) { obj.position.set(x, -y, z || 0); return obj; }

  function shared(geo) { geo.userData.shared = true; return geo; }

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

  /* Bake many placed copies of geometries into one BufferGeometry, so a field
   * of 19 pegs, 28 slots or 40 glow sprites costs one draw call. Each item is
   * { geo, x, y, z, rot, sx, sy, sz } in virtual coordinates (rot is the
   * world z rotation, already sign-flipped by the caller). Geometries may be
   * indexed or not, with or without uvs; the merge keeps whatever the first
   * one has. */
  var _m4 = null, _q = null, _v3 = null, _s3 = null;
  function mergeList(items, mat) {
    if (!_m4) { _m4 = new THREE.Matrix4(); _q = new THREE.Quaternion(); _v3 = new THREE.Vector3(); _s3 = new THREE.Vector3(); }
    var hasUv = !!items[0].geo.attributes.uv;
    var P = [], N = [], UV = [], I = [];
    var base = 0;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var g = it.geo.clone();
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.rot || 0);
      _v3.set(it.x || 0, -(it.y || 0), it.z || 0);
      _s3.set(it.sx === undefined ? 1 : it.sx, it.sy === undefined ? 1 : it.sy, it.sz === undefined ? 1 : it.sz);
      _m4.compose(_v3, _q, _s3);
      g.applyMatrix4(_m4);
      var pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      var vc = pos.count;
      for (var v = 0; v < vc; v++) {
        P.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        if (nor) N.push(nor.getX(v), nor.getY(v), nor.getZ(v)); else N.push(0, 0, 1);
        if (hasUv) { if (uv) UV.push(uv.getX(v), uv.getY(v)); else UV.push(0, 0); }
      }
      if (g.index) {
        for (var i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + base);
      } else {
        for (var j = 0; j < vc; j++) I.push(j + base);
      }
      base += vc;
      g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    if (hasUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    out.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
    var m = new THREE.Mesh(out, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /* Same geometry stamped at many (x, y) points. */
  function mergeAt(geo, points, mat) {
    var items = [];
    for (var k = 0; k < points.length; k++) items.push({ geo: geo, x: points[k][0], y: points[k][1] });
    return mergeList(items, mat);
  }

  /* Cylinder standing on the table (axis along z), base at z = 0. */
  function postGeo(r, h, rTop) {
    var g = new THREE.CylinderGeometry(rTop === undefined ? r : rTop, r, h, 24, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  }

  function sleeveGeo(r, h, z0) {
    var g = new THREE.CylinderGeometry(r, r, h, 24, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, z0 + h / 2);
    return g;
  }

  function ringGeo(r, tube) {
    return new THREE.TorusGeometry(r, tube, 8, 40);
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

  /* Glow material: an additive soft sprite that stands in for bloom. Cached
   * per colour / alpha step so the per-frame swaps in sync* cost nothing. */
  function glow(hex, alpha, bar) {
    var a = Math.round(U.clamp(alpha, 0, 1.5) * 20) / 20;
    var key = hex + ':' + a + (bar ? ':b' : ':d');
    var m = glowCache[key];
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: bar ? T.glowBar : T.glowDot, color: col(hex),
        transparent: true, opacity: Math.min(1, a),
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        toneMapped: false
      });
      glowCache[key] = m;
    }
    return m;
  }

  /* A glow quad (dot or bar) as a mesh, centred on (x, y) at height z. */
  function glowMesh(hex, alpha, x, y, z, w, h, rot) {
    var m = new THREE.Mesh(h === undefined ? G.glowDot : G.glowBar, glow(hex, alpha, h !== undefined));
    m.scale.set(w, h === undefined ? w : h, 1);
    m.rotation.z = rot || 0;
    m.renderOrder = 10;
    place(m, x, y, z);
    return m;
  }

  /* ---------------------------------------------------------------------- */
  /* Generated textures                                                     */
  /* ---------------------------------------------------------------------- */

  function glowDotTexture() {
    var s = 128, cv = document.createElement('canvas');
    cv.width = s; cv.height = s;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(s, s), d = img.data;
    for (var y = 0; y < s; y++) {
      for (var x = 0; x < s; x++) {
        var dx = (x + 0.5) / s * 2 - 1, dy = (y + 0.5) / s * 2 - 1;
        var r = Math.sqrt(dx * dx + dy * dy);
        var a = r >= 1 ? 0 : Math.pow(1 - r, 2.2);
        var o = (y * s + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function glowBarTexture() {
    var w = 128, h = 64, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = Math.abs((x + 0.5) / w * 2 - 1), dy = Math.abs((y + 0.5) / h * 2 - 1);
        /* Flat along the bar, soft at the ends; soft across it. */
        var fx = dx < 0.72 ? 1 : Math.pow(1 - (dx - 0.72) / 0.28, 1.6);
        var fy = Math.pow(Math.max(0, 1 - dy), 2.2);
        var o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(fx * fy * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* A soft diagonal sheen — the reflection of the room in the glass over the
   * playfield. Two faint streaks, otherwise fully transparent. */
  function sheenTexture() {
    var w = 256, h = 512, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, w, h * 0.55);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.30, 'rgba(255,255,255,0)');
    g.addColorStop(0.40, 'rgba(210,240,255,0.055)');
    g.addColorStop(0.47, 'rgba(255,255,255,0.015)');
    g.addColorStop(0.55, 'rgba(210,240,255,0.04)');
    g.addColorStop(0.64, 'rgba(255,255,255,0)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* Brushed-metal streaks for the cabinet panels. */
  function brushedTexture() {
    var w = 256, h = 256, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d1222';
    ctx.fillRect(0, 0, w, h);
    var rng = U.rng(9);
    for (var i = 0; i < 900; i++) {
      var y = rng() * h, a = 0.02 + rng() * 0.05;
      ctx.strokeStyle = 'rgba(' + (rng() < 0.5 ? '160,200,230' : '40,60,90') + ',' + a + ')';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rng() - 0.5) * 2); ctx.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    return tex;
  }

  /* The playfield print. `art` (optional) is the painted bg_table image from
   * ART; without it the print is fully procedural. Either way the overlay
   * pass keeps the centre of the field darkest — a white ball must read
   * instantly wherever it is — and adds the lane marks and drain apron the
   * gameplay relies on. Covers virtual y 60..1250. */
  function playfieldTexture(art) {
    var w = 720, h = 1190, top = 60;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d1424');
    g.addColorStop(0.5, C.table);
    g.addColorStop(1, '#070a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (art) {
      /* The art is packed at 720x1440 (whole virtual screen); take the slice
       * that lies under the table and keep it quiet under a navy wash. */
      var aw = art.naturalWidth || art.width, ah = art.naturalHeight || art.height;
      var sy = top / VH * ah, sh = h / VH * ah;
      ctx.drawImage(art, 0, sy, aw, sh, 0, 0, w, h);
      ctx.fillStyle = 'rgba(8,11,22,0.30)';
      ctx.fillRect(0, 0, w, h);
    } else {
      /* Fine speckle so the surface reads as material, not flat paint. */
      var img = ctx.getImageData(0, 0, w, h), d = img.data;
      var seed = 1234567;
      for (var i = 0; i < d.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        var n = ((seed >>> 16) & 255) / 255 - 0.5;
        d[i] += n * 9; d[i + 1] += n * 9; d[i + 2] += n * 10;
      }
      ctx.putImageData(img, 0, 0);

      /* Circuit-trace print in the player's cyan. */
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
    }

    /* Lane hairlines from the spawn gates. */
    ctx.setLineDash([4, 10]);
    ctx.strokeStyle = 'rgba(63,224,255,0.18)';
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
    ap.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = ap;
    ctx.fillRect(WL, 1080 - top, WR - WL, 170);
    ctx.strokeStyle = 'rgba(255,46,136,0.26)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (var v = 0; v < 2; v++) {
      var cy = 962 + v * 30 - top;
      ctx.beginPath();
      ctx.moveTo(334, cy - 9); ctx.lineTo(360, cy + 5); ctx.lineTo(386, cy - 9);
      ctx.stroke();
    }

    /* Vignette: the load-bearing part. */
    var vg = ctx.createRadialGradient(360, 620 - top, 140, 360, 620 - top, 760);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /* A small gradient cubemap used as the environment, so chrome and gloss
   * plastic pick up a believable arcade reflection without any image asset:
   * an overhead softbox, cyan-lit walls with a couple of bright light strips
   * (what gives chrome its highlights), and a dark floor. */
  function studioEnvironment() {
    var faces = [];
    var size = 64;
    for (var f = 0; f < 6; f++) {
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var ctx = cv.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, size);
      if (f === 2) {          // +y: overhead softbox, cool white
        g.addColorStop(0, '#f2f9ff'); g.addColorStop(1, '#9cc4de');
      } else if (f === 3) {   // -y: floor
        g.addColorStop(0, '#141c30'); g.addColorStop(1, '#05060d');
      } else {                // sides: a cyan-tinted arcade room
        g.addColorStop(0, '#b6e4f2'); g.addColorStop(0.5, '#27395c'); g.addColorStop(1, '#05060d');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      if (f === 0 || f === 1) {   // ±x: tall light tubes
        ctx.fillStyle = 'rgba(220,250,255,0.9)';
        ctx.fillRect(f === 0 ? 10 : 46, 4, 8, 50);
        ctx.fillStyle = 'rgba(255,46,136,0.35)';
        ctx.fillRect(f === 0 ? 40 : 14, 30, 6, 30);
      }
      if (f === 4) {              // +z: the "window" behind the player
        ctx.fillStyle = 'rgba(230,250,255,0.75)';
        ctx.fillRect(8, 6, 48, 10);
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
   * toy pinball machine. Dark navy gloss plastics, chrome and blue-steel
   * metal, and cyan light for everything the player owns. Magenta is
   * reserved for danger. */
  function buildMaterials() {
    var Phys = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;

    M.slab = new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 0.9, metalness: 0.05 });
    M.field = new THREE.MeshStandardMaterial({ map: playfieldTexture(null), roughness: 0.86, metalness: 0.02, envMapIntensity: 0.25 });
    /* The cabinet: gloss black-navy toy plastic with a clear coat. */
    M.frame = new Phys({ color: 0x0f1630, roughness: 0.42, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 });
    M.cab = new Phys({ map: brushedTexture(), color: 0xffffff, roughness: 0.5, metalness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    /* Chrome for pins, hubs and the inner rail lip. */
    M.chrome = new THREE.MeshStandardMaterial({ color: 0xe8f0fa, roughness: 0.16, metalness: 1.0 });
    M.rail = new THREE.MeshStandardMaterial({ color: 0x7d93c2, roughness: 0.28, metalness: 0.92 });
    M.alu = new THREE.MeshStandardMaterial({ color: 0x5c6f9c, roughness: 0.32, metalness: 0.88 });
    M.aluDark = new THREE.MeshStandardMaterial({ color: 0x1c2740, roughness: 0.45, metalness: 0.75 });
    M.rubber = new THREE.MeshStandardMaterial({ color: 0x05060d, roughness: 0.95, metalness: 0 });
    /* "poly" is the player's machinery: deep cyan plastic that the LED strips
     * sit on, so flippers and paddle arms read as cyan-family even unlit. */
    M.poly = new Phys({ color: col(C.cyanDeep), roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    M.polyDark = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, roughness: 0.5, metalness: 0.2 });
    M.slot = new THREE.MeshStandardMaterial({ color: 0x27334f, roughness: 0.35, metalness: 0.85 });
    M.slotHole = new THREE.MeshStandardMaterial({ color: 0x030408, roughness: 1, metalness: 0 });
    /* Bumper dome: frosted polycarbonate over a lit core. */
    M.dome = new Phys({
      color: 0xd8f6ff, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55,
      clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false
    });
    M.sheen = new THREE.MeshBasicMaterial({
      map: sheenTexture(), transparent: true, depthWrite: false, depthTest: false, toneMapped: false
    });
  }

  function buildShared() {
    T.glowDot = glowDotTexture();
    T.glowBar = glowBarTexture();
    G.glowDot = shared(new THREE.PlaneGeometry(1, 1));
    G.glowBar = shared(new THREE.PlaneGeometry(1, 1));
    G.hub = shared(postGeo(BOARD.FLIP.rad + 7, 12, BOARD.FLIP.rad + 5));
    G.bolt = shared(new THREE.SphereGeometry(9, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    G.bolt.rotateX(Math.PI / 2);
  }

  /* ---------------------------------------------------------------------- */
  /* Static machine (built once)                                            */
  /* ---------------------------------------------------------------------- */

  function buildStatic() {
    var g, i;

    /* Slab: the body of the table under the print. */
    var slab = new THREE.Mesh(new THREE.BoxGeometry(VW, 1190, 18), M.slab);
    place(slab, VW / 2, 60 + 1190 / 2, -9.2);
    slab.receiveShadow = true;
    board.add(slab);

    /* Playfield print on top of the slab (this is z = 0). */
    fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(VW, 1190), M.field);
    place(fieldMesh, VW / 2, 60 + 1190 / 2, 0);
    fieldMesh.receiveShadow = true;
    board.add(fieldMesh);

    /* Cabinet panels above and below the table: brushed gloss plates the HUD
     * and card tray sit on, each with a cyan pinstripe where it meets the
     * frame. They turn the screen from "a rectangle" into "a machine". */
    var head = new THREE.Mesh(new THREE.BoxGeometry(VW, 70, 28), M.cab);
    place(head, VW / 2, 33, 14);
    head.receiveShadow = true;
    board.add(head);
    var apron = new THREE.Mesh(new THREE.BoxGeometry(VW, VH - 1254, 28), M.cab);
    place(apron, VW / 2, (1254 + VH) / 2, 14);
    apron.receiveShadow = true;
    board.add(apron);
    var pinTop = new THREE.Mesh(new THREE.BoxGeometry(VW - 60, 2.2, 1.5), led(C.cyan, 1.0));
    place(pinTop, VW / 2, 66, 28.8);
    board.add(pinTop);
    board.add(glowMesh(C.cyan, 0.32, VW / 2, 66, 30, VW - 40, 26));
    var pinBot = new THREE.Mesh(new THREE.BoxGeometry(VW - 60, 2.2, 1.5), led(C.cyan, 1.0));
    place(pinBot, VW / 2, 1256, 28.8);
    board.add(pinBot);
    board.add(glowMesh(C.cyan, 0.32, VW / 2, 1256, 30, VW - 40, 26));

    /* Cabinet frame: a rounded ring standing 34 units proud of the print,
     * gloss plastic outside, chrome lip inside. The lip's inner edge sits
     * exactly where the wall colliders (r = 8) stop the ball, so what you
     * see is what the ball hits. */
    var outer = roundedRectShape(6, -(TRAY_TOP + 20), VW - 12, TRAY_TOP + 20 - 66, 28);
    var lipOuter = roundedRectShape(WL - 4, -(TRAY_TOP + 12), WR - WL + 8, TRAY_TOP + 12 - (BOARD.CEIL - 4), 50);
    outer.holes.push(lipOuter);
    g = new THREE.ExtrudeGeometry(outer, {
      depth: 26, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 4, curveSegments: 12
    });
    var frame = new THREE.Mesh(g, M.frame);
    frame.castShadow = true;
    frame.receiveShadow = true;
    board.add(frame);

    var lip = roundedRectShape(WL - 4, -(TRAY_TOP + 12), WR - WL + 8, TRAY_TOP + 12 - (BOARD.CEIL - 4), 50);
    var lipInner = roundedRectShape(WL + 8, -(TRAY_TOP + 4), WR - WL - 16, TRAY_TOP + 4 - (BOARD.CEIL + 8), 44);
    lip.holes.push(lipInner);
    g = new THREE.ExtrudeGeometry(lip, {
      depth: 30, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3, curveSegments: 12
    });
    var lipMesh = new THREE.Mesh(g, M.chrome);
    lipMesh.castShadow = true;
    lipMesh.receiveShadow = true;
    board.add(lipMesh);

    /* A dark rubber gasket line just inside the lip — the seam between
     * metal and print that every real machine has. */
    var gasket = roundedRectShape(WL + 8, -(TRAY_TOP + 4), WR - WL - 16, TRAY_TOP + 4 - (BOARD.CEIL + 8), 44);
    var gasketInner = roundedRectShape(WL + 12, -TRAY_TOP, WR - WL - 24, TRAY_TOP - (BOARD.CEIL + 12), 40);
    gasket.holes.push(gasketInner);
    var gk = new THREE.Mesh(new THREE.ExtrudeGeometry(gasket, { depth: 3, bevelEnabled: false }), M.rubber);
    board.add(gk);

    /* Cyan neon tube along the top of the chrome lip — the line that makes
     * the machine read as a toy pinball cabinet from the very first frame. */
    var rimOuter = roundedRectShape(WL + 2, -(TRAY_TOP + 10), WR - WL - 4, TRAY_TOP + 10 - (BOARD.CEIL - 2), 48);
    var rimInner = roundedRectShape(WL + 5.5, -(TRAY_TOP + 6.5), WR - WL - 11, TRAY_TOP + 6.5 - (BOARD.CEIL + 1.5), 45);
    rimOuter.holes.push(rimInner);
    var rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimOuter, { depth: 2.2, bevelEnabled: false }), led(C.cyan, 1.5));
    rim.position.z = 33.2;
    board.add(rim);
    /* ...and its glow: four bars merged into one mesh. */
    var rx0 = WL + 3.5, rx1 = WR - 3.5, ry0 = BOARD.CEIL - 0.5, ry1 = TRAY_TOP + 8;
    var rimGlow = mergeList([
      { geo: G.glowBar, x: (rx0 + rx1) / 2, y: ry0, z: 36, sx: rx1 - rx0 + 30, sy: 30 },
      { geo: G.glowBar, x: (rx0 + rx1) / 2, y: ry1, z: 36, sx: rx1 - rx0 + 30, sy: 30 },
      { geo: G.glowBar, x: rx0, y: (ry0 + ry1) / 2, z: 36, rot: Math.PI / 2, sx: ry1 - ry0 + 30, sy: 30 },
      { geo: G.glowBar, x: rx1, y: (ry0 + ry1) / 2, z: 36, rot: Math.PI / 2, sx: ry1 - ry0 + 30, sy: 30 }
    ], glow(C.cyan, 0.42, true));
    rimGlow.renderOrder = 10;
    rimGlow.castShadow = rimGlow.receiveShadow = false;
    board.add(rimGlow);

    /* Corner bolts on the cabinet frame. */
    var bolts = mergeAt(G.bolt, [[22, 82], [VW - 22, 82], [22, TRAY_TOP + 4], [VW - 22, TRAY_TOP + 4]], M.chrome);
    bolts.position.z = 32;
    board.add(bolts);

    /* Spawn gates: five chrome chutes let into the top rail, each with a
     * magenta LED slit so the player always knows where the threat enters. */
    var slitGlow = [];
    for (i = 0; i < BOARD.LANES.length; i++) {
      var x = BOARD.LANES[i];
      var housing = new THREE.Mesh(new THREE.BoxGeometry(58, 36, 34), M.aluDark);
      place(housing, x, BOARD.CEIL - 2, 17);
      housing.castShadow = true;
      board.add(housing);
      var trim = new THREE.Mesh(new THREE.BoxGeometry(62, 6, 36), M.chrome);
      place(trim, x, BOARD.CEIL - 18, 18);
      board.add(trim);
      var mouth = new THREE.Mesh(new THREE.BoxGeometry(42, 12, 20), M.slotHole);
      place(mouth, x, BOARD.CEIL + 12, 10);
      board.add(mouth);
      var slit = new THREE.Mesh(new THREE.BoxGeometry(38, 3, 3), led(C.magenta, 1.8));
      place(slit, x, BOARD.CEIL + 19, 21);
      board.add(slit);
      slitGlow.push({ geo: G.glowBar, x: x, y: BOARD.CEIL + 19, z: 24, sx: 64, sy: 26 });
    }
    var sg = mergeList(slitGlow, glow(C.magenta, 0.55, true));
    sg.renderOrder = 10; sg.castShadow = sg.receiveShadow = false;
    board.add(sg);

    /* Drain: a recessed mouth with a magenta LED strip along its lip. */
    var mouthBox = new THREE.Mesh(new THREE.BoxGeometry(WR - WL - 16, 30, 12), M.slotHole);
    place(mouthBox, VW / 2, BOARD.DRAIN_Y + 16, -5);
    board.add(mouthBox);
    var strip = new THREE.Mesh(new THREE.BoxGeometry(WR - WL - 20, 4, 3), led(C.magenta, 1.4));
    place(strip, VW / 2, BOARD.DRAIN_Y, 1.6);
    board.add(strip);
    SCENE3D._drainLed = strip;
    var dg = glowMesh(C.magenta, 0.5, VW / 2, BOARD.DRAIN_Y + 2, 4, WR - WL + 10, 70);
    board.add(dg);
    SCENE3D._drainGlow = dg;

    /* Flipper hubs are fixed; the blades are built in buildFlippers. */
    var hubL = new THREE.Mesh(G.hub, M.chrome); place(hubL, BOARD.FLIP.lx, BOARD.FLIP.y, 0); board.add(hubL);
    var hubR = new THREE.Mesh(G.hub, M.chrome); place(hubR, BOARD.FLIP.rx, BOARD.FLIP.y, 0); board.add(hubR);
    hubL.castShadow = hubR.castShadow = true;

    /* The glass: a sheen plane over the whole playfield, drawn last. */
    var sheen = new THREE.Mesh(new THREE.PlaneGeometry(WR - WL, TRAY_TOP - BOARD.CEIL), M.sheen);
    place(sheen, VW / 2, (BOARD.CEIL + TRAY_TOP) / 2, 38);
    sheen.renderOrder = 20;
    board.add(sheen);
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
      var strip = new THREE.Mesh(new THREE.BoxGeometry(F.len * 0.62, 3.2, 2.4), led(C.cyan, 0.5));
      strip.position.set(F.len * 0.46, 0, 18.8);
      grp.add(strip);
      var gl = glowMesh(C.cyan, 0.2, F.len * 0.46, 0, 22, F.len * 0.8, F.rad * 4.5);
      grp.add(gl);
      /* Chrome pivot cap. */
      var cap = new THREE.Mesh(postGeo(F.rad - 2, 21, F.rad - 4), M.chrome);
      grp.add(cap);
      grp.userData = { strip: strip, glow: gl };
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

    var pegs = [], posts = [], glows = [];
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
      var len = U.dist(c.ax, c.ay, c.bx, c.by);
      var rot = -Math.atan2(c.by - c.ay, c.bx - c.ax);
      var mx = (c.ax + c.bx) / 2, my = (c.ay + c.by) / 2;
      if (c.kind === 'sling') {
        var sl = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r, 22, M.poly);
        tableGroup.add(sl);
        var band = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r + 0.8, 8, M.rubber);
        band.position.z = 8;
        tableGroup.add(band);
        var strip = capsuleMesh(c.ax, c.ay, c.bx, c.by, 2.2, 2, led(C.cyan, 1.3));
        strip.position.z = 22.4;
        strip.castShadow = false;
        tableGroup.add(strip);
        glows.push({ geo: G.glowBar, x: mx, y: my, z: 26, rot: rot, sx: len + c.r * 2 + 20, sy: c.r * 4 + 16 });
      } else {
        var rail = capsuleMesh(c.ax, c.ay, c.bx, c.by, c.r, 24, M.rail);
        tableGroup.add(rail);
        /* Neon edge along every rail: what makes the funnel read at speed. */
        var top = capsuleMesh(c.ax, c.ay, c.bx, c.by, Math.max(2.2, c.r * 0.3), 2, led(C.cyan, 1.2));
        top.position.z = 24.2;
        top.castShadow = false;
        tableGroup.add(top);
        glows.push({ geo: G.glowBar, x: mx, y: my, z: 28, rot: rot, sx: len + c.r * 2 + 20, sy: c.r * 3.2 + 16 });
      }
    }

    /* Pegs and posts: chrome pins with a rubber sleeve and a lit cap. One
     * draw call per material thanks to mergeAt. */
    if (pegs.length) {
      tableGroup.add(mergeAt(postGeo(9, 24, 8), pegs, M.chrome));
      tableGroup.add(mergeAt(sleeveGeo(9.8, 8, 8), pegs, M.rubber));
      var pegCap = mergeAt(sleeveGeo(5, 2.4, 24), pegs, led(C.cyan, 1.4));
      pegCap.castShadow = false;
      tableGroup.add(pegCap);
      for (var p = 0; p < pegs.length; p++) glows.push({ geo: G.glowDot, x: pegs[p][0], y: pegs[p][1], z: 28, sx: 52, sy: 52 });
    }
    if (posts.length) {
      tableGroup.add(mergeAt(postGeo(11, 28, 10), posts, M.chrome));
      tableGroup.add(mergeAt(sleeveGeo(11.8, 9, 10), posts, M.rubber));
      var postCap = mergeAt(sleeveGeo(6, 2.4, 28), posts, led(C.cyan, 1.4));
      postCap.castShadow = false;
      tableGroup.add(postCap);
      for (var q2 = 0; q2 < posts.length; q2++) glows.push({ geo: G.glowDot, x: posts[q2][0], y: posts[q2][1], z: 32, sx: 64, sy: 64 });
    }
    /* Glow layer: bars (rails, slings) and dots (pins) each merge into one
     * additive mesh, since they use different sprite textures. */
    var bars = [], dots = [];
    for (var gi = 0; gi < glows.length; gi++) (glows[gi].geo === G.glowBar ? bars : dots).push(glows[gi]);
    if (bars.length) {
      var gb = mergeList(bars, glow(C.cyan, 0.38, true));
      gb.renderOrder = 10; gb.castShadow = gb.receiveShadow = false;
      tableGroup.add(gb);
    }
    if (dots.length) {
      var gd = mergeList(dots, glow(C.cyan, 0.42, false));
      gd.renderOrder = 10; gd.castShadow = gd.receiveShadow = false;
      tableGroup.add(gd);
    }

    /* Mounting slots: a machined chrome disc with a dark centre hole, a thin
     * cyan light ring and four screws. The lattice silently teaches where
     * defenses go, before build mode opens. */
    var pts = [];
    for (var s = 0; s < table.slots.length; s++) pts.push([table.slots[s].x, table.slots[s].y]);
    if (pts.length) {
      var disc = mergeAt(postGeo(15, 1.8, 14), pts, M.slot);
      disc.castShadow = false;
      tableGroup.add(disc);
      var hole = mergeAt(postGeo(5, 2.1), pts, M.slotHole);
      hole.castShadow = false;
      tableGroup.add(hole);
      var ring = mergeAt(ringGeo(11.5, 0.7), pts, led(C.cyan, 0.7));
      ring.position.z = 1.9;
      ring.castShadow = ring.receiveShadow = false;
      tableGroup.add(ring);
      var screws = [];
      for (var q = 0; q < pts.length; q++) {
        for (var k = 0; k < 4; k++) {
          var a = k * Math.PI / 2 + Math.PI / 4;
          screws.push([pts[q][0] + Math.cos(a) * 13, pts[q][1] + Math.sin(a) * 13]);
        }
      }
      var sc = mergeAt(postGeo(1.6, 2.4), screws, M.aluDark);
      sc.castShadow = false;
      tableGroup.add(sc);
    }

    board.add(tableGroup);
  }

  function disposeGroup(grp) {
    grp.traverse(function (o) {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Towers                                                                 */
  /* ---------------------------------------------------------------------- */

  function makePaddle(t) {
    var d = t.def;
    var grp = new THREE.Group();

    var base = new THREE.Mesh(postGeo(20, 5, 19), M.aluDark);
    base.castShadow = true; grp.add(base);
    var hub = new THREE.Mesh(postGeo(15, 24, 13), M.chrome);
    hub.castShadow = true; grp.add(hub);
    var ring = new THREE.Mesh(ringGeo(12.5, 2.6), led(d.color, 1));
    ring.position.z = 24.5;
    grp.add(ring);
    /* Ground halo: a flat lit disc under the hub so the tower's colour reads
     * from across the table. */
    var halo = new THREE.Mesh(postGeo(24, 0.8), led(d.color, 0.35));
    halo.position.z = 0.4;
    grp.add(halo);
    var gl = glowMesh(d.color, 0.5, 0, 0, 30, 96);
    grp.add(gl);
    var cap = new THREE.Mesh(postGeo(8, 3, 7), M.polyDark);
    cap.position.z = 24;
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
    var agl = glowMesh(d.color, 0.15, t.armLen * 0.5, 0, 24, t.armLen * 0.8, t.armRad * 4);
    arm.add(agl);
    grp.add(arm);

    grp.userData = { arm: arm, ring: ring, strip: strip, glow: gl, armGlow: agl, kind: 'paddle' };
    place(grp, t.x, t.y, 0);
    return grp;
  }

  function makeBumper(t) {
    var d = t.def;
    var grp = new THREE.Group();
    var r = t.r;

    var base = new THREE.Mesh(postGeo(r + 4, 4, r + 2), M.chrome);
    base.castShadow = true; grp.add(base);
    var body = new THREE.Mesh(postGeo(r, 14, r - 1.5), M.polyDark);
    body.castShadow = true; body.receiveShadow = true; body.position.z = 4; grp.add(body);
    var ring = new THREE.Mesh(ringGeo(r - 2.5, 3.2), led(d.color, 1));
    ring.position.z = 18.5;
    grp.add(ring);
    var halo = new THREE.Mesh(postGeo(r + 14, 0.8), led(d.color, 0.3));
    halo.position.z = 0.4;
    grp.add(halo);
    /* Lit core under a frosted dome: the bit that flashes when it fires. */
    var core = new THREE.Mesh(new THREE.SphereGeometry(r - 9, 20, 12), led(d.color, 1.4));
    core.position.z = 18;
    core.scale.z = 0.5;
    grp.add(core);
    var domeG = new THREE.SphereGeometry(r - 5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    domeG.rotateX(Math.PI / 2);
    domeG.scale(1, 1, 0.62);
    var dome = new THREE.Mesh(domeG, M.dome);
    dome.position.z = 18;
    dome.castShadow = true;
    dome.renderOrder = 5;
    grp.add(dome);
    var gl = glowMesh(d.color, 0.55, 0, 0, 36, r * 4.4);
    grp.add(gl);

    grp.userData = { ring: ring, core: core, dome: dome, body: body, glow: gl, kind: 'bumper', r: r };
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
      var c = t.def.color;
      if (ud.kind === 'paddle') {
        ud.arm.rotation.z = -t.angle;
        var hot = t.swingT > 0;
        var ready = t.cd <= 0;
        var oc = S.overchargeT > 0;
        ud.ring.material = led(c, ready ? (oc ? 2.4 : 1.4) : 0.3);
        ud.strip.material = led(c, hot ? 3.2 : (ready ? 0.9 : 0.2));
        ud.glow.material = glow(c, ready ? (oc ? 0.9 : 0.5) : 0.15);
        ud.armGlow.material = glow(c, hot ? 0.8 : (ready ? 0.18 : 0.05), true);
      } else {
        var pulse = t.pulse > 0 ? t.pulse / 0.28 : 0;
        var sh = S.superheatT > 0;
        node.scale.z = pop * (1 - pulse * 0.18);
        ud.core.material = pulse > 0.15 ? led(C.white, 1.5 + pulse * 2) : led(c, 1.4 + (sh ? 0.8 : 0));
        ud.ring.material = led(c, 1.3 + pulse * 3 + (sh ? 0.8 : 0));
        ud.glow.material = glow(pulse > 0.15 ? C.white : c, 0.5 + pulse * 0.7 + (sh ? 0.2 : 0));
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
    flipL.userData.strip.material = led(C.cyan, S.flipL.on ? 3 : 0.5);
    flipR.userData.strip.material = led(C.cyan, S.flipR.on ? 3 : 0.5);
    flipL.userData.glow.material = glow(C.cyan, S.flipL.on ? 0.85 : 0.2, true);
    flipR.userData.glow.material = glow(C.cyan, S.flipR.on ? 0.85 : 0.2, true);
  }

  /* Swap the procedural print for the painted one the first time ART has it
   * decoded. ART loads after SCENE3D.init (index.html boots the renderer
   * first), so this is polled from render() until it succeeds. */
  function applyFieldArt() {
    if (fieldArtApplied) return;
    var art = global.ART && global.ART.get ? global.ART.get('bg_table') : null;
    if (!art || !(art.complete || art.naturalWidth)) { if (!art) fieldArtApplied = true; return; }
    if (!art.naturalWidth && !art.width) return;
    fieldArtApplied = true;
    var old = M.field.map;
    M.field.map = playfieldTexture(art);
    M.field.needsUpdate = true;
    if (old) old.dispose();
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
    renderer.toneMappingExposure = 1.12;

    scene = new THREE.Scene();
    scene.background = col(C.void);
    scene.environment = studioEnvironment();
    if ('environmentIntensity' in scene) scene.environmentIntensity = 0.7;

    camera = new THREE.PerspectiveCamera(FOV, VW / VH, 200, CAM_Z + 400);
    camera.position.set(VW / 2, -VH / 2, CAM_Z);
    camera.lookAt(VW / 2, -VH / 2, 0);
    scene.add(camera);

    /* Lighting: one cool-white key from the upper left with soft shadows,
     * a cool hemisphere fill, a cyan kicker from below so chrome edges catch
     * the player's colour, and a faint magenta kicker from the top. */
    var hemi = new THREE.HemisphereLight(0xbfe6ff, 0x05060d, 0.9);
    scene.add(hemi);
    keyLight = new THREE.DirectionalLight(0xf4f9ff, 2.4);
    keyLight.position.set(-300, -120, 1500);
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
    var kick = new THREE.DirectionalLight(col(C.cyan), 0.7);
    kick.position.set(400, -1500, 600);
    scene.add(kick);
    var kick2 = new THREE.DirectionalLight(col(C.magenta), 0.3);
    kick2.position.set(-500, 200, 500);
    scene.add(kick2);

    /* Shake pivot: the 2D layer rotates about (VW/2, 700) — so do we. */
    pivot = new THREE.Group();
    pivot.position.set(VW / 2, -700, 0);
    board = new THREE.Group();
    board.position.set(-VW / 2, 700, 0);
    pivot.add(board);
    scene.add(pivot);

    buildShared();
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

  /* Draw the machine for this frame. `cam` is FX.camera() or null; `zm`
   * (optional, from TUT.cam()) is the tutorial zoom. */
  SCENE3D.render = function (S, cam, zm) {
    if (!renderer) return;

    applyFieldArt();

    if (S && S.table && S.table !== tableRef) buildTable(S.table);
    if (!S || !S.table) {
      if (tableGroup) { board.remove(tableGroup); disposeGroup(tableGroup); tableGroup = null; tableRef = null; }
      for (var id in towerNodes) { board.remove(towerNodes[id]); disposeGroup(towerNodes[id]); delete towerNodes[id]; }
    } else {
      syncTowers(S);
      syncFlippers(S);
      _time = S.time || 0;
      /* Drain strip breathes; cyan and steady while the barrier is up. */
      var breathe = 0.5 + Math.sin(_time * 4) * 0.5;
      if (S.barrierT > 0) {
        SCENE3D._drainLed.material = led(C.cyan, 2.2);
        SCENE3D._drainGlow.material = glow(C.cyan, 0.8, true);
      } else {
        SCENE3D._drainLed.material = led(C.magenta, 1.0 + breathe * 0.7);
        SCENE3D._drainGlow.material = glow(C.magenta, 0.35 + breathe * 0.3, true);
      }
    }

    /* `zm` is a zoom about focal (fx,fy) that lands on screen anchor (ax,ay).
     * The 2D layer applies the identical transform (translate anchor →
     * rotate → scale → translate -focal), so the pivot carries
     * anchor+scale+rotation and the board inside carries -focal. */
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
