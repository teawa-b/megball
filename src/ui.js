/* MEGABALL — ui.js
 * DOM overlay screens: title, world picker, level select, deck, pause, results.
 *
 * The canvas owns everything that happens on the table; the DOM owns
 * everything that happens between rounds. Splitting it this way means menus
 * get real text layout and accessibility for free, while gameplay keeps a
 * single scaled coordinate space.
 *
 * Visual language: the same "glossy toy arcade" look as the MEGABALL logo —
 * thick ink outlines, cyan-to-blue gloss, magenta accents, white lettering
 * with a dark rim. Every control is a chunky physical button with a lip that
 * depresses on tap, so menus feel like part of the machine.
 *
 * Attaches window.UI. Depends on: U, LEVELS, CARDS, ENT, GAME, ART, SFX, GLOBE.
 */
(function (global) {
  'use strict';

  var U = global.U;
  var UI = {};

  var root = null;
  var back = null;
  var hooks = {};
  var current = null;

  function sfx(n, o) { var s = global.SFX; if (s && s.play) s.play(n, o); }

  /* ---------------------------------------------------------------------- */
  /* Styles                                                                 */
  /* ---------------------------------------------------------------------- */

  var INK = '#070b18';
  var F = U.FONT;
  /* The pixel face the home screen is set in (src/fonts.js). */
  var PX = '"Ken Pixel","Segoe UI",system-ui,sans-serif';
  /* Headline lettering: white with a soft cyan bloom and a hard drop, so it
   * reads over the painted machine without an outline fighting the art. */
  var GLOW = 'text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 14px rgba(63,224,255,.55);';
  /* Chamfered octagon — the frame shape every panel and button shares. */
  function oct(c) {
    return 'polygon(' + c + 'px 0,calc(100% - ' + c + 'px) 0,100% ' + c + 'px,100% calc(100% - ' + c + 'px),' +
      'calc(100% - ' + c + 'px) 100%,' + c + 'px 100%,0 calc(100% - ' + c + 'px),0 ' + c + 'px)';
  }
  /* Stair-cut corners: the same silhouette as oct() but resolved in whole
   * cells, so it reads as pixel art instead of a machined bevel. */
  function pxc(a) {
    var A = a + 'px', N = 'calc(100% - ' + a + 'px)';
    return 'polygon(' + A + ' 0,' + N + ' 0,' + N + ' ' + A + ',100% ' + A + ',' +
      '100% ' + N + ',' + N + ' ' + N + ',' + N + ' 100%,' + A + ' 100%,' +
      A + ' ' + N + ',0 ' + N + ',0 ' + A + ',' + A + ' ' + A + ')';
  }
  var CY_EDGE = 'linear-gradient(180deg,rgba(143,240,255,.95),rgba(31,143,242,.75) 50%,rgba(63,224,255,.85))';
  var MG_EDGE = 'linear-gradient(180deg,rgba(255,120,190,.95),rgba(200,20,106,.8) 50%,rgba(255,46,136,.9))';
  var DIM_EDGE = 'linear-gradient(180deg,rgba(63,224,255,.42),rgba(31,143,242,.30))';
  var FILL = 'linear-gradient(180deg,rgba(14,26,58,.92),rgba(6,12,30,.96))';
  var FILL_BLUE = 'linear-gradient(180deg,#3a8dff 0%,#1a5be0 40%,#0b2c8c 100%)';
  var FILL_MAG = 'linear-gradient(180deg,rgba(60,14,44,.94),rgba(20,6,26,.96))';
  var FRAMES = '#ui .btn,#ui .panel,#ui .chip,#ui .iconbtn,#ui .tile,#ui .pc,#ui .stat,#ui .gpin,#ui .tagpanel,#ui .unlock,#ui .slot.full,#ui .hprof';

  var CSS = [
    '#ui{position:fixed;inset:0;z-index:20;display:none;font-family:' + F + ';',
    '  color:#fff;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}',
    '#ui.on{display:flex;align-items:stretch;justify-content:center;}',
    '#ui .sheet{position:relative;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;height:100dvh;display:flex;',
    '  flex-direction:column;padding:calc(14px + env(safe-area-inset-top)) 18px calc(16px + env(safe-area-inset-bottom));',
    '  box-sizing:border-box;overflow:hidden;overscroll-behavior:none;}',
    '#ui.on .sheet{animation:screenIn .26s cubic-bezier(.2,.8,.2,1) both;}',
    '@keyframes screenIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',

    /* Backdrop: painted key art, then a veil that keeps text legible. Pinned to
     * the viewport so a scrolling sheet never exposes the canvas beneath. */
    '#ui.nobg .bgimg{display:none;}',
    '#ui .veil,#ui .bgimg,#ui .grain{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;',
    '  transform:translateX(-50%);pointer-events:none;}',
    '#ui .bgimg{background-size:cover;background-position:center 30%;z-index:-3;opacity:.9;background-color:#05060d;}',
    '#ui .veil{z-index:-2;background:',
    '  radial-gradient(90% 40% at 50% 100%,rgba(255,46,136,.14),transparent 70%),',
    '  linear-gradient(180deg,rgba(5,8,20,.80) 0%,rgba(5,8,20,.72) 40%,rgba(5,8,20,.88) 100%);}',
    /* Faint circuit grid: the "tech frame" feel without a second image. */
    '#ui .grain{z-index:-1;opacity:.22;background:',
    '  linear-gradient(90deg,rgba(63,224,255,.10) 1px,transparent 1px) 0 0/28px 28px,',
    '  linear-gradient(180deg,rgba(63,224,255,.10) 1px,transparent 1px) 0 0/28px 28px;',
    '  -webkit-mask:linear-gradient(180deg,rgba(0,0,0,.9),transparent 45%,transparent 60%,rgba(0,0,0,.9));',
    '  mask:linear-gradient(180deg,rgba(0,0,0,.9),transparent 45%,transparent 60%,rgba(0,0,0,.9));}',
    '#ui:not(.hero) .bgimg{filter:blur(2px) saturate(1.15);opacity:.6;transform:translateX(-50%) scale(1.04);}',
    /* Title: light veil at top for the logo, heavy under the buttons. */
    '#ui.hero .bgimg{opacity:1;filter:saturate(1.1) contrast(1.05);animation:heroDrift 20s ease-in-out infinite alternate;}',
    '@keyframes heroDrift{from{transform:translateX(-50%) scale(1.02);}to{transform:translateX(-50%) scale(1.06);}}',
    '#ui.hero .veil{background:',
    '  radial-gradient(80% 30% at 50% 100%,rgba(255,46,136,.20),transparent 70%),',
    '  radial-gradient(120% 50% at 50% -10%,rgba(63,224,255,.16),transparent 60%),',
    '  linear-gradient(180deg,rgba(4,7,18,.55) 0%,rgba(4,7,18,.18) 30%,rgba(4,7,18,.06) 50%,',
    '  rgba(4,7,18,.50) 72%,rgba(4,7,18,.94) 100%);}',

    /* ---- shared chamfered frame ------------------------------------- */
    /* The element paints the glowing edge; ::before paints the fill 2px in.
     * z-index:-1 inside an isolated context keeps it under text and icons. */
    FRAMES + '{position:relative;isolation:isolate;border:0;box-sizing:border-box;clip-path:' + oct(14) + ';background:' + CY_EDGE + ';}',
    FRAMES.replace(/,/g, '::before,') + '::before{content:"";position:absolute;inset:2px;z-index:-1;clip-path:' + oct(13) + ';',
    '  background:' + FILL + ';box-shadow:inset 0 0 26px rgba(63,224,255,.14),inset 0 1px 0 rgba(255,255,255,.12);}',
    /* Outer bloom: filter on the wrapper follows the chamfered silhouettes. */
    '#ui .sheet>.actions,#ui .sheet>.bar,#ui .sheet>.grid,#ui .sheet>.panel,#ui .sheet>.cardgrid,#ui .sheet>.slots,',
    '#ui .sheet>.stats,#ui .sheet>.hero-copy,#ui .sheet>.unlock,#ui .glabels{filter:drop-shadow(0 0 12px rgba(63,224,255,.28)) drop-shadow(0 8px 14px rgba(0,0,0,.5));}',

    /* ---- top bar: every screen has the same three slots -------------- */
    '#ui .bar{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;flex:0 0 auto;margin-bottom:12px;}',
    '#ui .bar .mid{flex:1;text-align:center;min-width:0;}',
    '#ui .bar .side{flex:0 0 auto;min-width:48px;display:flex;justify-content:flex-start;}',
    '#ui .bar .side.r{justify-content:flex-end;}',
    '#ui h2{margin:0;font:900 21px/1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;color:#fff;' + GLOW + '}',
    '#ui .chip{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;clip-path:' + oct(10) + ';color:#ffd24a;',
    '  font:900 13px/1 ' + F + ';letter-spacing:.06em;white-space:nowrap;}',
    '#ui .chip::before{clip-path:' + oct(9) + ';}',
    '#ui .chip svg{width:14px;height:14px;fill:currentColor;}',
    '#ui .iconbtn{width:48px;height:48px;padding:0;display:grid;place-items:center;flex:0 0 48px;clip-path:' + oct(13) + ';',
    '  color:#dff8ff;cursor:pointer;font-family:inherit;transition:transform .07s,filter .15s;}',
    '#ui .iconbtn::before{clip-path:' + oct(12) + ';}',
    '#ui .iconbtn svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 6px rgba(63,224,255,.8));}',
    '#ui .iconbtn:hover{filter:brightness(1.15);}#ui .iconbtn:active{transform:translateY(2px);}',

    /* ---- hero -------------------------------------------------------- */
    '#ui .brand{position:relative;flex:0 0 auto;margin:0 auto;width:min(96%,440px);}',
    '#ui .brand-glow{position:absolute;inset:-18% -10%;border-radius:50%;pointer-events:none;',
    '  background:radial-gradient(45% 45% at 50% 48%,rgba(63,224,255,.30),transparent 70%),',
    '  radial-gradient(35% 35% at 62% 62%,rgba(255,46,136,.24),transparent 70%);filter:blur(8px);',
    '  animation:glowPulse 3.2s ease-in-out infinite;}',
    '@keyframes glowPulse{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}',
    '#ui .brand-logo{position:relative;display:block;width:100%;aspect-ratio:3/1;background-size:contain;',
    '  background-position:center;background-repeat:no-repeat;filter:drop-shadow(0 16px 22px rgba(0,0,0,.65));',
    '  animation:bob 4.2s ease-in-out infinite;}',
    '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}',
    '#ui h1{font-size:clamp(54px,16vw,78px);line-height:.82;margin:0;text-align:center;letter-spacing:-.04em;font-weight:900;color:#fff;' + GLOW + '}',
    '#ui .hero-copy{flex:0 0 auto;margin:-4px 0 0;}',
    '#ui .tagpanel{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 16px;text-align:left;clip-path:' + oct(12) + ';}',
    '#ui .tagpanel::before{clip-path:' + oct(11) + ';}',
    '#ui .tagpanel svg{width:30px;height:30px;flex:0 0 30px;fill:none;stroke:#dff8ff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 6px rgba(63,224,255,.8));}',
    '#ui .tagpanel b{display:block;font:900 13px/1 ' + F + ';letter-spacing:.24em;text-transform:uppercase;color:#fff;' + GLOW + '}',
    '#ui .tagpanel small{display:block;margin-top:6px;font:700 11px/1.3 ' + F + ';color:#9fd8ee;}',
    '#ui .tag{display:inline-block;margin:0;padding:7px 14px;clip-path:' + oct(8) + ';background:' + MG_EDGE + ';color:#fff;font:900 10px/1 ' + F + ';letter-spacing:.26em;text-transform:uppercase;text-shadow:0 1px 0 rgba(0,0,0,.45);}',
    '#ui .sub{margin:12px auto 0;max-width:320px;color:#eaf8ff;font:750 13px/1.4 ' + F + ';text-shadow:0 2px 0 ' + INK + ',0 0 12px rgba(0,0,0,.9);}',
    '#ui .spacer{flex:1 1 auto;min-height:8px;}',
    /* Campaign copy above the globe. */
    '#ui .campaign-title{font:900 clamp(26px,8vw,34px)/1 ' + F + ';letter-spacing:-.02em;text-transform:none;margin:2px 0 8px;' + GLOW + '}',
    '#ui .campaign-copy{margin:0 0 4px;color:#9fd8ee;font:700 12px/1.45 ' + F + ';max-width:340px;text-shadow:0 1px 0 ' + INK + ';}',

    /* ---- buttons ------------------------------------------------------ */
    '#ui .btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;',
    '  padding:0 18px;margin:8px 0;font:900 15px/1 ' + F + ';letter-spacing:.18em;text-transform:uppercase;',
    '  color:#fff;cursor:pointer;text-shadow:0 2px 0 rgba(0,0,0,.55);transition:transform .07s,filter .15s;}',
    '#ui .btn:hover{filter:brightness(1.12);}',
    '#ui .btn:active{transform:translateY(2px);filter:brightness(1.2);}',
    '#ui .btn svg{width:18px;height:18px;flex:0 0 18px;fill:currentColor;filter:drop-shadow(0 0 6px rgba(63,224,255,.8));}',
    '#ui .btn.primary{min-height:70px;font-size:20px;letter-spacing:.2em;' + GLOW + '}',
    '#ui .btn.primary::before{background:' + FILL_BLUE + ';box-shadow:inset 0 2px 0 rgba(255,255,255,.35),inset 0 -6px 14px rgba(0,20,80,.5),inset 0 0 26px rgba(120,200,255,.35);}',
    '#ui .btn.primary svg{width:26px;height:26px;flex:0 0 26px;}',
    '#ui .btn.play{min-height:92px;gap:16px;}',
    '#ui .btn.play svg{width:34px;height:34px;flex:0 0 34px;}',
    '#ui .btn.play b{display:block;font:900 34px/1 ' + F + ';letter-spacing:.14em;' + GLOW + '}',
    '#ui .btn.play small{display:block;margin-top:7px;font:800 11px/1 ' + F + ';letter-spacing:.22em;color:#8fe8ff;text-shadow:0 1px 0 rgba(0,0,0,.6);}',
    '#ui .btn.ghost{color:#cff4ff;}',
    '#ui .btn.mag{background:' + MG_EDGE + ';}',
    '#ui .btn.mag::before{background:' + FILL_MAG + ';box-shadow:inset 0 0 26px rgba(255,46,136,.18),inset 0 1px 0 rgba(255,255,255,.12);}',
    '#ui .btn.mag svg{filter:drop-shadow(0 0 6px rgba(255,46,136,.9));}',
    '#ui .btn.danger{background:' + MG_EDGE + ';}',
    '#ui .btn.danger::before{background:linear-gradient(180deg,#e0186f,#7a0a3c);}',
    /* Icon cards: icon on the left, label + one-line subtitle on the right. */
    '#ui .btn.card{justify-content:flex-start;text-align:left;min-height:78px;padding:0 14px;gap:12px;letter-spacing:0;text-transform:none;}',
    '#ui .btn.card svg{width:32px;height:32px;flex:0 0 32px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}',
    '#ui .btn.card b{display:block;font:900 12px/1 ' + F + ';letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;}',
    '#ui .btn.card small{display:block;margin-top:6px;font:700 10px/1.2 ' + F + ';color:#8fe8ff;}',
    '#ui .btn.card.mag small,#ui .btn.card.mag svg{color:#ff7ac0;}',
    '#ui .btn.card.amb small,#ui .btn.card.amb svg{color:#ffd24a;}',
    '#ui .btn[disabled]{opacity:.5;cursor:not-allowed;}',
    /* Focus for keyboard / gamepad: the edge itself turns white-hot. */
    '#ui :focus{outline:0;}',
    '#ui button:focus-visible{background:linear-gradient(180deg,#fff,#ffd24a)!important;filter:brightness(1.1) drop-shadow(0 0 10px rgba(255,210,74,.8));}',
    '#ui .row{display:flex;gap:10px;margin:8px 0;}#ui .row>*{flex:1;margin:0;}',
    '#ui .actions{flex:0 0 auto;padding-top:8px;}',

    /* ---- panels ------------------------------------------------------- */
    '#ui .panel{padding:14px 16px;background:' + DIM_EDGE + ';}',
    '#ui .kicker{display:block;font:900 10px/1 ' + F + ';letter-spacing:.24em;text-transform:uppercase;color:#3fe0ff;margin-bottom:8px;}',
    '#ui .hint{text-align:center;font:800 10px/1 ' + F + ';letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.55);margin:8px 0 6px;text-shadow:0 1px 0 ' + INK + ';}',

    /* ---- globe (campaign) ------------------------------------------- */
    '#ui .globe{position:relative;flex:1 1 auto;min-height:240px;margin:0 -8px;overflow:hidden;}',
    '#ui .gpin{position:absolute;top:0;left:0;padding:9px 14px;clip-path:' + oct(10) + ';color:#fff;font-family:' + F + ';white-space:nowrap;text-align:center;cursor:pointer;transition:opacity .12s;}',
    '#ui .gpin::before{clip-path:' + oct(9) + ';background:' + FILL_BLUE + ';}',
    '#ui .gpin b{display:block;font:900 13px/1.1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;' + GLOW + '}',
    '#ui .gpin i{display:block;margin-top:4px;font:800 9px/1.1 ' + F + ';letter-spacing:.16em;text-transform:uppercase;font-style:normal;color:#8fe8ff;}',
    '#ui .gpin.lockd{background:' + DIM_EDGE + ';}#ui .gpin.lockd::before{background:' + FILL + ';}',
    '#ui .gpin.lockd b{color:rgba(255,255,255,.7);}#ui .gpin.lockd i{color:#ff7ac0;}',
    '#ui .gpin:active{transform:translate(-50%,-100%) scale(.97);}',

    /* ---- level grid: five stages -------------------------------------- */
    '#ui .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:0 0 12px;flex:0 0 auto;}',
    '#ui .tile{aspect-ratio:.86;padding:0;margin:0;cursor:pointer;font-family:inherit;color:#fff;clip-path:' + oct(11) + ';',
    '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;transition:transform .07s,filter .15s;}',
    '#ui .tile::before{clip-path:' + oct(10) + ';}',
    '#ui .tile:active{transform:translateY(2px);}',
    '#ui .tile .n{font:900 26px/1 ' + F + ';letter-spacing:-.03em;' + GLOW + '}',
    '#ui .tile .st{font-size:9px;letter-spacing:1px;line-height:1;text-shadow:0 1px 0 ' + INK + ';}',
    '#ui .tile.cur::before{background:' + FILL_BLUE + ';box-shadow:inset 0 2px 0 rgba(255,255,255,.35),inset 0 0 22px rgba(120,200,255,.4);}',
    '#ui .tile.locked{cursor:not-allowed;background:rgba(255,255,255,.14);color:rgba(255,255,255,.4);}',
    '#ui .tile.locked::before{background:linear-gradient(180deg,rgba(14,18,40,.9),rgba(8,10,24,.95));box-shadow:none;}',
    '#ui .tile.locked .lk{color:#ff5fb0;opacity:.75;}',
    '#ui .level-name{display:block;color:#fff;font:900 17px/1.1 ' + F + ';letter-spacing:.02em;' + GLOW + '}',
    '#ui .level-subtitle{display:block;margin-top:5px;color:#a9dcef;font:700 12px/1.3 ' + F + ';}',
    '#ui .note{font:700 12px/1.4 ' + F + ';color:rgba(255,255,255,.72);margin:0 0 10px;}',

    /* Objective rows: same markup for level preview and results verdict. */
    '#ui .objs{display:flex;flex-direction:column;gap:6px;margin:10px 0 0;}',
    '#ui .obj{display:flex;align-items:center;gap:10px;padding:9px 11px;clip-path:' + oct(8) + ';',
    '  background:rgba(63,224,255,.07);border-left:3px solid rgba(63,224,255,.45);font:750 12px/1.3 ' + F + ';color:rgba(255,255,255,.82);}',
    '#ui .obj .mk{flex:0 0 22px;width:22px;height:22px;border-radius:50%;text-align:center;font:900 12px/18px ' + F + ';',
    '  border:2px solid rgba(255,255,255,.25);color:rgba(255,255,255,.35);box-sizing:border-box;}',
    '#ui .obj.met{border-left-color:#ffd24a;background:rgba(255,176,32,.12);color:#fff;}',
    '#ui .obj.met .mk{border-color:#ffd24a;background:#ffd24a;color:' + INK + ';}',
    '#ui .obj.failed{opacity:.5;border-left-color:#ff2e88;}#ui .obj.failed .mk{border-color:#ff2e88;color:#ff2e88;}',

    /* ---- power cards ------------------------------------------------ */
    '#ui .cardgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:0 0 10px;}',
    '#ui .pc{display:block;width:100%;padding:0;margin:0;font-family:inherit;color:inherit;overflow:hidden;cursor:pointer;aspect-ratio:3/4;clip-path:' + oct(12) + ';background:' + DIM_EDGE + ';transition:transform .07s;}',
    '#ui .pc::before{clip-path:' + oct(11) + ';}',
    '#ui .pc:active{transform:translateY(2px);}',
    '#ui .pc.eq{background:' + CY_EDGE + ';}',
    '#ui .pc.lock{opacity:.45;cursor:not-allowed;}',
    '#ui .pc .art{position:absolute;inset:2px;z-index:-1;clip-path:' + oct(11) + ';background-size:cover;background-position:center top;}',
    '#ui .pc .shade{position:absolute;inset:2px;z-index:-1;clip-path:' + oct(11) + ';background:linear-gradient(180deg,transparent 40%,rgba(7,10,19,.95) 82%);}',
    '#ui .pc .nm{position:absolute;left:2px;right:2px;bottom:19px;text-align:center;font:900 10px/1 ' + F + ';letter-spacing:.04em;text-transform:uppercase;text-shadow:0 1px 0 ' + INK + ';}',
    '#ui .pc .cd{position:absolute;left:0;right:0;bottom:7px;text-align:center;font:750 8px/1 ' + F + ';color:rgba(255,255,255,.6);letter-spacing:.05em;}',
    '#ui .pc .eqbadge{position:absolute;top:7px;right:7px;width:22px;height:22px;border-radius:50%;background:#3fe0ff;color:' + INK + ';font:900 11px/22px ' + F + ';text-align:center;box-shadow:0 0 10px rgba(63,224,255,.9);}',
    '#ui .slots{display:flex;gap:9px;margin:0 0 10px;}',
    '#ui .slot{flex:1;height:50px;box-sizing:border-box;border:2px dashed rgba(63,224,255,.3);clip-path:' + oct(10) + ';',
    '  display:flex;align-items:center;justify-content:center;font:900 10px/1.2 ' + F + ';letter-spacing:.12em;',
    '  color:rgba(255,255,255,.45);text-transform:uppercase;text-align:center;padding:4px;}',
    '#ui .slot.full{border:0;color:#fff;' + GLOW + '}#ui .slot.full::before{clip-path:' + oct(9) + ';background:' + FILL_BLUE + ';}',
    '#ui .slot.lockd{opacity:.45;}',
    '#ui .unlock{padding:12px 14px;margin:0 0 10px;font:900 12px/1.2 ' + F + ';letter-spacing:.08em;color:#ffd24a;text-align:center;clip-path:' + oct(10) + ';',
    '  background:linear-gradient(180deg,#ffd24a,#ffb020);}',
    '#ui .unlock::before{clip-path:' + oct(9) + ';background:linear-gradient(180deg,rgba(60,40,10,.94),rgba(30,18,4,.96));box-shadow:inset 0 0 22px rgba(255,176,32,.25);}',

    /* ---- results / pause -------------------------------------------- */
    '#ui .title-big{font:900 30px/1 ' + F + ';letter-spacing:.08em;text-align:center;margin:0 0 4px;text-transform:uppercase;' + GLOW + '}',
    '#ui .verdict{display:block;width:max-content;margin:0 auto 12px;}',
    '#ui .stars{font-size:46px;letter-spacing:8px;text-align:center;margin:6px 0 4px;text-shadow:0 0 18px rgba(255,210,74,.6),0 3px 0 ' + INK + ';}',
    '#ui .stars span{display:inline-block;opacity:0;transform:scale(.3);animation:pop .45s cubic-bezier(.2,1.6,.4,1) forwards;}',
    '@keyframes pop{to{opacity:1;transform:scale(1);}}',
    '#ui .stats{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:12px 0;}',
    '#ui .stat{padding:11px 13px;background:' + DIM_EDGE + ';clip-path:' + oct(11) + ';}#ui .stat::before{clip-path:' + oct(10) + ';}',
    '#ui .stat b{display:block;font:900 22px/1 ' + F + ';text-shadow:0 2px 0 ' + INK + ';}',
    '#ui .stat i{display:block;margin-top:5px;font-style:normal;font:800 9px/1 ' + F + ';letter-spacing:.16em;color:rgba(255,255,255,.5);text-transform:uppercase;}',

    /* ---- home: the backglass ----------------------------------------- */
    /* The title screen is the lit backglass of the cabinet in attract mode:
     * the logo on glass, a real 128x32 dot-matrix display cycling messages,
     * the cabinet START button pulsing, and a scorecard of modes with insert
     * lamps. Type is the pixel face (src/fonts.js), the only one shipped. */
    '#ui .sheet.home{padding:calc(8px + env(safe-area-inset-top)) 16px calc(12px + env(safe-area-inset-bottom));}',
    '#ui.on .sheet.home.boot{animation:lampsOn 1s steps(1,end) both;}',
    '@keyframes lampsOn{0%,100%{opacity:1}6%{opacity:.15}12%{opacity:.8}18%{opacity:.1}26%{opacity:.9}33%{opacity:.4}42%{opacity:1}}',
    '#ui.home .bgimg{opacity:.9;filter:saturate(.85) contrast(1.08);animation:heroDrift 24s ease-in-out infinite alternate;}',
    '#ui.home .veil{background:',
    '  radial-gradient(70% 34% at 50% 26%,rgba(63,224,255,.14),transparent 70%),',
    '  radial-gradient(80% 30% at 50% 100%,rgba(255,46,136,.14),transparent 70%),',
    '  linear-gradient(180deg,rgba(4,7,18,.72) 0%,rgba(4,7,18,.30) 22%,rgba(4,7,18,.22) 40%,rgba(4,7,18,.78) 60%,rgba(4,7,18,.96) 100%);}',
    '#ui.home .grain{display:none;}',
    /* Glass over everything: scanlines and a slow reflection sweeping across. */
    '#ui .glass{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;transform:translateX(-50%);',
    '  pointer-events:none;z-index:5;overflow:hidden;',
    '  background:repeating-linear-gradient(180deg,rgba(255,255,255,.04) 0 1px,transparent 1px 3px);}',
    '#ui .glass::after{content:"";position:absolute;top:-10%;bottom:-10%;left:-60%;width:60%;',
    '  background:linear-gradient(105deg,transparent 30%,rgba(143,232,255,.09) 50%,transparent 70%);animation:sweep 11s ease-in-out infinite;}',
    '@keyframes sweep{0%,15%{transform:translateX(0)}70%,100%{transform:translateX(370%)}}',
    /* Readout line: tiny pixel-face status in the corners, no boxes. */
    '#ui .hline{display:flex;justify-content:space-between;align-items:center;min-height:32px;flex:0 0 auto;',
    '  font:12px/1 ' + PX + ';color:rgba(143,232,255,.8);text-transform:uppercase;letter-spacing:.04em;}',
    '#ui .hline .rd{display:inline-flex;align-items:center;gap:7px;padding:6px 0;}',
    '#ui .hline .rd svg{width:12px;height:12px;fill:#ffd24a;filter:drop-shadow(0 0 4px rgba(255,210,74,.8));}',
    '#ui .hline .rd em{font-style:normal;color:#fff;}',
    '#ui .hline .sndbtn{background:none;border:0;padding:6px 0 6px 10px;margin:0;color:#8fe8ff;font:inherit;text-transform:inherit;letter-spacing:inherit;',
    '  display:inline-flex;align-items:center;gap:7px;cursor:pointer;}',
    '#ui .hline .sndbtn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 5px rgba(63,224,255,.8));}',
    '#ui .hline .sndbtn.off{color:rgba(255,255,255,.4);}#ui .hline .sndbtn.off svg{filter:none;}',
    /* Logo on the glass. */
    '#ui .sheet.home .brand{width:min(100%,460px);}',
    '#ui .sheet.home.boot .brand{animation:logoOn .8s cubic-bezier(.2,.8,.2,1) .2s both;}',
    '#ui .sheet.home .brand-logo{animation:bob 5s ease-in-out infinite;}',
    '@keyframes logoOn{from{opacity:0;transform:scale(1.1)}to{opacity:1;transform:none}}',
    /* The wordmark is a wide, short banner, so it rides high on the
     * backglass rather than floating in the middle of the art. */
    '#ui .sheet.home .spacer.top{flex:.28 1 auto;min-height:4px;}',
    '#ui .sheet.home .spacer.mid{flex:.6 1 auto;min-height:8px;}',
    /* The display: a real 128x32 DMD in a black bezel. */
    '#ui .dmd{position:relative;flex:0 0 auto;padding:7px 8px;background:#03050a;',
    '  border:1px solid rgba(63,224,255,.30);box-shadow:inset 0 0 0 2px #000,inset 0 6px 22px rgba(0,0,0,.9),0 0 26px rgba(63,224,255,.12),0 10px 24px rgba(0,0,0,.55);',
    '  animation:dmdOn .3s ease-out both;}',
    '#ui .sheet.home.boot .dmd{animation:dmdOn .5s ease-out .35s both;}',
    '@keyframes dmdOn{from{opacity:0}to{opacity:1}}',
    '#ui .dmd canvas{display:block;width:100%;height:auto;aspect-ratio:4/1;}',
    '#ui .dmd .plate{position:absolute;right:10px;top:-6px;padding:0 5px;background:#05060d;font:8px/10px ' + PX + ';color:rgba(143,232,255,.55);letter-spacing:.14em;text-transform:uppercase;}',
    '#ui .dmd .screw{position:absolute;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:#1c2740;box-shadow:inset 0 0 0 1px rgba(143,232,255,.35);}',
    '#ui .dmd .screw.l{left:2px;}#ui .dmd .screw.r{right:2px;}',
    /* Controls: the cabinet START button beside a scorecard of modes. */
    '#ui .ctl{display:flex;align-items:center;gap:16px;flex:0 0 auto;margin-top:10px;}',
    '#ui .start{flex:0 0 116px;width:116px;height:116px;border-radius:50%;border:0;padding:0;position:relative;cursor:pointer;font-family:inherit;',
    '  background:radial-gradient(circle at 50% 36%,#fff1bf 0%,#ffcf4a 30%,#f39316 60%,#8f4306 100%);',
    '  box-shadow:0 0 0 5px #0a0d18,0 0 0 7px rgba(255,176,32,.5),0 14px 30px rgba(0,0,0,.6),0 0 30px rgba(255,176,32,.3);',
    '  transition:transform .08s,filter .12s;}',
    '#ui .sheet.home.boot .start{animation:startOn .5s cubic-bezier(.2,1.4,.4,1) .55s both;}',
    '@keyframes startOn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
    /* The button used to breathe by animating a 60px-blur box-shadow, which
     * repaints a large area every frame for as long as the menu is open. The
     * same glow now lives on its own halo element and animates only opacity
     * and transform, so the compositor carries it and the paint cost is nil. */
    '#ui .start .halo{position:absolute;inset:-16px;border-radius:50%;pointer-events:none;z-index:0;',
    '  background:radial-gradient(circle,rgba(255,196,60,.5) 38%,rgba(255,176,32,.16) 62%,rgba(255,176,32,0) 76%);',
    '  animation:haloPulse 1.9s ease-in-out infinite;will-change:opacity,transform;}',
    '@keyframes haloPulse{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}',
    '#ui .start::before{content:"";position:absolute;inset:7px;border-radius:50%;border:2px solid rgba(255,255,255,.28);border-bottom-color:rgba(110,45,0,.45);}',
    '#ui .start::after{content:"";position:absolute;left:24%;top:9%;width:52%;height:26%;border-radius:50%;background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(255,255,255,0));}',
    '#ui .start b{position:relative;z-index:1;display:block;font:30px/1 ' + PX + ';color:#3a1600;text-shadow:0 1px 0 rgba(255,255,255,.4);}',
    '#ui .start small{position:relative;z-index:1;display:block;margin-top:5px;font:10px/1 ' + PX + ';color:#5a2600;letter-spacing:.06em;text-transform:uppercase;}',
    '#ui .start:hover{filter:brightness(1.08);}#ui .start:active{transform:scale(.94);filter:brightness(1.18);}',
    '#ui .scard{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}',
    /* A scorecard directly above the back button must not stretch, or the
     * button drifts away from the option it belongs under. */
    '#ui .scard.tight{flex:0 0 auto;}',
    '#ui .sc{display:flex;align-items:center;gap:9px;width:100%;min-height:46px;padding:0 2px;margin:0;background:none;border:0;',
    '  border-bottom:1px solid rgba(63,224,255,.18);color:#fff;font:15px/1 ' + PX + ';text-transform:uppercase;letter-spacing:.02em;text-align:left;cursor:pointer;',
    '  animation:rowIn .45s cubic-bezier(.2,.8,.2,1) both;transition:background .1s;}',
    '#ui .sc:nth-child(1){animation-delay:.05s}#ui .sc:nth-child(2){animation-delay:.11s}#ui .sc:nth-child(3){animation-delay:.17s}#ui .sc:nth-child(4){animation-delay:.23s}',
    '#ui .sheet.home.boot .sc:nth-child(1){animation-delay:.45s}#ui .sheet.home.boot .sc:nth-child(2){animation-delay:.53s}#ui .sheet.home.boot .sc:nth-child(3){animation-delay:.61s}#ui .sheet.home.boot .sc:nth-child(4){animation-delay:.69s}',
    '@keyframes rowIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}',
    '#ui .sc:last-child{border-bottom:0;}',
    '#ui .sc i{position:relative;flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:#3fe0ff;box-shadow:0 0 8px #3fe0ff,0 0 2px #fff;transition:background .1s,box-shadow .1s;}',
    '#ui .sc.mag i{background:#ff2e88;box-shadow:0 0 8px #ff2e88,0 0 2px #fff;}',
    '#ui .sc.amb i{background:#ffd24a;box-shadow:0 0 8px #ffd24a,0 0 2px #fff;}',
    '#ui .sc .lb{flex:0 0 auto;text-shadow:0 0 10px rgba(63,224,255,.35);}',
    '#ui .sc .ld{flex:1 1 auto;min-width:10px;height:2px;margin:0 2px;background:radial-gradient(circle,rgba(143,232,255,.5) 0.8px,transparent 1.3px) 0 0/6px 2px repeat-x;}',
    '#ui .sc .ct{flex:0 0 auto;font-size:12px;color:#ffd24a;text-shadow:0 0 8px rgba(255,210,74,.4);}',
    '#ui .sc:hover{background:rgba(63,224,255,.05);}#ui .sc:active{background:rgba(63,224,255,.10);}',
    '#ui .sc:active i{background:#fff;box-shadow:0 0 12px #fff;}',
    /* Attract lamp rail: the chase from the boot splash, carried onto the
     * backglass so the machine still looks awake while it waits. Only the
     * lamp caps animate, one opacity each, so this is compositor work. */
    '#ui .lamprail{display:flex;justify-content:center;gap:13px;flex:0 0 auto;margin:0 0 9px;}',
    '#ui .lamprail i{position:relative;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.06);',
    '  box-shadow:inset 0 0 0 1px rgba(143,232,255,.22);}',
    '#ui .lamprail i::after{content:"";position:absolute;inset:-1px;border-radius:50%;background:#ffd24a;',
    '  box-shadow:0 0 9px #ffd24a,0 0 2px #fff;opacity:0;animation:railChase 2.4s linear infinite;}',
    '@keyframes railChase{0%,7%{opacity:1}26%,100%{opacity:0}}',
    '#ui .lamprail i:nth-child(2)::after{animation-delay:.17s}#ui .lamprail i:nth-child(3)::after{animation-delay:.34s}',
    '#ui .lamprail i:nth-child(4)::after{animation-delay:.51s}#ui .lamprail i:nth-child(5)::after{animation-delay:.68s}',
    '#ui .lamprail i:nth-child(6)::after{animation-delay:.85s}#ui .lamprail i:nth-child(7)::after{animation-delay:1.02s}',
    '#ui .lamprail i:nth-child(8)::after{animation-delay:1.19s}#ui .lamprail i:nth-child(9)::after{animation-delay:1.36s}',
    /* Insert lamps on the scorecard wink in turn, the way a real cabinet
     * nags you to pick a mode. The dot keeps its own steady glow; a cap on
     * top fades in and out, so nothing repaints. */
    '#ui .sheet.home .sc i::after{content:"";position:absolute;inset:-3px;border-radius:50%;background:inherit;',
    '  opacity:0;animation:insertWink 4.2s ease-in-out infinite;}',
    '@keyframes insertWink{0%,74%,100%{opacity:0}82%,88%{opacity:.5}}',
    '#ui .sheet.home .sc:nth-child(2) i::after{animation-delay:.5s}',
    '#ui .sheet.home .sc:nth-child(3) i::after{animation-delay:1s}',
    '#ui .sheet.home .sc:nth-child(4) i::after{animation-delay:1.5s}',
    /* Attract line. */
    '#ui .attract{flex:0 0 auto;margin:12px 0 0;text-align:center;font:10px/1 ' + PX + ';color:rgba(143,232,255,.7);letter-spacing:.14em;text-transform:uppercase;',
    '  animation:blink 1.7s steps(1,end) .9s infinite;}',
    '@keyframes blink{0%,58%{opacity:1}59%,100%{opacity:.2}}',

    /* ---- machine components shared by every screen -------------------- */
    /* Everything past the home screen speaks the same hardware language:
     * pixel readouts, insert lamps, cabinet buttons, scorecard rows, dark
     * display plates on the dot grid. */
    /* These sheets also carry the `.sub` text class, which lends them a 12px
     * top margin. Left at a full 100dvh they hang 12px past the viewport, so
     * the bottom padding fell off-screen and BACK sat flush on the edge.
     * Subtract the margin, and give the button real clearance underneath. */
    '#ui .sheet.sub{height:calc(100dvh - 12px);padding:calc(8px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom));}',
    '#ui.sub .grain{display:none;}',
    '#ui.sub .bgimg{opacity:.55;filter:blur(2px) saturate(.8);transform:translateX(-50%) scale(1.04);}',
    '#ui.sub .veil{background:radial-gradient(70% 30% at 50% 0%,rgba(63,224,255,.10),transparent 70%),',
    '  linear-gradient(180deg,rgba(4,7,18,.86) 0%,rgba(4,7,18,.80) 50%,rgba(4,7,18,.94) 100%);}',
    '#ui.pause .veil{background:rgba(4,7,18,.74);}',
    /* Pixel back button: the way out of every sub-screen, parked at the
     * bottom of the sheet under the last option rather than floating above
     * the readout where it competed with the star count. */
    '#ui .pxbk{display:flex;align-items:center;justify-content:center;gap:11px;width:100%;min-height:46px;',
    '  margin:10px 0 0;padding:0 16px;border:0;position:relative;isolation:isolate;box-sizing:border-box;flex:0 0 auto;',
    '  cursor:pointer;color:#8fe8ff;font:15px/1 ' + PX + ';text-transform:uppercase;letter-spacing:.12em;',
    '  clip-path:' + pxc(5) + ';background:' + DIM_EDGE + ';transition:transform .08s,color .12s;}',
    '#ui .pxbk::before{content:"";position:absolute;inset:3px;z-index:-1;clip-path:' + pxc(4) + ';',
    '  background:linear-gradient(180deg,rgba(12,22,48,.96),rgba(5,9,22,.98));',
    '  box-shadow:inset 0 0 22px rgba(63,224,255,.12),inset 0 1px 0 rgba(255,255,255,.10);}',
    '#ui .pxbk .pxa{width:16px;height:16px;flex:0 0 16px;fill:currentColor;',
    '  filter:drop-shadow(0 0 6px rgba(63,224,255,.75));}',
    '#ui .pxbk:hover{color:#dffaff;}',
    '#ui .pxbk:active{transform:scale(.985);color:#fff;}',
    /* The sheet is fixed-height and clipped, so the slack the button needs
     * comes out of the spacer rather than the bottom padding. */
    '#ui .sheet.sub .spacer{min-height:0;}',
    /* Only the star readout lives up here now, so it needs less room. */
    '#ui .hline.sub{min-height:26px;}',
    /* Headings and copy. */
    '#ui .pxh{margin:6px 0 4px;font:22px/1.1 ' + PX + ';color:#fff;text-transform:uppercase;letter-spacing:.02em;flex:0 0 auto;',
    '  text-shadow:0 0 14px rgba(63,224,255,.45),0 2px 0 rgba(0,0,0,.6);}',
    '#ui .pxh small{display:block;margin-top:6px;font:12px/1.2 ' + PX + ';color:rgba(143,232,255,.8);letter-spacing:.06em;text-shadow:none;}',
    '#ui .copy{margin:0 0 8px;font:700 12.5px/1.45 ' + F + ';color:rgba(255,255,255,.72);max-width:340px;flex:0 0 auto;}',
    '#ui .kick{display:block;font:10px/1 ' + PX + ';letter-spacing:.14em;color:#ffd24a;text-transform:uppercase;margin-bottom:7px;text-shadow:0 0 8px rgba(255,210,74,.5);}',
    /* Cabinet button: the wide lit control. Amber by default; cyan and
     * magenta variants for secondary and destructive actions. */
    '#ui .cab{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:64px;margin:10px 0 0;padding:0 16px;',
    '  border:0;border-radius:14px;position:relative;cursor:pointer;font-family:inherit;color:#3a1600;flex:0 0 auto;box-sizing:border-box;',
    '  background:radial-gradient(120% 140% at 50% 20%,#fff1bf 0%,#ffcf4a 30%,#f39316 65%,#9a4a06 100%);',
    '  box-shadow:0 0 0 3px #0a0d18,0 0 0 5px rgba(255,176,32,.35),0 10px 22px rgba(0,0,0,.55),0 0 26px rgba(255,176,32,.25);',
    '  transition:transform .08s,filter .12s;animation:cabOn .45s cubic-bezier(.2,1.2,.4,1) .2s both;}',
    '@keyframes cabOn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}',
    /* The results screen's one button keeps asking. A real cabinet does this
     * with a flashing START lamp; here the whole cap hops on a short loop and
     * a ring of light breathes under it, so "go again" is never a row the eye
     * has to find. */
    '#ui .cab.bounce{animation:cabOn .45s cubic-bezier(.2,1.2,.4,1) .2s both,cabHop 1.5s cubic-bezier(.34,1.56,.64,1) .9s 3;}',
    /* Three hops to catch the eye, then it settles into a slow breathing
     * rim so it keeps asking without nagging while the stats are read. The
     * glow lives INSIDE the cap: the sheet clips anything past the button's
     * box, so an outer halo and a scaled-up hop both lost their edges. */
    '#ui .cab.bounce::before{content:"";position:absolute;inset:3px;border-radius:11px;pointer-events:none;',
    '  box-shadow:inset 0 0 0 2px rgba(255,255,255,.55),inset 0 0 22px rgba(255,236,160,.75);animation:cabGlow 1.5s ease-in-out .9s 3,cabBreathe 2.6s ease-in-out 5.4s infinite;}',
    '#ui .cab.bounce:active{animation-play-state:paused;}',
    '@keyframes cabHop{0%,100%{transform:none}14%{transform:translateY(-7px)}28%{transform:translateY(0) scaleY(.97)}40%{transform:translateY(-3px)}52%{transform:none}}',
    '@keyframes cabGlow{0%,100%{opacity:.25}14%{opacity:1}52%{opacity:.4}}',
    '@keyframes cabBreathe{0%,100%{opacity:.25}50%{opacity:.7}}',
    '#ui .sc.stat.pow i{background:#ff8a2a;box-shadow:0 0 8px #ff8a2a;}#ui .sc.stat .ct.pow{color:#ffb070;}',
    '@keyframes cabHop{0%,100%{transform:none}14%{transform:translateY(-6px) scale(1.05)}28%{transform:translateY(0) scale(.98,1.02)}40%{transform:translateY(-3px) scale(1.02)}52%{transform:none}}',
    '#ui .cab::after{content:"";position:absolute;left:10%;top:6px;width:80%;height:30%;border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0));pointer-events:none;}',
    '#ui .cab b{position:relative;z-index:1;font:20px/1 ' + PX + ';text-transform:uppercase;letter-spacing:.04em;text-shadow:0 1px 0 rgba(255,255,255,.35);}',
    '#ui .cab small{position:relative;z-index:1;margin-top:5px;font:10px/1 ' + PX + ';letter-spacing:.08em;text-transform:uppercase;color:#5a2600;}',
    '#ui .cab:active{transform:scale(.98);filter:brightness(1.12);}',
    '#ui .cab.cyan{color:#dffaff;background:radial-gradient(120% 140% at 50% 20%,#1b3d66 0%,#0d2242 45%,#070f22 100%);',
    '  box-shadow:0 0 0 3px #0a0d18,0 0 0 5px rgba(63,224,255,.35),0 10px 22px rgba(0,0,0,.55),0 0 22px rgba(63,224,255,.18);}',
    '#ui .cab.cyan b{text-shadow:0 0 12px rgba(63,224,255,.6);}#ui .cab.cyan small{color:#8fe8ff;}#ui .cab.cyan::after{opacity:.35;}',
    '#ui .cab.mag{color:#ffe1ee;background:radial-gradient(120% 140% at 50% 20%,#6b1440 0%,#3a0a24 45%,#160512 100%);',
    '  box-shadow:0 0 0 3px #0a0d18,0 0 0 5px rgba(255,46,136,.4),0 10px 22px rgba(0,0,0,.55),0 0 22px rgba(255,46,136,.2);}',
    '#ui .cab.mag b{text-shadow:0 0 12px rgba(255,46,136,.6);}#ui .cab.mag small{color:#ff7ac0;}#ui .cab.mag::after{opacity:.3;}',
    '#ui .cab[disabled]{opacity:.45;cursor:not-allowed;}',
    /* Scorecard rows as read-only stats. */
    '#ui .scard.stats{margin-top:4px;}',
    '#ui .sc.stat{cursor:default;animation:none;}#ui .sc.stat .ct{font-size:15px;color:#fff;}',
    '#ui .sc.stat .ct.amb{color:#ffd24a;}#ui .sc.stat .ct.mag{color:#ff7ac0;}#ui .sc.stat .ct.cy{color:#3fe0ff;}#ui .sc.stat .ct.grn{color:#7df0a6;}#ui .sc.grn i{background:#7df0a6;box-shadow:0 0 8px #7df0a6,0 0 2px #fff;}',
    '#ui .sc.stat:active{background:none;}#ui .sc.cy i{background:#3fe0ff;}',
    /* Level inserts: five stages, star lamps under each number. */
    '#ui .insrow{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0 12px;flex:0 0 auto;}',
    '#ui .ins{position:relative;aspect-ratio:.9;margin:0;padding:0;border:0;border-radius:10px;cursor:pointer;font-family:inherit;color:#fff;',
    '  background:linear-gradient(180deg,#0d1730,#070b18);box-shadow:inset 0 0 0 1px rgba(63,224,255,.25),0 6px 14px rgba(0,0,0,.5);',
    '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;transition:transform .07s,box-shadow .15s;}',
    '#ui .ins b{font:26px/1 ' + PX + ';text-shadow:0 0 12px rgba(63,224,255,.5);}',
    '#ui .ins .lamps{display:flex;gap:4px;}',
    '#ui .ins .lamps i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);}',
    '#ui .ins .lamps i.on{background:#ffd24a;box-shadow:0 0 8px #ffd24a,0 0 2px #fff;}',
    '#ui .ins.cur{box-shadow:inset 0 0 0 2px #ffd24a,0 0 18px rgba(255,210,74,.45),0 6px 14px rgba(0,0,0,.5);}',
    '#ui .ins.cur b{color:#fff3c8;text-shadow:0 0 12px rgba(255,210,74,.7);}',
    '#ui .ins.locked{cursor:not-allowed;background:linear-gradient(180deg,#0a0f1e,#05070f);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:rgba(255,255,255,.35);}',
    '#ui .ins.locked svg{width:20px;height:20px;stroke:#ff5fb0;opacity:.7;}',
    '#ui .ins:active{transform:translateY(2px);}',
    /* Plate: a dark readout panel for descriptions. */
    '#ui .plate{position:relative;padding:12px 14px;border-radius:10px;background:rgba(3,5,10,.82);flex:0 0 auto;',
    '  box-shadow:inset 0 0 0 1px rgba(63,224,255,.22),inset 0 6px 18px rgba(0,0,0,.6);}',
    '#ui .plate .nm{display:block;font:18px/1.1 ' + PX + ';color:#fff;text-transform:uppercase;text-shadow:0 0 12px rgba(63,224,255,.45);}',
    '#ui .plate .sub{display:block;margin:5px 0 0;max-width:none;font:700 12px/1.35 ' + F + ';color:#a9dcef;text-shadow:none;}',
    /* Objective rows: a lamp and the promise. */
    '#ui .objs{display:flex;flex-direction:column;gap:0;margin:8px 0 0;}',
    '#ui .obj{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid rgba(63,224,255,.14);background:none;border-left:0;clip-path:none;',
    '  font:700 12px/1.3 ' + F + ';color:rgba(255,255,255,.82);}',
    '#ui .obj:last-child{border-bottom:0;}',
    '#ui .obj .mk{flex:0 0 9px;width:9px;height:9px;border-radius:50%;border:0;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);font-size:0;line-height:0;color:transparent;}',
    '#ui .obj.met{background:none;border-left:0;color:#fff;}#ui .obj.met .mk{background:#ffd24a;box-shadow:0 0 8px #ffd24a,0 0 2px #fff;}',
    '#ui .obj.failed{opacity:.6;border-left:0;}#ui .obj.failed .mk{background:#ff2e88;box-shadow:0 0 8px #ff2e88;border:0;}',
    /* Power cards: sockets and art tiles. */
    '#ui .slots{display:flex;gap:8px;margin:6px 0 10px;flex:0 0 auto;}',
    '#ui .slot{flex:1;height:46px;box-sizing:border-box;border:1px dashed rgba(63,224,255,.3);border-radius:9px;clip-path:none;background:rgba(3,5,10,.6);',
    '  display:flex;align-items:center;justify-content:center;gap:6px;font:10px/1.2 ' + PX + ';letter-spacing:.06em;color:rgba(255,255,255,.4);text-transform:uppercase;text-align:center;padding:4px;}',
    '#ui .slot.full{border:1px solid rgba(63,224,255,.5);color:#dffaff;background:linear-gradient(180deg,#0f2244,#08122a);box-shadow:0 0 14px rgba(63,224,255,.18);text-shadow:0 0 8px rgba(63,224,255,.6);isolation:auto;}',
    '#ui .slot.full::before{content:"";position:static;inset:auto;z-index:auto;clip-path:none;width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#3fe0ff;box-shadow:0 0 8px #3fe0ff;}',
    '#ui .slot.lockd{opacity:.5;}',
    '#ui .cardgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 10px;flex:0 0 auto;}',
    '#ui .pc{display:block;position:relative;width:100%;padding:0;margin:0;font-family:inherit;color:inherit;overflow:hidden;cursor:pointer;aspect-ratio:3/4;isolation:auto;',
    '  clip-path:none;border-radius:9px;background:#070b18;box-shadow:inset 0 0 0 1px rgba(63,224,255,.28),0 6px 14px rgba(0,0,0,.5);transition:transform .07s;}',
    '#ui .pc::before{display:none;}',
    '#ui .pc:active{transform:translateY(2px);}',
    '#ui .pc.eq{background:#070b18;box-shadow:inset 0 0 0 2px #ffd24a,0 0 16px rgba(255,210,74,.35),0 6px 14px rgba(0,0,0,.5);}',
    '#ui .pc.lock{opacity:.4;cursor:not-allowed;}',
    '#ui .pc .art{position:absolute;inset:0;z-index:0;clip-path:none;background-size:cover;background-position:center top;}',
    '#ui .pc .shade{position:absolute;inset:0;z-index:0;clip-path:none;background:linear-gradient(180deg,transparent 40%,rgba(3,5,10,.96) 78%);}',
    '#ui .pc .nm{position:absolute;left:4px;right:4px;bottom:18px;z-index:1;text-align:center;font:10px/1 ' + PX + ';letter-spacing:.03em;text-transform:uppercase;text-shadow:0 1px 0 ' + INK + ';}',
    '#ui .pc .cd{position:absolute;left:0;right:0;bottom:7px;z-index:1;text-align:center;font:8px/1 ' + PX + ';color:rgba(255,255,255,.55);letter-spacing:.04em;}',
    '#ui .pc .eqbadge{position:absolute;top:6px;right:6px;z-index:1;width:20px;height:20px;border-radius:50%;background:#ffd24a;color:' + INK + ';font:11px/20px ' + PX + ';text-align:center;box-shadow:0 0 10px rgba(255,210,74,.9);}',
    /* Unlock plate. */
    '#ui .unlock{display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 0 8px;clip-path:none;border-radius:9px;background:rgba(3,5,10,.85);isolation:auto;',
    '  box-shadow:inset 0 0 0 1px rgba(255,210,74,.55),0 0 18px rgba(255,210,74,.2);font:11px/1.3 ' + PX + ';letter-spacing:.06em;color:#ffd24a;text-align:left;text-transform:uppercase;flex:0 0 auto;}',
    '#ui .unlock::before{content:"";position:static;inset:auto;z-index:auto;clip-path:none;width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:#ffd24a;box-shadow:0 0 8px #ffd24a;}',
    '#ui .unlock.good{box-shadow:inset 0 0 0 1px rgba(125,240,166,.55),0 0 18px rgba(125,240,166,.2);color:#7df0a6;}#ui .unlock.good::before{background:#7df0a6;box-shadow:0 0 8px #7df0a6;}',
    /* Unlock plate over the title (Endless). Dark glass, then a gold-edged
     * pixel-cut card carrying the same lamps, display and cabinet button the
     * rest of the backglass uses. */
    '#ui .pop{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;padding:20px 16px;',
    '  background:rgba(4,7,18,.78);animation:dmdOn .25s ease-out both;}',
    '#ui .pop-card{width:min(100%,360px);padding:12px 14px 14px;position:relative;isolation:isolate;box-sizing:border-box;display:flex;flex-direction:column;',
    '  clip-path:' + pxc(6) + ';background:linear-gradient(180deg,#ffe38a,#ffb020 50%,#ffd24a);animation:popIn .5s cubic-bezier(.2,1.4,.4,1) .05s both;}',
    '#ui .pop-card::before{content:"";position:absolute;inset:3px;z-index:-1;clip-path:' + pxc(5) + ';',
    '  background:linear-gradient(180deg,rgba(14,22,48,.98),rgba(5,9,22,.99));box-shadow:inset 0 0 28px rgba(255,210,74,.16),inset 0 1px 0 rgba(255,255,255,.1);}',
    '#ui .pop .starlamps{margin:2px 0 8px;}',
    '#ui .pop .kick{text-align:center;margin-bottom:6px;}',
    '#ui .pop .dmd{margin:0 0 10px;}',
    '#ui .pop-h{display:block;text-align:center;font:24px/1.05 ' + PX + ';color:#fff;text-transform:uppercase;letter-spacing:.02em;' + GLOW + '}',
    '#ui .pop-h small{display:block;margin-top:7px;font:14px/1 ' + PX + ';color:#ffd24a;letter-spacing:.16em;text-shadow:0 0 10px rgba(255,210,74,.6);}',
    '#ui .pop-sub{margin:10px 0 0;text-align:center;font:700 12.5px/1.45 ' + F + ';color:#a9dcef;}',
    '#ui .pop .cab{margin-top:12px;}',
    '#ui .pop .pxbk{margin-top:8px;min-height:40px;font-size:13px;}',
    '@keyframes popIn{from{transform:scale(.86)}to{transform:none}}',
    /* Results: three star lamps. */
    '#ui .starlamps{display:flex;justify-content:center;gap:16px;margin:12px 0 4px;flex:0 0 auto;}',
    '#ui .starlamps i{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14);opacity:0;transform:scale(.4);animation:pop .45s cubic-bezier(.2,1.6,.4,1) forwards;}',
    '#ui .starlamps i.on{background:radial-gradient(circle at 40% 35%,#fff6d0,#ffd24a 55%,#e09a00);box-shadow:0 0 18px rgba(255,210,74,.8),0 0 4px #fff;}',
    /* Globe pins as readout plates. */
    '#ui .gpin{clip-path:none;padding:7px 12px;border-radius:8px;background:rgba(3,5,10,.9);isolation:auto;box-shadow:inset 0 0 0 1px rgba(63,224,255,.6),0 0 14px rgba(63,224,255,.25);}',
    '#ui .gpin::before{display:none;}',
    '#ui .gpin b{font:12px/1.1 ' + PX + ';letter-spacing:.06em;text-shadow:0 0 10px rgba(63,224,255,.6);}',
    '#ui .gpin i{font:8px/1.1 ' + PX + ';letter-spacing:.1em;}',
    '#ui .gpin.lockd{box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);background:rgba(3,5,10,.8);}',
    '#ui .attract.static{animation:none;color:rgba(143,232,255,.55);margin:6px 0 2px;}',
    '#ui .sheet.sub .globe{margin:0 -8px;min-height:220px;}',
    '#ui .sheet.sub .dmd{margin-top:4px;}',

    /* ---- translite window: painted art behind glass ----------------- */
    '#ui .translite{position:relative;flex:0 0 auto;height:150px;margin:8px 0 10px;border-radius:12px;overflow:hidden;',
    '  background:#05070f center/cover no-repeat;box-shadow:inset 0 0 0 1px rgba(63,224,255,.35),0 0 24px rgba(63,224,255,.12),0 10px 24px rgba(0,0,0,.55);',
    '  animation:tlIn .35s ease-out both;}',
    '#ui .translite.tall{height:168px;}',
    '@keyframes tlIn{from{opacity:.35}to{opacity:1}}',
    '#ui .translite::before{content:"";position:absolute;inset:0;pointer-events:none;',
    '  background:repeating-linear-gradient(180deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px);}',
    '#ui .tl-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,5,10,.02) 30%,rgba(3,5,10,.92) 100%);}',
    '#ui .tl-cap{position:absolute;left:14px;right:14px;bottom:11px;}',
    '#ui .tl-cap .kick{margin-bottom:5px;}',
    '#ui .tl-cap .nm{display:block;font:20px/1 ' + PX + ';color:#fff;text-transform:uppercase;text-shadow:0 0 12px rgba(63,224,255,.5),0 2px 0 rgba(0,0,0,.7);}',
    '#ui .tl-cap .sub{display:block;margin-top:5px;font:700 12px/1.3 ' + F + ';color:#a9dcef;text-shadow:0 1px 0 rgba(0,0,0,.6);}',
    '#ui .plate.slim{padding:2px 14px;}',
    /* ---- featured card: art beside its readout ------------------------ */
    '#ui .feat{display:flex;gap:12px;align-items:stretch;flex:0 0 auto;margin:8px 0 10px;padding:10px;border-radius:12px;',
    '  background:rgba(3,5,10,.82);box-shadow:inset 0 0 0 1px rgba(63,224,255,.22),inset 0 6px 18px rgba(0,0,0,.6);animation:tlIn .3s ease-out both;}',
    '#ui .feat-art{flex:0 0 96px;height:96px;border-radius:9px;position:relative;overflow:hidden;background:#070b18 center/cover no-repeat;',
    '  box-shadow:inset 0 0 0 1px rgba(63,224,255,.35),0 0 16px rgba(63,224,255,.15);}',
    '#ui .feat-art::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(255,255,255,.04) 0 1px,transparent 1px 3px);}',
    '#ui .feat.lock .feat-art{filter:grayscale(.7) brightness(.55);}',
    '#ui .feat-txt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;}',
    '#ui .feat-txt .kick{margin-bottom:5px;}',
    '#ui .feat-txt .nm{display:block;font:18px/1 ' + PX + ';color:#fff;text-transform:uppercase;text-shadow:0 0 12px rgba(63,224,255,.45);}',
    /* No line clamp: four of the six cards need a fourth line, and a card
     * whose description ends in an ellipsis is a card the player cannot
     * evaluate. The panel sizes to its text and the spacer below absorbs
     * the difference. */
    '#ui .feat-txt .sub{display:block;margin-top:5px;font:700 11.5px/1.35 ' + F + ';color:#a9dcef;}',
    '#ui .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}',
    '#ui .chips i{font:8px/1 ' + PX + ';font-style:normal;letter-spacing:.08em;text-transform:uppercase;color:#8fe8ff;padding:4px 7px;border-radius:6px;',
    '  background:rgba(63,224,255,.08);box-shadow:inset 0 0 0 1px rgba(63,224,255,.3);}',
    '#ui .chips i.amb{color:#ffd24a;background:rgba(255,210,74,.08);box-shadow:inset 0 0 0 1px rgba(255,210,74,.4);}',
    '#ui .chips i.mag{color:#ff7ac0;background:rgba(255,46,136,.08);box-shadow:inset 0 0 0 1px rgba(255,46,136,.4);}',
    '#ui .chips i.grn{color:#7df0a6;background:rgba(125,240,166,.08);box-shadow:inset 0 0 0 1px rgba(125,240,166,.4);}',

    /* ---- short phones ------------------------------------------------ */
    '@media(max-height:720px){#ui .sheet{padding-top:calc(10px + env(safe-area-inset-top));padding-bottom:calc(10px + env(safe-area-inset-bottom));}',
    '  #ui .bar{margin-bottom:8px;min-height:42px}#ui .btn{min-height:50px;margin:6px 0}#ui .btn.primary{min-height:60px;font-size:18px}',
    '  #ui .btn.play{min-height:76px}#ui .btn.play b{font-size:28px}#ui .btn.card{min-height:64px}',
    '  #ui .obj{padding:7px 10px}#ui .objs{gap:4px;margin-top:6px}#ui .slots{margin-bottom:7px}',
    '  #ui .pc{aspect-ratio:1.05}#ui .pc .nm{font-size:8px}#ui .cardgrid{gap:6px;margin-bottom:7px}',
    '  #ui .brand{width:min(84%,340px)}#ui .translite{height:118px;margin:6px 0 8px}#ui .translite.tall{height:130px}#ui .feat-art{flex-basis:78px;height:78px}#ui .feat{margin:6px 0 8px;padding:8px}#ui .feat-txt .sub{font-size:10.5px;line-height:1.3;margin-top:4px}#ui .pxh{font-size:19px}#ui .cab{min-height:56px}#ui .cab b{font-size:18px}#ui .ins b{font-size:22px}#ui .sheet.sub .globe{min-height:190px}#ui .sheet.home .brand{width:min(96%,420px)}#ui .start{flex-basis:98px;width:98px;height:98px}#ui .start b{font-size:26px}#ui .sc{min-height:40px;font-size:14px}#ui .dmd{padding:5px 6px}#ui .attract{margin-top:8px}#ui .sheet.home .spacer{min-height:0}#ui .tagpanel{min-height:54px;padding:8px 14px}#ui .panel{padding:11px 13px}#ui .globe{min-height:200px}#ui .pxbk{min-height:40px;font-size:13px;margin-top:8px}#ui .hline.sub{min-height:22px}}',
    /* The tall sheets - results, the deck - ran past the viewport on a phone
     * whose browser keeps a toolbar at the bottom, and the last row (LEVELS,
     * or the HOME button) sat under the toolbar, unreachable. Every sub-sheet
     * is now allowed to scroll, so whatever the viewport does the last row
     * can be reached; and below ~800px the tall sheets pack tighter, so on
     * most phones they still fit without scrolling at all. The globe keeps
     * shrinking first, as before; plates, cards and grids hold their size. */
    '#ui .sheet.sub{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}',
    '#ui .sheet.sub .scard,#ui .sheet.sub .plate,#ui .sheet.sub .dmd,#ui .sheet.sub .grid,#ui .sheet.sub .feat,#ui .sheet.sub .unlock,#ui .sheet.sub .cab,#ui .sheet.sub .pxbk{flex-shrink:0;}',
    '@media(max-height:800px){',
    '  #ui .sheet.sub .sc{min-height:36px;font-size:13.5px}#ui .sheet.sub .sc.stat .ct{font-size:14px}',
    '  #ui .sheet.sub .obj{padding:5px 2px}#ui .sheet.sub .objs{margin-top:4px}#ui .sheet.sub .plate{padding:8px 12px}',
    '  #ui .sheet.sub .starlamps{margin:6px 0 0}#ui .sheet.sub .starlamps i{width:18px;height:18px}',
    '  #ui .sheet.sub .unlock{padding:7px 12px;margin:0 0 4px}#ui .sheet.sub .cab{min-height:52px;margin-top:6px}',
    '  #ui .sheet.sub .spacer{min-height:2px}#ui .sheet.results-screen .copy{margin:6px 0 2px!important}',
    '  #ui .sheet.sub .pc{aspect-ratio:1/1}#ui .sheet.sub .grid{gap:7px;margin-bottom:8px}',
    '  #ui .sheet.sub .feat{margin:6px 0 6px;padding:8px}#ui .sheet.sub .slots{margin:4px 0 6px}#ui .sheet.sub .slot{height:40px}',
    '  #ui .sheet.sub .pxbk{min-height:38px;margin-top:6px}',
    '}',
    /* The deck is the tallest of them all: a display, a featured card, the
     * slot row and a 5-wide grid. One more notch below ~700px so it clears
     * a browser toolbar on a small phone without needing the scroll. */
    '@media(max-height:700px){',
    '  #ui .sheet.sub .feat{margin:4px 0 5px;padding:7px}#ui .sheet.sub .feat-art{flex-basis:70px;height:70px}',
    '  #ui .sheet.sub .grid{gap:6px;margin-bottom:6px}#ui .sheet.sub .slot{height:36px}#ui .sheet.sub .slots{margin:3px 0 5px}',
    '  #ui .sheet.sub .dmd{padding:4px 6px}#ui .sheet.sub .hline{min-height:26px}',
    '}',
    '@media(max-height:600px){#ui .sheet.sub{padding-bottom:calc(14px + env(safe-area-inset-bottom))}#ui .attract{display:none}#ui .translite{height:98px;margin:5px 0 6px}#ui .insrow{margin:8px 0 8px}#ui .pxbk{min-height:36px;font-size:12px;margin-top:6px}#ui .sheet.home .brand{width:min(88%,380px)}#ui .start{flex-basis:88px;width:88px;height:88px}#ui .sc{min-height:36px}}',
    '@media(prefers-reduced-motion:reduce){#ui *{animation:none!important;transition:none!important}}'
  ].join('\n');

  /* ---------------------------------------------------------------------- */

  UI.init = function (h) {
    hooks = h || {};
    var style = document.createElement('style');
    if (global.FONTS && global.FONTS.inject) global.FONTS.inject();
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);

    /* The backdrop (key art, veil, grid, glass) is built once and stays put
     * across screen changes; only the sheet is swapped, so a change is a
     * cross-fade over a steady picture rather than a rebuild. */
    back = document.createElement('div');
    back.className = 'back';
    back.innerHTML = '<div class="bgimg"></div><div class="veil"></div><div class="grain"></div><div class="glass"></div>';
    root.appendChild(back);

    /* The globe sizes itself to its box, which changes with the viewport. */
    global.addEventListener('resize', function () {
      if (global.GLOBE && global.GLOBE.mounted) global.GLOBE.resize();
    });

    document.addEventListener('keydown', onKey, true);
  };

  /* ---- keyboard / gamepad-style navigation --------------------------- */
  /* Arrows move focus to the geometrically nearest control in that
   * direction; Enter/Space press it (native button behaviour); Escape or
   * Backspace is "back". Nothing is focused until the first arrow press, so
   * touch players never see a ring. Keys are swallowed here so the flipper
   * bindings in game.js stay quiet while a menu is up. */
  function focusables() {
    var ns = root.querySelectorAll('button:not([disabled])');
    var out = [];
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (n.classList.contains('locked') || n.classList.contains('lock')) continue;
      var r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(n).opacity !== '0') out.push(n);
    }
    return out;
  }

  function moveFocus(dx, dy) {
    var list = focusables();
    if (!list.length) return;
    var cur = document.activeElement;
    if (!cur || !root.contains(cur) || list.indexOf(cur) < 0) {
      var p = root.querySelector('.cab,.start,.btn.primary') || list[0];
      p.focus();
      return;
    }
    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === cur) continue;
      var b = n.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var vx = bx - ax, vy = by - ay;
      var along = vx * dx + vy * dy;          // progress in the pressed direction
      if (along < 4) continue;
      var across = Math.abs(vx * dy) + Math.abs(vy * dx);
      var score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) best.focus();
  }

  function onKey(e) {
    if (!current || !root) return;
    var c = e.code;
    var isArrow = c === 'ArrowUp' || c === 'ArrowDown' || c === 'ArrowLeft' || c === 'ArrowRight';
    if (isArrow) {
      e.preventDefault(); e.stopPropagation();
      moveFocus(c === 'ArrowRight' ? 1 : c === 'ArrowLeft' ? -1 : 0,
        c === 'ArrowDown' ? 1 : c === 'ArrowUp' ? -1 : 0);
      return;
    }
    if (c === 'Enter' || c === 'Space') {
      /* Buttons already click themselves on Enter/Space; just keep the game
       * from treating the same press as a wave start. */
      e.stopPropagation();
      if (!(document.activeElement && root.contains(document.activeElement))) {
        var p = root.querySelector('.cab,.start,.btn.primary');
        if (p) { e.preventDefault(); p.click(); }
      }
      return;
    }
    if (c === 'Escape' || c === 'Backspace') {
      if (current === 'paused') return;             // game.js resumes on Escape
      var back = root.querySelector('#back');
      if (back) { e.preventDefault(); e.stopPropagation(); back.click(); }
    }
  }

  /* ---------------------------------------------------------------------- */

  function bgStyle(key) {
    var a = global.ART && global.ART.get ? global.ART.get(key) : null;
    return a ? 'background-image:url(' + a.src + ')' : '';
  }

  var ICON = {
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"></path><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"></path></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"></path><path d="m16 9 5 6M21 9l-5 6"></path></svg>',
    /* Back arrow drawn on an 8x8 grid as whole cells, so it stays blocky at
     * any size instead of anti-aliasing into a smooth chevron. */
    pxback: '<svg class="pxa" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path d="M4 0h1v1H4zM3 1h1v1H3zM2 2h1v1H2zM1 3h1v1H1zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3zM4 7h1v1H4zM2 3h5v2H2z"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"></path></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.2 6.7.8-5 4.6 1.4 6.7L12 17.4l-6 3.4 1.4-6.7-5-4.6 6.7-.8z"></path></svg>',
    cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5 10.5 4l3 12.5L7 19zM12.5 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4"></path></svg>',
    learn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5-9 4.5z"></path><path d="M6.5 10.5v5C8 17.5 10 18.5 12 18.5s4-1 5.5-3v-5"></path></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path><circle cx="12" cy="12" r="7"></circle></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.2 7 9.5 4-1.3 7-5 7-9.5V6z"></path><path d="m9.2 12 2 2 3.8-4"></path></svg>',
    endless: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c-1.6-2.4-3-3.6-4.8-3.6a3.6 3.6 0 0 0 0 7.2c1.8 0 3.2-1.2 4.8-3.6s3-3.6 4.8-3.6a3.6 3.6 0 0 1 0 7.2c-1.8 0-3.2-1.2-4.8-3.6z"></path></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5z"></path><path d="M9 4v13M15 6.5v13"></path></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"></path></svg>',
    lock: '<svg class="lk" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"></rect><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path></svg>'
  };
  /* Outline icons inside .btn need stroke rather than fill. */
  var STROKE = 'style="fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"';
  function strokeIcon(svg) { return svg.replace('aria-hidden="true"', 'aria-hidden="true" ' + STROKE); }

  function starChip(n, of) {
    return '<span class="chip">' + ICON.star + n + (of ? ' / ' + of : '') + '</span>';
  }
  function bar(left, title, right) {
    return '<div class="bar"><div class="side">' + (left || '') + '</div>' +
      '<div class="mid">' + (title ? '<h2>' + title + '</h2>' : '') + '</div>' +
      '<div class="side r">' + (right || '') + '</div></div>';
  }

  function shell(inner, withBg) {
    var old = root.querySelector('.sheet');
    if (old) old.parentNode.removeChild(old);
    root.className = 'on' + (withBg ? '' : ' nobg');
    var bi = back.querySelector('.bgimg');
    if (bi && !bi.getAttribute('style')) bi.setAttribute('style', bgStyle('bg_menu_v2'));
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.insertAdjacentHTML('beforeend', inner);
    root.appendChild(sheet);
    return sheet;
  }
  /* Screen classes go on the sheet (layout) and on the root (backdrop). */
  function mark(sheet, cls) {
    sheet.classList.add(cls);
    root.classList.add(cls);
  }

  function on(sel, fn, sheet) {
    var n = (sheet || root).querySelector(sel);
    /* The first menu tap is the gesture that opens the audio engine, so its
     * one-time setup lands here rather than on the first level start. */
    if (n) n.addEventListener('click', function (e) { e.preventDefault(); if (global.SFX && global.SFX.init) global.SFX.init(); fn(e); });
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
  /* Title                                                                  */
  /* ---------------------------------------------------------------------- */

  /* ---- dot-matrix display ------------------------------------------- */
  /* A 128x32 DMD, the display every pinball machine has carried since the
   * early nineties. Each message is rasterised once through the pixel face
   * into a bitmap and the dots are painted from that, so the glyphs are
   * made of real dots rather than text behind a dotted mask. Runs only while
   * the title screen is up; showScreen stops it. */
  var DMD_W = 128, DMD_H = 32, DMD_CELL = 6;
  var dmdRuns = [];

  function dmdStart(canvas, messages, quick) {
    var W = DMD_W, H = DMD_H, CELL = DMD_CELL;
    canvas.width = W * CELL; canvas.height = H * CELL;
    var ctx = canvas.getContext('2d');
    var off = document.createElement('canvas');
    var octx = off.getContext('2d', { willReadFrequently: true });
    var FONT = '16px ' + PX;

    /* Unlit grid, painted once. */
    var grid = document.createElement('canvas');
    grid.width = canvas.width; grid.height = canvas.height;
    var g = grid.getContext('2d');
    g.fillStyle = '#03050a'; g.fillRect(0, 0, grid.width, grid.height);
    g.fillStyle = 'rgba(63,224,255,0.11)';
    for (var gy = 0; gy < H; gy++) {
      for (var gx = 0; gx < W; gx++) {
        g.beginPath(); g.arc(gx * CELL + CELL / 2, gy * CELL + CELL / 2, CELL * 0.26, 0, U.TAU); g.fill();
      }
    }
    /* Lit dot: a crisp core that stays inside its cell, with a short bloom
     * so neighbours read as separate dots rather than merging into strokes. */
    var SR = Math.round(CELL * 0.95);
    var sp = document.createElement('canvas'); sp.width = sp.height = SR * 2;
    var sg = sp.getContext('2d');
    var rg = sg.createRadialGradient(SR, SR, 0, SR, SR, SR);
    rg.addColorStop(0, 'rgba(240,255,255,1)');
    rg.addColorStop(0.3, 'rgba(120,236,255,1)');
    rg.addColorStop(0.42, 'rgba(63,224,255,0.95)');
    rg.addColorStop(0.55, 'rgba(63,224,255,0.28)');
    rg.addColorStop(1, 'rgba(63,224,255,0)');
    sg.fillStyle = rg; sg.fillRect(0, 0, sp.width, sp.height);

    /* The pixel face draws 14-dot capitals at 16px and 7-dot capitals at
     * 8px, so one line fills the display and two lines stack with a gap. */
    var bits = null, offW = W;
    function raster(lines) {
      var i, n = lines.length, widths = [], textW = 0;
      var font = (n === 1 ? 16 : 8) + 'px ' + PX;
      octx.font = font;
      for (i = 0; i < n; i++) {
        widths.push(Math.ceil(octx.measureText(lines[i]).width));
        if (widths[i] > textW) textW = widths[i];
      }
      offW = Math.max(W, textW + 6);
      off.width = offW; off.height = H;            // resizing also clears it
      octx.font = font;
      octx.fillStyle = '#fff'; octx.textBaseline = 'alphabetic'; octx.textAlign = 'left';
      for (i = 0; i < n; i++) {
        var x0 = offW > W ? 3 : Math.floor((W - widths[i]) / 2);
        var y0 = n === 1 ? 23 : (i === 0 ? 12 : 26);
        octx.fillText(lines[i], x0, y0);
      }
      var px = octx.getImageData(0, 0, offW, H).data;
      bits = new Uint8Array(offW * H);
      for (i = 0; i < bits.length; i++) bits[i] = px[i * 4 + 3] > 110 ? 1 : 0;
    }

    var WIPE = 320, HOLD = 2200, CRAWL = 42;      // ms, ms, dots per second
    var idx = -1, t0 = 0, phase = 'boot', raf = 0, dead = false, dirty = true, lastDraw = 0;

    function dot(x, y) { ctx.drawImage(sp, x * CELL + CELL / 2 - SR, y * CELL + CELL / 2 - SR); }

    function draw(now) {
      ctx.drawImage(grid, 0, 0);
      if (phase === 'boot') {
        for (var k = 0; k < 260; k++) dot((Math.random() * W) | 0, (Math.random() * H) | 0);
        return;
      }
      var el = now - t0;
      var wipeCol = phase === 'wipe' ? Math.floor(el / WIPE * W) : W;
      var shift = 0;
      if (offW > W) {
        shift = Math.min(offW - W, Math.floor(Math.max(0, el - WIPE - 700) / 1000 * CRAWL));
      }
      for (var y = 0; y < H; y++) {
        var row = y * offW + shift;
        for (var x = 0; x <= wipeCol && x < W; x++) if (bits[row + x]) dot(x, y);
      }
    }

    function next(now) {
      idx = (idx + 1) % messages.length;
      raster(messages[idx]);
      t0 = now; phase = 'wipe'; dirty = true;
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (phase === 'boot') {
        if (now - t0 > 520) next(now);
        else if (now - lastDraw > 60) { lastDraw = now; draw(now); }
        return;
      }
      var el = now - t0;
      var total = WIPE + (offW > W ? 700 + (offW - W) / CRAWL * 1000 + 900 : HOLD);
      if (el > total) { next(now); el = 0; }
      if (phase === 'wipe' && el > WIPE) { phase = 'hold'; dirty = true; }
      var crawling = offW > W && el > WIPE + 700 && el < total - 900;
      if (dirty || phase === 'wipe' || (crawling && now - lastDraw > 40)) {
        lastDraw = now; dirty = false; draw(now);
      }
    }

    function go() {
      if (dead) return;
      t0 = U.now(); phase = 'boot';
      if (quick) next(t0);                 // re-rendered screen: no power-on sparkle
      raf = requestAnimationFrame(frame);
    }
    if (document.fonts && document.fonts.load) document.fonts.load(FONT).then(go, go);
    else go();

    return {
      stop: function () { dead = true; if (raf) cancelAnimationFrame(raf); },
      /* Swap the message list; the first new message wipes in at once. */
      set: function (m) {
        messages = m; idx = -1;
        if (phase !== 'boot') next(U.now());
      }
    };
  }

  /* Markup for a display, and the call that lights it. */
  function dmdBox(id) {
    return '<div class="dmd" aria-hidden="true"><span class="screw l"></span><span class="screw r"></span>' +
      '<canvas id="' + id + '"></canvas><span class="plate">Megaball display</span></div>';
  }
  function dmdRun(sheet, id, msgs, quick) {
    var cv = sheet.querySelector('#' + id);
    if (!cv || !cv.getContext) return null;
    var run = dmdStart(cv, msgs, quick);
    dmdRuns.push(run);
    return run;
  }
  /* The readout line every sub-screen opens with. */
  function hline(left, right) {
    return '<div class="hline sub">' + (left || '<span></span>') + (right || '') + '</div>';
  }
  /* The blocky way out, placed last in the sheet. */
  function pxBack(label) {
    return '<button class="pxbk" id="back" aria-label="Back to ' + label + '">' +
      ICON.pxback + '<span>Back to ' + label + '</span></button>';
  }
  function starsRd(total) {
    return '<span class="rd" aria-label="' + total + ' of 15 stars">' + ICON.star + '<em>' + total + '</em> / 15 stars</span>';
  }
  function scRow(id, label, count, cls) {
    return '<button class="sc' + (cls ? ' ' + cls : '') + '" id="' + id + '"><i></i><span class="lb">' + label +
      '</span><span class="ld"></span>' + (count !== undefined && count !== '' ? '<span class="ct">' + count + '</span>' : '') + '</button>';
  }
  function statRow(label, value, cls) {
    return '<div class="sc stat' + (cls ? ' ' + cls : '') + '"><i></i><span class="lb">' + label +
      '</span><span class="ld"></span><span class="ct' + (cls ? ' ' + cls : '') + '">' + value + '</span></div>';
  }
  function cab(id, label, sub, cls) {
    return '<button class="cab' + (cls ? ' ' + cls : '') + '" id="' + id + '"><b>' + label + '</b>' +
      (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  }

  /* ---------------------------------------------------------------------- */
  /* Title: the backglass                                                   */
  /* ---------------------------------------------------------------------- */

  var titleShows = 0;
  function screenTitle() {
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var first = titleShows++ === 0;
    var muted = global.SFX && global.SFX.isMuted && global.SFX.isMuted();
    var logo = global.ART && global.ART.get ? global.ART.get('logo_megaball') : null;
    var total = GAME ? GAME.totalStars() : 0;
    var best = GAME ? (GAME.progress.endlessBest || 0) : 0;
    var firstRun = !!(GAME && global.TUT && GAME.progress.tutorialV !== global.TUT.VERSION);
    var rank = total >= 15 ? 'Legend' : total >= 10 ? 'Ace' : total >= 6 ? 'Veteran' : total >= 3 ? 'Defender' : 'Rookie';
    var owned = LEVELS && LEVELS.ownedAt ? LEVELS.ownedAt(total) : { cards: [] };
    var cardsMax = CARDS && CARDS.UNLOCK_ORDER ? CARDS.UNLOCK_ORDER.length : 0;

    /* Current stage = first unlocked level not yet mastered. */
    var curId = 1, cleared = 0, stages = 0;
    if (GAME && LEVELS && LEVELS.list) {
      stages = LEVELS.list.length;
      var found = false;
      for (var c = 0; c < LEVELS.list.length; c++) {
        var lc = LEVELS.list[c];
        if ((GAME.progress.stars[lc.id] || 0) > 0) cleared++;
        if (!found && GAME.levelUnlocked(lc.id) && (GAME.progress.stars[lc.id] || 0) < 3) { curId = lc.id; found = true; }
      }
    }
    var cur = LEVELS && LEVELS.byId ? LEVELS.byId(curId) : null;

    var sheet = shell([
      '<div class="hline">',
      '<span class="rd" aria-label="' + total + ' of 15 stars">' + ICON.star + '<em>' + total + '</em> / 15 stars</span>',
      '<button class="sndbtn' + (muted ? ' off' : '') + '" id="mute" aria-label="' + (muted ? 'Unmute' : 'Mute') + '">' +
        (muted ? ICON.muted : ICON.sound) + '<span>' + (muted ? 'Sound off' : 'Sound') + '</span></button>',
      '</div>',
      '<div class="spacer top"></div>',
      logo
        ? '<div class="brand"><div class="brand-glow"></div><div class="brand-logo" role="img" aria-label="MegaBall Defense" style="background-image:url(' + logo.src + ')"></div></div>'
        : '<h1>MEGA<br>BALL</h1>',
      '<div class="spacer mid"></div>',
      '<div class="lamprail" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>',
      '<div class="dmd" aria-hidden="true"><span class="screw l"></span><span class="screw r"></span><canvas id="dmd"></canvas><span class="plate">Megaball display</span></div>',
      /* ENDLESS is the headline. It is the mode with no ceiling, the one the
       * record chases, and the one a returning player comes back for — the
       * campaign is five stages long and is finished once. The round cabinet
       * button therefore launches Endless and the campaign moves down into
       * the scorecard, which is the reverse of how this started.
       *
       * The button keeps the word PLAY rather than the word ENDLESS: it is a
       * 116px circle set in a 30px pixel face, where "PLAY" fits and
       * "ENDLESS" does not. The action stays on the cap and the destination
       * rides underneath it, which is also how a real cabinet is labelled. */
      '<div class="ctl">',
      '<button class="start" id="endless" aria-label="' + (firstRun ? 'Play: start the first stage' : 'Play Endless mode' +
        (best ? ', best wave ' + best : '')) + '"><span class="halo" aria-hidden="true"></span>' +
        '<b>Play</b><small>' + (firstRun ? 'Start here' : 'Endless') + '</small></button>',
      '<div class="scard">',
      '<button class="sc amb" id="play"><i></i><span class="lb">Campaign</span><span class="ld"></span><span class="ct">' + cleared + '/' + stages + '</span></button>',
      '<button class="sc" id="lvls"><i></i><span class="lb">Levels</span><span class="ld"></span><span class="ct">Stage ' + curId + '</span></button>',
      '<button class="sc mag" id="deck"><i></i><span class="lb">Power cards</span><span class="ld"></span><span class="ct">' + owned.cards.length + '/' + cardsMax + '</span></button>',
      '<button class="sc" id="howto"><i></i><span class="lb">How to play</span><span class="ld"></span></button>',
      '</div></div>',
      '<p class="attract">' + (best ? 'Best wave ' + best + ' · ' : '') + '1 player · free play</p>'
    ].join(''), true);
    mark(sheet, 'hero');
    mark(sheet, 'home');
    if (first) sheet.classList.add('boot');

    on('#play', function () { sfx('ui_tap'); UI.showScreen('world'); }, sheet);
    on('#lvls', function () { sfx('ui_tap'); UI.showScreen('levelSelect'); }, sheet);
    /* A first-timer's PLAY goes to the lesson, not to Endless: the lesson
     * is where they build, ignite and chain inside three minutes, which is
     * the game's strongest three minutes. Once it has been seen (or skipped)
     * the cabinet button is Endless again, as labelled. */
    on('#endless', function () {
      sfx('ui_tap');
      if (firstRun && hooks.onStartLevel) hooks.onStartLevel(1);
      else UI.showScreen('endless');
    }, sheet);
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
      var btn = e.currentTarget;
      btn.innerHTML = (m ? ICON.muted : ICON.sound) + '<span>' + (m ? 'Sound off' : 'Sound') + '</span>';
      btn.classList.toggle('off', m);
      btn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    }, sheet);

    /* Attract-mode messages for the display. */
    var msgs = [
      ['MEGABALL'],
      best ? ['ENDLESS', 'BEST WAVE ' + best] : ['ENDLESS MODE', 'HOW FAR CAN YOU GET'],
      ['WORLD 1', 'STAGE ' + curId + (cur ? '  ' + cur.name.toUpperCase() : '')],
      ['STARS ' + total + ' / 15', 'RANK ' + rank.toUpperCase()],
      ['PRESS PLAY']
    ];
    dmdRun(sheet, 'dmd', msgs, !first);

    /* The first time home is reached after the opening stage is cleared, the
     * cabinet button stops pointing at the lesson and points at ENDLESS. The
     * player is told so once, on a plate in the same backglass language, and
     * never again: the flag is written the moment it shows. */
    if (GAME && (GAME.progress.stars[1] || 0) > 0 && !GAME.progress.endlessPopShown) {
      GAME.progress.endlessPopShown = true;
      GAME.saveProgress();
      showEndlessUnlocked(sheet);
    }
  }

  /* A backglass plate over the title: three lamps, the display, the name,
   * and a cabinet button that goes straight into the mode. */
  function showEndlessUnlocked(sheet) {
    var lamps = '';
    for (var i = 0; i < 3; i++) lamps += '<i class="on" style="animation-delay:' + (0.35 + i * 0.16) + 's"></i>';
    var pop = document.createElement('div');
    pop.className = 'pop';
    pop.id = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Endless mode unlocked');
    pop.innerHTML = '<div class="pop-card">' +
      '<div class="starlamps">' + lamps + '</div>' +
      '<span class="kick">New mode</span>' +
      dmdBox('dmdu') +
      '<b class="pop-h">Endless mode<small>Unlocked</small></b>' +
      '<p class="pop-sub">The waves never stop and every one grows. Every fifth wave is a boss. How far can you get?</p>' +
      cab('popgo', 'Play endless', 'Set a record', 'bounce') +
      '<button class="pxbk" id="popok" aria-label="Close">' + ICON.pxback + '<span>Later</span></button>' +
      '</div>';
    sheet.appendChild(pop);
    sfx('star');
    var run = dmdRun(pop, 'dmdu', [['ENDLESS MODE'], ['UNLOCKED'], ['SURVIVE', 'THE SWARM']], true);

    function close() {
      if (run) run.stop();
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    }
    on('#popok', function () { sfx('ui_back'); close(); }, pop);
    on('#popgo', function () { sfx('ui_tap'); close(); UI.showScreen('endless'); }, pop);
    /* A tap on the dark glass outside the plate also closes it. */
    pop.addEventListener('click', function (e) { if (e.target === pop) { sfx('ui_back'); close(); } });
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
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var total = GAME.totalStars();
    var owned = LEVELS && LEVELS.ownedAt ? LEVELS.ownedAt(total) : { cards: [] };
    var cardsMax = CARDS && CARDS.UNLOCK_ORDER ? CARDS.UNLOCK_ORDER.length : 0;

    var sheet = shell([
      hline('', starsRd(total)),
      '<h2 class="pxh">Campaign<small>Choose your battlefield.</small></h2>',
      '<p class="copy">Every stage reshapes the table. Clear objectives, earn stars, unlock stronger power cards.</p>',
      '<div class="globe" id="globe"></div>',
      '<p class="attract static">Drag to spin · tap a world</p>',
      cab('w1', 'Enter World 1', 'Five stages'),
      '<div class="scard tight">' + scRow('deck', 'Power cards', owned.cards.length + '/' + cardsMax, 'mag') + '</div>',
      pxBack('Home')
    ].join(''), true);
    mark(sheet, 'sub');

    on('#w1', function () { sfx('ui_tap'); UI.showScreen('levelSelect'); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'world' }); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('title'); }, sheet);

    var box = sheet.querySelector('#globe');
    var G = global.GLOBE;
    var ok = false;
    if (G && G.mount) {
      ok = G.mount(box, {
        pins: WORLDS,
        onPick: function () { sfx('ui_tap'); UI.showScreen('levelSelect'); },
        onLockedPick: function () { sfx('ui_error'); }
      });
    }
    if (!ok) {
      /* No WebGL: the button below is the whole picker, drop the hint. */
      var hint = sheet.querySelector('.attract');
      if (hint) hint.textContent = 'Worlds 2 and 3 are locked';
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Level grid                                                             */
  /* ---------------------------------------------------------------------- */

  function lockedTile(i) {
    return '<button class="ins locked" data-id="' + i + '" aria-label="Level ' + i + ' locked" disabled>' + ICON.lock + '</button>';
  }
  function lampStr(n) {
    var out = '';
    for (var i = 0; i < 3; i++) out += '<i' + (i < n ? ' class="on"' : '') + '></i>';
    return out;
  }
  function artUrl(key) {
    var a = global.ART && global.ART.get ? global.ART.get(key) : null;
    return a ? 'url(' + a.src + ')' : 'none';
  }

  /* Five stages as inserts under a translite of the selected stage; the
   * display reads out whatever is selected. */
  function screenLevelSelect() {
    var GAME = global.GAME, LEVELS = global.LEVELS;
    var total = GAME.totalStars();

    /* "Current" = the first unlocked level the player has not mastered. */
    var curId = 0, cleared = 0;
    for (var c = 0; c < LEVELS.list.length; c++) {
      var lc = LEVELS.list[c];
      if ((GAME.progress.stars[lc.id] || 0) > 0) cleared++;
      if (!curId && GAME.levelUnlocked(lc.id) && (GAME.progress.stars[lc.id] || 0) < 3) curId = lc.id;
    }
    if (!curId) curId = LEVELS.list.length ? LEVELS.list[0].id : 0;
    var stages = LEVELS.list.length;

    var tiles = '';
    for (var i = 1; i <= stages; i++) {
      var L = LEVELS.byId(i);
      if (!L || !GAME.levelUnlocked(L.id)) { tiles += lockedTile(i); continue; }
      var st = GAME.progress.stars[L.id] || 0;
      tiles += '<button class="ins' + (L.id === curId ? ' cur' : '') + '" data-id="' + L.id + '" aria-label="Level ' + L.id + ', ' + st + ' stars">' +
        '<b>' + L.id + '</b><span class="lamps">' + lampStr(st) + '</span></button>';
    }

    function capFor(L) {
      return '<span class="kick">Stage ' + L.id + '</span><b class="nm">' + L.name + '</b>' +
        '<span class="sub">' + L.subtitle + '</span>';
    }
    function msgsFor(L) {
      var st = GAME.progress.stars[L.id] || 0;
      return [['STAGE ' + L.id, L.name.toUpperCase()],
        [st + (st === 1 ? ' STAR' : ' STARS'), 'OF 3 EARNED'],
        ['WORLD 1', cleared + ' OF ' + stages + ' CLEARED']];
    }
    var cur = LEVELS.byId(curId);

    /* The three objectives of the current level, stated up front. A "use no
       more than N defenses" ask is unplayable as a surprise at the results
       screen: the player has to know the constraint before they spend. */
    var objList = cur ? objectiveRows(LEVELS.objectives(cur, null), false) : '';

    var sheet = shell([
      hline('', starsRd(total)),
      dmdBox('dmdl'),
      '<div class="translite" id="lart" style="background-image:' + artUrl('lvl_' + curId) + '"><div class="tl-shade"></div>' +
        '<div class="tl-cap" id="lcap">' + (cur ? capFor(cur) : '') + '</div></div>',
      '<div class="insrow">' + tiles + '</div>',
      '<div class="plate slim" id="objs">' + objList + '</div>',
      '<div class="spacer"></div>',
      cab('launch', 'Play stage ' + curId, cur ? cur.name : ''),
      '<div class="scard tight">' + scRow('deck', 'Power cards', '', 'mag') + '</div>',
      pxBack('Map')
    ].join(''), true);
    mark(sheet, 'sub');

    var dmd = dmdRun(sheet, 'dmdl', cur ? [['WORLD 1']].concat(msgsFor(cur)) : [['WORLD 1']], true);

    var selectedId = curId;
    onAll('.ins', function (n) {
      var id = parseInt(n.getAttribute('data-id'), 10);
      if (n.classList.contains('locked')) { sfx('ui_error'); return; }
      var L = LEVELS.byId(id);
      if (!L) return;
      selectedId = id;
      var all = sheet.querySelectorAll('.ins');
      for (var ti = 0; ti < all.length; ti++) all[ti].classList.remove('cur');
      n.classList.add('cur');
      var art = sheet.querySelector('#lart');
      if (art) {
        art.style.backgroundImage = artUrl('lvl_' + id);
        art.style.animation = 'none';
        void art.offsetWidth;                 // restart the fade
        art.style.animation = '';
      }
      var cap = sheet.querySelector('#lcap');
      if (cap) cap.innerHTML = capFor(L);
      var ob = sheet.querySelector('#objs');
      if (ob) ob.innerHTML = objectiveRows(LEVELS.objectives(L, null), false);
      var launch = sheet.querySelector('#launch');
      if (launch) launch.innerHTML = '<b>Play stage ' + L.id + '</b><small>' + L.name + '</small>';
      if (dmd) dmd.set(msgsFor(L));
      sfx('ui_tap');
    }, sheet);
    on('#launch', function () { sfx('ui_tap'); if (hooks.onStartLevel) hooks.onStartLevel(selectedId); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'levelSelect' }); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('world'); }, sheet);
  }

  /* ---------------------------------------------------------------------- */
  /* Power cards                                                            */
  /* ---------------------------------------------------------------------- */

  /* The deck builder. Slots unlock with stars, so the loadout decision gets
   * meaningfully harder as the collection grows.
   *
   * `ctx` (optional) = { next: levelId, unlocks: [], back: screenName }. The
   * results screen routes through here after a level that unlocked something,
   * because a new card arrives with no free slot to put it in — the player has
   * to swap, and they will never guess that from a menu they were never sent to. */
  function screenLoadout(ctx) {
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var total = GAME.totalStars();
    var owned = LEVELS.ownedAt(total);
    var loadout = GAME.progress.loadout;
    var nextLvl = ctx && ctx.next ? LEVELS.byId(ctx.next) : null;
    var cardsMax = CARDS.UNLOCK_ORDER ? CARDS.UNLOCK_ORDER.length : 0;

    /* Trim any cards that are no longer slottable. */
    while (loadout.length > owned.slots) loadout.pop();

    function slotsHtml() {
      var h = '';
      for (var s = 0; s < 3; s++) {
        var lockd = s >= owned.slots;
        var cid = loadout[s];
        var cd = cid ? CARDS.PLAYER[cid] : null;
        h += '<div class="slot ' + (cd ? 'full' : '') + (lockd ? ' lockd' : '') + '">' +
          (lockd ? 'Locked ★' + slotStarReq(s) : (cd ? cd.name : 'Empty')) + '</div>';
      }
      return h;
    }

    var grid = '';
    for (var i = 0; i < CARDS.UNLOCK_ORDER.length; i++) {
      var id = CARDS.UNLOCK_ORDER[i];
      var def = CARDS.PLAYER[id];
      var has = owned.cards.indexOf(id) >= 0;
      var eq = loadout.indexOf(id);
      var art = global.ART && global.ART.get ? global.ART.get(def.art) : null;
      grid += '<button class="pc ' + (has ? '' : 'lock ') + (eq >= 0 ? 'eq' : '') + '" data-id="' + id + '"' +
        ' aria-label="' + (has ? def.name : 'Locked card ' + def.name) + '">' +
        (art ? '<div class="art" style="background-image:url(' + art.src + ')"></div>' : '') +
        '<div class="shade"></div>' +
        (eq >= 0 ? '<div class="eqbadge">' + (eq + 1) + '</div>' : '') +
        '<div class="nm" style="color:' + (has ? def.color : 'rgba(255,255,255,.5)') + '">' +
        (has ? def.name : 'Locked') + '</div>' +
        '<div class="cd">' + (has ? def.cd + 's cooldown' : cardStarReq(id)) + '</div>' +
        '</button>';
    }

    /* Featured card: the one just tapped, else the last equipped, else the
     * first card everyone owns. */
    var selId = (ctx && ctx.sel) || (loadout.length ? loadout[loadout.length - 1] : 'slowtime');
    function featHtml(fid) {
      var sel = CARDS.PLAYER[fid] || CARDS.PLAYER.slowtime;
      var selHas = owned.cards.indexOf(fid) >= 0;
      var selEq = loadout.indexOf(fid);
      var selArt = global.ART && global.ART.get ? global.ART.get(sel.art) : null;
      var chips = '<i class="amb">' + sel.cd + 's cooldown</i>' +
        (selHas ? (selEq >= 0 ? '<i class="grn">Slot ' + (selEq + 1) + '</i>' : '<i>Not equipped</i>')
          : '<i class="mag">' + cardStarReq(fid) + '</i>');
      return {
        has: selHas,
        inner: '<div class="feat-art" style="background-image:' + (selArt ? 'url(' + selArt.src + ')' : 'none') + '"></div>' +
          '<div class="feat-txt"><span class="kick" style="color:' + (selHas ? sel.color : '#ff7ac0') + '">' +
          (selHas ? 'Power card' : 'Locked card') + '</span><b class="nm">' + sel.name + '</b>' +
          '<span class="sub">' + sel.long + '</span><span class="chips">' + chips + '</span></div>'
      };
    }
    var feat0 = featHtml(selId);

    /* Plates for anything just unlocked. */
    var unl = '';
    if (ctx && ctx.unlocks) {
      for (var u = 0; u < ctx.unlocks.length; u++) {
        unl += '<div class="unlock">Unlocked · ' + ctx.unlocks[u].label + '</div>';
      }
    }

    var backLabel = nextLvl ? 'Levels' : (ctx && ctx.back === 'title' ? 'Home' : (ctx && ctx.back === 'world' ? 'Map' : (ctx && ctx.back === 'endless' ? 'Endless' : 'Levels')));

    var sheet = shell([
      hline('', starsRd(total)),
      dmdBox('dmdc'),
      '<div class="feat' + (feat0.has ? '' : ' lock') + '" id="feat">' + feat0.inner + '</div>',
      unl,
      '<div class="slots">' + slotsHtml() + '</div>',
      '<div class="cardgrid">' + grid + '</div>',
      '<div class="spacer"></div>',
      nextLvl ? cab('play', 'Play stage ' + nextLvl.id, nextLvl.name) : '',
      pxBack(backLabel)
    ].join(''), true);
    mark(sheet, 'sub');
    mark(sheet, 'deck-screen');

    /* The display carries the rule that matters right now. */
    var msgs = [['POWER CARDS'], [owned.cards.length + ' OF ' + cardsMax + ' OWNED', owned.slots + (owned.slots === 1 ? ' SLOT' : ' SLOTS')]];
    msgs.push(owned.cards.length > owned.slots ? ['SLOTS FULL', 'TAP A CARD TO SWAP'] : ['TAP A CARD', 'TO EQUIP IT']);
    if (nextLvl) msgs.push(['NEXT UP', 'STAGE ' + nextLvl.id + ' ' + nextLvl.name.toUpperCase()]);
    dmdRun(sheet, 'dmdc', msgs, true);

    /* A tap patches the sheet in place. Rebuilding the whole screen replayed
     * its entry fade from black and re-decoded every card's art, which read
     * as the display cutting out for a beat on each selection. Only the bits
     * a tap can change are touched: the slot row, the equip badges, and the
     * featured plate. The art tiles keep the bitmaps they already have. */
    function refresh(fid) {
      var sl = sheet.querySelector('.slots');
      if (sl) sl.innerHTML = slotsHtml();
      var pcs = sheet.querySelectorAll('.pc');
      for (var p = 0; p < pcs.length; p++) {
        var pc = pcs[p];
        var eq = loadout.indexOf(pc.getAttribute('data-id'));
        pc.classList.toggle('eq', eq >= 0);
        var badge = pc.querySelector('.eqbadge');
        if (eq >= 0) {
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'eqbadge';
            var shade = pc.querySelector('.shade');
            if (shade && shade.nextSibling) pc.insertBefore(badge, shade.nextSibling); else pc.appendChild(badge);
          }
          badge.textContent = String(eq + 1);
        } else if (badge) {
          badge.parentNode.removeChild(badge);
        }
      }
      var f = featHtml(fid);
      var fe = sheet.querySelector('#feat');
      if (fe) {
        fe.classList.toggle('lock', !f.has);
        fe.innerHTML = f.inner;
      }
    }

    onAll('.pc', function (n) {
      var id = n.getAttribute('data-id');
      if (n.classList.contains('lock')) {
        sfx('ui_error');
        refresh(id);                     // feature it, so the unlock cost is readable
        return;
      }
      var idx = loadout.indexOf(id);
      if (idx >= 0) loadout.splice(idx, 1);
      else if (loadout.length < owned.slots) loadout.push(id);
      else { loadout.pop(); loadout.push(id); }
      sfx('ui_tap');
      GAME.saveProgress();
      refresh(id);
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

  /* ---------------------------------------------------------------------- */
  /* Endless lobby                                                          */
  /* ---------------------------------------------------------------------- */

  /* The mode gets its own backglass: the record on the display, the rules
   * on a translite, the loadout you are taking in, and one START. */
  function screenEndless() {
    var GAME = global.GAME, LEVELS = global.LEVELS, CARDS = global.CARDS;
    var total = GAME.totalStars();
    var best = GAME.progress.endlessBest || 0;
    var runs = GAME.progress.endlessRuns || 0;
    var owned = LEVELS.ownedAt(total);
    var cardsMax = CARDS.UNLOCK_ORDER ? CARDS.UNLOCK_ORDER.length : 0;
    var names = [];
    for (var i = 0; i < GAME.progress.loadout.length; i++) {
      var d = CARDS.PLAYER[GAME.progress.loadout[i]];
      if (d) names.push(d.name);
    }
    var lend = LEVELS.ENDLESS && LEVELS.ENDLESS.levelCard && CARDS.PLAYER[LEVELS.ENDLESS.levelCard]
      ? CARDS.PLAYER[LEVELS.ENDLESS.levelCard].name : null;

    var sheet = shell([
      hline('', starsRd(total)),
      dmdBox('dmdx'),
      '<div class="translite tall" style="background-image:' + artUrl('lvl_5') + '"><div class="tl-shade"></div>' +
        '<div class="tl-cap"><span class="kick" style="color:#ff7ac0">Endless mode</span><b class="nm">Survive the swarm</b>' +
        '<span class="sub">The waves never stop and every one grows. Every fifth wave is a boss, each a different one: clear it and take a life back.</span></div></div>',
      '<div class="scard stats">',
      statRow('Best run', best ? 'Wave ' + best : 'None yet', 'amb'),
      statRow('Runs played', runs, ''),
      statRow('Loadout', names.length ? names.join(' MID_CH ') : 'Empty', 'cy'),
      lend ? statRow('Lent by the table', lend, 'grn') : '',
      '</div>',
      '<div class="spacer"></div>',
      cab('go', 'Start run', best ? 'Beat wave ' + best : 'Set a record'),
      '<div class="scard tight">' + scRow('deck', 'Power cards', owned.cards.length + '/' + cardsMax, 'mag') + '</div>',
      pxBack('Home')
    ].join(''), true);
    mark(sheet, 'sub');

    dmdRun(sheet, 'dmdx', [['ENDLESS'],
      best ? ['BEST RUN', 'WAVE ' + best] : ['NO RECORD', 'SET ONE'],
      ['EVERY 10TH WAVE', 'IS A BOSS'],
      ['PRESS START']], true);

    on('#go', function () { sfx('ui_tap'); if (hooks.onStartLevel) hooks.onStartLevel('endless'); }, sheet);
    on('#deck', function () { sfx('ui_tap'); UI.showScreen('loadout', { back: 'endless' }); }, sheet);
    on('#back', function () { sfx('ui_back'); UI.showScreen('title'); }, sheet);
  }

  /* ---------------------------------------------------------------------- */
  /* Pause / results                                                        */
  /* ---------------------------------------------------------------------- */

  function screenPaused() {
    var S = global.GAME ? global.GAME.state : null;
    var endless = !!(S && S.level && S.level.endless);
    var sheet = shell([
      '<div class="spacer"></div>',
      dmdBox('dmdp'),
      '<div class="spacer" style="max-height:26px"></div>',
      cab('res', 'Resume', 'Back to the table'),
      '<div class="scard">' + scRow('rst', endless ? 'Restart run' : 'Restart level', '') +
        scRow('qt', 'Quit to menu', '', 'mag') + '</div>',
      '<div class="spacer"></div>'
    ].join(''), false);
    mark(sheet, 'sub');
    mark(sheet, 'pause');

    var msgs = [['PAUSED']];
    if (S && S.level) {
      msgs.push(['WAVE ' + Math.max(1, S.waveIndex + 1) + (S.level.endless ? '' : ' OF ' + S.level.waves.length),
        (S.level.endless ? 'ENDLESS' : S.level.name.toUpperCase())]);
    }
    dmdRun(sheet, 'dmdp', msgs, true);

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
    var lamps = '';
    for (var i = 0; i < 3; i++) {
      lamps += '<i class="' + (i < d.stars ? 'on' : '') + '" style="animation-delay:' + (0.25 + i * 0.24) + 's"></i>';
    }
    var unl = '';
    for (var u = 0; u < d.unlocks.length; u++) {
      unl += '<div class="unlock">Unlocked · ' + d.unlocks[u].label + '</div>';
    }

    /* Go on through the Deck rather than straight into the next level when
     * there is something new to slot, and always after Level 1: that is the
     * one moment we can be sure the player has never opened the Deck, and a
     * card they cannot find is a card they will never use. */
    var viaDeck = d.win && d.hasNext && (d.unlocks.length > 0 || d.level.id === 1);
    var nextId = d.level.id + 1;

    if (d.endless) { screenEndlessResults(d); return; }

    var name = d.level.name.toUpperCase();
    var sheet = shell([
      '<div class="spacer" style="max-height:10px"></div>',
      dmdBox('dmdr'),
      d.win ? '<div class="starlamps">' + lamps + '</div>'
        : '<p class="copy" style="text-align:center;max-width:none;margin:12px 0 4px">Reached wave ' + (d.wave || 1) + ' of ' + (d.waves || '?') + '</p>',
      d.objectives ? '<div class="plate">' + objectiveRows(d.objectives, true) + '</div>' : '',
      '<div class="scard stats">',
      statRow('Lives left', d.lives + '/' + d.livesMax, 'mag'),
      statRow('Destroyed', d.kills, ''),
      statRow('Energy earned', d.earned, 'amb'),
      statRow('Leaks', d.leaks, 'mag'),
      d.bestChain >= 2 ? statRow('Best chain', 'x' + d.bestChain, 'pow') : '',
      '</div>',
      unl,
      d.win && !d.hasNext ? '<div class="unlock good">All levels cleared · ★' + d.totalStars + ' total</div>' : '',
      '<div class="spacer"></div>',
      d.win && d.hasNext
        ? cab('next', 'Continue',
            viaDeck ? 'Pick your cards first' : 'Stage ' + nextId, 'bounce')
        : (d.win ? '' : cab('retry', 'Try again', 'Get past wave ' + (d.wave || 1), 'bounce')),
      '<div class="scard">',
      d.win ? scRow('retry', 'Replay', '') : '',
      scRow('menu', 'Levels', ''),
      '</div>'
    ].join(''), true);
    mark(sheet, 'sub');
    mark(sheet, 'results-screen');

    dmdRun(sheet, 'dmdr', d.win
      ? [['LEVEL CLEAR'], ['STAGE ' + d.level.id, name], [(d.stars || 0) + (d.stars === 1 ? ' STAR' : ' STARS')]]
      : [['BREACHED'], ['STAGE ' + d.level.id, name], ['WAVE ' + (d.wave || 1) + ' OF ' + (d.waves || '?')]], true);

    on('#next', function () {
      sfx('ui_tap');
      if (viaDeck) UI.showScreen('loadout', { next: nextId, unlocks: d.unlocks });
      else global.GAME.nextLevel();
    }, sheet);
    on('#retry', function () { sfx('ui_tap'); global.GAME.restartLevel(); }, sheet);
    on('#menu', function () { sfx('ui_back'); global.GAME.quitToMenu(); }, sheet);
  }

  /* Endless has no stars, objectives or next level: the run is the score.
   * The wave count is the headline, the record sits beside it, and a new
   * record gets the same plate a card unlock would. */
  function screenEndlessResults(d) {
    var sheet = shell([
      '<div class="spacer" style="max-height:10px"></div>',
      dmdBox('dmde'),
      '<div class="scard stats">',
      statRow('Waves survived', d.wave || 0, 'cy'),
      statRow('Best run', d.best || 0, 'amb'),
      statRow('Destroyed', d.kills, ''),
      statRow('Leaks', d.leaks, 'mag'),
      d.bestChain >= 2 ? statRow('Best chain', 'x' + d.bestChain, 'pow') : '',
      '</div>',
      d.newBest ? '<div class="unlock">New best · wave ' + d.wave + '</div>' : '',
      '<div class="spacer"></div>',
      cab('retry', 'Go again',
        d.newBest ? 'Beat wave ' + d.wave : (d.best ? 'Beat wave ' + d.best : 'Set a record'), 'bounce'),
      '<div class="scard">' + scRow('menu', 'Home', '') + '</div>'
    ].join(''), true);
    mark(sheet, 'sub');
    mark(sheet, 'results-screen');

    dmdRun(sheet, 'dmde', [['RUN OVER'], ['WAVE ' + (d.wave || 0)],
      d.newBest ? ['NEW BEST', 'WAVE ' + d.wave] : ['BEST RUN', 'WAVE ' + (d.best || 0)]], true);

    on('#retry', function () { sfx('ui_tap'); global.GAME.restartLevel(); }, sheet);
    on('#menu', function () { sfx('ui_back'); global.GAME.quitToMenu(); }, sheet);
  }

  /* ---------------------------------------------------------------------- */

  /* A screen the player did not ask for must not be dismissible by a tap they
   * had already started making.
   *
   * The results card is the only one that appears on its own, and it appears
   * at exactly the worst moment: the last ball drains while the player is
   * mid-rhythm on the flippers, and the very next tap of that rhythm lands on
   * NEXT LEVEL. So the sheet is deaf for half a second after it arrives —
   * longer than its own entry animation, far shorter than any deliberate
   * reach for a button. */
  var guardTimer = 0;
  function guardTaps(ms) {
    var sheet = root.querySelector('.sheet');
    if (!sheet) return;
    sheet.style.pointerEvents = 'none';
    if (guardTimer) global.clearTimeout(guardTimer);
    guardTimer = global.setTimeout(function () {
      guardTimer = 0;
      /* Only lift the guard if this is still the sheet on screen — a fast
       * navigation away must not re-arm a detached node. */
      if (sheet.parentNode) sheet.style.pointerEvents = '';
    }, ms || 550);
  }

  UI.showScreen = function (name, data) {
    /* The globe owns a WebGL context of its own. Release it the instant we
     * leave the world screen, before anything else touches the DOM, so the
     * game's table never has to compete for one. */
    if (current === 'world' && name !== 'world') {
      if (global.GLOBE && global.GLOBE.unmount) global.GLOBE.unmount();
    }
    current = name;
    while (dmdRuns.length) dmdRuns.pop().stop();
    if (!name) {
      root.classList.remove('on');
      var sh = root.querySelector('.sheet');
      if (sh) sh.parentNode.removeChild(sh);
      return;
    }
    root.classList.add('on');
    if (name === 'title') screenTitle();
    else if (name === 'world') screenWorld();
    else if (name === 'levelSelect') screenLevelSelect();
    else if (name === 'loadout') screenLoadout(data);
    else if (name === 'endless') screenEndless();
    else if (name === 'paused') screenPaused();
    else if (name === 'results') screenResults(data);
    root.scrollTop = 0;
    /* Results is the one screen that raises itself; see guardTaps. */
    if (name === 'results') guardTaps();
  };

  UI.current = function () { return current; };
  UI.isOpen = function () { return !!current; };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : this);
