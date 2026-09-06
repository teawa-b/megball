#!/usr/bin/env node
/* MEGABALL — tools/check-offline.js
 *
 * Tests the submission the way it will actually be judged, not by
 * double-clicking index.html. Double-clicking can pass a build that is still
 * pulling files off the internet (the machine running it has a connection)
 * and can fail a build that is perfectly fine (file:// blocks things a
 * server would allow). So:
 *
 *   1. unzip dist/megaball.zip into a clean empty folder
 *   2. serve that folder over a local HTTP server
 *   3. open it in a fresh, uncached browser profile
 *   4. kill the internet — every hostname except loopback fails to resolve
 *   5. play a full session in portrait
 *   6. assert nothing was fetched from outside, and nothing came up missing,
 *      silent or black
 *
 * Step 4 is done with Chrome's --host-resolver-rules rather than by unplugging
 * anything: every DNS lookup except 127.0.0.1 returns NOTFOUND, so the browser
 * genuinely cannot reach the network while localhost still serves the game.
 * That is stricter than switching off wi-fi, and it is repeatable.
 *
 * Every request the page makes is recorded either way, so the report says not
 * just "it survived offline" but "it never even asked".
 *
 * Zero dependencies — Node 22+ for the global WebSocket.
 *
 * Usage:  node tools/check-offline.js [path/to/megaball.zip]
 *
 * Exit 0 = clean. 1 = could not run it. 2 = failures.
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const zlib = require('zlib');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ZIP = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'megaball.zip'));
const CDP_PORT = 9341;
const HTTP_PORT = 8731;

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

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
function bail(msg) { console.error('CHECK FAILED: ' + msg); process.exit(1); }

/* ---------------------------------------------------------- 1. clean unzip */
/* Written by hand rather than shelling out to unzip/tar, so the check runs
 * the same on any machine and proves the archive is readable while it is at
 * it. Only the two methods a zip of this shape uses: stored and deflate. */
function unzipTo(zipPath, dest) {
  const buf = fs.readFileSync(zipPath);
  const files = [];
  /* Walk the central directory backwards from the end-of-central-directory
   * record, which is where a zip's real index lives. */
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    /* The local header repeats the name/extra lengths, and they can differ
     * from the central copy, so read them again rather than assuming. */
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);

    const out = path.join(dest, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    files.push({ name, bytes: data.length });
  }
  return files;
}

