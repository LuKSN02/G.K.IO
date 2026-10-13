// Servidor estático mínimo em 127.0.0.1. Rodar o app em http://localhost
// (e não file://) mantém o Firebase Auth/IndexedDB funcionando — "localhost"
// já vem como domínio autorizado por padrão no Firebase.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

function start(root, preferredPort = 47831) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (rel === '/') rel = '/index.html';
    const full = path.normalize(path.join(root, rel));
    if (!full.startsWith(path.normalize(root + path.sep))) { res.writeHead(403); return res.end(); } // anti path-traversal
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    const listen = (port) => {
      server.once('error', (e) => { if (e.code === 'EADDRINUSE' && port !== 0) listen(0); else reject(e); });
      // Porta fixa => origem estável => localStorage/IndexedDB persistem entre execuções.
      server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    };
    listen(preferredPort);
  });
}
module.exports = { start };
