'use strict';
// Server-enforced letter lock: the client cannot advance the unlock by changing its clock.
// The client UI is not connected to this API until owner approval of storage and consent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const WEEK = 7 * 86400000;

async function fixture(t) {
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-letter-lock-'));
  const gateway = createGateway({
    databasePath: path.join(dir, 'private.sqlite'),
    origin: 'http://127.0.0.1:0', development: true, now: () => clock
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function post(route, data, cookie = '') {
    return fetch(base + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
      body: JSON.stringify(data) });
  }
  async function get(route, cookie = '') {
    return fetch(base + route, { headers: { Cookie: cookie } });
  }
  async function enroll(email) {
    const invite = gateway.createInvite(email);
    const res = await post('/api/enroll', { email, password: 'safe-test-password-123', invite });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  async function login(email) {
    const res = await post('/api/login', { email, password: 'safe-test-password-123' });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  return { post, get, enroll, login, advance: ms => { clock += ms; } };
}

test('手紙はサーバーで封印し、7日未満は本文を返さず、7日後に初めて開く', async t => {
  const f = await fixture(t);
  let a = await f.enroll('letter-a@example.invalid');
  const text = '21日後の私から、今日の私へ。';
  assert.equal((await f.post('/api/future-letter/seal', { text })).status, 401);
  assert.equal((await f.post('/api/future-letter/seal', { text }, a)).status, 200);
  const status = await (await f.get('/api/future-letter/status', a)).json();
  assert.equal(status.sealed, true);
  assert.equal(status.available, false);
  assert.equal('text' in status, false);
  const boot = await (await f.get('/api/bootstrap', a)).text();
  assert.equal(boot.includes(text), false, 'bootstrap must never include a sealed letter');
  assert.equal((await f.post('/api/future-letter/open', {}, a)).status, 423);
  f.advance(WEEK - 1);
  // Sessions expire after 24h. Re-authenticate rather than weakening session expiry.
  assert.equal((await f.get('/api/future-letter/status', a)).status, 401);
  a = await f.login('letter-a@example.invalid');
  assert.equal((await f.post('/api/future-letter/open', {}, a)).status, 423);
  f.advance(1);
  const opened = await f.post('/api/future-letter/open', {}, a);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).text, text);
  assert.equal((await (await f.get('/api/future-letter/status', a)).json()).opened, true);
  assert.equal((await f.post('/api/future-letter/open', {}, a)).status, 200);
});

test('封印後の書き直し拒否・利用者間分離・アカウント削除で本文消去', async t => {
  const f = await fixture(t);
  let a = await f.enroll('letter-b@example.invalid');
  let b = await f.enroll('letter-c@example.invalid');
  assert.equal((await f.post('/api/future-letter/seal', { text: '最初の手紙' }, a)).status, 200);
  assert.equal((await f.post('/api/future-letter/seal', { text: '改ざん' }, a)).status, 409);
  assert.equal((await f.post('/api/future-letter/open', {}, b)).status, 404);
  assert.equal((await (await f.get('/api/future-letter/status', b)).json()).sealed, false);
  assert.equal((await f.post('/api/future-letter/seal', { text: '' }, b)).status, 400);
  assert.equal((await f.post('/api/future-letter/seal', { text: 'x'.repeat(4001) }, b)).status, 400);
  f.advance(WEEK);
  assert.equal((await f.get('/api/future-letter/status', a)).status, 401);
  a = await f.login('letter-b@example.invalid');
  assert.equal((await (await f.post('/api/future-letter/open', {}, a)).json()).text, '最初の手紙');
  assert.equal((await f.post('/api/delete-account', {}, a)).status, 200);
  assert.equal((await f.get('/api/future-letter/status', a)).status, 401);
  // The second user's session also expired during the seven-day clock advance.
  // Re-authenticate before checking isolation; a 401 error body has no `sealed` field.
  assert.equal((await f.get('/api/future-letter/status', b)).status, 401);
  b = await f.login('letter-c@example.invalid');
  assert.equal((await (await f.get('/api/future-letter/status', b)).json()).sealed, false);
});

test('他サイトからのPOSTと未ログインGETは拒否する', async t => {
  const f = await fixture(t), a = await f.enroll('letter-d@example.invalid');
  assert.equal((await f.get('/api/future-letter/status')).status, 401);
  // Verify the endpoint rejects a cross-origin mutation without creating a letter.
  // The fixture POST helper supplies the expected Origin, so use a request with no Origin.
  assert.equal((await fetch((await f.get('/api/future-letter/status', a)).url.replace('/api/future-letter/status', '/api/future-letter/seal'), {
    method: 'POST', headers: { Cookie: a, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '不正な封印' })
  })).status, 403);
  assert.equal((await (await f.get('/api/future-letter/status', a)).json()).sealed, false);
});
