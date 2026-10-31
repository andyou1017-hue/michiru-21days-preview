// 試作版（app/）を手元で開くための小さなサーバー。外部には公開しない（127.0.0.1のみ）。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

// opts.now：応答の Date に使う時刻（テストで「7日後」などを作るため）
function createStaticServer(root, opts = {}) {
  root = path.resolve(root);
  return http.createServer((req, res) => {
    if (opts.now) res.setHeader('Date', new Date(opts.now()).toUTCString());
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (_) { res.writeHead(400); return res.end('bad request'); }
    if (urlPath.includes('\u0000')) { res.writeHead(400); return res.end('bad request'); }
    let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8340);
  createStaticServer(path.join(__dirname, '..', 'app')).listen(port, '127.0.0.1', () => {
    console.log('試作版：http://127.0.0.1:' + port + '/');
  });
}

module.exports = { createStaticServer };

