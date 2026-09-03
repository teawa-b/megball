/* MEGABALL — ui.js
 * DOM overlay screens: title, world picker, level select, deck, pause, results.
 *
 * The canvas owns everything that happens on the table; the DOM owns
 * everything that happens between rounds. Splitting it this way means menus
 * get real text layout and accessibility for free, while gameplay keeps a
 * single scaled coordinate space.
 *
 * Attaches window.UI. Depends on: U, LEVELS, CARDS, ENT, GAME, ART, SFX.
 */
(function (global) {
  'use strict';

  var U = global.U;
  var UI = {};

  var root = null;
  var hooks = {};
  var current = null;

  function sfx(n, o) { var s = global.SFX; if (s && s.play) s.play(n, o); }

  /* ---------------------------------------------------------------------- */
  /* Styles                                                                 */
  /* ---------------------------------------------------------------------- */

  var CSS = [
    '#ui{position:fixed;inset:0;z-index:20;display:none;font-family:' + U.FONT + ';',
    '  color:#fff;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}',
    '#ui.on{display:flex;align-items:stretch;justify-content:center;}',
    '#ui .sheet{position:relative;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;height:100dvh;display:flex;',
    '  flex-direction:column;padding:calc(20px + env(safe-area-inset-top)) 22px calc(18px + env(safe-area-inset-bottom));',
    '  box-sizing:border-box;overflow:hidden;overscroll-behavior:none;}',
    '#ui.on .sheet{animation:screenIn .28s cubic-bezier(.2,.8,.2,1) both;}',
    '@keyframes screenIn{from{opacity:0;transform:translateY(10px) scale(.992)}to{opacity:1;transform:none}}',
    /* Pinned to the viewport rather than to the sheet's padding box: the sheet
     * is the scroll container, so an absolutely positioned backdrop stops at
     * the first screenful and lets the canvas show through underneath once a
     * long list scrolls. Width is matched to the sheet so nothing else moves. */
    '#ui .veil,#ui .bgimg{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;',
    '  transform:translateX(-50%);pointer-events:none;}',
    '#ui .veil{background:radial-gradient(120% 80% at 50% 0%,',
    '  rgba(63,224,255,.10),transparent 60%),linear-gradient(180deg,rgba(5,6,13,.88),rgba(5,6,13,.96));',
    '  z-index:-1;}',
    /* The title is the one screen that lets the painted key art breathe: the
     * veil only darkens the top band (under the logo) and the bottom band
     * (under the buttons), and a cyan light bleeds up from the machine. */
    '#ui .sheet.hero .veil{background:radial-gradient(100% 42% at 50% 68%,rgba(63,224,255,.10),transparent 72%),',
    '  linear-gradient(180deg,rgba(5,6,13,.86) 0%,rgba(5,6,13,.34) 28%,rgba(5,6,13,.10) 53%,',
    '  rgba(5,6,13,.72) 74%,rgba(5,6,13,.97) 100%);}',
    '#ui .bgimg{background-size:cover;background-position:center;',
    '  opacity:.92;z-index:-2;filter:saturate(1.05) contrast(1.04);}',
    '#ui .sheet.hero .bgimg{animation:heroDrift 14s ease-in-out infinite alternate;}',
    '@keyframes heroDrift{from{transform:translateX(-50%) scale(1);}to{transform:translateX(-50%) scale(1.045);}}',

    '#ui h1{font-size:clamp(54px,16vw,78px);line-height:.82;margin:0;letter-spacing:-.055em;',
    '  font-weight:900;background:linear-gradient(180deg,#fff 20%,#3fe0ff 130%);',
    '  -webkit-background-clip:text;background-clip:text;color:transparent;',
    '  filter:drop-shadow(0 0 28px rgba(63,224,255,.55)) drop-shadow(0 6px 0 rgba(0,0,0,.55));}',
    '#ui .tag{letter-spacing:.34em;font-size:10px;font-weight:900;color:#3fe0ff;',
    '  opacity:.9;margin:10px 0 0;text-transform:uppercase;}',
    '#ui .sub{color:rgba(255,255,255,.82);font-size:14px;line-height:1.42;font-weight:650;margin:13px 0 0;',
    '  text-shadow:0 2px 8px rgba(0,0,0,.8);}',
    '#ui .spacer{flex:1 1 auto;min-height:8px;}',

    '#ui .btn{display:block;width:100%;min-height:' + U.UI.minTouch + 'px;box-sizing:border-box;padding:14px 18px;margin:6px 0;font-family:inherit;',
    '  border-radius:16px;border:1px solid rgba(143,232,255,.38);background:rgba(12,22,39,.76);',
    '  color:#fff;font:850 14px/1 ' + U.FONT + ';letter-spacing:.14em;text-transform:uppercase;',
    '  cursor:pointer;transition:transform .08s,background .15s,border-color .15s;}',
    '#ui .btn:hover{border-color:rgba(143,232,255,.72);background:rgba(26,47,70,.82);}',
    '#ui .btn:focus-visible{outline:3px solid #ffb020;outline-offset:2px;}',
    '#ui .btn:active{transform:scale(.975);background:rgba(63,224,255,.2);}',
    '#ui .btn.primary{background:linear-gradient(180deg,rgba(63,224,255,.50),rgba(10,126,164,.55));',
    '  border-color:#b8f3ff;font-size:17px;padding:18px;text-shadow:0 1px 0 rgba(0,0,0,.4);',
    '  box-shadow:0 0 34px rgba(63,224,255,.32),inset 0 1px 0 rgba(255,255,255,.35),0 10px 30px rgba(0,0,0,.45);',
    '  animation:primaryPulse 2.4s ease-in-out infinite;}',
    '@keyframes primaryPulse{0%,100%{box-shadow:0 0 26px rgba(63,224,255,.26),inset 0 1px 0 rgba(255,255,255,.35),0 10px 30px rgba(0,0,0,.45);}',
    '  50%{box-shadow:0 0 48px rgba(63,224,255,.55),inset 0 1px 0 rgba(255,255,255,.45),0 10px 30px rgba(0,0,0,.45);}}',
    '#ui .btn.ghost{border-color:rgba(143,232,255,.22);background:rgba(10,14,26,.62);',
    '  color:rgba(255,255,255,.82);font-size:14px;padding:14px;backdrop-filter:blur(6px);',
    '  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 6px 18px rgba(0,0,0,.35);}',
    '#ui .btn.danger{border-color:rgba(255,46,136,.5);background:rgba(255,46,136,.10);}',
    '#ui .row{display:flex;gap:10px;}#ui .row>*{flex:1;}',

    '#ui .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex:0 0 auto;}',
    '#ui .hdr h2{font-size:22px;margin:0;letter-spacing:.12em;font-weight:900;text-transform:uppercase;}',
    '#ui .starcount{font-size:15px;font-weight:800;color:#ffb020;letter-spacing:.06em;}',
    '#ui .back{width:auto;padding:11px 18px;margin:0;font-size:12px;}',

    /* World picker. The globe lives in a plain box that eats the leftover
     * height of the sheet; GLOBE.mount() puts its canvas and its labels in. */
    '#ui .globe{position:relative;flex:1 1 auto;min-height:280px;margin:2px 0 6px;overflow:hidden;}',
    '#ui .gpin{position:absolute;top:0;left:0;padding:7px 12px;border-radius:11px;',
    '  background:rgba(5,6,13,.80);border:2px solid rgba(63,224,255,.55);',
    '  font-family:' + U.FONT + ';white-space:nowrap;text-align:center;cursor:pointer;',
    '  box-shadow:0 0 20px rgba(63,224,255,.22);transition:opacity .12s;}',
    '#ui .gpin b{display:block;font:900 13px/1.1 ' + U.FONT + ';letter-spacing:.14em;',
    '  text-transform:uppercase;color:#3fe0ff;}',
    '#ui .gpin i{display:block;font:800 9px/1.1 ' + U.FONT + ';letter-spacing:.16em;',
    '  text-transform:uppercase;color:rgba(255,255,255,.45);margin-top:4px;font-style:normal;}',
    '#ui .gpin.lockd{border-color:rgba(255,46,136,.45);box-shadow:none;}',
    '#ui .gpin.lockd b{color:rgba(255,255,255,.55);}',
    '#ui .gpin:active{transform:translate(-50%,-100%) scale(.97);}',
    '#ui .hint{text-align:center;font:800 10px/1 ' + U.FONT + ';letter-spacing:.18em;',
    '  text-transform:uppercase;color:rgba(255,255,255,.32);margin:0 0 14px;}',

    /* Level grid: three across, square tiles, big numerals. */
    '#ui .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;',
    '  margin:2px 0 16px;flex:0 0 auto;}',
    '#ui .tile{position:relative;aspect-ratio:1;box-sizing:border-box;padding:0;margin:0;',
    '  border-radius:14px;cursor:pointer;font-family:inherit;color:#fff;',
    '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;',
    '  border:2px solid rgba(63,224,255,.34);background:linear-gradient(160deg,#152040 0%,#0a0e1a 65%);',
    '  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 8px 20px rgba(0,0,0,.4);',
    '  transition:transform .08s,border-color .15s,box-shadow .2s;}',
    '#ui .tile:active{transform:scale(.96);}',
    '#ui .tile .n{font:900 27px/1 ' + U.FONT + ';letter-spacing:-.03em;',
    '  text-shadow:0 0 18px rgba(63,224,255,.45);}',
    '#ui .tile .st{font-size:9px;letter-spacing:1px;color:#ffb020;line-height:1;}',
    '#ui .tile.cur{border-color:#3fe0ff;background:linear-gradient(160deg,#124a66 0%,#0b1a30 70%);',
    '  box-shadow:0 0 0 1px rgba(63,224,255,.18),0 8px 28px rgba(63,224,255,.30),inset 0 1px 0 rgba(255,255,255,.18);}',
    '#ui .tile.locked{cursor:not-allowed;border-color:rgba(255,46,136,.16);',
    '  background:linear-gradient(160deg,#0f1224,#080a14);color:rgba(255,255,255,.30);box-shadow:none;}',
    '#ui .tile.locked .lk{color:rgba(255,46,136,.34);}',

    '#ui .cardgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 10px;}',
    '#ui .pc{position:relative;border-radius:13px;overflow:hidden;cursor:pointer;',
    '  border:2px solid rgba(255,255,255,.10);background:#0b0f1c;aspect-ratio:3/4;',
    '  transition:transform .08s,border-color .15s;}',
    '#ui .pc:active{transform:scale(.97);}',
    '#ui .pc.eq{border-color:#3fe0ff;box-shadow:0 0 22px rgba(63,224,255,.3);}',
    '#ui .pc.lock{opacity:.34;cursor:not-allowed;}',
    '#ui .pc .art{position:absolute;inset:0;background-size:cover;background-position:center top;}',
    '#ui .pc .shade{position:absolute;inset:0;background:linear-gradient(180deg,',
    '  transparent 38%,rgba(7,10,19,.93) 82%);}',
    '#ui .pc .nm{position:absolute;left:2px;right:2px;bottom:18px;text-align:center;',
    '  font-size:9px;font-weight:850;letter-spacing:.035em;text-transform:uppercase;}',
    '#ui .pc .cd{position:absolute;left:0;right:0;bottom:7px;text-align:center;',
    '  font-size:7px;font-weight:750;color:rgba(255,255,255,.52);letter-spacing:.05em;}',
    '#ui .pc .eqbadge{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;',
    '  background:#3fe0ff;color:#05060d;font:900 11px/20px ' + U.FONT + ';text-align:center;}',
    '#ui .slots{display:flex;gap:8px;margin:2px 0 10px;}',
    '#ui .slot{flex:1;height:50px;border-radius:12px;border:2px dashed rgba(255,255,255,.16);',
    '  display:flex;align-items:center;justify-content:center;font:800 10px/1 ' + U.FONT + ';',
    '  letter-spacing:.14em;color:rgba(255,255,255,.35);text-transform:uppercase;text-align:center;padding:4px;}',
    '#ui .slot.full{border-style:solid;border-color:#3fe0ff;background:rgba(63,224,255,.12);color:#fff;}',
    '#ui .slot.lockd{opacity:.4;}',
    '#ui .note{font-size:12px;color:rgba(255,255,255,.62);font-weight:650;line-height:1.42;margin:0 0 10px;}',

    '#ui .stars{font-size:44px;letter-spacing:8px;text-align:center;margin:6px 0 4px;}',
    '#ui .stars span{display:inline-block;opacity:0;transform:scale(.3);',
    '  animation:pop .45s cubic-bezier(.2,1.6,.4,1) forwards;}',
    '@keyframes pop{to{opacity:1;transform:scale(1);}}',
    /* Objective rows. The same markup serves the level-select preview (all
       rows pending) and the results verdict (each row resolved), so what the
       level promised and what it awarded can never drift apart. */
    '#ui .objs{display:flex;flex-direction:column;gap:6px;margin:10px 0 4px;}',
    '#ui .obj{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;',
    '  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);',
    '  font-size:12px;font-weight:700;line-height:1.3;color:rgba(255,255,255,.72);}',
    '#ui .obj .mk{flex:0 0 20px;width:20px;height:20px;border-radius:50%;text-align:center;',
    '  font:900 12px/20px ' + U.FONT + ';border:2px solid rgba(255,255,255,.18);',
    '  color:rgba(255,255,255,.3);}',
    '#ui .obj.met{border-color:rgba(255,176,32,.45);background:rgba(255,176,32,.09);color:#fff;}',
    '#ui .obj.met .mk{border-color:#ffb020;background:#ffb020;color:#05060d;}',
    '#ui .obj.failed{opacity:.45;}',
    '#ui .obj.failed .mk{border-color:rgba(255,46,136,.55);color:#ff2e88;}',
    '#ui .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0;}',
    '#ui .stat{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);',
    '  border-radius:11px;padding:11px 13px;}',
    '#ui .stat b{display:block;font-size:21px;font-weight:900;}',
    '#ui .stat i{font-style:normal;font-size:10px;letter-spacing:.16em;font-weight:800;',
    '  color:rgba(255,255,255,.4);text-transform:uppercase;}',
    '#ui .unlock{border:2px solid rgba(255,176,32,.5);background:rgba(255,176,32,.10);',
    '  border-radius:13px;padding:13px 15px;margin:10px 0;font-weight:800;font-size:13px;',
    '  letter-spacing:.06em;color:#ffb020;text-align:center;}',
    '#ui .title-big{font-size:30px;font-weight:900;letter-spacing:.06em;text-align:center;',
    '  margin:0 0 2px;text-transform:uppercase;}',
    '#ui .muted{position:absolute;top:calc(14px + env(safe-area-inset-top));right:16px;font-family:inherit;',
    '  width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.16);',
    '  background:rgba(255,255,255,.05);color:#fff;font-size:19px;cursor:pointer;z-index:3;}',
    '#ui .legend{display:flex;gap:8px 12px;flex-wrap:wrap;margin:10px 0 0;}',
    '#ui .lg{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;',
    '  color:rgba(255,255,255,.55);}',
    '#ui .lg em{width:16px;height:16px;border-radius:50%;background:#fff;',
    '  border:3px solid #000;display:block;flex:0 0 16px;}',
    '#ui .hero-actions{flex:0 0 auto;}',
    '#ui .level-card{padding:14px;border:1px solid rgba(63,224,255,.18);border-radius:16px;',
    '  background:linear-gradient(145deg,rgba(15,30,51,.82),rgba(6,10,20,.76));box-shadow:0 14px 36px rgba(0,0,0,.25);}',
    '#ui .level-card .note{font-size:14px;margin-bottom:5px;}',
    '#ui .menu-actions{margin-top:auto;flex:0 0 auto;padding-top:10px;}',
    '@media(max-height:720px){#ui .sheet{padding-top:14px;padding-bottom:12px}#ui .hdr{margin-bottom:9px}',
    '  #ui .obj{padding:7px 10px}#ui .objs{gap:4px;margin-top:6px}#ui .note{line-height:1.3}',
    '  #ui .btn{min-height:44px;padding:11px 15px;margin:4px 0}#ui .slots{margin-bottom:7px}',
    '  #ui .pc{aspect-ratio:1.05}#ui .pc .nm{font-size:8px}#ui .cardgrid{gap:6px;margin-bottom:7px}}',
    '@media(prefers-reduced-motion:reduce){#ui.on .sheet,#ui .sheet.hero .bgimg,#ui .btn.primary{animation:none!important}}'
  ].join('\n');

  /* ---------------------------------------------------------------------- */

  UI.init = function (h) {
    hooks = h || {};
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);

    /* The globe sizes itself to its box, which changes with the viewport. */
    global.addEventListener('resize', function () {
      if (global.GLOBE && global.GLOBE.mounted) global.GLOBE.resize();
    });
  };

  function bgStyle(key) {
    var a = global.ART && global.ART.get ? global.ART.get(key) : null;
    return a ? 'background-image:url(' + a.src + ')' : '';
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  function shell(inner, withBg) {
    root.innerHTML = '';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    var veil = document.createElement('div');
    veil.className = 'veil';
    sheet.appendChild(veil);
    if (withBg) {
      var bi = document.createElement('div');
      bi.className = 'bgimg';
      bi.setAttribute('style', bgStyle('bg_menu'));
      sheet.appendChild(bi);
    }
    sheet.insertAdjacentHTML('beforeend', inner);
    root.appendChild(sheet);
    return sheet;
  }

  function on(sel, fn, sheet) {
    var n = (sheet || root).querySelector(sel);
    if (n) n.addEventListener('click', function (e) { e.preventDefault(); fn(e); });
    return n;
  }
  function onAll(sel, fn, sheet) {
    var ns = (sheet || root).querySelectorAll(sel);
    for (var i = 0; i < ns.length; i++) {
      (function (n) {
        n.addEventListener('click', function (e) { e.preventDefault(); fn(n, e); });
      })(ns[i]);
    }
  }

  function starStr(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += (i < n ? '★' : '☆');
    return s;
  }

  /* ---------------------------------------------------------------------- */
  /* Screens                                                                */
  /* ---------------------------------------------------------------------- */

  function screenTitle() {
    var muted = global.SFX && global.SFX.isMuted && global.SFX.isMuted();
    var sheet = shell([
      '<button class="muted" id="mute">' + (muted ? '🔇' : '🔊') + '</button>',
      '<div class="spacer"></div>',
      '<p class="tag">Tower Defense · Pinball</p>',
      '<h1>MEGA<br>BALL</h1>',
      '<p class="sub">Build the board. Flip the stragglers.<br>',
      'Turn enemy balls into weapons.</p>',
      '<div class="legend">',
      '  <div class="lg"><em></em>Enemy ball</div>',
      '  <div class="lg" style="color:#3fe0ff">◗ Your defenses</div>',
      '  <div class="lg" style="color:#ff2e88">▁ Don\'t let them out</div>',
      '</div>',
      '<div class="spacer"></div>',
      '<div class="hero-actions"><button class="btn primary" id="play">Start</button>',
      '<div class="row"><button class="btn ghost" id="deck">Cards</button>',
      '<button class="btn ghost" id="howto">Tutorial</button></div></div>'
    ].join(''), true);
    sheet.classList.add('hero');

    on('#play', function () { sfx('ui_tap'); UI.showScreen('world'); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'title' }); }, sheet);
    /* Replays the Level 1 tutorial on demand. */
    on('#howto', function () {
      sfx('ui_tap');
      if (global.TUT) global.TUT.force = true;
      if (hooks.onStartLevel) hooks.onStartLevel(1);
    }, sheet);
    on('#mute', function (e) {
      var s = global.SFX;
      if (!s) return;
      s.init();
      var m = !s.isMuted();
      s.setMuted(m);
      GAMEsave('muted', m);
      e.target.textContent = m ? '🔇' : '🔊';
    }, sheet);
  }

  function GAMEsave(k, v) {
    if (global.GAME) { global.GAME.progress[k] = v; global.GAME.saveProgress(); }
  }

  /* ---------------------------------------------------------------------- */
  /* World picker                                                           */
  /* ---------------------------------------------------------------------- */

  /* Where each world sits on the planet. Only World 1 exists; the other two
   * are pinned far enough apart that a single drag never reveals all three,
   * which is the whole point of putting them on a globe. */
  var WORLDS = [
    { id: 1, lat: 14, lon: -62, label: 'World 1', locked: false },
    { id: 2, lat: 44, lon: 78, label: 'World 2', locked: true },
    { id: 3, lat: -32, lon: 168, label: 'World 3', locked: true }
  ];

  function screenWorld() {
    var GAME = global.GAME;
    var total = GAME.totalStars();

    var sheet = shell([
      '<div class="hdr"><h2>Select World</h2>',
      '<span class="starcount">\u2605 ' + total + ' / 15</span></div>',
      '<div class="globe" id="globe"></div>',
      '<p class="hint">Drag to spin \u00b7 tap a world</p>',
      '<div class="row"><button class="btn ghost" id="deck">Cards</button>',
      '<button class="btn ghost" id="back">Title</button></div>'
    ].join(''), true);

    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'world' }); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('title'); }, sheet);

    var box = sheet.querySelector('#globe');
    var G = global.GLOBE;
    if (G && G.mount) {
      G.mount(box, {
        pins: WORLDS,
        onPick: function () { sfx('ui_tap'); UI.showScreen('levelSelect'); },
        onLockedPick: function () { sfx('ui_error'); }
      });
    } else {
      /* No WebGL: the grid is still one tap away. */
      box.innerHTML = '<button class="btn primary" id="w1">World 1</button>';
      on('#w1', function () { sfx('ui_tap'); UI.showScreen('levelSelect'); }, sheet);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Level grid                                                             */
  /* ---------------------------------------------------------------------- */

  /* A padlock drawn inline rather than typed as an emoji: the emoji font
   * renders in full colour on every desktop platform, and colour outside the
   * palette is the one thing the art direction does not allow. */
  var LOCK_SVG = '<svg class="lk" viewBox="0 0 24 24" width="27" height="27" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"></rect>' +
    '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path></svg>';

  function lockedTile(i) {
    return '<button class="tile locked" data-id="' + i + '">' + LOCK_SVG + '</button>';
  }

  /* Five stages, shown as one clean progression row. */
  function screenLevelSelect() {
    var GAME = global.GAME, LEVELS = global.LEVELS;
    var total = GAME.totalStars();

    /* "Current" = the first unlocked level the player has not mastered. */
    var curId = 0;
    for (var c = 0; c < LEVELS.list.length; c++) {
      var lc = LEVELS.list[c];
      if (GAME.levelUnlocked(lc.id) && (GAME.progress.stars[lc.id] || 0) < 3) { curId = lc.id; break; }
    }
    if (!curId) curId = LEVELS.list.length ? LEVELS.list[0].id : 0;

    var tiles = '';
    for (var i = 1; i <= LEVELS.list.length; i++) {
      var L = LEVELS.byId(i);
      if (!L) {
        tiles += lockedTile(i);
        continue;
      }
      var open = GAME.levelUnlocked(L.id);
      var st = GAME.progress.stars[L.id] || 0;
      if (!open) {
        tiles += lockedTile(i);
        continue;
      }
      tiles += '<button class="tile' + (L.id === curId ? ' cur' : '') + '" data-id="' + L.id + '">' +
        '<span class="n">' + L.id + '</span>' +
        '<span class="st" style="color:' + (st ? '#ffb020' : 'rgba(255,255,255,.22)') + '">' +
        starStr(st) + '</span></button>';
    }

    var cur = LEVELS.byId(curId);
    var blurb = cur
      ? '<b style="color:#3fe0ff">' + cur.id + '. ' + cur.name + '</b> \u2014 ' + cur.subtitle
      : '';

    /* The three objectives of the current level, stated up front. A "use no
       more than N defenses" ask is unplayable as a surprise at the results
       screen — the player has to know the constraint before they spend. */
    var objList = cur ? objectiveRows(LEVELS.objectives(cur, null), false) : '';

    var sheet = shell([
      '<div class="hdr"><h2>World 1</h2>',
      '<span class="starcount">\u2605 ' + total + ' / 15</span></div>',
      '<div class="grid">' + tiles + '</div>',
      '<div class="level-card"><p class="note" id="blurb">' + blurb + '</p>',
      '<div id="objs">' + objList + '</div></div>',
      '<div class="spacer"></div>',
      '<div class="menu-actions"><button class="btn primary" id="launch">Play Level ' + curId + '</button>',
      '<div class="row"><button class="btn ghost" id="deck">Cards</button>',
      '<button class="btn ghost" id="back">Worlds</button></div></div>'
    ].join(''), true);
    sheet.classList.add('level-select');

    var note = sheet.querySelector('#blurb');
    var selectedId = curId;
    onAll('.tile', function (n) {
      var id = parseInt(n.getAttribute('data-id'), 10);
      if (n.classList.contains('locked')) { sfx('ui_error'); return; }
      var L = LEVELS.byId(id);
      if (note && L) {
        selectedId = id;
        var allTiles = sheet.querySelectorAll('.tile');
        for (var ti = 0; ti < allTiles.length; ti++) allTiles[ti].classList.remove('cur');
        n.classList.add('cur');
        note.innerHTML = '<b style="color:#3fe0ff">' + L.id + '. ' + L.name +
          '</b> \u2014 ' + L.subtitle;
        var ob = sheet.querySelector('#objs');
        if (ob) ob.innerHTML = objectiveRows(LEVELS.objectives(L, null), false);
        var launch = sheet.querySelector('#launch');
        if (launch) launch.textContent = 'Play Level ' + L.id;
      }
      sfx('ui_tap');
    }, sheet);
    on('#launch', function () { sfx('ui_tap'); if (hooks.onStartLevel) hooks.onStartLevel(selectedId); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'levelSelect' }); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('world'); }, sheet);
  }

  /* The deck builder. Slots unlock with stars, so the loadout decision gets
   * meaningfully harder as the collection grows.
   *
   * `ctx` (optional) = { next: levelId, unlocks: [] }. The results screen
   * routes through here after a level that unlocked something, because a new
   * card arrives with no free slot to put it in — the player has to swap, and
   * they will never guess that from a menu they were never sent to. */
  function screenLoadout(ctx) {
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var total = GAME.totalStars();
    var owned = LEVELS.ownedAt(total);
    var loadout = GAME.progress.loadout;
    var nextLvl = ctx && ctx.next ? LEVELS.byId(ctx.next) : null;

    /* Trim any cards that are no longer slottable. */
    while (loadout.length > owned.slots) loadout.pop();

    var slots = '';
    for (var s = 0; s < 3; s++) {
      var lockd = s >= owned.slots;
      var cid = loadout[s];
      var cd = cid ? CARDS.PLAYER[cid] : null;
      slots += '<div class="slot ' + (cd ? 'full' : '') + (lockd ? ' lockd' : '') + '">' +
        (lockd ? 'Locked<br>★' + slotStarReq(s) : (cd ? cd.name : 'Empty')) + '</div>';
    }

    var grid = '';
    for (var i = 0; i < CARDS.UNLOCK_ORDER.length; i++) {
      var id = CARDS.UNLOCK_ORDER[i];
      var def = CARDS.PLAYER[id];
      var has = owned.cards.indexOf(id) >= 0;
      var eq = loadout.indexOf(id);
      var art = global.ART && global.ART.get ? global.ART.get(def.art) : null;
      grid += '<div class="pc ' + (has ? '' : 'lock ') + (eq >= 0 ? 'eq' : '') + '" data-id="' + id + '">' +
        (art ? '<div class="art" style="background-image:url(' + art.src + ')"></div>' : '') +
        '<div class="shade"></div>' +
        (eq >= 0 ? '<div class="eqbadge">' + (eq + 1) + '</div>' : '') +
        '<div class="nm" style="color:' + (has ? def.color : 'rgba(255,255,255,.4)') + '">' +
        (has ? def.name : 'Locked') + '</div>' +
        '<div class="cd">' + (has ? def.cd + 's cooldown' : cardStarReq(id)) + '</div>' +
        '</div>';
    }

    var sel = loadout.length ? CARDS.PLAYER[loadout[loadout.length - 1]] : CARDS.PLAYER.slowtime;

    /* Banner for anything just unlocked, then the swap rule — spelled out only
     * when it actually bites, i.e. more cards owned than slots to hold them. */
    var unl = '';
    if (ctx && ctx.unlocks) {
      for (var u = 0; u < ctx.unlocks.length; u++) {
        unl += '<div class="unlock">UNLOCKED — ' + ctx.unlocks[u].label + '</div>';
      }
    }
    var lead = owned.cards.length > owned.slots
      ? 'Slots full. Tap a card to swap it into your loadout.'
      : 'Tap to equip. Cards recharge during play; each level lends one bonus card.';

    var sheet = shell([
      '<div class="hdr"><h2>Power Cards</h2><span class="starcount">★ ' + total + '</span></div>',
      unl,
      '<p class="note">' + lead + '</p>',
      '<div class="slots">' + slots + '</div>',
      '<div class="cardgrid">' + grid + '</div>',
      '<p class="note" id="blurb"><b style="color:' + sel.color + '">' + sel.name + '</b> — ' + sel.long + '</p>',
      '<div class="spacer"></div>',
      nextLvl
        ? '<button class="btn primary" id="play">Play ' + nextLvl.id + '. ' + nextLvl.name + '</button>' +
          '<button class="btn ghost" id="back">Level Select</button>'
        : '<button class="btn" id="back">Back</button>'
    ].join(''), true);
    sheet.classList.add('deck-screen');

    onAll('.pc', function (n) {
      var id = n.getAttribute('data-id');
      if (n.classList.contains('lock')) { sfx('ui_error'); return; }
      var idx = loadout.indexOf(id);
      if (idx >= 0) loadout.splice(idx, 1);
      else if (loadout.length < owned.slots) loadout.push(id);
      else { loadout.pop(); loadout.push(id); }
      sfx('ui_tap');
      GAME.saveProgress();
      screenLoadout(ctx);          // keep the "play next" context across a re-render
    }, sheet);

    on('#play', function () {
      sfx('ui_tap');
      if (hooks.onStartLevel) hooks.onStartLevel(nextLvl.id);
    }, sheet);
    on('#back', function () {
      sfx('ui_back');
      UI.showScreen(nextLvl ? 'levelSelect' : ((ctx && ctx.back) || 'levelSelect'));
    }, sheet);
  }

  function slotStarReq(index) {
    var LEVELS = global.LEVELS;
    for (var i = 0; i < LEVELS.UNLOCKS.length; i++) {
      if (LEVELS.UNLOCKS[i].kind === 'slot' && LEVELS.UNLOCKS[i].id === index + 1) {
        return LEVELS.UNLOCKS[i].stars;
      }
    }
    return '?';
  }
  function cardStarReq(id) {
    var LEVELS = global.LEVELS;
    for (var i = 0; i < LEVELS.UNLOCKS.length; i++) {
      if (LEVELS.UNLOCKS[i].kind === 'card' && LEVELS.UNLOCKS[i].id === id) {
        return '★' + LEVELS.UNLOCKS[i].stars + ' to unlock';
      }
    }
    return '';
  }

  function screenPaused() {
    var sheet = shell([
      '<div class="spacer"></div>',
      '<p class="title-big">Paused</p>',
      '<div class="spacer"></div>',
      '<button class="btn primary" id="res">Resume</button>',
      '<button class="btn ghost" id="rst">Restart Level</button>',
      '<button class="btn ghost danger" id="qt">Quit to Menu</button>'
    ].join(''), false);

    on('#res', function () { sfx('ui_back'); global.GAME.resume(); }, sheet);
    on('#rst', function () { sfx('ui_tap'); global.GAME.restartLevel(); }, sheet);
    on('#qt', function () { sfx('ui_back'); global.GAME.quitToMenu(); }, sheet);
  }

  /* Render a set of LEVELS.objectives rows. `resolved` false renders every
     row as a plain promise (level select), true renders the verdict. */
  function objectiveRows(objs, resolved) {
    var out = '';
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var cls = 'obj';
      var mark = '★';
      if (resolved) {
        if (o.met) cls += ' met';
        else if (o.failed) { cls += ' failed'; mark = '✕'; }
      }
      out += '<div class="' + cls + '"><span class="mk">' + mark + '</span>' +
        '<span>' + o.text + '</span></div>';
    }
    return '<div class="objs">' + out + '</div>';
  }

  function screenResults(d) {
    var stars = '';
    for (var i = 0; i < 3; i++) {
      stars += '<span style="animation-delay:' + (0.15 + i * 0.24) + 's;color:' +
        (i < d.stars ? '#ffb020' : 'rgba(255,255,255,.16)') + '">★</span>';
    }
    var unl = '';
    for (var u = 0; u < d.unlocks.length; u++) {
      unl += '<div class="unlock">UNLOCKED — ' + d.unlocks[u].label + '</div>';
    }

    /* Go on through the Deck rather than straight into the next level when
     * there is something new to slot, and always after Level 1 — that is the
     * one moment we can be sure the player has never opened the Deck, and a
     * card they cannot find is a card they will never use. */
    var viaDeck = d.win && d.hasNext && (d.unlocks.length > 0 || d.level.id === 1);
    var nextId = d.level.id + 1;

    var sheet = shell([
      '<div class="spacer"></div>',
      '<p class="tag" style="text-align:center;color:' + (d.win ? '#4ade80' : '#ff2e88') + '">',
      d.win ? 'Level Complete' : 'Defenses Breached', '</p>',
      '<p class="title-big">' + d.level.name + '</p>',
      d.win ? '<div class="stars">' + stars + '</div>' :
        '<p class="note" style="text-align:center">Reached wave ' + (d.wave || 1) + ' of ' + (d.waves || '?') + '</p>',
      d.objectives ? objectiveRows(d.objectives, true) : '',
      '<div class="stats">',
      '  <div class="stat"><b style="color:#ff2e88">' + d.lives + '/' + d.livesMax + '</b><i>Lives left</i></div>',
      '  <div class="stat"><b style="color:#fff">' + d.kills + '</b><i>Destroyed</i></div>',
      '  <div class="stat"><b style="color:#ffb020">' + d.earned + '</b><i>Energy earned</i></div>',
      '  <div class="stat"><b style="color:#ff2e88">' + d.leaks + '</b><i>Leaks</i></div>',
      '</div>',
      unl,
      '<div class="spacer"></div>',
      d.win && d.hasNext
        ? '<button class="btn primary" id="next">' +
            (viaDeck ? 'Choose Cards &amp; Continue' : 'Next Level') + '</button>'
        : '',
      viaDeck && d.unlocks.length
        ? '<p class="note" style="text-align:center;margin:2px 0 0">Pick which cards you take in.</p>'
        : '',
      d.win && !d.hasNext ? '<div class="unlock" style="border-color:rgba(74,222,128,.5);background:rgba(74,222,128,.1);color:#4ade80">ALL LEVELS CLEARED — ★' + d.totalStars + ' total</div>' : '',
      '<button class="btn' + (d.win ? ' ghost' : ' primary') + '" id="retry">' + (d.win ? 'Replay' : 'Try Again') + '</button>',
      '<button class="btn ghost" id="menu">Level Select</button>'
    ].join(''), true);
    sheet.classList.add('results-screen');

    on('#next', function () {
      sfx('ui_tap');
      if (viaDeck) UI.showScreen('loadout', { next: nextId, unlocks: d.unlocks });
      else global.GAME.nextLevel();
    }, sheet);
    on('#retry', function () { sfx('ui_tap'); global.GAME.restartLevel(); }, sheet);
    on('#menu', function () { sfx('ui_back'); global.GAME.quitToMenu(); }, sheet);
  }

  /* ---------------------------------------------------------------------- */

  UI.showScreen = function (name, data) {
    /* The globe owns a WebGL context of its own. Release it the instant we
     * leave the world screen, before anything else touches the DOM, so the
     * game's table never has to compete for one. */
    if (current === 'world' && name !== 'world') {
      if (global.GLOBE && global.GLOBE.unmount) global.GLOBE.unmount();
    }
    current = name;
    if (!name) {
      root.classList.remove('on');
      root.innerHTML = '';
      return;
    }
    root.classList.add('on');
    if (name === 'title') screenTitle();
    else if (name === 'world') screenWorld();
    else if (name === 'levelSelect') screenLevelSelect();
    else if (name === 'loadout') screenLoadout(data);
    else if (name === 'paused') screenPaused();
    else if (name === 'results') screenResults(data);
    root.scrollTop = 0;
  };

  UI.current = function () { return current; };
  UI.isOpen = function () { return !!current; };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : this);
