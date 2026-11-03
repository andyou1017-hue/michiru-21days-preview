'use strict';
// iPhone-sized browser regression only. WebKit automation is not a physical iPhone Safari test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let browserType;
try { browserType = require('playwright')[BROWSER]; } catch (_) {}

test('招待制ログインは320px/375pxのタッチ画面で横はみ出し・入力時の自動拡大を防ぐ', {
  skip: !browserType && 'Playwrightがないためブラウザ確認できません'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-mobile-login-'));
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
  const executable = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  const browser = await browserType.launch(BROWSER === 'chromium' && fs.existsSync(executable) ? { executablePath: executable } : {});
  t.after(() => browser.close());
  const base = 'http://127.0.0.1:' + gateway.server.address().port;

  for (const width of [320, 375]) {
    const context = await browser.newContext({
      viewport: { width, height: 720 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForSelector('#login-form');
    const layout = await page.evaluate(() => {
      const ids = ['email', 'password', 'invite'];
      const fields = ids.map(id => {
        const element = document.getElementById(id);
        const rect = element.getBoundingClientRect();
        return { id, fontSize: parseFloat(getComputedStyle(element).fontSize), left: rect.left, right: rect.right, height: rect.height };
      });
      const submit = document.getElementById('submit').getBoundingClientRect();
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, fields,
        submit: { left: submit.left, right: submit.right, height: submit.height } };
    });
    assert.ok(layout.documentWidth <= layout.viewport + 1, width + 'px: 横スクロールが発生しない');
    for (const field of layout.fields) {
      assert.ok(field.fontSize >= 16, width + 'px: ' + field.id + 'はiOS自動ズームを避ける16px以上');
      assert.ok(field.left >= -1 && field.right <= layout.viewport + 1, width + 'px: ' + field.id + 'が画面内');
      assert.ok(field.height >= 44, width + 'px: ' + field.id + 'は44px以上のタップ領域');
    }
    assert.ok(layout.submit.left >= -1 && layout.submit.right <= layout.viewport + 1, width + 'px: ボタンが画面内');
    assert.ok(layout.submit.height >= 44, width + 'px: ボタンのタップ領域');
    await page.locator('#password').focus();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'password');
    assert.deepEqual(errors, [], width + 'px: スクリプト例外なし');
    await context.close();
  }
});
