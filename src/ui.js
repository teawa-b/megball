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
  var hooks = {};
  var current = null;

  function sfx(n, o) { var s = global.SFX; if (s && s.play) s.play(n, o); }

  /* ---------------------------------------------------------------------- */
  /* Styles                                                                 */
  /* ---------------------------------------------------------------------- */

  var INK = '#070b18';
  var F = U.FONT;
  /* Headline lettering: white with a soft cyan bloom and a hard drop, so it
   * reads over the painted machine without an outline fighting the art. */
  var GLOW = 'text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 14px rgba(63,224,255,.55);';
  /* Chamfered octagon — the frame shape every panel and button shares. */
  function oct(c) {
    return 'polygon(' + c + 'px 0,calc(100% - ' + c + 'px) 0,100% ' + c + 'px,100% calc(100% - ' + c + 'px),' +
      'calc(100% - ' + c + 'px) 100%,' + c + 'px 100%,0 calc(100% - ' + c + 'px),0 ' + c + 'px)';
  }
  var CY_EDGE = 'linear-gradient(180deg,rgba(143,240,255,.95),rgba(31,143,242,.75) 50%,rgba(63,224,255,.85))';
  var MG_EDGE = 'linear-gradient(180deg,rgba(255,120,190,.95),rgba(200,20,106,.8) 50%,rgba(255,46,136,.9))';
  var DIM_EDGE = 'linear-gradient(180deg,rgba(63,224,255,.42),rgba(31,143,242,.30))';
  var FILL = 'linear-gradient(180deg,rgba(14,26,58,.92),rgba(6,12,30,.96))';
  var FILL_BLUE = 'linear-gradient(180deg,#3a8dff 0%,#1a5be0 40%,#0b2c8c 100%)';
  var FILL_MAG = 'linear-gradient(180deg,rgba(60,14,44,.94),rgba(20,6,26,.96))';
  var FRAMES = '#ui .btn,#ui .panel,#ui .chip,#ui .iconbtn,#ui .tile,#ui .pc,#ui .stat,#ui .gpin,#ui .tagpanel,#ui .unlock,#ui .slot.full';

  var CSS = [
    '#ui{position:fixed;inset:0;z-index:20;display:none;font-family:' + F + ';',
    '  color:#fff;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}',
    '#ui.on{display:flex;align-items:stretch;justify-content:center;}',
    '#ui .sheet{position:relative;width:100%;max-width:' + U.UI.maxMenuWidth + 'px;height:100dvh;display:flex;',
    '  flex-direction:column;padding:calc(14px + env(safe-area-inset-top)) 18px calc(16px + env(safe-area-inset-bottom));',
    '  box-sizing:border-box;overflow:hidden;overscroll-behavior:none;}',
    '#ui.on .sheet{animation:screenIn .26s cubic-bezier(.2,.8,.2,1) both;}',
    '@keyframes screenIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',

    /* Backdrop: painted key art, then a veil that keeps text legible. Pinned to
     * the viewport so a scrolling sheet never exposes the canvas beneath. */
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
    '#ui .sheet:not(.hero) .bgimg{filter:blur(2px) saturate(1.15);opacity:.6;transform:translateX(-50%) scale(1.04);}',
    /* Title: light veil at top for the logo, heavy under the buttons. */
    '#ui .sheet.hero .bgimg{opacity:1;filter:saturate(1.1) contrast(1.05);animation:heroDrift 20s ease-in-out infinite alternate;}',
    '@keyframes heroDrift{from{transform:translateX(-50%) scale(1.02);}to{transform:translateX(-50%) scale(1.06);}}',
    '#ui .sheet.hero .veil{background:',
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
    '#ui .backbtn{width:auto;padding:0 14px 0 9px;gap:4px;display:inline-flex;align-items:center;',
    '  font:900 12px/1 ' + F + ';letter-spacing:.12em;text-transform:uppercase;}',
    '#ui .backbtn svg{width:16px;height:16px;}',

    /* ---- hero -------------------------------------------------------- */
    '#ui .brand{position:relative;flex:0 0 auto;margin:0 auto;width:min(96%,440px);}',
    '#ui .brand-glow{position:absolute;inset:-18% -10%;border-radius:50%;pointer-events:none;',
    '  background:radial-gradient(45% 45% at 50% 48%,rgba(63,224,255,.30),transparent 70%),',
    '  radial-gradient(35% 35% at 62% 62%,rgba(255,46,136,.24),transparent 70%);filter:blur(8px);',
    '  animation:glowPulse 3.2s ease-in-out infinite;}',
    '@keyframes glowPulse{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}',
    '#ui .brand-logo{position:relative;display:block;width:100%;aspect-ratio:640/430;background-size:contain;',
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

    /* ---- short phones ------------------------------------------------ */
    '@media(max-height:720px){#ui .sheet{padding-top:calc(10px + env(safe-area-inset-top));padding-bottom:calc(10px + env(safe-area-inset-bottom));}',
    '  #ui .bar{margin-bottom:8px;min-height:42px}#ui .btn{min-height:50px;margin:6px 0}#ui .btn.primary{min-height:60px;font-size:18px}',
    '  #ui .btn.play{min-height:76px}#ui .btn.play b{font-size:28px}#ui .btn.card{min-height:64px}',
    '  #ui .obj{padding:7px 10px}#ui .objs{gap:4px;margin-top:6px}#ui .slots{margin-bottom:7px}',
    '  #ui .pc{aspect-ratio:1.05}#ui .pc .nm{font-size:8px}#ui .cardgrid{gap:6px;margin-bottom:7px}',
    '  #ui .brand{width:min(84%,340px)}#ui .tagpanel{min-height:54px;padding:8px 14px}#ui .panel{padding:11px 13px}#ui .globe{min-height:200px}}',
    '@media(prefers-reduced-motion:reduce){#ui *{animation:none!important;transition:none!important}}'
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
      var p = root.querySelector('.btn.primary') || list[0];
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
        var p = root.querySelector('.btn.primary');
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
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"></path></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.2 6.7.8-5 4.6 1.4 6.7L12 17.4l-6 3.4 1.4-6.7-5-4.6 6.7-.8z"></path></svg>',
    cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5 10.5 4l3 12.5L7 19zM12.5 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4"></path></svg>',
    learn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5-9 4.5z"></path><path d="M6.5 10.5v5C8 17.5 10 18.5 12 18.5s4-1 5.5-3v-5"></path></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path><circle cx="12" cy="12" r="7"></circle></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.2 7 9.5 4-1.3 7-5 7-9.5V6z"></path><path d="m9.2 12 2 2 3.8-4"></path></svg>',
    lock: '<svg class="lk" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"></rect><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path></svg>'
  };
  /* Outline icons inside .btn need stroke rather than fill. */
  var STROKE = 'style="fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"';
  function strokeIcon(svg) { return svg.replace('aria-hidden="true"', 'aria-hidden="true" ' + STROKE); }

  function starChip(n, of) {
    return '<span class="chip">' + ICON.star + n + (of ? ' / ' + of : '') + '</span>';
  }
  function backBtn(label) {
    return '<button class="iconbtn backbtn" id="back" aria-label="Back">' + ICON.back + label + '</button>';
  }
  function bar(left, title, right) {
    return '<div class="bar"><div class="side">' + (left || '') + '</div>' +
      '<div class="mid">' + (title ? '<h2>' + title + '</h2>' : '') + '</div>' +
      '<div class="side r">' + (right || '') + '</div></div>';
  }

  function shell(inner, withBg) {
    root.innerHTML = '';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    if (withBg) {
      var bi = document.createElement('div');
      bi.className = 'bgimg';
      bi.setAttribute('style', bgStyle('bg_menu_v2'));
      sheet.appendChild(bi);
    }
    var veil = document.createElement('div');
    veil.className = 'veil';
    sheet.appendChild(veil);
    var grain = document.createElement('div');
    grain.className = 'grain';
    sheet.appendChild(grain);
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
  /* Title                                                                  */
  /* ---------------------------------------------------------------------- */

  function screenTitle() {
    var muted = global.SFX && global.SFX.isMuted && global.SFX.isMuted();
    var logo = global.ART && global.ART.get ? global.ART.get('logo_megaball') : null;
    var total = global.GAME ? global.GAME.totalStars() : 0;
    var sheet = shell([
      bar(starChip(total, 15), '',
        '<button class="iconbtn" id="mute" aria-label="' + (muted ? 'Unmute' : 'Mute') + '">' + (muted ? ICON.muted : ICON.sound) + '</button>'),
      '<div class="spacer" style="max-height:10px"></div>',
      logo
        ? '<div class="brand"><div class="brand-glow"></div><div class="brand-logo" role="img" aria-label="Megaball" style="background-image:url(' + logo.src + ')"></div></div>'
        : '<h1>MEGA<br>BALL</h1>',
      '<div class="hero-copy"><div class="tagpanel">' + ICON.shield + '<div><b>Build. Defend. Survive.</b>',
      '<small>Build the board. Break the swarm. Save the drain.</small></div></div></div>',
      '<div class="spacer"></div>',
      '<div class="actions"><button class="btn primary play" id="play">' + ICON.play + '<span><b>Play</b><small>World 1 \u00b7 Five stages</small></span></button>',
      '<div class="row"><button class="btn card mag" id="deck">' + ICON.cards + '<span><b>Power Cards</b><small>Choose your loadout</small></span></button>',
      '<button class="btn card" id="howto">' + ICON.learn + '<span><b>Learn</b><small>Interactive tutorial</small></span></button></div></div>'
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
      e.currentTarget.innerHTML = m ? ICON.muted : ICON.sound;
      e.currentTarget.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
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
      bar(backBtn('Home'), 'Campaign', starChip(total, 15)),
      '<h2 class="campaign-title">Choose your battlefield.</h2>',
      '<p class="campaign-copy">Every stage reshapes the table. Clear objectives, earn stars, unlock stronger power cards.</p>',
      '<div class="globe" id="globe"></div>',
      '<p class="hint">Drag to spin \u00b7 tap a world</p>',
      '<div class="actions"><button class="btn primary" id="w1">' + ICON.play + 'Enter World 1</button>',
      '<button class="btn ghost" id="deck">' + strokeIcon(ICON.cards) + 'Power Cards</button></div>'
    ].join(''), true);

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
      var hint = sheet.querySelector('.hint');
      if (hint) hint.textContent = 'Worlds 2 and 3 are locked';
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Level grid                                                             */
  /* ---------------------------------------------------------------------- */

  function lockedTile(i) {
    return '<button class="tile locked" data-id="' + i + '" aria-label="Level ' + i + ' locked" disabled>' + ICON.lock + '</button>';
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
      if (!L || !GAME.levelUnlocked(L.id)) { tiles += lockedTile(i); continue; }
      var st = GAME.progress.stars[L.id] || 0;
      tiles += '<button class="tile' + (L.id === curId ? ' cur' : '') + '" data-id="' + L.id + '" aria-label="Level ' + L.id + '">' +
        '<span class="n">' + L.id + '</span>' +
        '<span class="st" style="color:' + (st ? '#ffd24a' : 'rgba(255,255,255,.35)') + '">' +
        starStr(st) + '</span></button>';
    }

    function blurbFor(L) {
      return '<span class="kicker">Stage ' + L.id + '</span><b class="level-name">' + L.name + '</b>' +
        '<span class="level-subtitle">' + L.subtitle + '</span>';
    }
    var cur = LEVELS.byId(curId);

    /* The three objectives of the current level, stated up front. A "use no
       more than N defenses" ask is unplayable as a surprise at the results
       screen — the player has to know the constraint before they spend. */
    var objList = cur ? objectiveRows(LEVELS.objectives(cur, null), false) : '';

    var sheet = shell([
      bar(backBtn('Map'), 'World 1', starChip(total, 15)),
      '<div class="grid">' + tiles + '</div>',
      '<div class="panel"><div id="blurb">' + (cur ? blurbFor(cur) : '') + '</div>',
      '<div id="objs">' + objList + '</div></div>',
      '<div class="spacer"></div>',
      '<div class="actions"><button class="btn primary" id="launch">' + ICON.play + 'Play Level ' + curId + '</button>',
      '<button class="btn ghost" id="deck">' + strokeIcon(ICON.cards) + 'Power Cards</button></div>'
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
        note.innerHTML = blurbFor(L);
        var ob = sheet.querySelector('#objs');
        if (ob) ob.innerHTML = objectiveRows(LEVELS.objectives(L, null), false);
        var launch = sheet.querySelector('#launch');
        if (launch) launch.innerHTML = ICON.play + 'Play Level ' + L.id;
      }
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
      grid += '<button class="pc ' + (has ? '' : 'lock ') + (eq >= 0 ? 'eq' : '') + '" data-id="' + id + '"' +
        (has ? '' : ' disabled') + ' aria-label="' + (has ? def.name : 'Locked card') + '">' +
        (art ? '<div class="art" style="background-image:url(' + art.src + ')"></div>' : '') +
        '<div class="shade"></div>' +
        (eq >= 0 ? '<div class="eqbadge">' + (eq + 1) + '</div>' : '') +
        '<div class="nm" style="color:' + (has ? def.color : 'rgba(255,255,255,.5)') + '">' +
        (has ? def.name : 'Locked') + '</div>' +
        '<div class="cd">' + (has ? def.cd + 's cooldown' : cardStarReq(id)) + '</div>' +
        '</button>';
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

    var backLabel = nextLvl ? 'Levels' : (ctx && ctx.back === 'title' ? 'Home' : (ctx && ctx.back === 'world' ? 'Map' : 'Levels'));

    var sheet = shell([
      bar(backBtn(backLabel), 'Power Cards', starChip(total)),
      unl,
      '<p class="note">' + lead + '</p>',
      '<div class="slots">' + slots + '</div>',
      '<div class="cardgrid">' + grid + '</div>',
      '<div class="panel" id="blurb"><span class="kicker" style="color:' + sel.color + '">' + sel.name + '</span>' +
        '<span class="note" style="margin:0;display:block">' + sel.long + '</span></div>',
      '<div class="spacer"></div>',
      nextLvl
        ? '<div class="actions"><button class="btn primary" id="play">' + ICON.play + 'Play ' + nextLvl.id + '. ' + nextLvl.name + '</button></div>'
        : ''
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

  /* ---------------------------------------------------------------------- */
  /* Pause / results                                                        */
  /* ---------------------------------------------------------------------- */

  function screenPaused() {
    var sheet = shell([
      '<div class="spacer"></div>',
      '<p class="title-big">Paused</p>',
      '<div class="spacer"></div>',
      '<div class="actions"><button class="btn primary" id="res">' + ICON.play + 'Resume</button>',
      '<button class="btn ghost" id="rst">Restart Level</button>',
      '<button class="btn danger" id="qt">Quit to Menu</button></div>'
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
        (i < d.stars ? '#ffd24a' : 'rgba(255,255,255,.18)') + '">★</span>';
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

    var verdictStyle = d.win
      ? 'background:linear-gradient(180deg,#7df0a6,#22b35a)'
      : 'background:linear-gradient(180deg,#ff5fb0,#c8146a)';

    var sheet = shell([
      '<div class="spacer"></div>',
      '<p class="tag verdict" style="' + verdictStyle + '">' + (d.win ? 'Level Complete' : 'Defenses Breached') + '</p>',
      '<p class="title-big">' + d.level.name + '</p>',
      d.win ? '<div class="stars">' + stars + '</div>' :
        '<p class="note" style="text-align:center">Reached wave ' + (d.wave || 1) + ' of ' + (d.waves || '?') + '</p>',
      d.objectives ? objectiveRows(d.objectives, true) : '',
      '<div class="stats">',
      '  <div class="stat"><b style="color:#ff5fb0">' + d.lives + '/' + d.livesMax + '</b><i>Lives left</i></div>',
      '  <div class="stat"><b style="color:#fff">' + d.kills + '</b><i>Destroyed</i></div>',
      '  <div class="stat"><b style="color:#ffd24a">' + d.earned + '</b><i>Energy earned</i></div>',
      '  <div class="stat"><b style="color:#ff5fb0">' + d.leaks + '</b><i>Leaks</i></div>',
      '</div>',
      unl,
      '<div class="spacer"></div>',
      '<div class="actions">',
      d.win && d.hasNext
        ? '<button class="btn primary" id="next">' + ICON.play +
            (viaDeck ? 'Cards &amp; Continue' : 'Next Level') + '</button>'
        : '',
      viaDeck && d.unlocks.length
        ? '<p class="hint" style="margin:0 0 4px">Pick which cards you take in</p>'
        : '',
      d.win && !d.hasNext ? '<div class="unlock" style="background:linear-gradient(180deg,#7df0a6,#22b35a)">ALL LEVELS CLEARED — ★' + d.totalStars + ' total</div>' : '',
      '<div class="row"><button class="btn' + (d.win ? ' ghost' : ' primary') + '" id="retry">' + (d.win ? 'Replay' : 'Try Again') + '</button>',
      '<button class="btn ghost" id="menu">Levels</button></div></div>'
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
