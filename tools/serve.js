/* Tiny zero-dependency static server for local playtesting only.
   The shipped game does not need it — index.html runs straight from file://. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
/* Port comes from the environment so several playtest sessions can run side
   by side; 5173 is only the fallback when nothing assigns one. */
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.webp':'image/webp', '.json':'application/json', '.md':'text/markdown' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('megaball dev server on http://localhost:' + PORT));
