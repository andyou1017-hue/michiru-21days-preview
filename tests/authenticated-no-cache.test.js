'use strict';
// 受講生の個人記録が共有端末・中間キャッシュへ残らないことを確認する。
// 架空の招待・記録だけを使用。iPhone Safari実機試験の代替ではない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

test('招待後の教材・個人記録・手紙・ログアウト応答もキャッシュ禁止', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-private-cache-'));
  const gateway = createGateway({
    databasePath: path.join(dir, 'student.sqlite'),
    origin: 'http://127.0.0.1:0',
    development: true
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const email = 'cache-student@example.invalid';
  const invite = gateway.createInvite(email);
  const post = (route, data, cookie = '') => fetch(base + route, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data)
  });
  function privateHeaders(response, route) {
    assert.equal(response.headers.get('cache-control'), 'no-store', route);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', route);
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, route);
  }

  const enrolled = await post('/api/enroll', { email, password: 'a-long-test-passphrase', invite });
  assert.equal(enrolled.status, 200);
  privateHeaders(enrolled, 'enroll');
  const cookie = enrolled.headers.get('set-cookie').split(';')[0];
  const get = route => fetch(base + route, { headers: { Cookie: cookie } });

  for (const route of ['/', '/api/bootstrap', '/api/future-letter/status', '/js/app.js', '/css/app.css']) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    privateHeaders(response, route);
    await response.arrayBuffer();
  }

  const sealed = await post('/api/future-letter/seal', { text: '架空の未来への手紙' }, cookie);
  assert.equal(sealed.status, 200);
  privateHeaders(sealed, 'seal');
  const locked = await post('/api/future-letter/open', {}, cookie);
  assert.equal(locked.status, 423);
  privateHeaders(locked, 'locked letter');
  assert.equal(JSON.stringify(await (await get('/api/future-letter/status')).json()).includes('架空の未来への手紙'), false,
    '封印した本文を開封前の状態APIへ含めない');

  const logout = await post('/api/logout', {}, cookie);
  assert.equal(logout.status, 200);
  privateHeaders(logout, 'logout');
  const denied = await get('/api/bootstrap');
  assert.equal(denied.status, 401);
  privateHeaders(denied, 'after logout');
});
