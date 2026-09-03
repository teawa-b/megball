/* MEGABALL — globe.js
 * The world picker: a small rotatable planet with a pin on every world.
 *
 * This is a self-contained three.js scene with its own renderer, canvas and
 * animation loop, mounted into a DOM element by the UI layer and torn down
 * again the moment the player leaves the screen. It never touches SCENE3D's
 * renderer — the two never run at the same time, and unmount() releases the
 * WebGL context so the game's table can take it back cleanly.
 *
 * Everything is procedural: the planet map is drawn into a 2D canvas at mount
 * time (cyan graticule, dot-matrix landmasses), the atmosphere is a back-side
 * additive shell, the starfield is a Points cloud. No files, no network.
 *
 * Pin labels are real HTML: absolutely positioned <div>s inside the container,
 * moved every frame to the pin's projected screen position and hidden when the
 * pin swings round the far side. That keeps the text crisp and tappable.
 *
 * Attaches window.GLOBE. Depends on: THREE (vendor), U.
 */
(function (global) {
  'use strict';

  var U = global.U;
  var C = U.C;
  var FONT = U.FONT;

  var GLOBE = {};
  var THREE = null;

  /* Mount state — all null while unmounted. */
  var host = null, canvas = null, labelLayer = null;
  var renderer = null, scene = null, camera = null;
  var world = null;            // spins with the drag; holds planet + pins
  var raf = 0, lastT = 0;
  var szW = 0, szH = 0;          // last size the renderer was configured for
  var pins = [];               // { def, node, hit, label, pos }
  var opts = null;
  var disposables = [];        // geometries + materials to release

  var R = 1;                   // planet radius, in globe units
  var FOV = 38;                // vertical field of view, degrees
  var FIT = 1.16;              // margin the planet leaves inside the frame

  /* Drag state. */
  var drag = { on: false, id: -1, x: 0, y: 0, moved: 0 };
  var spin = { yaw: 0, pitch: -0.18, vy: 0, vp: 0 };
  var idleT = 0;

  var AUTO = 0.16;             // idle spin, rad/s
  var IDLE_AFTER = 1.6;        // seconds of stillness before auto-rotate
  var TAP_SLOP = 10;           // px of travel still counted as a tap

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  function keep(o) { disposables.push(o); return o; }

  /* Latitude/longitude in degrees -> a point on the sphere of radius r. */
  function latLon(lat, lon, r) {
    var phi = (90 - lat) * Math.PI / 180;
    var th = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(th),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(th)
    );
  }

  /* ---------------------------------------------------------------------- */
  /* The planet map                                                         */
  /* ---------------------------------------------------------------------- */

  /* An equirectangular map drawn once into a canvas: deep navy ocean, a cyan
   * graticule every 30 degrees, and stylised continents built from clustered
   * dots so the planet reads as a schematic rather than as a photo. */
  function planetTexture() {
    var w = 1024, h = 512;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1428');
    g.addColorStop(0.5, '#0a0e1a');
    g.addColorStop(1, '#070c1c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* Landmass blobs: a handful of seeds, each grown into a soft cluster of
     * overlapping discs, then stippled with brighter dots. */
    var rng = U.rng(9137);
    var seeds = [
      [0.17, 0.32, 0.10], [0.26, 0.46, 0.07], [0.22, 0.62, 0.06],
      [0.46, 0.30, 0.09], [0.53, 0.44, 0.07], [0.60, 0.66, 0.06],
      [0.78, 0.36, 0.08], [0.86, 0.58, 0.055], [0.70, 0.20, 0.05],
      [0.06, 0.70, 0.045], [0.40, 0.78, 0.05]
    ];
    ctx.globalCompositeOperation = 'lighter';
    for (var s = 0; s < seeds.length; s++) {
      var cx = seeds[s][0] * w, cy = seeds[s][1] * h, rad = seeds[s][2] * w;
      for (var b = 0; b < 26; b++) {
        var a = rng() * Math.PI * 2, d = Math.pow(rng(), 0.6) * rad;
        var bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d * 0.72;
        var br = rad * (0.22 + rng() * 0.34);
        var rg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        rg.addColorStop(0, 'rgba(63,224,255,0.085)');
        rg.addColorStop(1, 'rgba(63,224,255,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      }
      /* Dot matrix over the blob — the "scan" look. */
      for (var p = 0; p < 220; p++) {
        var pa = rng() * Math.PI * 2, pd = Math.pow(rng(), 0.5) * rad;
        var px = cx + Math.cos(pa) * pd, py = cy + Math.sin(pa) * pd * 0.72;
        ctx.fillStyle = 'rgba(143,232,255,' + (0.10 + rng() * 0.30) + ')';
        ctx.fillRect(Math.round(px / 6) * 6, Math.round(py / 6) * 6, 2.4, 2.4);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    /* Graticule: meridians every 30deg, parallels every 30deg, equator brighter. */
    ctx.strokeStyle = 'rgba(63,224,255,0.13)';
    ctx.lineWidth = 1.2;
    for (var m = 0; m <= 12; m++) {
      var mx = m * w / 12;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, h); ctx.stroke();
    }
    for (var q = 1; q < 6; q++) {
      var qy = q * h / 6;
      ctx.strokeStyle = q === 3 ? 'rgba(63,224,255,0.28)' : 'rgba(63,224,255,0.13)';
      ctx.lineWidth = q === 3 ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(0, qy); ctx.lineTo(w, qy); ctx.stroke();
    }

    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return keep(tex);
  }

  /* ---------------------------------------------------------------------- */
  /* Scene construction                                                     */
  /* ---------------------------------------------------------------------- */

  function buildStars() {
    var n = 320, arr = new Float32Array(n * 3);
    var rng = U.rng(4242);
    for (var i = 0; i < n; i++) {
      /* Scatter on a big shell, biased behind the planet. */
      var u1 = rng() * 2 - 1, a = rng() * Math.PI * 2;
      var r = Math.sqrt(1 - u1 * u1), rad = 9 + rng() * 6;
      arr[i * 3] = Math.cos(a) * r * rad;
      arr[i * 3 + 1] = Math.sin(a) * r * rad;
      arr[i * 3 + 2] = u1 * rad - 4;
    }
    var g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    var m = keep(new THREE.PointsMaterial({
      color: new THREE.Color(C.frost), size: 0.075, sizeAttenuation: true,
      transparent: true, opacity: 0.75, depthWrite: false
    }));
    var pts = new THREE.Points(g, m);
    scene.add(pts);
  }

  function buildPlanet() {
    var g = keep(new THREE.SphereGeometry(R, 56, 40));
    var m = keep(new THREE.MeshStandardMaterial({
      map: planetTexture(), roughness: 0.86, metalness: 0.1,
      emissive: new THREE.Color(C.cyanDeep), emissiveIntensity: 0.16
    }));
    world.add(new THREE.Mesh(g, m));

    /* Atmosphere: a slightly larger sphere rendered from the inside with an
     * additive material, so only its silhouette lights up — a cheap rim. */
    var ag = keep(new THREE.SphereGeometry(R * 1.075, 48, 32));
    var am = keep(new THREE.MeshBasicMaterial({
      color: new THREE.Color(C.cyan), transparent: true, opacity: 0.11,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scene.add(new THREE.Mesh(ag, am));

    var ag2 = keep(new THREE.SphereGeometry(R * 1.22, 40, 28));
    var am2 = keep(new THREE.MeshBasicMaterial({
      color: new THREE.Color(C.cyanDeep), transparent: true, opacity: 0.055,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scene.add(new THREE.Mesh(ag2, am2));
  }

  function pinMaterial(hex, intensity) {
    return keep(new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex).multiplyScalar(0.3),
      emissive: new THREE.Color(hex), emissiveIntensity: intensity,
      roughness: 0.35, metalness: 0
    }));
  }

  function buildPin(def) {
    var open = !def.locked;
    var hex = open ? C.cyan : C.magenta;
    var grp = new THREE.Group();

    var mat = pinMaterial(hex, open ? 1.25 : 0.6);

    /* A short mast standing on the surface with a glowing bead on top. */
    var stem = keep(new THREE.CylinderGeometry(0.014, 0.02, 0.16, 10));
    stem.translate(0, 0.08, 0);
    grp.add(new THREE.Mesh(stem, mat));

    var bead = keep(new THREE.SphereGeometry(0.055, 16, 12));
    bead.translate(0, 0.185, 0);
    grp.add(new THREE.Mesh(bead, mat));

    /* Ground ring so the pin reads as planted rather than floating. */
    var ring = keep(new THREE.RingGeometry(0.06, 0.085, 24));
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.004, 0);
    var rm = keep(new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex), transparent: true,
      opacity: open ? 0.7 : 0.35, side: THREE.DoubleSide, depthWrite: false
    }));
    grp.add(new THREE.Mesh(ring, rm));

    /* A generous invisible hit sphere: the visible pin is tiny, the touch
     * target must not be. */
    var hg = keep(new THREE.SphereGeometry(0.19, 12, 10));
    hg.translate(0, 0.13, 0);
    var hm = keep(new THREE.MeshBasicMaterial({ visible: false }));
    var hit = new THREE.Mesh(hg, hm);
    grp.add(hit);

    var p = latLon(def.lat, def.lon, R);
    grp.position.copy(p);
    grp.up.set(0, 1, 0);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
    world.add(grp);

    return { def: def, node: grp, hit: hit, pos: p.clone().normalize() };
  }

  function buildLabel(rec) {
    var open = !rec.def.locked;
    var d = document.createElement('div');
    d.className = 'gpin' + (open ? '' : ' lockd');
    d.setAttribute('data-id', rec.def.id);
    d.innerHTML = '<b>' + rec.def.label + '</b>' +
      (open ? '' : '<i>Coming soon</i>');
    labelLayer.appendChild(d);
    d.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      pick(rec);
    });
    rec.label = d;
  }

  function pick(rec) {
    if (!opts) return;
    if (rec.def.locked) { if (opts.onLockedPick) opts.onLockedPick(rec.def.id); }
    else if (opts.onPick) opts.onPick(rec.def.id);
  }

  /* ---------------------------------------------------------------------- */
  /* Input                                                                  */
  /* ---------------------------------------------------------------------- */

  var ray = null, ndc = null;

  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  function onDown(e) {
    if (drag.on) return;
    drag.on = true;
    drag.id = e.pointerId;
    var p = localXY(e);
    drag.x = p.x; drag.y = p.y; drag.moved = 0;
    spin.vy = 0; spin.vp = 0;
    idleT = 0;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
  }

  function onMove(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    var p = localXY(e);
    var dx = p.x - drag.x, dy = p.y - drag.y;
    drag.x = p.x; drag.y = p.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    var k = 0.0075;
    spin.yaw += dx * k;
    spin.pitch = U.clamp(spin.pitch + dy * k, -1.05, 1.05);
    spin.vy = dx * k * 12;
    spin.vp = dy * k * 12;
    idleT = 0;
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    idleT = 0;
    if (drag.moved <= TAP_SLOP) {
      var p = localXY(e);
      ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      var targets = [];
      for (var i = 0; i < pins.length; i++) targets.push(pins[i].hit);
      var hits = ray.intersectObjects(targets, false);
      if (hits.length) {
        for (var k = 0; k < pins.length; k++) {
          if (pins[k].hit === hits[0].object) { pick(pins[k]); break; }
        }
      }
    }
  }

  function onCancel(e) {
    if (drag.on && e.pointerId === drag.id) { drag.on = false; idleT = 0; }
  }

  /* ---------------------------------------------------------------------- */
  /* Frame                                                                  */
  /* ---------------------------------------------------------------------- */

  var _v = null;

  function updateLabels() {
    var r = canvas.getBoundingClientRect();
    var w = r.width, h = r.height;
    /* A pin faces the camera when its (rotated) surface normal points at us. */
    for (var i = 0; i < pins.length; i++) {
      var rec = pins[i];
      _v.copy(rec.pos).applyQuaternion(world.quaternion);
      var facing = _v.z;
      var lb = rec.label;
      if (facing < 0.12) { lb.style.opacity = '0'; lb.style.pointerEvents = 'none'; continue; }
      _v.copy(rec.node.position).add(
        rec.pos.clone().multiplyScalar(0.20)
      ).applyQuaternion(world.quaternion).project(camera);
      /* Keep the chip inside the box even when its pin sits near the limb. */
      var x = U.clamp((_v.x * 0.5 + 0.5) * w, 58, w - 58);
      var y = U.clamp((-_v.y * 0.5 + 0.5) * h, 34, h - 6);
      lb.style.transform = 'translate(-50%,-100%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      lb.style.opacity = String(U.clamp((facing - 0.12) / 0.25, 0, 1));
      lb.style.pointerEvents = 'auto';
    }
  }

  function frame(t) {
    raf = global.requestAnimationFrame(frame);

    /* The sheet is often still being laid out on the frame the globe is
     * mounted, and the box tracks the viewport afterwards. Re-fitting here
     * costs one clientWidth read and makes every other path unnecessary. */
    if (host.clientWidth !== szW || host.clientHeight !== szH) GLOBE.resize();

    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;

    if (!drag.on) {
      /* Inertia, then a slow drift once the player has stopped touching it. */
      spin.yaw += spin.vy * dt;
      spin.pitch = U.clamp(spin.pitch + spin.vp * dt, -1.05, 1.05);
      var damp = Math.pow(0.03, dt);
      spin.vy *= damp;
      spin.vp *= damp;
      idleT += dt;
      if (idleT > IDLE_AFTER && Math.abs(spin.vy) < 0.05) {
        spin.yaw += AUTO * dt * U.clamp((idleT - IDLE_AFTER) / 0.8, 0, 1);
      }
    }

    world.rotation.set(0, 0, 0);
    world.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), spin.yaw);
    world.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), spin.pitch);
    world.updateMatrixWorld();

    updateLabels();
    renderer.render(scene, camera);
  }

  /* ---------------------------------------------------------------------- */
  /* Public                                                                 */
  /* ---------------------------------------------------------------------- */

  GLOBE.mounted = false;

  /* Fill `container` with a globe. `o` is
   *   { pins: [{ id, lat, lon, label, locked }], onPick(id), onLockedPick(id) }
   * Returns false when WebGL is unavailable, so the caller can fall back. */
  GLOBE.mount = function (container, o) {
    THREE = global.THREE;
    if (!THREE || !container) return false;
    if (GLOBE.mounted) GLOBE.unmount();

    host = container;
    opts = o || {};

    canvas = document.createElement('canvas');
    canvas.className = 'gcanvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    host.appendChild(canvas);

    labelLayer = document.createElement('div');
    labelLayer.className = 'glabels';
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    host.appendChild(labelLayer);

    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) {
      host.removeChild(canvas); host.removeChild(labelLayer);
      canvas = labelLayer = host = null;
      return false;
    }
    renderer.setClearAlpha(0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);

    world = new THREE.Group();
    scene.add(world);

    scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x05060d, 0.75));
    var key = new THREE.DirectionalLight(0xf4f9ff, 2.1);
    key.position.set(-1.4, 1.2, 2.2);
    scene.add(key);
    var kick = new THREE.DirectionalLight(new THREE.Color(C.cyan), 0.8);
    kick.position.set(1.8, -0.9, 0.6);
    scene.add(kick);

    buildStars();
    buildPlanet();

    pins = [];
    var list = opts.pins || [];
    for (var i = 0; i < list.length; i++) {
      var rec = buildPin(list[i]);
      pins.push(rec);
      buildLabel(rec);
    }

    /* Start with the first unlocked pin facing the player. */
    var startLon = 0;
    for (var s = 0; s < list.length; s++) {
      if (!list[s].locked) { startLon = list[s].lon; break; }
    }
    /* Rotating the sphere by yaw about +Y puts longitude L at the camera when
     * yaw = -90deg - L (see latLon above). */
    spin.yaw = -Math.PI / 2 - startLon * Math.PI / 180;
    spin.pitch = -0.18;
    spin.vy = 0; spin.vp = 0;
    idleT = 0;

    ray = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    _v = new THREE.Vector3();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);

    GLOBE.mounted = true;
    szW = szH = 0;
    GLOBE.resize();
    lastT = 0;
    raf = global.requestAnimationFrame(frame);
    return true;
  };

  GLOBE.resize = function () {
    if (!renderer || !host) return;
    var w = host.clientWidth || 1, h = host.clientHeight || 1;
    szW = host.clientWidth; szH = host.clientHeight;
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /* The field of view is vertical, so a tall narrow box would crop the
     * planet horizontally. Back the camera off until the sphere clears the
     * narrower axis too, leaving FIT worth of margin for the atmosphere. */
    var halfH = R * FIT / Math.min(1, w / h);
    camera.position.z = halfH / Math.tan(FOV * Math.PI / 360);
    camera.updateProjectionMatrix();
  };

  GLOBE.unmount = function () {
    if (!GLOBE.mounted) return;
    if (raf) global.cancelAnimationFrame(raf);
    raf = 0; lastT = 0;

    if (canvas) {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    }

    for (var i = 0; i < disposables.length; i++) {
      var d = disposables[i];
      if (d && d.dispose) d.dispose();
    }
    disposables = [];

    if (renderer) {
      renderer.dispose();
      if (renderer.forceContextLoss) { try { renderer.forceContextLoss(); } catch (e) {} }
    }

    if (labelLayer && labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);

    renderer = null; scene = null; camera = null; world = null;
    canvas = null; labelLayer = null; host = null; opts = null;
    pins = []; ray = null; ndc = null; _v = null;
    drag.on = false;
    GLOBE.mounted = false;
  };

  global.GLOBE = GLOBE;
})(typeof window !== 'undefined' ? window : this);
