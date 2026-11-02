'use strict';
// Invite-only student journey in iPhone-sized browser emulation.
// This is NOT a physical iPhone Safari check and uses fictional accounts only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let browserType;
try { browserType = require('playwright')[BROWSER]; } catch (_) {}

test('招待された受講生だけがスマホ画面で登録し、21日教材を開ける', {
  skip: !browserType && 'Playwrightがないためブラウザ確認できません'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-invite-journey-'));
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
  const browser = await browserType.launch();
  t.after(() => browser.close());
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const email = 'mobile-student@example.invalid';
  const invite = gateway.createInvite(email);

  const guest = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  t.after(() => guest.close());
  const guestPage = await guest.newPage();
  await guestPage.goto(base + '/');
  assert.equal(await guestPage.locator('#login-form').count(), 1, '未招待者にはログイン画面だけを表示');
  assert.equal((await guestPage.request.get(base + '/api/bootstrap')).status(), 401, '教材APIは未認証で拒否');

  const student = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  t.after(() => student.close());
  const page = await student.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('a-long-test-passphrase');
  await page.locator('#invite').fill(invite);
  await page.locator('#submit').click();
  await page.locator('#agree').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#login-form').count(), 0, '登録後に受講生画面へ移動');
  const response = await page.request.get(base + '/api/bootstrap');
  assert.equal(response.status(), 200, '登録した本人だけが教材APIを利用できる');
  assert.equal((await response.json()).content.days.length, 21, '21日分の教材を配信');

  await page.locator('#agree').check();
  await page.locator('#start').click();
  await page.locator('.daily-door').waitFor();
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth
  }));
  assert.ok(layout.width <= layout.viewport + 1, '受講生トップは375pxで横にはみ出さない');
  assert.deepEqual(errors, [], '受講生画面でスクリプト例外がない');

  // 画面から入力した日本語・絵文字が端末だけでなくサーバーへ届くことを検査する。
  // 400msの送信待ちがあるため、固定sleepではなく保存済みAPIの値を待つ。
  const reflection = '受講生の日本語記録 🌼 改行も保存';
  await page.goto(base + '/#/day/1/5');
  await page.locator('#refl').fill(reflection);
  await page.waitForFunction(async expected => {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    if (!response.ok) return false;
    const data = await response.json();
    return data.entries && data.entries[1] && data.entries[1].reflection === expected;
  }, reflection, { timeout: 15000 });
  await page.reload();
  await page.goto(base + '/#/day/1/5');
  assert.equal(await page.locator('#refl').inputValue(), reflection, '再読み込み後も記録を表示');

  // 新しいブラウザ（別端末相当）で同じ受講生が再ログインしても復元できる。
  const secondDevice = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  t.after(() => secondDevice.close());
  const secondPage = await secondDevice.newPage();
  await secondPage.goto(base + '/');
  await secondPage.locator('#email').fill(email);
  await secondPage.locator('#password').fill('a-long-test-passphrase');
  await secondPage.locator('#submit').click();
  await secondPage.locator('#agree').waitFor({ timeout: 15000 });
  await secondPage.locator('#agree').check();
  await secondPage.locator('#start').click();
  await secondPage.locator('.daily-door').waitFor();
  // 同意直後の初回同期と画面描画が競合しないよう、再読み込みでサーバーの状態を取得する。
  await secondPage.reload();
  await secondPage.goto(base + '/#/day/1/5');
  await secondPage.waitForFunction(expected => {
    const field = document.querySelector('#refl');
    return field && field.value === expected;
  }, reflection, { timeout: 15000 });
  assert.equal(await secondPage.locator('#refl').inputValue(), reflection, '別端末で同一アカウントの記録を復元');
  assert.equal((await guestPage.request.get(base + '/api/bootstrap')).status(), 401, '未認証者へ記録を漏らさない');
});
