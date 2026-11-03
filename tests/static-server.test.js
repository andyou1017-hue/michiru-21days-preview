'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('../tools/static-server');
test('不正URLは400、隣接ディレクトリへの脱出は403。以後の正常要求も処理できる', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-static-'));
  const root = path.join(dir, 'app'); fs.mkdirSync(root);
  fs.mkdirSync(root + '-private');
  fs.writeFileSync(path.join(root, 'index.html'), 'OK');
  fs.writeFileSync(path.join(root + '-private', 'secret'), 'PRIVATE');
  const server = createStaticServer(root);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true }); });
  async function request(url) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: server.address().port, path: url }, res => {
        let body = ''; res.on('data', b => { body += b; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
  }
  assert.equal((await request('/%E0%A4%A')).status, 400);
  assert.equal((await request('/%00')).status, 400);
  assert.equal((await request('/..%2fapp-private/secret')).status, 403);
  assert.deepEqual(await request('/'), { status: 200, body: 'OK' });
});
