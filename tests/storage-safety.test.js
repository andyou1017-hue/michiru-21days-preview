'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(remote) {
  const values = new Map();
  let fail = false;
  const storage = {
    getItem: k => values.get(k) || null,
    setItem(k, v) { if (fail) throw Error('quota'); values.set(k, v); },
    removeItem(k) { values.delete(k); }
  };
  const context = { window: { localStorage: storage }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), context);
  const store = new context.window.MichiruStore.Store({ remote });
  return { store, fail: v => { fail = v; }, values };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('保存失敗後に再試行すると、日別の送信も失われない', async () => {
  const sent = [];
  const { store, fail } = setup({ pushEntry: async (d, e) => sent.push(e.reflection) });
  store.updateEntry(1, { reflection: '記録' });
  fail(true);
  assert.equal(store.flush(), false);
  assert.equal(store.status, 'error');
  fail(false);
  assert.equal(store.flush(), true);
  await tick();
  assert.deepEqual(sent, ['記録']);
});
test('送信中の追加入力は、最初の送信完了後にも送る', async () => {
  const sent = [], resolve = [];
  const { store } = setup({ pushEntry: (d, e) => {
    sent.push(e.reflection);
    return new Promise(r => resolve.push(r));
  } });
  store.updateEntry(1, { reflection: '最初' }); store.flush();
  await tick();
  store.updateEntry(1, { reflection: '追記' }); store.flush();
  assert.deepEqual(sent, ['最初']);
  resolve.shift()(); await tick();
  assert.deepEqual(sent, ['最初', '追記']);
  resolve.shift()(); await tick();
  assert.equal(store.status, 'saved');
});
test('復元失敗では状態とメモリキャッシュを元の記録に保つ', () => {
  const { store, fail } = setup();
  store.updateEntry(1, { reflection: '元の記録' }); store.flush();
  const backup = store.exportBackup(); backup.entries[1].reflection = '復元候補';
  fail(true);
  assert.equal(store.importBackup(backup), false);
  assert.equal(store.entry(1).reflection, '元の記録');
  assert.equal(store.backend.read().entries[1].reflection, '元の記録');
});
test('日別削除失敗でもメモリキャッシュから記録が消えない', () => {
  const { store, fail } = setup();
  store.updateEntry(1, { reflection: '残す' }); store.flush(); fail(true);
  assert.equal(store.deleteDay(1), false);
  assert.equal(store.backend.read().entries[1].reflection, '残す');
});
test('全削除のサーバー拒否は未完了を返し、端末の記録を戻す', async () => {
  const { store } = setup({ deleteAll: async () => { throw Error('offline'); } });
  store.addDiscovery(1, '発見'); store.flush();
  assert.equal(await store.deleteAll(), false);
  assert.equal(store.state.discoveries[0].text, '発見');
  assert.equal(store.backend.read().discoveries[0].text, '発見');
  assert.equal(store.status, 'error');
});
test('同期アダプターの同期例外も保存失敗として扱う', async () => {
  const { store } = setup({ pushEntry() { throw Error('network'); } });
  store.updateEntry(1, { reflection: '端末には保存' }); store.flush();
  await tick();
  assert.equal(store.status, 'offline');
  store.detach();
});
test('ログアウト後、遅れて届いた送信成功で保存済みに戻さない', async () => {
  let resolve;
  const { store, values } = setup({ pushEntry: () => new Promise(r => { resolve = r; }) });
  store.updateEntry(1, { reflection: '個人記録' }); store.flush(); await tick();
  store.detach(); store.setStatus('memory'); resolve(); await tick();
  assert.equal(values.size, 0);
  assert.equal(store.status, 'memory');
});
test('全削除は進行中の送信を待ち、削除後に記録を復活させない', async () => {
  const calls = [];
  let resolve;
  const { store } = setup({
    pushEntry: () => new Promise(r => { resolve = () => { calls.push('push'); r(); }; }),
    deleteAll: async () => { calls.push('delete'); }
  });
  store.updateEntry(1, { reflection: '記録' }); store.flush(); await tick();
  const deletion = store.deleteAll(); await tick();
  assert.deepEqual(calls, []);
  resolve();
  assert.equal(await deletion, true);
  assert.deepEqual(calls, ['push', 'delete']);
});
