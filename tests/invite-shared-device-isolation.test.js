'use strict';
// Shared iPhone-sized browser: switching invited accounts must never mix their
// visible reflections or server records. Fictional accounts and text only.
// WebKit emulation is not a physical iPhone Safari test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}

test('同じスマホで受講生を切り替えても記録を混ぜず、本人の再ログインで戻る', {
  skip: !engine && 'Playwrightが必要です'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-shared-device-'));
  const gateway = createGateway({
    databasePath: path.join(dir, 'private.sqlite'),
    origin: 'http://127.0.0.1:0',
    development: true
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const browser = await engine.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const password = 'a-long-test-passphrase';
  const first = 'shared-first@example.invalid';
  const second = 'shared-second@example.invalid';
  const aText = '受講生Aだけの振り返り 🌼';
  const bText = '受講生Bだけの振り返り 🌷';

  async function enter(email, invite) {
    await page.goto(base + '/');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    if (invite) await page.locator('#invite').fill(invite);
    await page.locator('#submit').click();
    const agree = page.locator('#agree');
    const door = page.locator('.daily-door');
    await Promise.race([agree.waitFor({ timeout: 15000 }), door.waitFor({ timeout: 15000 })]);
    if (await agree.count()) {
      await agree.check();
      await page.locator('#start').click();
    }
    await door.waitFor({ timeout: 15000 });
    await page.goto(base + '/#/day/1/5');
    await page.locator('#refl').waitFor();
  }
  async function saveReflection(value) {
    await page.locator('#refl').fill(value);
    await page.waitForFunction(async expected => {
      const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
      if (!response.ok) return false;
      const json = await response.json();
      return json.entries?.[1]?.reflection === expected;
    }, value, { timeout: 15000 });
  }
  async function logout() {
    await page.goto(base + '/#/settings');
    await page.locator('#logout').click();
    await page.locator('#login-form').waitFor({ timeout: 15000 });
    assert.equal((await page.request.get(base + '/api/bootstrap')).status(), 401,
      'ログアウト後は記録APIを拒否する');
  }

  await enter(first, gateway.createInvite(first));
  await saveReflection(aText);
  const a = await (await page.request.get(base + '/api/bootstrap')).json();
  await logout();

  await enter(second, gateway.createInvite(second));
  assert.equal(await page.locator('#refl').inputValue(), '',
    '別の受講生の画面にAの記録を表示しない');
  const b = await (await page.request.get(base + '/api/bootstrap')).json();
  assert.notEqual(a.account.id, b.account.id);
  assert.equal(JSON.stringify(b.entries).includes(aText), false,
    '別アカウントのサーバー応答にAの記録を混ぜない');
  await saveReflection(bText);
  await logout();

  await enter(first);
  await page.waitForFunction(expected =>
    document.querySelector('#refl')?.value === expected, aText, { timeout: 15000 });
  assert.equal(await page.locator('#refl').inputValue(), aText,
    '本人Aの記録は再ログイン後に復元');
  assert.equal((await page.locator('body').innerText()).includes(bText), false,
    'Aの画面にBの記録を表示しない');
  await logout();

  await enter(second);
  await page.waitForFunction(expected =>
    document.querySelector('#refl')?.value === expected, bText, { timeout: 15000 });
  assert.equal(await page.locator('#refl').inputValue(), bText,
    '本人Bの記録も再ログイン後に復元');
  assert.deepEqual(errors, [], 'アカウント切替時にJSエラーがない');
});
