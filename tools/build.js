#!/usr/bin/env node
/* MEGABALL — tools/build.js
 *
 * Produces the competition submission package:
 *
 *   dist/index.html    one self-contained, readable, dependency-free document
 *   dist/megaball.zip  that file, at the ROOT of the zip, nothing else
 *
 * Zero dependencies (Node stdlib only) and deliberately NOT a minifier: the
 * competition asks for readable game code inside a root-level index.html, and
 * judges read it. All we do is splice each <script src="src/*.js"> into the
 * page verbatim, keeping load order and the original comment banners.
 *
 * Usage:  node tools/build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC_HTML = path.join(ROOT, 'index.html');
const OUT_HTML = path.join(DIST, 'index.html');
const OUT_ZIP = path.join(DIST, 'megaball.zip');
const ZIP_ENTRY_NAME = 'index.html';
const SIZE_CAP = 35 * 1024 * 1024;

/* ------------------------------------------------------------------ utils */

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
function mb(n) { return (n / (1024 * 1024)).toFixed(2) + ' MB'; }

function fail(msg) {
  console.error('BUILD FAILED: ' + msg);
  process.exit(1);
}

/* ------------------------------------------------------- 1. inline scripts */

/* A literal "</script" anywhere in the JS would close the tag early. The
 * sources currently contain none, but a future string literal or comment
 * could, so neutralise it unconditionally: "<\/script" is identical inside a
 * JS string/regex and harmless inside a comment. */
function escapeClosingTag(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

/* Third-party libraries are NOT inlined. The competition rules ask for them
 * in a folder named `vendor` next to index.html, referenced by relative path,
 * and explicitly not embedded in the page. So src/vendor/x.js is copied to
 * dist/vendor/x.js and the tag is rewritten to point there. */
function inlineScripts(html) {
  const inlined = [];
  const vendored = [];
  const TAG = /[ \t]*<script\s+src\s*=\s*["']([^"']+)["']\s*>\s*<\/script>[ \t]*\r?\n?/gi;

  const out = html.replace(TAG, (match, src) => {
    if (/^[a-z]+:\/\//i.test(src) || src.startsWith('//')) {
      fail('remote script reference in index.html: ' + src +
           ' — the submission must be fully offline.');
    }
    const abs = path.join(ROOT, src.split('/').join(path.sep));
    if (!fs.existsSync(abs)) fail('script not found on disk: ' + src);

    if (src.startsWith('src/vendor/')) {
      const rel = src.slice('src/'.length);          // vendor/three.min.js
      const data = fs.readFileSync(abs);
      vendored.push({ src, rel, bytes: data.length, data });
      return '<script src="' + rel + '"></script>\n';
    }

    const code = escapeClosingTag(fs.readFileSync(abs, 'utf8')).replace(/\s*$/, '');
    inlined.push({ src, bytes: Buffer.byteLength(code, 'utf8') });

    /* Keep a marker so a judge reading dist/index.html can still tell where
     * each module came from in the source tree. */
    return '<!-- ' + src + ' -->\n<script>\n' + code + '\n</script>\n';
  });

  return { html: out, inlined, vendored };
}

/* ---------------------------------------------------------- 2. ZIP writer */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* MS-DOS date/time, the only timestamp the base ZIP format understands. */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/* Minimal single-entry-capable ZIP writer: local file headers followed by the
 * central directory and EOCD. Deflate (method 8) via zlib.deflateRawSync. */
function makeZip(entries, when) {
  const { time, date } = dosDateTime(when || new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    /* Store instead of deflate if compression made it bigger (tiny files). */
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // local file header signature
    local.writeUInt16LE(20, 4);          // version needed to extract (2.0)
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);     // central directory header signature
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0, 8);              // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // extra length
    cd.writeUInt16LE(0, 32);             // comment length
    cd.writeUInt16LE(0, 34);             // disk number start
    cd.writeUInt16LE(0, 36);             // internal attributes
    cd.writeUInt32LE(0x81a40000 >>> 0, 38); // external attrs: regular file 0644
    cd.writeUInt32LE(offset, 42);        // relative offset of local header
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);     // end of central directory signature
  eocd.writeUInt16LE(0, 4);              // this disk
  eocd.writeUInt16LE(0, 6);              // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);             // comment length

  return Buffer.concat([Buffer.concat(chunks), cdBuf, eocd]);
}

