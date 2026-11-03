'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

test('ログイン前の画面とAPI応答はキャッシュ禁止', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-cache-test-'));
  const gateway = createGateway({ databasePath: path.join(dir, 'test.sqlite'), origin: 'http://127.0.0.1:0', development: true });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  for (const route of ['/', '/api/bootstrap', '/offline.html', '/sw.js']) {
    const response = await fetch(base + route);
    assert.equal(response.headers.get('cache-control'), 'no-store', route);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', route);
  }
});
