'use strict';
// A fresh invited device has not consented yet, so Store.remote is null.
// "Delete all" must still delete the account's server records, never only local data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let engine;
try { engine = require('playwright')[BROWSER]; } catch (_) {}
const skip = !engine && 'Playwright is required';

test('別端末の初回同意前でも全削除はサーバーに反映し、通信失敗時は削除しない', { skip }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-delete-preconsent-'));
  const gateway = createGateway({ databasePath: path.join(dir, 'private.sqlite'), origin: 'http://127.0.0.1:0', development: true });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  const executable = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  const browser = await engine.launch(BROWSER === 'chromium' && fs.existsSync(executable) ? { executablePath: executable } : {});
  t.after(async () => browser.close());

  const email = 'delete-preconsent@example.invalid';
  const password = 'a-long-test-passphrase';
  const first = await browser.newContext();
  const pageA = await first.newPage();
  t.after(async () => first.close());
  await pageA.goto(base);
  await pageA.fill('#email', email);
  await pageA.fill('#password', password);
  await pageA.fill('#invite', gateway.createInvite(email));
  await pageA.click('#submit');
  await pageA.waitForSelector('#agree');
  await pageA.check('#agree');
  await pageA.click('#start');
  await pageA.waitForSelector('.day-list');
  await pageA.goto(base + '/#/day/1/3');
  await pageA.fill('#ans-0', 'サーバーに保存した記録');
  await pageA.waitForFunction(async () => {
    const r = await fetch('/api/bootstrap');
    if (!r.ok) return false;
    return (await r.json()).entries['1']?.answers?.[0] === 'サーバーに保存した記録';
  }, null, { timeout: 10000 });

  // Route the simulated outage at the page level; disable service-worker
  // interception so WebKit and Chromium observe the same mocked response.
  const second = await browser.newContext({ serviceWorkers: 'block' });
  const pageB = await second.newPage();
  t.after(async () => second.close());
  await pageB.goto(base);
  await pageB.fill('#email', email);
  await pageB.fill('#password', password);
  await pageB.click('#submit');
  await pageB.waitForSelector('#agree');
  // This device has not agreed to sync, and its local store has no remote adapter.
  await pageB.goto(base + '/#/settings');
  await pageB.waitForSelector('#delete-all');
  await pageB.click('#delete-all');
  await pageB.click('#confirm-ok');
  await pageB.waitForSelector('#agree');
  const after = await pageB.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.deepEqual(after.entries, {}, 'server entries must also be deleted');
  assert.equal(after.generation, 1, 'deletion must advance the server generation');

  // Re-consent, write another entry, then simulate an unreachable bootstrap.
  await pageB.check('#agree');
  await pageB.click('#start');
  await pageB.waitForSelector('.day-list');
  await pageB.goto(base + '/#/day/1/3');
  await pageB.fill('#ans-0', '通信障害時に残す記録');
  await pageB.waitForFunction(async () => {
    const r = await fetch('/api/bootstrap');
    if (!r.ok) return false;
    return (await r.json()).entries['1']?.answers?.[0] === '通信障害時に残す記録';
  }, null, { timeout: 10000 });
  await pageB.goto(base + '/#/settings');
  // Intercept fetch in the application itself: WebKit can bypass page.route
  // when a service worker is involved, but the API always calls window.fetch.
  await pageB.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__blockedBootstrap = 0;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input.url;
      if (new URL(url, location.href).pathname === '/api/bootstrap') {
        window.__blockedBootstrap++;
        return Promise.reject(new TypeError('simulated network outage'));
      }
      return originalFetch(input, init);
    };
  });
  await pageB.click('#delete-all');
  await pageB.click('#confirm-ok');
  await pageB.waitForFunction(() => /削除しませんでした/.test(document.getElementById('delete-msg')?.textContent || ''), null, { timeout: 10000 });
  assert.ok(await pageB.evaluate(() => window.__blockedBootstrap) > 0, 'the simulated bootstrap outage must be intercepted');
  assert.equal(await pageB.locator('#delete-all').count(), 1, 'remain on settings after failed preflight');
  const local = await pageB.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('michiru21.u.'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  assert.equal(local.entries['1'].answers[0], '通信障害時に残す記録');
  const serverStillHas = await pageA.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(serverStillHas.entries['1'].answers[0], '通信障害時に残す記録');
});