/* ------------------------------------------- 3. ZIP reader (self-checking) */

/* Reads the archive back through the central directory — the same path a real
 * unzip tool takes — so a malformed header is caught here and not by a judge. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff + cdSize > buf.length) throw new Error('central directory out of bounds');

  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header #' + i);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');

    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);

    if (data.length !== usize) throw new Error('size mismatch for ' + name);
    if (crc32(data) !== crc) throw new Error('CRC mismatch for ' + name);
    out.push({ name, data });

    p += 46 + nlen + elen + clen;
  }
  return out;
}

/* ---------------------------------------------------------------- 4. main */

function main() {
  if (!fs.existsSync(SRC_HTML)) fail('index.html not found at ' + SRC_HTML);

  const srcHtml = fs.readFileSync(SRC_HTML, 'utf8');
  const { html, inlined, vendored } = inlineScripts(srcHtml);

  if (!inlined.length) fail('no <script src="..."> tags found — nothing to inline.');
  /* The only <script src=> allowed to survive points into vendor/. */
  const survivors = html.match(/<script\s+src\s*=\s*["']([^"']+)["']/gi) || [];
  for (const s of survivors) {
    if (!/src\s*=\s*["']vendor\//i.test(s)) fail('a non-vendor <script src=> survived inlining: ' + s);
  }

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  for (const v of vendored) {
    const dest = path.join(DIST, v.rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, v.data);
  }

  const htmlBuf = fs.readFileSync(OUT_HTML);
  const entries = [{ name: ZIP_ENTRY_NAME, data: htmlBuf }]
    .concat(vendored.map(v => ({ name: v.rel, data: v.data })));
  const zipBuf = makeZip(entries);
  fs.writeFileSync(OUT_ZIP, zipBuf);

  /* Read the archive we just wrote back and byte-compare. A zip that does not
   * round-trip is worse than no zip at all. */
  let roundTrip = 'FAIL';
  try {
    const back = readZip(fs.readFileSync(OUT_ZIP));
    if (back.length !== entries.length) throw new Error('expected ' + entries.length + ' entries, got ' + back.length);
    if (back[0].name !== ZIP_ENTRY_NAME) throw new Error('entry is "' + back[0].name + '", not at zip root');
    for (let i = 0; i < entries.length; i++) {
      if (back[i].name !== entries[i].name) throw new Error('entry ' + i + ' is "' + back[i].name + '"');
      if (!back[i].data.equals(entries[i].data)) throw new Error('extracted bytes differ for ' + back[i].name);
    }
    roundTrip = 'OK';
  } catch (e) {
    fail('zip did not round-trip: ' + e.message);
  }

  const under = zipBuf.length < SIZE_CAP;
  const totalBytes = entries.reduce((n, e) => n + e.data.length, 0);

  console.log('');
  console.log('MEGABALL build');
  console.log('--------------------------------------------------');
  console.log('inlined modules      : ' + inlined.length);
  for (const f of inlined) {
    console.log('  ' + f.src.padEnd(20) + kb(f.bytes).padStart(12));
  }
  console.log('vendor files (copied): ' + vendored.length);
  for (const v of vendored) {
    console.log('  ' + v.rel.padEnd(20) + kb(v.bytes).padStart(12));
  }
  console.log('--------------------------------------------------');
  console.log('dist/index.html      : ' + htmlBuf.length + ' bytes  (' + mb(htmlBuf.length) + ')');
  console.log('dist/megaball.zip    : ' + zipBuf.length + ' bytes  (' + mb(zipBuf.length) + ')');
  console.log('compression          : ' + (100 - (zipBuf.length / totalBytes) * 100).toFixed(1) + '%');
  console.log('zip round-trip       : ' + roundTrip + ' (' + entries.length + ' entries, "' +
              ZIP_ENTRY_NAME + '" at archive root' + (vendored.length ? ', libraries under vendor/' : '') + ')');
  console.log('35 MB cap            : ' + (under ? 'PASS' : 'FAIL') +
              '  — ' + mb(SIZE_CAP - zipBuf.length) + ' headroom');
  console.log('--------------------------------------------------');
  console.log('Next: node tools/verify.js');
  console.log('');

  if (!under) process.exit(1);
}

main();
