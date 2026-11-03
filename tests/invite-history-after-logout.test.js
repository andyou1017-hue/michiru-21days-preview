'use strict';
// Regression: after an account logs out in another tab, Safari-like history
// navigation must not redisplay the previous student's private reflection.
// Browser emulation is not a physical iPhone Safari verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}

test('別タブでログアウトした後に戻る操作をしても前の受講生の記録を表示しない', {
  skip: !engine && 'Playwrightが必要です'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-history-privacy-'));
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
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const email = 'history-private@example.invalid';
  const privateText = '履歴から見えてはいけない記録 🌼';
  const page = await context.newPage();

  await page.goto(base + '/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('a-long-test-passphrase');
  await page.locator('#invite').fill(gateway.createInvite(email));
  await page.locator('#submit').click();
  await page.locator('#agree').waitFor({ timeout: 15000 });
  await page.locator('#agree').check();
  await page.locator('#start').click();
  await page.locator('.daily-door').waitFor();
  await page.goto(base + '/#/day/1/5');
  await page.locator('#refl').fill(privateText);
  await page.waitForFunction(async expected => {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    if (!response.ok) return false;
    const data = await response.json();
    return data.entries?.[1]?.reflection === expected;
  }, privateText, { timeout: 15000 });
  assert.equal(await page.locator('#refl').inputValue(), privateText);

  // Leave the private document in the history stack, then log out in a second tab.
  await page.goto(base + '/offline.html');
  const logoutTab = await context.newPage();
  await logoutTab.goto(base + '/#/settings');
  await logoutTab.locator('#logout').click();
  await logoutTab.locator('#login-form').waitFor({ timeout: 15000 });
  assert.equal((await logoutTab.request.get(base + '/api/bootstrap')).status(), 401,
    'ログアウトしたセッションはAPIから拒否される');

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.locator('#login-form').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#refl').count(), 0, '記録の入力欄を再表示しない');
  assert.equal((await page.locator('body').innerText()).includes(privateText), false,
    'ログアウト後の戻る操作で以前の記録を表示しない');
  assert.equal((await page.request.get(base + '/api/bootstrap')).status(), 401,
    '戻る操作でもセッションを復活させない');
});
