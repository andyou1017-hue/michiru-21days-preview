'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');
let engine;
try { engine = require('playwright')[process.env.PW_BROWSER || 'chromium']; } catch (_) {}
const skip = !engine && 'Playwright required';
let browser, gateway, base, dir, clock = Date.now();
const PASSWORD = 'safe-test-password-123';
test.before(async () => {
  if (!engine) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-completion-'));
  gateway = createGateway({ databasePath: path.join(dir, 'test.sqlite'), origin: 'http://127.0.0.1:0', development: true, now: () => clock });
  await new Promise(r => gateway.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + gateway.server.address().port;
  const exec = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  browser = await engine.launch((process.env.PW_BROWSER || 'chromium') === 'chromium' && fs.existsSync(exec) ? { executablePath: exec } : {});
});
test.after(async () => {
  if (browser) await browser.close();
  if (gateway) await new Promise(r => gateway.server.close(r));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
async function student(email, speech = false, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...options });
  if (speech) await context.addInitScript(() => {
    const synth = new EventTarget();
    synth.getVoices = () => [{ name: '日本語テスト', lang: 'ja-JP' }];
    synth.speak = u => { window.__utterance = u; };
    synth.cancel = () => {};
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.fill('#email', email); await page.fill('#password', PASSWORD);
  await page.fill('#invite', gateway.createInvite(email)); await page.click('#submit');
  await page.waitForSelector('#agree'); await page.check('#agree'); await page.click('#start'); await page.waitForSelector('.day-list');
  return { context, page, errors, email };
}
async function post(context, route, data) { return context.request.post(base + route, { headers: { Origin: base }, data }); }
async function relogin(context, email) { assert.equal((await post(context, '/api/login', { email, password: PASSWORD })).status(), 200); }

test('PWA設定とiPhoneアイコンの寸法を検証', () => {
  const root = path.join(__dirname, '../app');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const png = fs.readFileSync(path.join(root, 'icons', file));
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
});

test('音声終了前は計らず、33秒・60秒・180秒を区別し、入力と封印操作を守る', { skip }, async () => {
  const { context, page, errors } = await student('timing-completion@example.invalid', true);
  try {
    await page.goto(base + '/#/day/1/2'); await page.waitForSelector('#t-voice');
    const epoch = Date.now(); await page.clock.install({ time: new Date(epoch) }); await page.clock.pauseAt(new Date(epoch + 1000));
    await page.click('#t-voice'); await page.clock.fastForward(30000);
    assert.equal(await page.textContent('#t-sec'), '33');
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__utterance.onend(); });
    await page.clock.fastForward(32999); assert.equal(await page.textContent('#t-sec'), '1');
    await page.clock.fastForward(1); assert.equal(await page.textContent('#t-sec'), '0');
    await page.goto(base + '/#/day/1/3'); await page.waitForSelector('#work-time-voice');
    await page.click('#work-time-voice'); await page.clock.fastForward(60000);
    assert.equal(await page.textContent('#work-time-remaining'), '01:00');
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__utterance.onend(); });
    await page.fill('#ans-0', '消えない記録');
    await page.clock.fastForward(20000); await page.click('#work-time-pause');
    const held = await page.textContent('#work-time-remaining'); await page.clock.fastForward(5000);
    assert.equal(await page.textContent('#work-time-remaining'), held);
    await page.click('#work-time-resume'); await page.clock.fastForward(40000);
    assert.equal(await page.textContent('#work-time-remaining'), '00:00'); assert.equal(await page.inputValue('#ans-0'), '消えない記録');
    await page.goto(base + '/#/day/1/5'); await page.waitForSelector('.letter-box'); await page.click('.letter-box > summary'); await page.click('#prep-skip');
    await page.click('#letter-time-voice'); await page.clock.fastForward(180000);
    assert.equal(await page.textContent('#letter-time-remaining'), '03:00');
    await page.evaluate(() => window.__utterance.onend()); await page.fill('#letter-text', '時間が終わっても残る手紙');
    await page.clock.fastForward(180000);
    assert.equal(await page.textContent('#letter-time-remaining'), '00:00');
    assert.equal(await page.inputValue('#letter-text'), '時間が終わっても残る手紙'); assert.equal(await page.isEditable('#letter-text'), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('PWAは個人情報をキャッシュせず、オフライン・再起動後にも記録を保つ', { skip }, async () => {
  const { context, page, errors } = await student('pwa-completion@example.invalid');
  try {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForSelector('.day-list');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.goto(base + '/#/day/2/3'); await page.fill('#ans-0', 'PWA再開用の記録');
    const before = await page.evaluate(() => { const key = Object.keys(localStorage).find(k => k.startsWith('michiru21.u.')); return { key, value: localStorage.getItem(key) }; });
    const cached = await page.evaluate(async () => { const all = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) all.push(new URL(request.url).pathname); return all; });
    assert.ok(cached.includes('/offline.html')); assert.ok(cached.every(p => p === '/offline.html' || p.startsWith('/icons/')));
    await context.setOffline(true);
    try { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('h1', { timeout: 5000 }); }
    catch (error) { console.log('PWA diagnosis:', page.url(), await page.content().catch(() => 'document unavailable')); throw error; }
    assert.match(await page.textContent('h1'), /通信を確認/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), before.key), before.value);
    await context.setOffline(false); await page.goto(base + '/#/day/2/3'); await page.waitForSelector('#ans-0');
    assert.equal(await page.inputValue('#ans-0'), 'PWA再開用の記録');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('封印後は端末・バックアップに本文を残さず、サーバーの7日境界で開く', { skip }, async () => {
  const { context, page, errors, email } = await student('sealed-completion@example.invalid');
  const text = 'サーバーで守る大切な手紙' + 'あ'.repeat(3500);
  try {
    await page.goto(base + '/#/day/1/5'); await page.waitForSelector('.letter-box'); await page.click('.letter-box > summary'); await page.click('#prep-skip');
    await page.fill('#letter-text', text); await page.click('#letter-seal'); await page.click('#confirm-ok');
    await page.waitForSelector('.seal-state');
    assert.equal(await page.evaluate(text => JSON.stringify(localStorage).includes(text), text), false);
    assert.equal((await post(context, '/api/future-letter/open', {})).status(), 423);
    await page.goto(base + '/#/settings'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
    assert.equal(fs.readFileSync(await dl.path(), 'utf8').includes(text), false);
    await page.clock.install(); await page.clock.fastForward(8 * 86400000);
    assert.equal((await post(context, '/api/future-letter/open', {})).status(), 423, '端末時計だけでは開かない');
    clock += 7 * 86400000 - 1; await relogin(context, email);
    assert.equal((await post(context, '/api/future-letter/open', {})).status(), 423);
    clock++; await page.goto(base + '/#/letter'); await page.reload(); await page.waitForSelector('#letter-open'); await page.click('#letter-open');
    await page.waitForSelector('.letter-quote'); assert.equal(await page.textContent('.letter-quote'), text);
    assert.equal(await page.evaluate(text => JSON.stringify(localStorage).includes(text), text), false);
    assert.equal((await context.request.get(base + '/api/bootstrap')).status(), 200);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('封印の通信失敗で完了を偽らず、書きかけを再開できる', { skip }, async () => {
  // PlaywrightのrouteはService Worker経由を遮断できないため、この障害注入試験だけ制御を固定する。
  const { context, page, errors } = await student('seal-failure@example.invalid', false, { serviceWorkers: 'block' });
  try {
    await page.goto(base + '/#/day/1/5'); await page.waitForSelector('.letter-box'); await page.click('.letter-box > summary'); await page.click('#prep-skip');
    await page.fill('#letter-text', '送信に失敗しても残す');
    await page.route('**/api/future-letter/seal', route => route.abort());
    await page.click('#letter-seal'); await page.click('#confirm-ok');
    await page.waitForFunction(() => !!document.getElementById('seal-msg')?.textContent.length);
    assert.equal(await page.inputValue('#letter-text'), '送信に失敗しても残す');
    assert.equal(await page.locator('.letter-box > .seal-state').count(), 0);
    assert.equal((await (await context.request.get(base + '/api/future-letter/status')).json()).sealed, false);
    await page.unroute('**/api/future-letter/seal'); await page.reload(); await page.waitForSelector('#letter-text');
    assert.equal(await page.inputValue('#letter-text'), '送信に失敗しても残す');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('以前の端末内封印を誤ってサーバー保護とせず、確認後に本文を移す', { skip }, async () => {
  const { context, page, errors } = await student('legacy-migration@example.invalid');
  const text = '以前の封の本文を守る';
  try {
    await page.evaluate(text => {
      const key = Object.keys(localStorage).find(k => k.startsWith('michiru21.u.'));
      const state = JSON.parse(localStorage.getItem(key));
      state.futureLetter = { text, written_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', sealed_at: '2026-01-01T00:00:00Z', opened_at: null };
      localStorage.setItem(key, JSON.stringify(state));
    }, text);
    await page.reload(); await page.goto(base + '/#/day/1/5'); await page.waitForSelector('#letter-migrate');
    assert.match(await page.textContent('.letter-box'), /サーバーで保護された封ではありません/);
    await page.click('#letter-migrate'); await page.click('#confirm-cancel');
    assert.equal((await (await context.request.get(base + '/api/future-letter/status')).json()).sealed, false);
    await page.click('#letter-migrate'); await page.click('#confirm-ok');
    await page.waitForSelector('.letter-box > .seal-state');
    assert.equal(await page.evaluate(text => JSON.stringify(localStorage).includes(text), text), false);
    assert.equal((await post(context, '/api/future-letter/open', {})).status(), 423);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
