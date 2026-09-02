#!/usr/bin/env node
/* MEGABALL — tools/verify.js
 *
 * Static compliance checker for the competition submission. Run it on the
 * built single-file document:
 *
 *   node tools/verify.js                 # checks dist/index.html
 *   node tools/verify.js path/to.html    # checks something else
 *
 * Exits non-zero if any check fails, so it can gate a release.
 *
 * What this does and does NOT prove: it proves the shipped bytes contain no
 * remote references and no networking API calls. It cannot prove the game
 * boots — that is a manual file:// run (see docs/SUBMISSION.md).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SIZE_CAP = 35 * 1024 * 1024;
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(target)) {
  console.error('verify: file not found: ' + target);
  console.error('Run `node tools/build.js` first.');
  process.exit(1);
}

const buf = fs.readFileSync(target);
const text = buf.toString('utf8');

/* Line index, built once, so every finding can be reported with a location. */
const lineStarts = [0];
for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
function lineOf(idx) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
function context(idx, len) {
  const s = Math.max(0, idx - 45);
  const e = Math.min(text.length, idx + len + 45);
  return text.slice(s, e).replace(/\s+/g, ' ').trim();
}

const results = [];
function check(name, findings, detail) {
  results.push({ name, findings: findings || [], detail: detail || '' });
}

/* Collect every match of a regex as {line, text} findings. */
function scan(re, filter) {
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(text)) !== null) {
    if (m[0].length === 0) { rx.lastIndex++; continue; }
    if (filter && !filter(m)) continue;
    out.push({ line: lineOf(m.index), text: context(m.index, m[0].length), match: m[0] });
    if (out.length >= 25) break;
  }
  return out;
}

/* --- 1. no remote URLs ---------------------------------------------------
 * XML namespace identifiers (http://www.w3.org/...) are never fetched by a
 * browser — they are opaque strings — so they are the one allowed form. */
const NS_ALLOW = /^https?:\/\/www\.w3\.org\//;
const remoteUrls = scan(/https?:\/\/[^\s"'`)<>\\]+/g, (m) => !NS_ALLOW.test(m[0]));
check('No http:// or https:// URLs (data: URIs fine)', remoteUrls,
      'w3.org XML namespace strings are exempt: browsers never fetch them.');

/* --- 2. no networking APIs ----------------------------------------------- */
const netApis = scan(
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bimportScripts\b|\bsendBeacon\b|navigator\.serviceWorker|\bnew\s+Worker\s*\(/g);
check('No fetch/XHR/WebSocket/EventSource/importScripts/sendBeacon', netApis);

/* --- 3. no ES module syntax (file:// blocks modules) --------------------- */
const moduleSyntax = scan(
  /(?:^|[\n;}])[ \t]*(?:import|export)[ \t]+(?![(=:.])|(?:^|[^.\w$])import[ \t]*\(|type\s*=\s*["']module["']|<script[^>]*\btype\s*=\s*["']module["']/g);
check('No import/export syntax, no type="module"', moduleSyntax,
      'The game must run from file://, where module loading is blocked.');

/* --- 4. no remote fonts -------------------------------------------------- */
const remoteFonts = scan(/@font-face[\s\S]{0,400}?url\s*\(\s*["']?(?!data:)[^)]*\)|fonts\.googleapis\.com|fonts\.gstatic\.com/g);
check('No @font-face with a URL, no Google Fonts', remoteFonts,
      'Typography is the system font stack only.');

/* --- 5. self-contained single document ----------------------------------- */
const external = scan(
  /<script[^>]*\bsrc\s*=|<link[^>]*\brel\s*=\s*["']?stylesheet|<link[^>]*\bhref\s*=\s*["'](?!data:)|<img[^>]*\bsrc\s*=\s*["'](?!data:)|<(?:audio|video|source|iframe|embed|object)[^>]*\b(?:src|data)\s*=\s*["'](?!data:)|@import\s/gi);
check('Single self-contained document (no external subresources)', external);

/* --- 6. size cap --------------------------------------------------------- */
const overCap = buf.length > SIZE_CAP
  ? [{ line: 0, text: buf.length + ' bytes exceeds the 35 MB cap' }] : [];
check('Under the 35 MB submission cap', overCap,
      (buf.length / 1048576).toFixed(2) + ' MB of 35.00 MB (' +
      ((buf.length / SIZE_CAP) * 100).toFixed(1) + '% used)');

/* --- 7. asset budget (informational) -------------------------------------
 * assets.js builds its data URIs as PREFIX + '<base64>', so counting literal
 * "data:" strings undercounts the payload. Measure both. */
let dataUriCount = 0, dataUriBytes = 0;
{
  const rx = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9-]+=[^;,]*)*(?:;base64)?,[A-Za-z0-9+/=%._~:-]*/gi;
  let m;
  while ((m = rx.exec(text)) !== null) { dataUriCount++; dataUriBytes += m[0].length; }
}
let b64Count = 0, b64Bytes = 0;
{
  const rx = /['"]([A-Za-z0-9+/]{256,}={0,2})['"]/g;
  let m;
  while ((m = rx.exec(text)) !== null) { b64Count++; b64Bytes += m[1].length; }
}
const embeddedBytes = dataUriBytes + b64Bytes;

/* ----------------------------------------------------------------- output */

const W = 58;
let failed = 0;
console.log('');
console.log('MEGABALL compliance check');
console.log('file: ' + target);
console.log('='.repeat(W + 8));
for (const r of results) {
  const ok = r.findings.length === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + r.name);
  if (r.detail) console.log('      ' + r.detail);
  for (const f of r.findings) {
    console.log('      line ' + f.line + ': ' + f.text.slice(0, 160));
  }
}
console.log('='.repeat(W + 8));
console.log('INFO  embedded data: URIs        : ' + dataUriCount +
            '  (' + (dataUriBytes / 1024).toFixed(1) + ' KB of literal URI text)');
console.log('INFO  base64 payload literals    : ' + b64Count +
            '  (' + (b64Bytes / 1024).toFixed(1) + ' KB)');
console.log('INFO  total embedded asset text  : ' + (embeddedBytes / 1024).toFixed(1) + ' KB' +
            '  (' + ((embeddedBytes / buf.length) * 100).toFixed(1) + '% of the document)');
console.log('INFO  document size              : ' + buf.length + ' bytes (' +
            (buf.length / 1048576).toFixed(2) + ' MB)');
console.log('='.repeat(W + 8));
console.log(failed === 0
  ? 'RESULT: PASS — ' + results.length + '/' + results.length + ' checks clean.'
  : 'RESULT: FAIL — ' + failed + ' of ' + results.length + ' checks failed.');
console.log('');

process.exit(failed === 0 ? 0 : 1);
