'use strict';
// 初日と再訪時の「今日の扉」をブラウザで検証。教材原文には触れない。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createStaticServer } = require('../tools/static-server');

const browserName = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[browserName]; } catch (_) { engine = null; }

test('初日には「昨日」を前提にせず、Day2から継続の文章に切り替える', {
  skip: engine ? false : 'Playwright 未導入のため省略'
}, async t => {
  const server = createStaticServer(path.join(__dirname, '..', 'app'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const fs = require('node:fs');
  const executable = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  browser = await engine.launch(browserName === 'chromium' && fs.existsSync(executable) ? { executablePath: executable } : {});
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
  await page.goto(base);
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.daily-door');
  let first = await page.locator('.daily-door').innerText();
  assert.match(first, /DAY 01 \/ 21/);
  assert.match(first, /ここから、あなたの21日間が始まります/);
  assert.doesNotMatch(first, /昨日は見えなかったものが/);
  await page.goto(base + '#/day/1/5');
  await page.click('#complete');
  await page.goto(base + '#/');
  await page.waitForFunction(() => document.querySelector('.daily-door')?.textContent?.includes('DAY 02 / 21'));
  const second = await page.locator('.daily-door').innerText();
  assert.match(second, /昨日は見えなかったものが/);
  assert.doesNotMatch(second, /ここから、あなたの21日間が始まります/);
  await page.close();
});
