'use strict';
// 受講生が「花がない」「ミニ解説がない」と感じた問題の回帰検査。
// 単なる花データの存在ではなく、実際の320pxブラウザ画面の描画を確認する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer } = require('../tools/static-server');
const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) { engine = null; }
const skip = engine ? false : 'Playwrightがないためブラウザ描画を確認できません';

test('招待前の静的プレビューで21日すべての花・ミニ解説を実際に描画する（320px）', { skip }, async t => {
  const server = createStaticServer(path.join(__dirname, '..', 'app'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executable = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  const browser = await engine.launch(BROWSER === 'chromium' && fs.existsSync(executable) ? { executablePath: executable } : {});
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  await page.waitForSelector('.intro-flower svg.flower');
  assert.ok(await page.locator('.intro-flower svg.flower').evaluate(el => el.getBoundingClientRect().width >= 100));
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.day-list');
  assert.equal(await page.locator('.day-card .flower').count(), 21);
  assert.equal(await page.locator('.daily-door .flower').count(), 1);
  const names = new Set();
  for (let day = 1; day <= 21; day++) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/#/day/' + day + '/3');
    await page.waitForSelector('.day-head .head-flower svg.flower');
    await page.waitForFunction(day => document.querySelector('.day-head .eyebrow')?.textContent === 'Day ' + String(day).padStart(2, '0') + ' / 21', day);
    const drawn = await page.evaluate(() => {
      const svg = document.querySelector('.head-flower svg.flower');
      const label = document.querySelector('.head-flower .flower-name');
      const guide = document.querySelector('.mini-guide');
      const rect = svg.getBoundingClientRect();
      const style = getComputedStyle(svg);
      const gRect = guide && guide.getBoundingClientRect();
      return {
        name: label && label.textContent.trim(),
        svgMarkup: svg.querySelectorAll('path, circle, ellipse').length,
        visible: rect.width >= 40 && rect.height >= 40 && style.display !== 'none' && style.visibility !== 'hidden',
        guideVisible: !!guide && guide.open && gRect.height > 20 && guide.textContent.trim().length > 20,
        overflow: document.documentElement.scrollWidth > innerWidth + 1
      };
    });
    assert.ok(drawn.name, 'Day ' + day + ' の花名がない');
    assert.ok(!names.has(drawn.name), 'Day ' + day + ' の花が重複');
    names.add(drawn.name);
    assert.ok(drawn.visible && drawn.svgMarkup > 0, 'Day ' + day + ' の花が実際に描画されない');
    assert.ok(drawn.guideVisible, 'Day ' + day + ' のミニ解説が表示されない');
    assert.equal(drawn.overflow, false, 'Day ' + day + ' で横スクロールが発生');
    if (process.env.MICHIRU_SCREENSHOTS) {
      fs.mkdirSync(process.env.MICHIRU_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.MICHIRU_SCREENSHOTS, 'day-' + String(day).padStart(2, '0') + '.png'), fullPage: true, animations: 'disabled' });
    }
  }
  assert.equal(names.size, 21);
  assert.deepEqual(errors, []);
  await page.close();
});
