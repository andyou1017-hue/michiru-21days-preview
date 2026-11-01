'use strict';
// End-to-end regression for the *encrypted* backup path with two synthetic invitees.
// No production database, credentials, email or external storage is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const { exportEncryptedBackup, restoreEncryptedBackup } = require('../runtime/encrypted-backup');

const passphrase = 'synthetic-recovery-test-passphrase-only';
const password = 'synthetic-test-password-1234';
const week = 7 * 86400000;

async function listen(gateway) {
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + gateway.server.address().port;
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
  const response = await post(base, '/api/enroll', { email, password, invite });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function get(base, route, cookie) {
  const response = await fetch(base + route, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, route);
  return response.json();
}
function entry(day, reflection) {
  return {
    day_number: day, mood_am: 4, mood_pm: 8, answers: ['架空の美点'],
    action_text: '架空の行動', action_status: 'done', reflection,
    updated_at: '2026-11-01T10:00:00.000Z', completed_at: null
  };
}

test('暗号化した稼働中DBから招待2名・日別記録・封印手紙・7日制限を復元する', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-encrypted-e2e-'));
  const live = path.join(dir, 'live.sqlite');
  const encrypted = path.join(dir, 'offsite-simulation', 'backup.enc');
  const recovered = path.join(dir, 'recovered.sqlite');
  let clock = Date.parse('2026-11-01T10:00:00.000Z');
  const original = createGateway({
    databasePath: live, origin: 'http://127.0.0.1:0',
    development: true, now: () => clock
  });
  let restored;
  t.after(async () => {
    if (restored) await new Promise(resolve => restored.server.close(resolve));
    await new Promise(resolve => original.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = await listen(original);
  const a = await enroll(original, base, 'encrypted-a@example.invalid');
  const b = await enroll(original, base, 'encrypted-b@example.invalid');
  const secret = '暗号化された未来からの手紙の架空本文';
  assert.equal((await post(base, '/api/entry', { day: 1, entry: entry(1, 'Aだけの記録') }, a)).status, 200);
  assert.equal((await post(base, '/api/entry', { day: 2, entry: entry(2, 'Bだけの記録') }, b)).status, 200);
  assert.equal((await post(base, '/api/future-letter/seal', { text: secret }, a)).status, 200);

  // Export while SQLite/WAL and the original HTTP gateway remain active.
  await exportEncryptedBackup(live, encrypted, passphrase);
  const bytes = fs.readFileSync(encrypted);
  assert.equal(bytes.includes(Buffer.from(secret)), false, '暗号化ファイルに手紙本文を含めない');
  assert.equal(bytes.includes(Buffer.from('Aだけの記録')), false, '暗号化ファイルに記録の平文を含めない');
  assert.equal(fs.statSync(encrypted).mode & 0o777, 0o600);
  await restoreEncryptedBackup(encrypted, recovered, passphrase);
  assert.equal(fs.statSync(recovered).mode & 0o777, 0o600);

  restored = createGateway({
    databasePath: recovered, origin: 'http://127.0.0.1:0',
    development: true, now: () => clock
  });
  const restoredBase = await listen(restored);
  const first = await get(restoredBase, '/api/bootstrap', a);
  const second = await get(restoredBase, '/api/bootstrap', b);
  assert.deepEqual(Object.keys(first.entries), ['1']);
  assert.deepEqual(Object.keys(second.entries), ['2']);
  assert.equal(first.entries[1].reflection, 'Aだけの記録');
  assert.equal(second.entries[2].reflection, 'Bだけの記録');
  assert.equal(JSON.stringify(first).includes('Bだけの記録'), false);
  assert.equal(JSON.stringify(second).includes('Aだけの記録'), false);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal((await get(restoredBase, '/api/future-letter/status', b)).sealed, false);
  const status = await get(restoredBase, '/api/future-letter/status', a);
  assert.equal(status.sealed, true);
  assert.equal(status.available, false);
  assert.equal('text' in status, false);
  assert.equal((await post(restoredBase, '/api/future-letter/open', {}, a)).status, 423);

  // Expired sessions must reauthenticate; the original seal timestamp must survive restore.
  clock += week - 1;
  const login = await post(restoredBase, '/api/login', {
    email: 'encrypted-a@example.invalid', password
  });
  assert.equal(login.status, 200);
  const fresh = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(restoredBase, '/api/future-letter/open', {}, fresh)).status, 423);
  assert.equal((await post(restoredBase, '/api/future-letter/seal', { text: '書き直し' }, fresh)).status, 409);
  clock += 1;
  const opened = await post(restoredBase, '/api/future-letter/open', {}, fresh);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).text, secret);
  assert.equal('text' in await get(restoredBase, '/api/future-letter/status', fresh), false);
  await assert.rejects(restoreEncryptedBackup(encrypted, recovered, passphrase), { code: 'EEXIST' });
});
