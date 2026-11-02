'use strict';
// The invite login screen must not promise full sync or falsely claim no sync.
// No real student account, network deployment or production data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

test('招待ログイン画面は同意後の部分同期と端末専用データを正確に案内する', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-invite-copy-'));
  const gateway = createGateway({
    databasePath: path.join(dir, 'private.sqlite'),
    origin: 'http://127.0.0.1:0',
    development: true
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const html = await response.text();
  assert.match(html, /招待を受け取った方だけが利用できます/);
  assert.match(html, /同意後、毎日の記録はこの端末と招待制サーバーに保存されます/);
  assert.match(html, /端末だけに残る内容もあります/);
  assert.match(html, /機種変更の前に/);
  assert.doesNotMatch(html, /自動同期はありません/);
  // A login-screen copy fix must not expose the authenticated curriculum.
  assert.equal((await fetch(base + '/api/bootstrap')).status, 401);
  assert.equal((await fetch(base + '/js/app.js')).status, 401);
});
