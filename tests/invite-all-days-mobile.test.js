'use strict';
// Regression coverage of the actual invite-only student gateway on mobile-sized browsers.
// Browser emulation is NOT a physical iPhone Safari test. No real student data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}

test('招待制アプリで21日×5ステップを320pxで表示し、花・ミニ解説・入力欄を確認', {
  skip: !engine && 'Playwrightが必要です'
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-mobile-21days-'));
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
  page.on('pageerror', e => errors.push(e.message));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const email = 'all-days-mobile@example.invalid';

  await page.goto(base);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('a-long-test-passphrase');
  await page.locator('#invite').fill(gateway.createInvite(email));
  await page.locator('#submit').click();
  await page.locator('#agree').waitFor();
  await page.locator('#agree').check();
  await page.locator('#start').click();
  await page.locator('.day-list').waitFor();

  const names = new Set();
  const controls = {
    1: '#mood-am', 2: '#t-sec', 3: '#ans-0', 4: '#act', 5: '#refl'
  };
  for (let day = 1; day <= 21; day++) {
    for (let step = 1; step <= 5; step++) {
      await page.goto(base + '/#/day/' + day + '/' + step);
      await page.waitForFunction(({ day, step }) => {
        const heading = document.querySelector('.day-head .eyebrow');
        const stepName = document.querySelector('.step-name');
        return heading?.textContent.trim() === 'Day ' + String(day).padStart(2, '0') + ' / 21'
          && stepName?.textContent.trim().startsWith(step + '. ');
      }, { day, step });
      assert.equal(await page.locator(controls[step]).count(), 1,
        'Day ' + day + ' step ' + step + ': missing required control');
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
        flower: document.querySelector('.head-flower svg.flower')?.getBoundingClientRect().width || 0
      }));
      assert.ok(layout.width <= layout.viewport + 1,
        'Day ' + day + ' step ' + step + ': horizontal overflow at 320px');
      assert.ok(layout.flower >= 40, 'Day ' + day + ' step ' + step + ': flower not visible');

      if (step === 3) {
        const name = (await page.locator('.head-flower .flower-name').innerText()).trim();
        assert.ok(name, 'Day ' + day + ': flower name missing');
        assert.equal(names.has(name), false, 'Day ' + day + ': duplicate flower');
        names.add(name);
        const guide = page.locator('.mini-guide');
        assert.equal(await guide.count(), 1, 'Day ' + day + ': mini-guide missing');
        assert.equal(await guide.evaluate(el => el.open && el.getBoundingClientRect().height > 20), true,
          'Day ' + day + ': mini-guide not visibly expanded');
        assert.ok((await guide.innerText()).trim().length > 20,
          'Day ' + day + ': mini-guide is empty');
        assert.ok(await page.locator('#ans-0').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16),
          'Day ' + day + ': iOS input zoom risk (<16px)');
      }
    }
  }
  assert.equal(names.size, 21, '21 unique flowers required');

  // Check the narrow-to-standard iPhone layout transition on key letter days.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const day of [1, 7, 14, 21]) {
    for (const step of [1, 3, 5]) {
      await page.goto(base + '/#/day/' + day + '/' + step);
      await page.waitForFunction(({ day, step }) =>
        document.querySelector('.day-head .eyebrow')?.textContent.trim() ===
          'Day ' + String(day).padStart(2, '0') + ' / 21' &&
        document.querySelector('.step-name')?.textContent.trim().startsWith(step + '. '),
        { day, step });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true, 'Day ' + day + ' step ' + step + ': horizontal overflow at 375px');
    }
  }
  assert.deepEqual(errors, [], 'Unexpected browser JavaScript errors');
});
