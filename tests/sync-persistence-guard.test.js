'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const values = new Map();
  let fail = false;
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error('quota'); values.set(key, value); },
    removeItem: key => values.delete(key)
  };
  const context = { window: { localStorage }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), context);
  const store = new context.window.MichiruStore.Store();
  return { store, fail: value => { fail = value; } };
}

test('failed remote reconciliation returns false, rolls back local state and never queues an upload', () => {
  const { store, fail } = setup();
  store.updateEntry(1, { reflection: 'local entry' });
  assert.equal(store.flush(), true);
  fail(true);
  const result = store.mergeRemote({
    2: { day_number: 2, reflection: 'remote entry', updated_at: '2026-11-01T01:00:00.000Z' }
  });
  assert.equal(result, false);
  assert.equal(store.hasEntry(2), false);
  assert.equal(store.entry(1).reflection, 'local entry');
  assert.equal(Object.keys(store.pendingRemote).length, 0);
  assert.equal(store.remote, null);
  store.detach(true);
});

test('successful reconciliation returns true and preserves remote day', () => {
  const { store } = setup();
  const result = store.mergeRemote({
    2: { day_number: 2, reflection: 'remote entry', updated_at: '2026-11-01T01:00:00.000Z' }
  });
  assert.equal(result, true);
  assert.equal(store.entry(2).reflection, 'remote entry');
  store.detach(true);
});

test('failed sealed-letter metadata save preserves the local draft in memory', () => {
  const { store, fail } = setup();
  store.setFutureLetter('my important draft');
  assert.equal(store.flush(), true);
  fail(true);
  assert.equal(store.setServerLetter({ sealed: true, sealedAt: '2026-11-01T01:00:00.000Z' }), false);
  assert.equal(store.state.futureLetter.text, 'my important draft');
  assert.equal(store.state.futureLetter.server_managed, undefined);
  store.detach(true);
});
