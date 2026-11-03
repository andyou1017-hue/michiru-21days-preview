'use strict';
// Offsite-copy recovery drill using synthetic student data only.
// This does not verify an actual remote mount or touch a production database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const { runBackupAndCopy } = require('../runtime/backup-offsite-run');
const { restoreEncryptedBackup } = require('../runtime/encrypted-backup');

const passphrase = 'synthetic-offsite-recovery-secret-2026';
const password = 'synthetic-student-password-123';
const WEEK = 7 * 86400000;

async function start(gateway) {
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + gateway.server.address().port;
}
function post(base, route, payload, cookie = '') {
  return fetch(base + route, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
function get(base, route, cookie) {
  return fetch(base + route, { headers: { Cookie: cookie } });
}

test('外部コピーから復元後も記録の分離・7日間ロックを維持し、ローカル破損に依存しない', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-offsite-recovery-'));
  const backupDirectory = path.join(root, 'local');
  const offsiteDirectory = path.join(root, 'offsite');
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  fs.mkdirSync(offsiteDirectory, { mode: 0o700 });
  const databasePath = path.join(root, 'live.sqlite');
  const restoredPath = path.join(root, 'restored.sqlite');
  let clock = Date.parse('2026-11-02T12:00:00.000Z');
  const original = createGateway({
    databasePath, origin: 'http://127.0.0.1:0',
    development: true, now: () => clock
  });
  let restored = null;
  t.after(async () => {
    if (restored) await new Promise(resolve => restored.server.close(resolve));
    await new Promise(resolve => original.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = await start(original);
  async function enroll(email) {
    const invite = original.createInvite(email);
    const response = await post(base, '/api/enroll', { email, password, invite });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const a = await enroll('offsite-a@example.invalid');
  const b = await enroll('offsite-b@example.invalid');
  const note = '架空の日本語記録🌼';
  const letter = '架空の未来からの手紙🌻';
  const entry = {
    day_number: 1, mood_am: 5, mood_pm: 8, answers: ['架空の美点'],
    action_text: '', action_status: null, reflection: note,
    updated_at: '2026-11-02T12:00:00.000Z', completed_at: null
  };
  assert.equal((await post(base, '/api/entry', { day: 1, entry }, a)).status, 200);
  assert.equal((await post(base, '/api/future-letter/seal', { text: letter }, a)).status, 200);

  const copied = await runBackupAndCopy({
    databasePath, backupDirectory, offsiteDirectory, passphrase,
    now: new Date(clock), suffix: 'fedcba987654'
  });
  assert.equal(path.dirname(copied.offsite), offsiteDirectory);
  assert.equal(fs.statSync(copied.offsite).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(copied.offsite).includes(Buffer.from(note)), false);
  assert.equal(fs.readFileSync(copied.offsite).includes(Buffer.from(letter)), false);

  // Simulate losing the local backup; recover only from the verified offsite copy.
  fs.writeFileSync(copied.local, 'broken local backup');
  await restoreEncryptedBackup(copied.offsite, restoredPath, passphrase);
  restored = createGateway({
    databasePath: restoredPath, origin: 'http://127.0.0.1:0',
    development: true, now: () => clock
  });
  const recoveredBase = await start(restored);
  const first = await (await get(recoveredBase, '/api/bootstrap', a)).json();
  const second = await (await get(recoveredBase, '/api/bootstrap', b)).json();
  assert.equal(first.entries[1].reflection, note);
  assert.deepEqual(Object.keys(second.entries), []);
  assert.equal(JSON.stringify(first).includes(letter), false);
  assert.equal((await post(recoveredBase, '/api/future-letter/open', {}, a)).status, 423);

  clock += WEEK - 1;
  const login = await post(recoveredBase, '/api/login', { email: 'offsite-a@example.invalid', password });
  assert.equal(login.status, 200);
  const fresh = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(recoveredBase, '/api/future-letter/open', {}, fresh)).status, 423);
  clock += 1;
  const opened = await post(recoveredBase, '/api/future-letter/open', {}, fresh);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).text, letter);
});
