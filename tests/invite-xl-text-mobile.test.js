'use strict';
// Check the student-selected XL text size on narrow touch screens.
// Playwright WebKit emulation is NOT a physical iPhone Safari test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}

test('招待制の320px画面で特大文字を選んでも教材・手紙の日に横はみ出ししない', {
  skip: !engine && 'Playwrightが必要です'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-xl-mobile-'));
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
    viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const email = 'large-text@example.invalid';

  await page.goto(base + '/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('a-long-test-passphrase');
  await page.locator('#invite').fill(gateway.createInvite(email));
  await page.locator('#submit').click();
  await page.locator('#agree').waitFor();
  await page.locator('#agree').check();
  await page.locator('#start').click();
  await page.locator('.daily-door').waitFor();

  await page.goto(base + '/#/settings');
  await page.locator('[data-fs="xl"]').click();
  assert.equal(await page.locator('[data-fs="xl"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '22px');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-font')), 'xl',
    '特大文字の設定は再読み込み後も維持');

  for (const day of [1, 7, 14, 21]) {
    for (const step of [1, 3, 5]) {
      await page.goto(base + '/#/day/' + day + '/' + step);
      await page.waitForFunction(({ day, step }) => {
        const heading = document.querySelector('.day-head .eyebrow');
        const name = document.querySelector('.step-name');
        return heading?.textContent.trim() === 'Day ' + String(day).padStart(2, '0') + ' / 21'
          && name?.textContent.trim().startsWith(step + '. ');
      }, { day, step });
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        font: getComputedStyle(document.documentElement).fontSize,
        navHeights: [...document.querySelectorAll('.app-nav a')].map(x => x.getBoundingClientRect().height)
      }));
      assert.equal(layout.font, '22px', '特大文字が各画面に反映される');
      assert.ok(layout.width <= layout.viewport + 1,
        'Day ' + day + ' step ' + step + ': 320pxで横にはみ出さない');
      assert.equal(layout.navHeights.length, 4);
      assert.ok(layout.navHeights.every(h => h >= 44),
        'Day ' + day + ' step ' + step + ': ナビゲーションのタッチ領域が44px以上');
    }
  }
  assert.deepEqual(errors, [], '特大文字での画面操作中にJSエラーがない');
});
