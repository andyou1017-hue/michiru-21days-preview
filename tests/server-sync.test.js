'use strict';
// Server-side daily-record regression tests. No production URL or user data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createGateway } = require('../runtime/gateway');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-sync-'));
  const databasePath = path.join(dir, 'private.sqlite');
  const gateway = createGateway({ databasePath, origin: 'http://127.0.0.1:0', development: true });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function post(route, data, cookie = '') {
    return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify(data) });
  }
  async function enroll(email) {
    const invite = gateway.createInvite(email);
    const res = await post('/api/enroll', { email, password: 'safe-test-password-123', invite });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  async function entries(cookie) {
    const res = await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    return (await res.json()).entries;
  }
  return { base, databasePath, post, enroll, entries };
}
function entry(day, reflection) {
  return { day_number: day, mood_am: null, mood_pm: 6, answers: ['気づいたこと'],
    action_text: '', action_status: null, reflection,
    updated_at: '2026-11-01T01:00:00.000Z', completed_at: null };
}

test('未認証者は保存・削除できず、各利用者の記録を混ぜない', async t => {
  const { post, enroll, entries } = await fixture(t);
  const a = await enroll('a@example.invalid'), b = await enroll('b@example.invalid');
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'Aの記録') })).status, 401);
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'Aの記録') }, a)).status, 200);
  assert.equal((await post('/api/entry', { day: 2, entry: entry(2, 'Bの記録') }, b)).status, 200);
  assert.deepEqual(Object.keys(await entries(a)), ['1']);
  assert.equal((await entries(a))[1].reflection, 'Aの記録');
  assert.deepEqual(Object.keys(await entries(b)), ['2']);
  assert.equal((await post('/api/entry/delete', { day: 2 }, a)).status, 200);
  assert.equal((await entries(b))[2].reflection, 'Bの記録');
  assert.equal((await post('/api/entries/delete-all', {}, a)).status, 200);
  assert.deepEqual(await entries(a), {});
  assert.equal((await entries(b))[2].reflection, 'Bの記録');
});

test('日付・入力形式・Originを検証し、拒否した記録は保存しない', async t => {
  const { post, enroll, entries, base } = await fixture(t);
  const cookie = await enroll('validation@example.invalid');
  for (const [day, data] of [[0, entry(0, 'x')], [22, entry(22, 'x')],
    [1, entry(2, 'wrong day')], [1, { ...entry(1, 'x'), answers: ['x'.repeat(5000)] }],
    [1, { ...entry(1, 'x'), mood_am: 12 }]]) {
    assert.equal((await post('/api/entry', { day, entry: data }, cookie)).status, 400);
  }
  const attack = await fetch(base + '/api/entry', {
    method: 'POST', headers: { Origin: 'https://elsewhere.invalid', Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: 1, entry: entry(1, 'x') })
  });
  assert.equal(attack.status, 403);
  assert.deepEqual(await entries(cookie), {});
});

test('アカウント削除で日別記録と認証情報を消去し、再ログインを拒否する', async t => {
  const { post, enroll, entries, databasePath, base } = await fixture(t);
  const email = 'erase@example.invalid';
  const cookie = await enroll(email);
  assert.equal((await post('/api/entry', { day: 7, entry: entry(7, '消す記録') }, cookie)).status, 200);
  assert.equal((await entries(cookie))[7].reflection, '消す記録');
  assert.equal((await post('/api/delete-account', {}, cookie)).status, 200);
  assert.equal((await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await post('/api/login', { email, password: 'safe-test-password-123' })).status, 401);
  const db = new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM entries').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM accounts WHERE email=?').get(email).n, 0);
  } finally { db.close(); }
});
