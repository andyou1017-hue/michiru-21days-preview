'use strict';
// Invite-only browser regression for the Day 7/14/21 future-letter experience.
// Uses synthetic records and a controllable server clock; never contacts production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}
const WEEK = 7 * 24 * 60 * 60 * 1000;

test('招待制のDay7/14/21：封印後7日未満は本文を隠し、7日後に本人だけが読める', {
  skip: !engine && 'Playwrightが必要です'
}, async t => {
  let clock = Date.parse('2026-11-02T00:00:00.000Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-letter-days-ui-'));
  const gateway = createGateway({
    databasePath: path.join(dir, 'private.sqlite'),
    origin: 'http://127.0.0.1:0', development: true, now: () => clock
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
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
  const page = await context.newPage();
  const email = 'letter-days@example.invalid';
  const password = 'a-long-test-passphrase';
  const letter = '7日後の私へのテストの手紙。';
  await page.goto(base);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.fill('#invite', gateway.createInvite(email));
  await page.click('#submit');
  await page.waitForSelector('#agree');
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.day-list');

  // Simulate the same server endpoint the Day 1 seal button calls, then reload
  // so the client obtains the server-managed sealed metadata from bootstrap.
  const sealed = await page.evaluate(async text => {
    const r = await fetch('/api/future-letter/seal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return r.status;
  }, letter);
  assert.equal(sealed, 200);
  await page.reload();
  await page.waitForSelector('.day-list');

  async function checkDay(day, locked) {
    await page.goto(base + '/#/day/' + day + '/5');
    await page.waitForSelector('#letter-read:not([aria-busy])');
    const section = page.locator('#letter-read');
    if (locked) {
      assert.match(await section.innerText(), /7日後/);
      assert.equal(await section.locator('#letter-open').count(), 0);
      assert.equal((await section.innerText()).includes(letter), false);
    } else {
      await section.locator('#letter-open').waitFor();
      assert.equal((await section.innerText()).includes(letter), false);
    }
  }
  for (const day of [7, 14, 21]) await checkDay(day, true);

  // The server, not the phone clock, controls the unlock. Sessions expire
  // after 24 hours, so the test must sign in again after advancing seven days.
  clock += WEEK - 1;
  await page.reload();
  await page.waitForSelector('#login-form');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#submit');
  await page.waitForSelector('.day-list');
  await checkDay(7, true);

  clock += 1;
  await checkDay(7, false);
  await page.locator('#letter-read #letter-open').click();
  await page.locator('#letter-read .letter-quote').waitFor();
  assert.equal(await page.locator('#letter-read .letter-quote').innerText(), letter);
  await page.locator('#letter-close').click();
  assert.equal(await page.locator('#letter-read .letter-quote').count(), 0);
  for (const day of [14, 21]) {
    await checkDay(day, false);
    await page.locator('#letter-read #letter-open').click();
    assert.equal(await page.locator('#letter-read .letter-quote').innerText(), letter);
  }
});
