#!/usr/bin/env node
/* MEGABALL — tools/serve-submission.js
 *
 * Serves ONLY the unzipped submission (dist/submission-test/), which is the
 * one thing a judge actually runs. tools/serve.js serves the repo root, so it
 * would hand out the source index.html and src/*.js instead of the built,
 * inlined document — a stale or broken build would still look fine there.
 *
 * The competition's own instructions say not to test by opening index.html
 * from the filesystem: file:// can pass on a build that is still pulling from
 * the network, and can fail on a build that is perfectly fine. This exists so
 * the offline check runs over HTTP the way judging will.
 *
 * Usage:
 *   node tools/build.js
 *   node tools/unzip-submission.js   (or unzip dist/megaball.zip by hand)
 *   node tools/serve-submission.js
 *
 * Every request is logged with its status, so anything the page asks for that
 * is not in the zip shows up as a 404 rather than failing silently.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'dist', 'submission-test');
const PORT = Number(process.env.PORT) || 5174;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('No index.html in ' + ROOT);
  console.error('Run: node tools/build.js, then unzip dist/megaball.zip into dist/submission-test/');
  process.exit(1);
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);

  /* Path traversal guard: the point of this server is that it can only ever
   * serve what is actually inside the zip. */
  if (!file.startsWith(ROOT)) {
    console.log('403 ' + p);
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      console.log('404 ' + p + '   <-- NOT IN THE ZIP');
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + p);
      return;
    }
    console.log('200 ' + p + '  (' + buf.length + ' bytes)');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      /* No caching, so a re-test never reads a stale build. */
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('Serving the unzipped submission from ' + ROOT);
  console.log('http://localhost:' + PORT);
});
