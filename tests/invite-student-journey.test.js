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
  assert.equal((await guestPage.request.get(base + '/api/bootstrap')).status(), 401, '別の未認証ブラウザへ教材を漏らさない');
});
