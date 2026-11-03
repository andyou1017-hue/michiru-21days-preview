'use strict';
// Regression: deletion on one device must not be undone by another device's stale upload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createGateway } = require('../runtime/gateway');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-stale-delete-'));
  const gateway = createGateway({ databasePath: path.join(dir, 'private.sqlite'), origin: 'http://127.0.0.1:0', development: true });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  t.after(async () => { await new Promise(resolve => gateway.server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  async function post(route, payload, cookie) {
    return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify(payload) });
  }
  const email = 'stale@example.invalid';
  const invite = gateway.createInvite(email);
  const enrolled = await post('/api/enroll', { email, password: 'safe-test-password-123', invite }, '');
  assert.equal(enrolled.status, 200);
  const cookie = enrolled.headers.get('set-cookie').split(';')[0];
  const boot = async () => (await (await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).json());
  return { post: (route, payload) => post(route, payload, cookie), boot };
}
const entry = (day, text) => ({ day_number: day, mood_am: null, mood_pm: null, answers: [], action_text: '', action_status: null, reflection: text, updated_at: '2026-11-01T01:00:00.000Z', completed_at: null });

test('delete-all invalidates stale device writes, including old clients without a generation', async t => {
  const { post, boot } = await fixture(t);
  const old = await boot();
  assert.equal(old.generation, 0);
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'old'), generation: old.generation })).status, 200);
  const deleted = await post('/api/entries/delete-all', { generation: old.generation });
  assert.equal(deleted.status, 200);
  const after = await deleted.json();
  assert.equal(after.generation, 1);
  assert.deepEqual((await boot()).entries, {});
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'resurrect'), generation: old.generation })).status, 409);
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'legacy') })).status, 409);
  assert.deepEqual((await boot()).entries, {});
  assert.equal((await post('/api/entry', { day: 1, entry: entry(1, 'new'), generation: after.generation })).status, 200);
  assert.equal((await boot()).entries[1].reflection, 'new');
});

test('deleting one day prevents a stale second device from resurrecting that day', async t => {
  const { post, boot } = await fixture(t);
  const before = await boot();
  assert.equal((await post('/api/entry', { day: 2, entry: entry(2, 'old'), generation: before.generation })).status, 200);
  const removed = await post('/api/entry/delete', { day: 2, generation: before.generation });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).generation, 1);
  assert.equal((await post('/api/entry', { day: 2, entry: entry(2, 'stale'), generation: before.generation })).status, 409);
  assert.deepEqual((await boot()).entries, {});
});

test('stale local entries block reconciliation without discarding the original text', () => {
  const values = new Map();
  const localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const ctx = { window: { localStorage }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), ctx);
  const store = new ctx.window.MichiruStore.Store();
  store.updateEntry(1, { reflection: 'keep for backup' });
  assert.equal(store.flush(), true);
  assert.equal(store.mergeRemote({}, 1), false);
  assert.equal(store.entry(1).reflection, 'keep for backup');
  assert.equal(store.status, 'conflict');
  assert.equal(Object.keys(store.pendingRemote).length, 0);
  store.detach(true);
});

test('fresh local device accepts server generation and can synchronize safely', () => {
  const values = new Map();
  const localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const ctx = { window: { localStorage }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), ctx);
  const store = new ctx.window.MichiruStore.Store();
  assert.equal(store.mergeRemote({}, 2), true);
  assert.equal(store.state.syncGeneration, 2);
  store.detach(true);
});

test('client API updates its generation after deletion before sending another entry', async () => {
  const requests = [];
  const ctx = { window: {}, location: { reload() {} }, fetch: async (url, opts) => {
    requests.push({ url, payload: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => url.endsWith('/delete') ? { ok: true, generation: 4 } : { ok: true } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runtime/api.js'), 'utf8'), ctx);
  const remote = ctx.window.MichiruApi.remote(3);
  await remote.deleteEntry(1);
  await remote.pushEntry(2, entry(2, 'new'));
  assert.equal(requests[0].payload.generation, 3);
  assert.equal(requests[1].payload.generation, 4);
  assert.equal(remote.getGeneration(), 4);
});
