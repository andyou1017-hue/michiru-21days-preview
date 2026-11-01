'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}
let browser, gateway, base, dir;
test.before(async () => {
  if (!engine) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-gateway-ui-'));
  gateway = createGateway({ databasePath: path.join(dir, 'private.sqlite'), origin: 'http://127.0.0.1:0', development: true });
  await new Promise(r => gateway.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + gateway.server.address().port;
  const executable = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  browser = await engine.launch(BROWSER === 'chromium' && fs.existsSync(executable) ? { executablePath: executable } : {});
});
test.after(async () => {
  if (browser) await browser.close();
  if (gateway) await new Promise(r => gateway.server.close(r));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
async function login(page, email, invite) {
  await page.goto(base);
  await page.fill('#email', email); await page.fill('#password', 'a-long-test-passphrase');
  if (invite) await page.fill('#invite', invite);
  await page.click('#submit');
  await page.waitForSelector('#agree, .day-list');
  if (await page.locator('#agree').count()) { await page.check('#agree'); await page.click('#start'); }
  await page.waitForSelector('.day-list');
}
const skip = !engine && 'Playwright is required';
test('招待ログイン後、Day1〜3の全ステップ・花・ミニ解説・保存・再開を確認（320pxタッチ）', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const email = 'days@example.invalid';
  await login(page, email, gateway.createInvite(email));
  for (let day = 1; day <= 3; day++) {
    for (let step = 1; step <= 5; step++) {
      await page.goto(base + `/#/day/${day}/${step}`);
      await page.waitForSelector('.day-head');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Day${day} step${step}`);
      assert.ok((await page.textContent('.head-flower .flower-name')).trim());
      if (step === 2) {
        const meditation = await page.textContent('.meditation');
        assert.match(meditation, /命の瞑想/);
        assert.match(meditation, /吸って、吐き/);
        assert.match(meditation, /脈を感じ/);
        assert.match(meditation, /あなたの中に、命が在る/);
        assert.equal(await page.textContent('#t-sec'), '33');
      }
      if (step === 3) {
        assert.ok((await page.textContent('.mini-guide')).length > 20);
        await page.fill('#ans-0', `Day${day}の記録 🌼`);
        await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'saved');
        await page.reload();
        assert.equal(await page.inputValue('#ans-0'), `Day${day}の記録 🌼`);
      }
    }
  }
  await page.goto(base + '/#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(backup.entries[1].answers[0], 'Day1の記録 🌼');
  assert.equal(backup.entries[3].answers[0], 'Day3の記録 🌼');
  await page.click('#logout'); await page.waitForSelector('#login-form');
  await login(page, email);
  await page.goto(base + '/#/day/1/3');
  assert.equal(await page.inputValue('#ans-0'), 'Day1の記録 🌼');
  assert.deepEqual(errors, []);
  await context.close();
});
test('同じ端末で別の招待アカウントへ切り替えても他人の記録を表示しない', { skip }, async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const first = 'first@example.invalid', second = 'second@example.invalid';
  await login(page, first, gateway.createInvite(first));
  await page.goto(base + '/#/day/1/3'); await page.fill('#ans-0', '最初の人だけの記録');
  await page.goto(base + '/#/settings'); await page.click('#logout'); await page.waitForSelector('#login-form');
  await login(page, second, gateway.createInvite(second));
  await page.goto(base + '/#/day/1/3'); assert.equal(await page.inputValue('#ans-0'), '');
  await context.close();
});
