'use strict';
// Regression: a live SQLite backup must restore the full invite-only student state,
// including sealed letters, without exposing one student's records to another.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createGateway } = require('../runtime/gateway');
const { createBackup } = require('../runtime/backup');

async function listen(gateway) {
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + gateway.server.address().port;
}
async function close(gateway) {
  await new Promise(resolve => gateway.server.close(resolve));
}
async function post(base, route, payload, cookie = '') {
  return fetch(base + route, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
async function enroll(gateway, base, email) {
  const invite = gateway.createInvite(email);
  const response = await post(base, '/api/enroll', {
    email, password: 'test-passphrase-12345', invite
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
function entry(day, reflection) {
  return {
    day_number: day, mood_am: 5, mood_pm: 8, answers: ['今日の美点'],
    action_text: '小さな行動', action_status: 'done', reflection,
    updated_at: '2026-11-01T10:00:00.000Z', completed_at: null
  };
}
async function getJson(base, route, cookie) {
  const response = await fetch(base + route, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, route);
  return response.json();
}

test('稼働中のバックアップから記録・封印手紙・利用者分離を復元できる', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-recovery-'));
  const source = path.join(dir, 'live.sqlite');
  const destination = path.join(dir, 'recovered.sqlite');
  // Use the same controlled server clock before and after restore, so the seven-day
  // boundary is checked exactly rather than relying on wall-clock timing.
  let clock = Date.parse('2026-11-01T10:00:00.000Z');
  const original = createGateway({
    databasePath: source, origin: 'http://127.0.0.1:0', development: true, now: () => clock
  });
  let restored;
  t.after(async () => {
    if (restored) await close(restored);
    await close(original);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = await listen(original);
  const a = await enroll(original, base, 'first@example.invalid');
  const b = await enroll(original, base, 'second@example.invalid');
  const letter = '封印した大切な手紙の本文';
  assert.equal((await post(base, '/api/entry', { day: 1, entry: entry(1, 'Aの振り返り') }, a)).status, 200);
  assert.equal((await post(base, '/api/entry', { day: 2, entry: entry(2, 'Bの振り返り') }, b)).status, 200);
  assert.equal((await post(base, '/api/future-letter/seal', { text: letter }, a)).status, 200);

  // SQLite WAL remains live while the backup is taken.
  await createBackup(source, destination);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM future_letters').get().n, 1);
  } finally { snapshot.close(); }

  restored = createGateway({
    databasePath: destination, origin: 'http://127.0.0.1:0', development: true, now: () => clock
  });
  const restoredBase = await listen(restored);
  const first = await getJson(restoredBase, '/api/bootstrap', a);
  const second = await getJson(restoredBase, '/api/bootstrap', b);
  assert.deepEqual(Object.keys(first.entries), ['1']);
  assert.deepEqual(Object.keys(second.entries), ['2']);
  assert.equal(first.entries[1].reflection, 'Aの振り返り');
  assert.equal(second.entries[2].reflection, 'Bの振り返り');
  assert.equal(JSON.stringify(first).includes('Bの振り返り'), false);
  assert.equal(JSON.stringify(second).includes('Aの振り返り'), false);
  assert.equal(JSON.stringify(first).includes(letter), false, '封印本文はbootstrapへ出さない');
  const status = await getJson(restoredBase, '/api/future-letter/status', a);
  assert.equal(status.sealed, true);
  assert.equal(status.available, false);
  assert.equal('text' in status, false);
  assert.equal((await post(restoredBase, '/api/future-letter/open', {}, a)).status, 423);
  assert.equal((await getJson(restoredBase, '/api/future-letter/status', b)).sealed, false);
  assert.equal((await fetch(restoredBase + '/recovered.sqlite', { headers: { Cookie: a } })).status, 404);

  // A restored database must preserve the original seal time. Expired sessions
  // require re-authentication, but neither restore nor login may reset the lock.
  clock += 7 * 86400000 - 1;
  assert.equal((await post(restoredBase, '/api/future-letter/open', {}, a)).status, 401);
  const login = await post(restoredBase, '/api/login', {
    email: 'first@example.invalid', password: 'test-passphrase-12345'
  });
  assert.equal(login.status, 200);
  const freshCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(restoredBase, '/api/future-letter/open', {}, freshCookie)).status, 423);
  assert.equal((await post(restoredBase, '/api/future-letter/seal', { text: '書き直し' }, freshCookie)).status, 409);
  clock += 1;
  const opened = await post(restoredBase, '/api/future-letter/open', {}, freshCookie);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).text, letter);
  const openedStatus = await getJson(restoredBase, '/api/future-letter/status', freshCookie);
  assert.equal(openedStatus.opened, true);
  assert.equal('text' in openedStatus, false, '開封後もstatusには本文を含めない');
  assert.equal((await post(restoredBase, '/api/future-letter/seal', { text: '再封印' }, freshCookie)).status, 409);
});
