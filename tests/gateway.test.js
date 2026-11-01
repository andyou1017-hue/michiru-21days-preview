'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createGateway } = require('../runtime/gateway');
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-gateway-'));
  let clock = Date.now();
  const gateway = createGateway({ databasePath: path.join(dir, 'private.sqlite'), origin: 'http://127.0.0.1:0', development: true, now: () => clock, ...options });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  t.after(async () => { await new Promise(r => gateway.server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  async function post(route, data, cookie = '', origin = base) {
    return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(data) });
  }
  async function enroll(email = 'student@example.invalid') {
    const invite = gateway.createInvite(email);
    const r = await post('/api/enroll', { email, password: 'a-long-test-passphrase', invite });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  return { gateway, base, post, enroll, databasePath: path.join(dir, 'private.sqlite'), advance: ms => { clock += ms; } };
}
test('受講生DBを公開リポジトリ内へ直接・リンク経由で作成できない', t => {
  const repoRoot = path.resolve(__dirname, '..');
  const direct = path.join(repoRoot, 'should-never-create-student-db.sqlite');
  const opts = { origin: 'http://127.0.0.1:0', development: true };
  assert.throws(() => createGateway({ ...opts, databasePath: direct }), /リポジトリ/);
  assert.equal(fs.existsSync(direct), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-private-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'repo-link');
  fs.symlinkSync(repoRoot, link, 'dir');
  assert.throws(() => createGateway({ ...opts, databasePath: path.join(link, 'should-never-create-student-db.sqlite') }), /リポジトリ/);
  assert.equal(fs.existsSync(direct), false);
});
test('未招待者は教材HTML・JS・JSON・bootstrapの直URLからも入れない', async t => {
  const { base } = await fixture(t);
  assert.match(await (await fetch(base)).text(), /招待を受け取った方だけ/);
  for (const route of ['/js/content.js', '/js/app.js', '/js/life-meditation.js', '/js/future-guidance.js', '/content/days.yellow.json', '/api/bootstrap', '/runtime/gateway.js', '/private.sqlite']) {
    assert.equal((await fetch(base + route)).status, 401, route);
  }
});
test('起動確認は個人情報を返さず、認証が必要なAPIは保護したままにする', async t => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal((await fetch(base + '/api/bootstrap')).status, 401);
});
test('稼働中DBを安全にバックアップし、別DBでログイン情報を復元できる', async t => {
  const { createBackup } = require('../runtime/backup');
  const { base, enroll, databasePath } = await fixture(t);
  const cookie = await enroll('backup@example.invalid');
  const original = await (await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).json();
  const target = path.join(path.dirname(databasePath), 'backup.sqlite');
  await createBackup(databasePath, target);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  const bytes = fs.readFileSync(target);
  await assert.rejects(createBackup(databasePath, target));
  assert.deepEqual(fs.readFileSync(target), bytes);
  const restored = createGateway({ databasePath: target, origin: 'http://127.0.0.1:0', development: true });
  await new Promise(r => restored.server.listen(0, '127.0.0.1', r));
  try {
    const response = await fetch('http://127.0.0.1:' + restored.server.address().port + '/api/bootstrap', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).account.id, original.account.id);
  } finally { await new Promise(r => restored.server.close(r)); }
  const missing = path.join(path.dirname(databasePath), 'missing.sqlite');
  await assert.rejects(createBackup(missing, path.join(path.dirname(databasePath), 'not-created.sqlite')));
  assert.equal(fs.existsSync(missing), false);
});
test('本番用起動はオーナー承認と接続設定がなければ拒否する', () => {
  const { productionOptions } = require('../runtime/production');
  assert.throws(() => productionOptions({}));
  assert.throws(() => productionOptions({ MICHIRU_RELEASE_APPROVED: 'yes' }));
  assert.deepEqual(productionOptions({ MICHIRU_RELEASE_APPROVED: 'yes', MICHIRU_ORIGIN: 'https://example.invalid', MICHIRU_DB: '/private/michiru.sqlite' }), { origin: 'https://example.invalid', databasePath: '/private/michiru.sqlite' });
});
test('招待は宛先・期限・一回利用を検証し、再ログインはパスワードで行う', async t => {
  const { gateway, base, post, advance } = await fixture(t);
  const email = 'student@example.invalid', password = 'a-long-test-passphrase';
  const invite = gateway.createInvite(email);
  assert.equal((await post('/api/enroll', { email: 'other@example.invalid', password, invite })).status, 401);
  const response = await post('/api/enroll', { email, password, invite });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const bootstrap = await (await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } })).json();
  assert.equal(bootstrap.content.days.length, 21);
  assert.equal(bootstrap.account.email, email);
  assert.equal((await post('/api/enroll', { email, password, invite })).status, 401);
  assert.equal((await post('/api/login', { email, password })).status, 200);
  const expired = gateway.createInvite('expired@example.invalid', 1); advance(2);
  assert.equal((await post('/api/enroll', { email: 'expired@example.invalid', password, invite: expired })).status, 401);
});
test('同時登録でも同じ招待を二回使えない', async t => {
  const { gateway, post } = await fixture(t);
  const data = { email: 'student@example.invalid', password: 'a-long-test-passphrase', invite: gateway.createInvite('student@example.invalid') };
  const result = await Promise.all([post('/api/enroll', data), post('/api/enroll', data)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 401]);
});
test('別利用者の情報を返さず、ログアウト・失効・期限でセッションを拒否する', async t => {
  const { gateway, base, post, enroll, advance } = await fixture(t);
  const first = await enroll('one@example.invalid'), second = await enroll('two@example.invalid');
  async function get(cookie) { return fetch(base + '/api/bootstrap', { headers: { Cookie: cookie } }); }
  const a = await (await get(first)).json(), b = await (await get(second)).json();
  assert.notEqual(a.account.id, b.account.id);
  assert.equal(JSON.stringify(a).includes('two@example.invalid'), false);
  assert.equal((await post('/api/logout', {}, first)).status, 200);
  assert.equal((await get(first)).status, 401);
  gateway.revoke('two@example.invalid');
  assert.equal((await get(second)).status, 401);
  const third = await enroll('three@example.invalid'); advance(86400001);
  assert.equal((await get(third)).status, 401);
});
test('外部Origin・認証失敗の連続試行・不正JSONを拒否する', async t => {
  const { base, post } = await fixture(t);
  const data = { email: 'student@example.invalid', password: 'a-long-test-passphrase' };
  assert.equal((await post('/api/login', data, '', 'https://attacker.invalid')).status, 403);
  const bad = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/login', data)).status, 401);
  assert.equal((await post('/api/login', data)).status, 429);
});
test('認証後にもソース・DB・生成教材へのアクセスを拒否する', async t => {
  const { base, enroll } = await fixture(t); const cookie = await enroll();
  for (const route of ['/private.sqlite', '/runtime/gateway.js', '/js/content.js']) assert.equal((await fetch(base + route, { headers: { Cookie: cookie } })).status, 404);
  const r = await fetch(base, { headers: { Cookie: cookie } });
  const html = await r.text();
  // 招待制のログイン後はサーバー保存モード。旧localOnly:trueの期待値は誤り。
  assert.match(html, /MICHIRU_CONFIG=\{server:true,localOnly:false\}/);
  assert.doesNotMatch(html, /src="js\/content.js"/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('本番設定はHTTPSが必須で、セッションCookieはSecureを付ける', async t => {
  assert.throws(() => createGateway({ databasePath: '/tmp/unused.sqlite', origin: 'http://example.invalid' }));
  const { base, gateway } = await fixture(t, { origin: 'https://michiru.example.invalid', development: false });
  const email = 'secure@example.invalid';
  // Node fetchはHostを接続先へ合わせるため、TLS終端後の転送をhttp.requestで再現する。
  const r = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/enroll', { method: 'POST', headers: { Host: 'michiru.example.invalid', Origin: 'https://michiru.example.invalid', 'Content-Type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => resolve(response));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ email, password: 'a-long-test-passphrase', invite: gateway.createInvite(email) }));
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['set-cookie'][0], /^__Host-michiru_session=/);
  assert.match(r.headers['set-cookie'][0], /; Secure/);
});
