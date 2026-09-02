/* MEGABALL — ui.js
 * DOM overlay screens: title, level select, deck builder, pause, results.
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
    '#ui .sheet{position:relative;width:100%;max-width:560px;height:100%;display:flex;',
    '  flex-direction:column;padding:26px 22px calc(26px + env(safe-area-inset-bottom));',
    '  box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;}',
    '#ui .veil{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 0%,',
    '  rgba(63,224,255,.10),transparent 60%),linear-gradient(180deg,rgba(5,6,13,.86),rgba(5,6,13,.97));',
    '  z-index:-1;}',
    '#ui .bgimg{position:absolute;inset:0;background-size:cover;background-position:center;',
    '  opacity:.5;z-index:-2;filter:saturate(.85);}',

    '#ui h1{font-size:15vw;max-font-size:74px;line-height:.92;margin:0;letter-spacing:-.03em;',
    '  font-weight:900;background:linear-gradient(180deg,#fff 20%,#3fe0ff 130%);',
    '  -webkit-background-clip:text;background-clip:text;color:transparent;',
    '  filter:drop-shadow(0 0 26px rgba(63,224,255,.45));}',
    '#ui .tag{letter-spacing:.42em;font-size:11px;font-weight:800;color:#3fe0ff;',
    '  opacity:.85;margin:10px 0 0;text-transform:uppercase;}',
    '#ui .sub{color:rgba(255,255,255,.55);font-size:14px;line-height:1.5;font-weight:500;margin:14px 0 0;}',
    '#ui .spacer{flex:1 1 auto;min-height:12px;}',

    '#ui .btn{display:block;width:100%;box-sizing:border-box;padding:17px 20px;margin:9px 0;font-family:inherit;',
    '  border-radius:14px;border:2px solid rgba(63,224,255,.45);background:rgba(63,224,255,.10);',
    '  color:#fff;font:800 16px/1 ' + U.FONT + ';letter-spacing:.16em;text-transform:uppercase;',
    '  cursor:pointer;transition:transform .08s,background .15s,border-color .15s;}',
    '#ui .btn:active{transform:scale(.975);background:rgba(63,224,255,.2);}',
    '#ui .btn.primary{background:linear-gradient(180deg,rgba(63,224,255,.28),rgba(63,224,255,.12));',
    '  border-color:#3fe0ff;box-shadow:0 6px 30px rgba(63,224,255,.22);font-size:19px;padding:21px;}',
    '#ui .btn.ghost{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.04);',
    '  color:rgba(255,255,255,.7);font-size:14px;padding:14px;}',
    '#ui .btn.danger{border-color:rgba(255,46,136,.5);background:rgba(255,46,136,.10);}',
    '#ui .row{display:flex;gap:10px;}#ui .row>*{flex:1;}',

    '#ui .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}',
    '#ui .hdr h2{font-size:22px;margin:0;letter-spacing:.12em;font-weight:900;text-transform:uppercase;}',
    '#ui .starcount{font-size:15px;font-weight:800;color:#ffb020;letter-spacing:.06em;}',
    '#ui .back{width:auto;padding:11px 18px;margin:0;font-size:12px;}',

    /* <button> does not inherit colour or font from its ancestors, so both
     * have to be stated here or the label falls back to the UA's near-black. */
    '#ui .lvl{display:flex;align-items:center;gap:14px;width:100%;box-sizing:border-box;',
    '  padding:15px 16px;margin:8px 0;border-radius:14px;text-align:left;cursor:pointer;',
    '  color:#fff;font-family:inherit;',
    '  border:2px solid rgba(255,255,255,.10);background:rgba(255,255,255,.035);',
    '  transition:transform .08s,border-color .15s,background .15s;}',
    '#ui .lvl:active{transform:scale(.985);}',
    '#ui .lvl.open{border-color:rgba(63,224,255,.5);background:rgba(63,224,255,.07);}',
    '#ui .lvl.locked{opacity:.42;cursor:not-allowed;}',
    '#ui .lvl .num{width:42px;height:42px;flex:0 0 42px;border-radius:11px;display:flex;',
    '  align-items:center;justify-content:center;font-weight:900;font-size:18px;',
    '  background:rgba(63,224,255,.14);color:#3fe0ff;border:1px solid rgba(63,224,255,.3);}',
    '#ui .lvl .nm{display:block;font-weight:800;font-size:16px;letter-spacing:.02em;color:#fff;}',
    '#ui .lvl .ds{display:block;font-size:12px;color:rgba(255,255,255,.45);margin-top:3px;font-weight:600;}',
    '#ui .lvl .st{margin-left:auto;font-size:15px;letter-spacing:2px;white-space:nowrap;}',
    '#ui .grow{flex:1;min-width:0;}',

    '#ui .cardgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:6px 0 18px;}',
    '#ui .pc{position:relative;border-radius:13px;overflow:hidden;cursor:pointer;',
    '  border:2px solid rgba(255,255,255,.10);background:#0b0f1c;aspect-ratio:3/4;',
    '  transition:transform .08s,border-color .15s;}',
    '#ui .pc:active{transform:scale(.97);}',
    '#ui .pc.eq{border-color:#3fe0ff;box-shadow:0 0 22px rgba(63,224,255,.3);}',
    '#ui .pc.lock{opacity:.34;cursor:not-allowed;}',
    '#ui .pc .art{position:absolute;inset:0;background-size:cover;background-position:center top;}',
    '#ui .pc .shade{position:absolute;inset:0;background:linear-gradient(180deg,',
    '  transparent 38%,rgba(7,10,19,.93) 82%);}',
    '#ui .pc .nm{position:absolute;left:0;right:0;bottom:22px;text-align:center;',
    '  font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;}',
    '#ui .pc .cd{position:absolute;left:0;right:0;bottom:7px;text-align:center;',
    '  font-size:9px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.1em;}',
    '#ui .pc .eqbadge{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;',
    '  background:#3fe0ff;color:#05060d;font:900 11px/20px ' + U.FONT + ';text-align:center;}',
    '#ui .slots{display:flex;gap:9px;margin:4px 0 16px;}',
    '#ui .slot{flex:1;height:56px;border-radius:12px;border:2px dashed rgba(255,255,255,.16);',
    '  display:flex;align-items:center;justify-content:center;font:800 10px/1 ' + U.FONT + ';',
    '  letter-spacing:.14em;color:rgba(255,255,255,.35);text-transform:uppercase;text-align:center;padding:4px;}',
    '#ui .slot.full{border-style:solid;border-color:#3fe0ff;background:rgba(63,224,255,.12);color:#fff;}',
    '#ui .slot.lockd{opacity:.4;}',
    '#ui .note{font-size:12px;color:rgba(255,255,255,.42);font-weight:600;line-height:1.5;margin:0 0 14px;}',

    '#ui .stars{font-size:44px;letter-spacing:8px;text-align:center;margin:6px 0 4px;}',
    '#ui .stars span{display:inline-block;opacity:0;transform:scale(.3);',
    '  animation:pop .45s cubic-bezier(.2,1.6,.4,1) forwards;}',
    '@keyframes pop{to{opacity:1;transform:scale(1);}}',
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
    '#ui .legend{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0 0;}',
    '#ui .lg{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;',
    '  color:rgba(255,255,255,.55);}',
    '#ui .lg em{width:16px;height:16px;border-radius:50%;background:#fff;',
    '  border:3px solid #000;display:block;flex:0 0 16px;}'
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
      '<p class="sub">Build paddles and bumpers on a pinball table.<br>',
      'Flip the ones that get through.<br>',
      'Ignite an enemy and turn it on the swarm.</p>',
      '<div class="legend">',
      '  <div class="lg"><em></em>Enemy ball</div>',
      '  <div class="lg" style="color:#3fe0ff">◗ Your defenses</div>',
      '  <div class="lg" style="color:#ff2e88">▁ Don\'t let them out</div>',
      '</div>',
      '<div class="spacer"></div>',
      '<button class="btn primary" id="play">Play</button>',
      '<button class="btn ghost" id="deck">Deck</button>'
    ].join(''), true);

    on('#play', function () { sfx('ui_tap'); UI.showScreen('levelSelect'); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout'); }, sheet);
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

  function screenLevelSelect() {
    var GAME = global.GAME, LEVELS = global.LEVELS;
    var total = GAME.totalStars();
    var next = LEVELS.nextUnlock(total);

    var rows = '';
    for (var i = 0; i < LEVELS.list.length; i++) {
      var L = LEVELS.list[i];
      var open = GAME.levelUnlocked(L.id);
      var st = GAME.progress.stars[L.id] || 0;
      rows += '<button class="lvl ' + (open ? 'open' : 'locked') + '" data-id="' + L.id + '">' +
        '<span class="num">' + (open ? L.id : '🔒') + '</span>' +
        '<span class="grow"><span class="nm">' + L.name + '</span>' +
        '<span class="ds">' + L.subtitle + '</span></span>' +
        '<span class="st" style="color:' + (st ? '#ffb020' : 'rgba(255,255,255,.2)') + '">' +
        starStr(st) + '</span></button>';
    }

    var sheet = shell([
      '<div class="hdr"><h2>Select Level</h2>',
      '<span class="starcount">★ ' + total + ' / 15</span></div>',
      rows,
      next ? '<p class="note">Next unlock at ★' + next.stars + ' — ' + next.label + '</p>' : '',
      '<div class="spacer"></div>',
      '<div class="row"><button class="btn ghost" id="deck">Deck</button>',
      '<button class="btn ghost" id="back">Title</button></div>'
    ].join(''), true);

    onAll('.lvl', function (n) {
      if (n.classList.contains('locked')) { sfx('ui_error'); return; }
      sfx('ui_tap');
      if (hooks.onStartLevel) hooks.onStartLevel(parseInt(n.getAttribute('data-id'), 10));
    }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout'); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('title'); }, sheet);
  }

  /* The deck builder. Slots unlock with stars, so the loadout decision gets
   * meaningfully harder as the collection grows. */
  function screenLoadout() {
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var total = GAME.totalStars();
    var owned = LEVELS.ownedAt(total);
    var loadout = GAME.progress.loadout;

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

    var sheet = shell([
      '<div class="hdr"><h2>Deck</h2><span class="starcount">★ ' + total + '</span></div>',
      '<p class="note">Cards are active powers you trigger mid-run. Each level also lends you its own card for free.</p>',
      '<div class="slots">' + slots + '</div>',
      '<div class="cardgrid">' + grid + '</div>',
      '<p class="note" id="blurb"><b style="color:' + sel.color + '">' + sel.name + '</b> — ' + sel.long + '</p>',
      '<div class="spacer"></div>',
      '<button class="btn" id="back">Done</button>'
    ].join(''), true);

    onAll('.pc', function (n) {
      var id = n.getAttribute('data-id');
      if (n.classList.contains('lock')) { sfx('ui_error'); return; }
      var idx = loadout.indexOf(id);
      if (idx >= 0) loadout.splice(idx, 1);
      else if (loadout.length < owned.slots) loadout.push(id);
      else { loadout.pop(); loadout.push(id); }
      sfx('ui_tap');
      GAME.saveProgress();
      screenLoadout();
    }, sheet);

    on('#back', function () { sfx('ui_back'); UI.showScreen('levelSelect'); }, sheet);
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

    var sheet = shell([
      '<div class="spacer"></div>',
      '<p class="tag" style="text-align:center;color:' + (d.win ? '#4ade80' : '#ff2e88') + '">',
      d.win ? 'Level Complete' : 'Defenses Breached', '</p>',
      '<p class="title-big">' + d.level.name + '</p>',
      d.win ? '<div class="stars">' + stars + '</div>' :
        '<p class="note" style="text-align:center">Reached wave ' + (d.wave || 1) + ' of ' + (d.waves || '?') + '</p>',
      '<div class="stats">',
      '  <div class="stat"><b style="color:#ff2e88">' + d.lives + '/' + d.livesMax + '</b><i>Lives left</i></div>',
      '  <div class="stat"><b style="color:#fff">' + d.kills + '</b><i>Destroyed</i></div>',
      '  <div class="stat"><b style="color:#ffb020">' + d.earned + '</b><i>Energy earned</i></div>',
      '  <div class="stat"><b style="color:#ff2e88">' + d.leaks + '</b><i>Leaks</i></div>',
      '</div>',
      unl,
      '<div class="spacer"></div>',
      d.win && d.hasNext ? '<button class="btn primary" id="next">Next Level</button>' : '',
      d.win && !d.hasNext ? '<div class="unlock" style="border-color:rgba(74,222,128,.5);background:rgba(74,222,128,.1);color:#4ade80">ALL LEVELS CLEARED — ★' + d.totalStars + ' total</div>' : '',
      '<button class="btn' + (d.win ? ' ghost' : ' primary') + '" id="retry">' + (d.win ? 'Replay' : 'Try Again') + '</button>',
      '<button class="btn ghost" id="menu">Level Select</button>'
    ].join(''), true);

    on('#next', function () { sfx('ui_tap'); global.GAME.nextLevel(); }, sheet);
    on('#retry', function () { sfx('ui_tap'); global.GAME.restartLevel(); }, sheet);
    on('#menu', function () { sfx('ui_back'); global.GAME.quitToMenu(); }, sheet);
  }

  /* ---------------------------------------------------------------------- */

  UI.showScreen = function (name, data) {
    current = name;
    if (!name) {
      root.classList.remove('on');
      root.innerHTML = '';
      return;
    }
    root.classList.add('on');
    if (name === 'title') screenTitle();
    else if (name === 'levelSelect') screenLevelSelect();
    else if (name === 'loadout') screenLoadout();
    else if (name === 'paused') screenPaused();
    else if (name === 'results') screenResults(data);
    root.scrollTop = 0;
  };

  UI.current = function () { return current; };
  UI.isOpen = function () { return !!current; };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : this);
