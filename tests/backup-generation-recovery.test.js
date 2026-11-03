'use strict';
// Regression: an online SQLite backup must retain deletion generations.
// Restoring an older-device session must never resurrect deleted student work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const { createBackup } = require('../runtime/backup');

async function listen(gateway) {
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + gateway.server.address().port;
}
async function close(gateway) {
  if (gateway) await new Promise((resolve, reject) =>
    gateway.server.close(error => error ? reject(error) : resolve()));
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
    email, invite, password: 'synthetic-test-password-123'
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function bootstrap(base, cookie) {
  const response = await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json();
}
function entry(day, reflection) {
  return {
    day_number: day, mood_am: null, mood_pm: null, answers: [],
    action_text: '', action_status: null, reflection,
    updated_at: '2026-11-03T00:00:00.000Z', completed_at: null
  };
}

test('live backup restores deletion generation and rejects stale devices without affecting other students', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-generation-'));
  const source = path.join(dir, 'live.sqlite');
  const destination = path.join(dir, 'restored.sqlite');
  let original = null;
  let restored = null;
  try {
    original = createGateway({ databasePath: source, origin: 'http://127.0.0.1:0', development: true });
    const base = await listen(original);
    const cookieA = await enroll(original, base, 'deleted@example.invalid');
    const cookieB = await enroll(original, base, 'retained@example.invalid');
    assert.equal((await post(base, '/api/entry', {
      day: 1, entry: entry(1, 'A old entry'), generation: 0
    }, cookieA)).status, 200);
    assert.equal((await post(base, '/api/entry', {
      day: 2, entry: entry(2, 'B retained entry'), generation: 0
    }, cookieB)).status, 200);
    const deleted = await post(base, '/api/entries/delete-all', { generation: 0 }, cookieA);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).generation, 1);

    // Snapshot while the original server and SQLite WAL are still active.
    await createBackup(source, destination);
    restored = createGateway({ databasePath: destination, origin: 'http://127.0.0.1:0', development: true });
    const recoveredBase = await listen(restored);
    const recoveredA = await bootstrap(recoveredBase, cookieA);
    const recoveredB = await bootstrap(recoveredBase, cookieB);
    assert.equal(recoveredA.generation, 1);
    assert.deepEqual(recoveredA.entries, {});
    assert.equal(recoveredB.generation, 0);
    assert.equal(recoveredB.entries[2].reflection, 'B retained entry');

    assert.equal((await post(recoveredBase, '/api/entry', {
      day: 1, entry: entry(1, 'A stale device'), generation: 0
    }, cookieA)).status, 409);
    assert.equal((await post(recoveredBase, '/api/entry', {
      day: 1, entry: entry(1, 'A legacy device')
    }, cookieA)).status, 409);
    assert.deepEqual((await bootstrap(recoveredBase, cookieA)).entries, {});
    assert.equal((await post(recoveredBase, '/api/entry', {
      day: 3, entry: entry(3, 'A new work'), generation: 1
    }, cookieA)).status, 200);
    assert.equal((await bootstrap(recoveredBase, cookieA)).entries[3].reflection, 'A new work');
    assert.equal((await bootstrap(recoveredBase, cookieB)).entries[2].reflection, 'B retained entry');
  } finally {
    await close(restored);
    await close(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