(async () => {
  if (!fs.existsSync(ZIP)) bail(ZIP + ' does not exist — run node tools/build.js first');
  const chromePath = CANDIDATES.find(f => { try { return fs.existsSync(f); } catch (e) { return false; } });
  if (!chromePath) bail('no Chrome or Edge found; set CHROME_PATH');

  const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megaball-unzip-'));
  const entries = unzipTo(ZIP, serveDir);

  /* ------------------------------------------------------- 2. local server */
  const served = [];
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(serveDir, rel);
    /* Never serve outside the unzipped folder: if the game reaches for
     * something that is not in the archive, this must 404, not find it on
     * the developer's disk. That is the whole point of the clean unzip. */
    if (!file.startsWith(serveDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      served.push({ url: req.url, status: 404 });
      res.writeHead(404); res.end('not found'); return;
    }
    served.push({ url: req.url, status: 200 });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + HTTP_PORT;

  /* ------------------- 3 + 4. fresh uncached profile, and no internet at all */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'megaball-profile-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    /* Every hostname fails to resolve except loopback: the browser is off
     * the internet, while the local server still answers. */
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--disable-application-cache',
    '--incognito',
    '--window-size=420,900',              // portrait, like a phone
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    origin + '/index.html'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const list = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => {
          let d = ''; r.on('data', c => (d += c));
          r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
        }).on('error', rej);
      });
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* not up yet */ }
  }
  if (!target) { chrome.kill(); server.close(); bail('Chrome never opened a debuggable page'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const waiting = new Map();
  const pageErrors = [], consoleErrors = [], requests = [], failedReqs = [];
  const reqUrl = new Map();
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
    if (m.method === 'Network.requestWillBeSent') {
      reqUrl.set(m.params.requestId, m.params.request.url);
      requests.push(m.params.request.url);
    }
    /* Name the URL, not just the error: "ERR_ABORTED" on its own says
     * nothing about whether the game reached for something it should not. */
    if (m.method === 'Network.loadingFailed') {
      failedReqs.push((reqUrl.get(m.params.requestId) || '?') + ' -> ' + m.params.errorText);
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
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.clearBrowserCache');
  await send('Network.clearBrowserCookies');
  /* Reload now that recording and the cache kill are armed, so the very
   * first byte of the real load is observed. */
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(8000);                                   // splash + asset decode

  const report = {}, fail = [];
  function expect(name, ok, detail) {
    report[name] = (ok ? 'PASS  ' : 'FAIL  ') + detail;
    if (!ok) fail.push(name);
  }

  /* ------------------------------------------- 5. play a session, portrait */
  const boot = JSON.parse(await run(`JSON.stringify({
    missing: ['GAME','DRAW','LEVELS','FX','UI','SFX','ART','SCENE3D','TUT','BOARD','ENT','CARDS']
      .filter(function(k){ return !window[k]; }),
    three: (window.THREE && THREE.REVISION) || null,
    webgl: !!(document.getElementById('gl') && document.getElementById('gl').getContext('webgl2')),
    portrait: window.innerHeight > window.innerWidth,
    artTotal: Object.keys(ART.manifest).length,
    artBroken: Object.keys(ART.manifest).filter(function(k){ return !ART.get(k); }),
    fonts: Array.from(document.fonts).map(function(f){ return f.family; })
  })`));
  expect('boots served + offline', !boot.missing.length && boot.webgl,
    boot.missing.length ? 'missing ' + boot.missing.join(', ')
      : 'all globals up, three.js r' + boot.three + ', WebGL2 live');
  expect('portrait', boot.portrait, 'window ' + (boot.portrait ? 'is portrait' : 'is NOT portrait'));
  expect('no missing art', boot.artBroken.length === 0,
    (boot.artTotal - boot.artBroken.length) + '/' + boot.artTotal + ' images decoded' +
    (boot.artBroken.length ? ', broken: ' + boot.artBroken.join(', ') : ''));
  expect('font bundled', boot.fonts.length > 0, 'loaded faces: ' + (boot.fonts.join(', ') || 'NONE'));

  const play = JSON.parse(await run(`(function(){
    document.getElementById('ui').style.display = 'none';
    GAME.progress.tutorialDone = true;
    GAME.progress.tutorialV = (window.TUT && TUT.VERSION) || 6;
    GAME.progress.stars = { 1:3, 2:2 };
    GAME.startLevel(3, ['megaball']);
    var S = GAME.state, DT = 1/60, i;
    for (i = 0; i < 60; i++) GAME.update(DT);
    var card = !!(S.notice && S.notice.title && S.notice.art);
    GAME.noticeAction('ok');
    S.energy = 9999;
    var want = ['bumper','paddle','blast','paddle','bumper','power','paddle','bumper'], p = 0;
    for (var k = 0; k < S.table.slots.length && p < 8; k++) { var sl = S.table.slots[k];
      if (sl.occupant) continue; S.buildPick = want[p]; if (GAME.placeAt(sl)) p++; }
    function flip(){ var L = false, R = false;
      for (var b = 0; b < S.balls.length; b++) { var q = S.balls[b];
        if (q.dead) continue;
        if (q.y > 1060 && q.vy > 0) { if (q.x < 360) L = true; else R = true; } }
      GAME.setFlipper('L', L); GAME.setFlipper('R', R); }
    for (i = 0; i < 60 * 400; i++) {
      S.lives = 5; S.energy = 9999;
      if (S.mode === 'build' && S.buildT > 0.3) S.buildT = 0.2;
      if (S.notice) GAME.noticeAction(S.notice.buttons[0].id);
      flip(); GAME.update(DT);
      if (S.mode === 'won' || S.mode === 'lost') break;
    }
    var st = (SCENE3D && SCENE3D.stats) ? SCENE3D.stats() : null;
    var ac = (SFX && SFX.ctx) ? SFX.ctx : (window.__ac || null);
    return JSON.stringify({ card: card, towers: S.towers.length, kills: S.totalKills,
      wave: S.waveIndex + 1, mode: S.mode,
      scene: st ? (st.objects || st.meshes || st.ledMaterials || 0) : 'n/a',
      audio: ac ? ac.state : 'no context' });
  })()`));
  expect('plays a full level', play.towers === 8 && play.kills > 0 && play.mode === 'won',
    play.towers + ' towers, ' + play.kills + ' kills, cleared on wave ' + play.wave);
  expect('mission card renders', play.card, 'stage card with art and objectives');

  /* Not black: a blank frame is a tiny PNG, a real one is not. */
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotBytes = shot.result && shot.result.data
    ? Buffer.from(shot.result.data, 'base64').length : 0;
  fs.writeFileSync(path.join(ROOT, 'dist', 'offline-shot.png'),
    Buffer.from(shot.result.data, 'base64'));
  expect('screen is not black', shotBytes > 20000,
    'frame is ' + (shotBytes / 1024).toFixed(0) + ' KB of PNG (a black frame is ~2 KB)');

  /* ------------------------------- 6. did it ever reach for the internet? */
  const external = requests.filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect('no external requests', external.length === 0,
    external.length ? external.slice(0, 4).join(' | ')
      : requests.length + ' requests, every one to ' + origin);
  const missing404 = served.filter(s => s.status === 404);
  expect('nothing 404s', missing404.length === 0,
    missing404.length ? missing404.map(s => s.url).join(', ') : 'every file the game asked for was in the zip');
  expect('no failed loads', failedReqs.length === 0,
    failedReqs.length ? failedReqs.slice(0, 3).join(' | ') : 'none');
  expect('no page errors', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none');
  expect('no console errors', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'none');

  console.log('MEGABALL offline playtest — served, uncached, no internet');
  console.log('zip   : ' + ZIP);
  console.log('unzip : ' + serveDir);
  console.log('served: ' + origin + '  (DNS dead for every other host)');
  console.log('files : ' + entries.map(e => e.name + ' (' + (e.bytes / 1024).toFixed(0) + ' KB)').join(', '));
  console.log('='.repeat(72));
  Object.keys(report).forEach(k => console.log(report[k].slice(0, 6) + k.padEnd(24) + report[k].slice(6)));
  console.log('='.repeat(72));
  console.log(fail.length ? 'RESULT: FAIL — ' + fail.join(', ')
    : 'RESULT: PASS — ' + Object.keys(report).length + '/' + Object.keys(report).length + ' checks clean.');

  ws.close();
  chrome.kill();
  server.close();
  setTimeout(() => process.exit(fail.length ? 2 : 0), 300);
})().catch(e => bail(e.message));
