'use strict';
// Regression: server-controlled deletion generations must survive restart and
// remain scoped to one invited account. Synthetic students only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const entry = (day, reflection) => ({
  day_number: day, mood_am: null, mood_pm: null, answers: [],
  action_text: '', action_status: null, reflection,
  updated_at: '2026-11-03T00:00:00.000Z', completed_at: null
});

test('deleted records stay deleted after restart; generations are isolated per account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-generation-restart-'));
  const databasePath = path.join(dir, 'student.sqlite');
  let server = null;
  let base = null;
  async function start() {
    const gateway = createGateway({ databasePath, origin: 'http://127.0.0.1:0', development: true });
    server = gateway.server;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    return gateway;
  }
  async function stop() {
    if (!server) return;
    const closing = server;
    server = null;
    await new Promise((resolve, reject) => closing.close(error => error ? reject(error) : resolve()));
  }
  async function post(route, payload, cookie = '') {
    return fetch(base + route, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(payload)
    });
  }
  async function boot(cookie) {
    const response = await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function enroll(gateway, email) {
    const invite = gateway.createInvite(email);
    const response = await post('/api/enroll', { email, password: 'synthetic-test-password-123', invite });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    const gateway = await start();
    const cookieA = await enroll(gateway, 'restart-a@example.invalid');
    const cookieB = await enroll(gateway, 'restart-b@example.invalid');
    const initialA = await boot(cookieA);
    const initialB = await boot(cookieB);
    assert.equal(initialA.generation, 0);
    assert.equal(initialB.generation, 0);

    assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'A private entry'), generation: 0 }, cookieA)).status, 200);
    assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'B independent entry'), generation: 0 }, cookieB)).status, 200);
    const removed = await post('/api/entries/delete-all', { generation: 0 }, cookieA);
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).generation, 1);
    await stop();

    await start();
    const afterA = await boot(cookieA);
    const afterB = await boot(cookieB);
    assert.equal(afterA.generation, 1);
    assert.deepEqual(afterA.entries, {});
    assert.equal(afterB.generation, 0);
    assert.equal(afterB.entries[1].reflection, 'B independent entry');

    // Old devices and pre-upgrade clients cannot resurrect A's deleted data.
    assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'stale A'), generation: 0 }, cookieA)).status, 409);
    assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'legacy A') }, cookieA)).status, 409);
    assert.deepEqual((await boot(cookieA)).entries, {});

    // A fresh device may save new entries; B's old generation remains valid.
    assert.equal((await post('/api/entry', { day: 2, entry: entry(2, 'new A'), generation: 1 }, cookieA)).status, 200);
    assert.equal((await post('/api/entry', { day: 2, entry: entry(2, 'new B'), generation: 0 }, cookieB)).status, 200);
    assert.equal((await boot(cookieA)).entries[2].reflection, 'new A');
    assert.equal((await boot(cookieB)).entries[2].reflection, 'new B');
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
