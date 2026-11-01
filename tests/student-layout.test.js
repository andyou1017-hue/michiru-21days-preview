'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createStaticServer } = require('../tools/static-server');
const BROWSER = process.env.PW_BROWSER || 'chromium';
let browserType; try { browserType = require('playwright')[BROWSER]; } catch (_) {}

test('受講生の画面の並び：同意の直後はトップから表示し、ワークは「小さな理由→お話→書く時間→問い」の順', { skip: !browserType && 'Playwrightがないため実画面を確認できません' }, async t => {
  const server = createStaticServer(path.join(__dirname, '..', 'app'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await browserType.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: BROWSER !== 'firefox', hasTouch: true });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  await page.goto(url);
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.daily-door');
  assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 0, '今日の扉が見える位置から始まる');
  const doorBtn = await page.locator('#door-open').boundingBox();
  assert.ok(doorBtn.y + doorBtn.height <= 812, '扉のボタンが最初の画面に入る');
  for (const step of [3, 4, 5]) {
    await page.goto(url + '#/day/2/' + step);
    await page.waitForSelector('.writing-time');
    const order = await page.evaluate(() => {
      const pos = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + window.scrollY : null; };
      return { guide: pos('.mini-guide'), story: pos('.story'), timer: pos('.writing-time'), field: pos('.step-body textarea') };
    });
    if (step === 3) assert.ok(order.guide < order.story, '小さな理由がお話より先');
    if (order.story !== null) assert.ok(order.story < order.timer, 'step' + step + '：お話（実践）が書く時間より先');
    assert.ok(order.timer < order.field, 'step' + step + '：書く時間は書く欄のすぐ前');
  }
});
