#!/usr/bin/env node
/* MEGABALL — tools/check-submission.js
 *
 * tools/verify.js proves the built document is offline-clean, but it reads
 * the file: it cannot tell you whether the game still runs when opened.
 * This does. It loads the built page from file:// in headless Chrome
 * over the DevTools protocol and PLAYS it — boot, a campaign level from the
 * mission card through to a cleared wave, an Endless run out to a boss wave,
 * and the results sheet — while collecting every uncaught exception and
 * console error the page produces.
 *
 * It also checks the things a screenshot cannot. Computed opacity on the
 * results rows and star lamps, for one: an element parked at opacity:0 that
 * relies on its entry animation photographs perfectly at the right moment
 * and is invisible forever to a player with prefers-reduced-motion. That bug
 * shipped once already.
 *
 * Zero dependencies — Node 22+ for the global WebSocket.
 *
 * Usage:  node tools/check-submission.js [path/to/index.html]
 *         (defaults to dist/index.html)
 *
 * Exit 0 = played clean. Exit 1 = could not run it. Exit 2 = errors on page.
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'index.html'));
const PORT = 9339;

/* Wherever Chrome happens to live on this machine. Edge is Chromium too and
 * speaks the same protocol, so it is a fine fallback. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function bail(msg) { console.error('CHECK FAILED: ' + msg); process.exit(1); }

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  if (!fs.existsSync(PAGE)) bail(PAGE + ' does not exist — run node tools/build.js first');
  const chromePath = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!chromePath) bail('no Chrome or Edge found; set CHROME_PATH');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'megaball-check-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=420,900',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    'file:///' + PAGE.replace(/\\/g, '/')
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* not listening yet */ }
  }
  if (!target) { chrome.kill(); bail('Chrome never opened a debuggable page'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const waiting = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  let id = 0;

  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(String((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.description || a.value).join(' ').split('\n')[0]);
    }
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  const send = (method, params) =>
    new Promise(res => { waiting.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });

  async function run(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const d = r.result && r.result.exceptionDetails;
    if (d) throw new Error(d.exception ? d.exception.description : d.text);
    return r.result.result.value;
  }

  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(6500);                       // splash, asset decode, first frame

  const report = {};
  const fail = [];
  function expect(name, ok, detail) {
    report[name] = (ok ? 'PASS  ' : 'FAIL  ') + detail;
    if (!ok) fail.push(name);
  }

  /* ---- boot ---------------------------------------------------------- */
  const boot = JSON.parse(await run(`JSON.stringify({
    missing: ['GAME','DRAW','LEVELS','FX','UI','SFX','ART','SCENE3D','TUT','BOARD','ENT','CARDS']
      .filter(function(k){ return !window[k]; }),
    canvases: document.querySelectorAll('canvas').length,
    webgl: !!(document.getElementById('gl') && document.getElementById('gl').getContext('webgl2')),
    artTotal: Object.keys(ART.manifest).length,
    artBroken: Object.keys(ART.manifest).filter(function(k){ return !ART.get(k); }),
    fonts: Array.from(document.fonts).map(function(f){ return f.family; })
  })`));
  expect('boots', !boot.missing.length && boot.canvases >= 2 && boot.webgl,
    boot.missing.length ? 'missing globals: ' + boot.missing.join(', ')
      : boot.canvases + ' canvases, WebGL2 ' + (boot.webgl ? 'up' : 'DOWN'));

  /* Images and the font are separate files beside the document now, so their
   * relative paths have to resolve from wherever the page was opened. */
  expect('art loads from assets/', boot.artBroken.length === 0,
    (boot.artTotal - boot.artBroken.length) + '/' + boot.artTotal + ' images decoded' +
    (boot.artBroken.length ? ', broken: ' + boot.artBroken.join(', ') : '') +
    '; faces: ' + (boot.fonts.join(', ') || 'none declared'));

  /* ---- a campaign level, played ------------------------------------- */
  const lvl = JSON.parse(await run(`(function(){
    document.getElementById('ui').style.display = 'none';
    GAME.progress.tutorialDone = true;
    GAME.progress.tutorialV = (window.TUT && TUT.VERSION) || 6;
    GAME.progress.stars = { 1:3, 2:2 };
    GAME.startLevel(3, ['megaball']);
    var S = GAME.state, DT = 1/60, i;
    for (i = 0; i < 60; i++) GAME.update(DT);
    var card = { title: S.notice && S.notice.title, art: S.notice && S.notice.art,
                 objs: S.notice && S.notice.objs && S.notice.objs.length };
    GAME.noticeAction('ok');
    S.energy = 9999;
    var want = ['bumper','paddle','blast','paddle','bumper','power','paddle','bumper'], p = 0;
    for (var k = 0; k < S.table.slots.length && p < 8; k++) {
      var sl = S.table.slots[k];
      if (sl.occupant) continue;
      S.buildPick = want[p]; if (GAME.placeAt(sl)) p++;
    }
    function flip(){ var L = false, R = false;
      for (var b = 0; b < S.balls.length; b++) { var q = S.balls[b];
        if (q.dead) continue;
        if (q.y > 1060 && q.vy > 0) { if (q.x < 360) L = true; else R = true; } }
      GAME.setFlipper('L', L); GAME.setFlipper('R', R); }
    var lastWaveOffers = 0;
    for (i = 0; i < 60 * 400; i++) {
      S.lives = 5; S.energy = 9999;
      if (S.mode === 'build' && S.buildT > 0.3) S.buildT = 0.2;
      if (S.notice) GAME.noticeAction(S.notice.buttons[0].id);
      flip(); GAME.update(DT);
      if (S.mode === 'wave' && S.waveIndex + 1 >= S.level.waves.length &&
          GAME.canEndWaveEarly()) lastWaveOffers++;
      if (S.mode === 'won' || S.mode === 'lost') break;
    }
    return JSON.stringify({ card: card, towers: S.towers.length, kills: S.totalKills,
      wave: S.waveIndex + 1, mode: S.mode, lastWaveOffers: lastWaveOffers });
  })()`));
  expect('mission card', !!(lvl.card.title && lvl.card.art && lvl.card.objs === 3),
    lvl.card.title + ', art ' + lvl.card.art + ', ' + lvl.card.objs + ' objectives');
  expect('plays a level', lvl.towers === 8 && lvl.kills > 0 && lvl.wave > 1,
    lvl.towers + ' towers, ' + lvl.kills + ' kills, reached wave ' + lvl.wave + ' (' + lvl.mode + ')');
  expect('no early clear', lvl.lastWaveOffers === 0,
    'NEXT WAVE offered on the last wave for ' + lvl.lastWaveOffers + ' frames');

  /* ---- the tray is a flipper where it is empty ----------------------- */
  const tray = JSON.parse(await run(`(function(){
    GAME.startLevel(2, ['megaball','slowmo']);
    if (GAME.state.notice) GAME.noticeAction('ok');
    var S = GAME.state, vp = GAME.vp, i;
    for (i = 0; i < 10; i++) GAME.update(1/60);
    function toClient(vx, vy){ return [vx * (vp.scaleX || vp.scale) + vp.ox,
                                       vy * (vp.scaleY || vp.scale) + vp.oy]; }
    var cells = DRAW.trayRects(S).cells;
    function covered(x, y){ for (var i = 0; i < cells.length; i++) { var c = cells[i];
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return true; } return false; }
    function gap(lo, hi){ for (var y = U.BAND.trayTop + 40; y < U.VH - 20; y += 10)
      for (var x = lo; x < hi; x += 6) if (!covered(x, y)) return { x: x, y: y }; return null; }
    function tap(pid, vx, vy){ S.flipL.on = false; S.flipR.on = false; S.buildPick = null;
      var c = toClient(vx, vy); GAME.pointerDown(pid, c[0], c[1]);
      var r = { L: S.flipL.on, R: S.flipR.on, pick: S.buildPick };
      GAME.pointerUp(pid, c[0], c[1]); return r; }
    var gl = gap(120, 340), gr = gap(400, 620);
    S.energy = 9999;
    var pad = null, bum = null, card = null;
    for (i = 0; i < cells.length; i++) { var c = cells[i];
      if (c.kind === 'build' && c.type === 'paddle') pad = c;
      if (c.kind === 'build' && c.type === 'bumper') bum = c;
      if (c.kind === 'card' && !card) card = c; }
    return JSON.stringify({
      left: gl ? tap(81, gl.x, gl.y) : null,
      right: gr ? tap(82, gr.x, gr.y) : null,
      paddle: tap(83, pad.x + pad.w/2, pad.y + pad.h/2),
      bumper: tap(84, bum.x + bum.w/2, bum.y + bum.h/2),
      card: card ? tap(85, card.x + card.w/2, card.y + card.h/2) : null
    });
  })()`));
  expect('empty tray flips',
    tray.left && tray.left.L && !tray.left.R && tray.right && tray.right.R && !tray.right.L,
    'left gap -> L, right gap -> R');
  expect('tray controls still work',
    tray.paddle.pick === 'paddle' && !tray.paddle.L && !tray.paddle.R &&
    tray.bumper.pick === 'bumper' && tray.card && !tray.card.L && !tray.card.R,
    'piles pick their tower, a card is still a card');

  /* ---- clearing stage 1 announces Endless, once ----------------------- */
  const unlock = JSON.parse(await run(`(function(){
    var seen = [], realShow = UI.showScreen;
    UI.showScreen = function(name, d){
      if (name === 'results') seen.push({ prev: d.prevStars, isNew: !!d.endlessNew });
      return realShow.apply(UI, arguments);
    };
    function play(){
      document.getElementById('ui').style.display = 'none';
      GAME.startLevel(1, ['megaball']);
      var S = GAME.state, DT = 1/60;
      if (S.pendingTutorial) GAME.endTutorial(true);
      if (S.notice) GAME.noticeAction('ok');
      S.energy = 9999;
      var want = ['bumper','paddle','bumper','paddle','bumper','paddle'], p = 0;
      for (var k = 0; k < S.table.slots.length && p < 6; k++) { var sl = S.table.slots[k];
        if (sl.occupant) continue; S.buildPick = want[p]; if (GAME.placeAt(sl)) p++; }
      function flip(){ var L = false, R = false;
        for (var b = 0; b < S.balls.length; b++) { var q = S.balls[b];
          if (q.dead) continue;
          if (q.y > 1060 && q.vy > 0) { if (q.x < 360) L = true; else R = true; } }
        GAME.setFlipper('L', L); GAME.setFlipper('R', R); }
      for (var i = 0; i < 60 * 400; i++) {
        if (S.lives < 3) S.lives = 3;
        S.energy = 9999;
        if (S.mode === 'build' && S.buildT > 0.3) S.buildT = 0.2;
        if (S.notice) GAME.noticeAction(S.notice.buttons[0].id);
        flip(); GAME.update(DT);
        if (S.mode === 'won' || S.mode === 'lost') break;
      }
      return S.mode;
    }
    GAME.progress.stars = {};
    GAME.progress.tutorialDone = true;
    GAME.progress.tutorialV = (window.TUT && TUT.VERSION) || 6;
    GAME.saveProgress();
    var a = play(), b = play();
    UI.showScreen = realShow;
    return JSON.stringify({ first: a, second: b, seen: seen });
  })()`));
  expect('endless announced once',
    unlock.seen.length === 2 && unlock.seen[0].isNew === true && unlock.seen[1].isNew === false,
    unlock.seen.map(function (r) { return 'prev ' + r.prev + ' -> ' + r.isNew; }).join(', '));

  /* ---- Endless, out to a boss wave ----------------------------------- */
  const end = JSON.parse(await run(`(function(){
    GAME.progress.endlessTutAsked = true;
    GAME.startEndless(['megaball']);
    var S = GAME.state, DT = 1/60;
    if (S.notice) GAME.noticeAction('ok');
    S.energy = 999999;
    var want = ['bumper','paddle','blast','paddle','bumper','power',
                'paddle','bumper','blast','paddle','shock','bumper'], p = 0;
    for (var k = 0; k < S.table.slots.length && p < 12; k++) { var sl = S.table.slots[k];
      if (sl.occupant) continue; S.buildPick = want[p]; if (GAME.placeAt(sl)) p++; }
    function flip(){ var L = false, R = false;
      for (var b = 0; b < S.balls.length; b++) { var q = S.balls[b];
        if (q.dead) continue;
        if (q.y > 1060 && q.vy > 0) { if (q.x < 360) L = true; else R = true; } }
      GAME.setFlipper('L', L); GAME.setFlipper('R', R); }
    var bossF = 0, bossOffered = 0, maxShake = 0, rot = 0, frames = 0, maxBalls = 0;
    for (var i = 0; i < 60 * 280; i++) {
      S.lives = 5; S.energy = 999999;
      if (S.mode === 'build' && S.buildT > 0.3) S.buildT = 0.2;
      if (S.notice) GAME.noticeAction(S.notice.buttons[0].id);
      flip(); GAME.update(DT);
      if (S.mode !== 'wave') continue;
      frames++; if (S.balls.length > maxBalls) maxBalls = S.balls.length;
      var j = FX.juice();
      if (j.shake > maxShake) maxShake = j.shake;
      if (j.shake > 8) rot++;
      var w = S.level.waves[S.waveIndex];
      if (w && w.boss) { bossF++; if (GAME.canEndWaveEarly()) bossOffered++; }
    }
    return JSON.stringify({ wave: S.waveIndex + 1, maxBalls: maxBalls, bossFrames: bossF,
      bossOfferedPct: Math.round(100 * bossOffered / Math.max(1, bossF)),
      maxShake: +maxShake.toFixed(1),
      rotatingPct: Math.round(100 * rot / Math.max(1, frames)) });
  })()`));
  expect('endless runs', end.wave >= 5 && end.maxBalls > 4,
    'reached wave ' + end.wave + ' with up to ' + end.maxBalls + ' balls');
  expect('boss wave is escapable', end.bossFrames === 0 || end.bossOfferedPct > 10,
    end.bossFrames ? 'NEXT WAVE offered for ' + end.bossOfferedPct + '% of boss-wave time'
      : 'no boss wave reached in this run');
  expect('juice stays governed', end.rotatingPct < 25 && end.maxShake > 10,
    'peak shake ' + end.maxShake + ', rotating ' + end.rotatingPct + '% of frames');

  /* ---- the results sheet, after its animations have finished ---------- */
  await run(`(function(){
    document.getElementById('ui').style.display = '';
    var L = LEVELS.byId(3);
    UI.showScreen('results', { win: true, level: L, stars: 2, prevStars: 0,
      objectives: LEVELS.objectives(L, { won:true, lost:false, leaks:0, peakTowers:6,
        peakFamily:{ paddle:3, bumper:3 }, built:{}, bestChain:4 }),
      lives:4, livesMax:5, kills:40, earned:300, leaks:0, unlocks:[],
      bestChain:4, totalStars:6, hasNext:true });
    return 1;
  })()`);
  await sleep(2500);
  const res = JSON.parse(await run(`(function(){
    function op(n){ return getComputedStyle(n).opacity; }
    var rows = document.querySelectorAll('#ui .objs.res .obj');
    var lamps = document.querySelectorAll('#ui .starlamps i');
    var silk = document.querySelector('#ui .dmd .silk');
    return JSON.stringify({
      rows: rows.length,
      head: (document.querySelector('#ui .objhead') || {}).innerText || null,
      hidden: Array.prototype.filter.call(rows, function(r){ return +op(r) < 0.9; }).length +
              Array.prototype.filter.call(lamps, function(l){ return +op(l) < 0.9; }).length,
      silkShadow: silk ? getComputedStyle(silk).boxShadow : 'no caption'
    });
  })()`));
  expect('results sheet', res.rows === 3 && res.hidden === 0,
    res.rows + ' verdict rows, ' + res.hidden + ' invisible elements, head "' +
    String(res.head).replace(/\n/g, ' ') + '"');
  expect('display caption is flat', res.silkShadow === 'none',
    'box-shadow: ' + res.silkShadow);

  expect('no page errors', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none');
  expect('no console errors', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'none');

  console.log('MEGABALL submission playtest');
  console.log('file: ' + PAGE);
  console.log('='.repeat(66));
  Object.keys(report).forEach(k => console.log(report[k].slice(0, 6) + k.padEnd(26) + report[k].slice(6)));
  console.log('='.repeat(66));
  console.log(fail.length
    ? 'RESULT: FAIL — ' + fail.join(', ')
    : 'RESULT: PASS — ' + Object.keys(report).length + '/' + Object.keys(report).length + ' checks clean.');

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* windows holds files */ }
  setTimeout(() => process.exit(fail.length ? 2 : 0), 300);
})().catch(e => bail(e.message));
