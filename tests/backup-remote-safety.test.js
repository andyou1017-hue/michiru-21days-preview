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
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error('quota'); values.set(key, value); },
    removeItem: key => values.delete(key)
  };
  const context = { window: { localStorage: storage }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8'), context);
  return {
    store: new context.window.MichiruStore.Store({ remote }),
    fail: value => { fail = value; },
    values
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function entry(day, reflection, updated_at) {
  return { day_number: day, reflection, updated_at };
}
function backup(entries, consentedAt = null) {
  return { app: 'michiru-21days', schema: 1, consentedAt, entries };
}

test('古いバックアップ復元はサーバーの新しい記録を削除・上書きせず、照合後だけ追加を送る', async () => {
  const sent = [];
  const server = {
    1: entry(1, 'サーバーの新しいDay1', '2026-11-01T12:00:00.000Z'),
    2: entry(2, 'サーバーだけのDay2', '2026-11-01T12:00:00.000Z')
  };
  const remote = {
    pushEntry: async (day, data) => { sent.push({ op: 'push', day }); server[day] = data; },
    deleteEntry: async day => { sent.push({ op: 'delete', day }); delete server[day]; }
  };
  const { store } = setup(remote);
  store.state.consentedAt = '2026-11-01T11:00:00.000Z';
  store.mergeRemote(server);
  const older = backup({
    1: entry(1, 'バックアップの古いDay1', '2026-10-01T12:00:00.000Z'),
    3: entry(3, 'バックアップだけのDay3', '2026-10-31T12:00:00.000Z')
  });
  assert.equal(store.importBackup(older), true);
  assert.equal(store.remote, null, '復元直後は送信を停止');
  assert.equal(store.state.consentedAt, '2026-11-01T11:00:00.000Z', '現アカウントの同意を維持');
  await tick();
  assert.deepEqual(sent, [], 'サーバー再取得前は送信しない');
  store.mergeRemote(server);
  assert.equal(store.entry(1).reflection, 'サーバーの新しいDay1');
  assert.equal(store.entry(2).reflection, 'サーバーだけのDay2');
  assert.equal(store.entry(3).reflection, 'バックアップだけのDay3');
  store.remote = remote;
  store.pushRemote();
  await tick(); await tick(); await tick();
  assert.deepEqual(sent, [{ op: 'push', day: 3 }]);
  assert.equal(server[1].reflection, 'サーバーの新しいDay1');
  assert.equal(server[2].reflection, 'サーバーだけのDay2');
  store.detach(true);
});

test('別のバックアップの同意日時を新しいアカウントへ引き継がない', () => {
  const { store } = setup();
  assert.equal(store.importBackup(backup({ 1: entry(1, '記録', '2026-10-01T12:00:00.000Z') }, '2026-10-01T10:00:00.000Z')), true);
  assert.equal(store.state.consentedAt, null);
  store.detach(true);
});

test('送信中の復元は拒否して現在の記録と同期を守る', async () => {
  let resolve;
  const remote = { pushEntry: () => new Promise(r => { resolve = r; }) };
  const { store } = setup(remote);
  store.updateEntry(1, { reflection: '送信中の記録' });
  store.flush();
  await tick();
  assert.equal(store.importBackup(backup({})), false);
  assert.equal(store.entry(1).reflection, '送信中の記録');
  assert.equal(store.remote, remote);
  resolve(); await tick();
  store.detach(true);
});

test('端末保存失敗時は復元前の状態とリモート接続を復旧する', () => {
  const remote = { pushEntry: async () => {} };
  const { store, fail } = setup(remote);
  store.state.consentedAt = '2026-11-01T11:00:00.000Z';
  fail(true);
  assert.equal(store.importBackup(backup({})), false);
  assert.equal(store.remote, remote);
  assert.equal(store.state.consentedAt, '2026-11-01T11:00:00.000Z');
  store.detach(true);
});


test('サーバー照合の端末保存に失敗したら同期を再開せず、復元済みの端末記録を守る', async () => {
  const sent = [];
  const remote = { pushEntry: async day => { sent.push(day); } };
  const { store, fail } = setup();
  assert.equal(store.importBackup(backup({ 3: entry(3, '復元したDay3', '2026-10-31T12:00:00.000Z') })), true);
  fail(true);
  assert.equal(store.mergeRemote({ 1: entry(1, 'サーバーのDay1', '2026-11-01T12:00:00.000Z') }), false);
  assert.equal(store.status, 'error');
  assert.equal(store.remote, null, '保存失敗後に同期を再開しない');
  assert.deepEqual(sent, [], '端末保存できない内容を送信しない');
  fail(false);
  assert.equal(store.mergeRemote({ 1: entry(1, 'サーバーのDay1', '2026-11-01T12:00:00.000Z') }), true);
  store.remote = remote;
  store.pushRemote();
  await tick(); await tick();
  assert.deepEqual(sent, [3], '照合と保存の成功後だけ復元したDay3を送信');
  store.detach(true);
});
