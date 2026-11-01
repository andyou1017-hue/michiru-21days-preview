'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../runtime/api.js'), 'utf8');
function client(response) {
  const requests = [];
  const ctx = { window: {}, location: { reload() {} }, fetch: async (url, opts) => {
    requests.push({ url, opts });
    return response || { ok: true, status: 200, json: async () => ({ ok: true }) };
  } };
  vm.runInNewContext(script, ctx);
  return { api: ctx.window.MichiruApi, requests };
}
test('日々の記録の保存・削除・全削除は同一オリジンの認証付きAPIへ送信', async () => {
  const { api, requests } = client();
  const remote = api.remote();
  const entry = { day_number: 1, reflection: 'ありがとう' };
  await remote.pushEntry(1, entry);
  await remote.deleteEntry(1);
  await remote.deleteAll();
  assert.deepEqual(requests.map(r => r.url), ['/api/entry', '/api/entry/delete', '/api/entries/delete-all']);
  for (const r of requests) {
    assert.equal(r.opts.method, 'POST');
    assert.equal(r.opts.credentials, 'same-origin');
    assert.equal(r.opts.headers['Content-Type'], 'application/json');
  }
  assert.equal(JSON.parse(requests[0].opts.body).entry.reflection, 'ありがとう');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].opts.body)).sort(), ['day', 'entry']);
});
test('サーバーエラーを保存成功として扱わない', async () => {
  const { api } = client({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(api.remote().pushEntry(1, { day_number: 1 }), /保存できません/);
});
test('招待制のサーバー画面はローカル専用と誤表示しない', () => {
  const gateway = fs.readFileSync(path.join(__dirname, '../runtime/gateway.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app/js/app.js'), 'utf8');
  assert.ok(gateway.includes('MICHIRU_CONFIG={server:true,localOnly:false}'));
  assert.match(app, /サーバーにも保存されます/);
  assert.match(app, /この端末に保存されます/);
});
