// 試作版の受け入れテスト（実際のブラウザで操作する）。T01〜T27 のうち画面にかかわるもの。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createStaticServer } = require('../tools/static-server');

const BROWSER = process.env.PW_BROWSER || 'chromium';
let chromium;
try { chromium = require('playwright')[BROWSER]; } catch (e) { chromium = null; }

const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = chromium ? false : 'playwright が見つからないため省略';

let server, base, browser;
let serverNow = null; // null＝本当の時刻。テストで「封から7日後」などを作るときに設定する
const DAY = 24 * 60 * 60 * 1000;

test.before(async () => {
  if (skip) return;
  server = createStaticServer(path.join(__dirname, '..', 'app'), { now: () => (serverNow === null ? Date.now() : serverNow) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  const fs = require('fs');
  browser = await chromium.launch(BROWSER === 'chromium' && fs.existsSync(EXEC) ? { executablePath: EXEC } : {});
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width || 390, height: 800 }, storageState: opts.storageState });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return { context, page, errors };
}

async function consent(page) {
  await page.goto(base);
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.day-list');
}

async function waitSaved(page) {
  await page.waitForFunction(() => document.getElementById('save-status').getAttribute('data-state') === 'saved');
}

function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('michiru21.v1')));
}

test('本番設定で認証APIが欠けた場合、試作教材へフォールバックしない', { skip }, async () => {
  const { context, page } = await newPage();
  await page.addInitScript(() => { window.MICHIRU_CONFIG = { server: true }; });
  await page.goto(base);
  assert.match(await page.textContent('#view'), /認証を読み込めませんでした/);
  assert.equal(await page.locator('#start, .day-list, textarea').count(), 0);
  await context.close();
});

test('RECOVERY 読めない記録を上書きせず、元データを退避してバックアップから戻せる', { skip }, async () => {
  const { context, page, errors } = await newPage({ width: 320 });
  const original = '{"entries":{"1":{"reflection":"大切な記録"';
  await page.addInitScript(value => {
    if (!sessionStorage.getItem('recovery-seeded')) {
      localStorage.setItem('michiru21.v1', value); sessionStorage.setItem('recovery-seeded', '1');
    }
  }, original);
  await page.goto(base);
  await page.waitForSelector('#recovery-title');
  assert.equal(await page.isDisabled('#export'), true);
  assert.equal(await page.locator('textarea').count(), 0);
  await page.goto(base + '#/day/1/3');
  await page.waitForSelector('#recovery-title');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => localStorage.getItem('michiru21.v1')), original);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-recovery')]);
  assert.equal(require('fs').readFileSync(await download.path(), 'utf8'), original);
  const backup = { app: 'michiru-21days', schema: 1, consentedAt: new Date().toISOString(), entries: { 1: { answers: ['復元する記録'] } }, discoveries: [{ id: 'd1', text: '発見', day: 1 }], futureReplies: { 7: { text: '返信' } } };
  await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.click('#confirm-cancel');
  assert.equal(await page.evaluate(() => localStorage.getItem('michiru21.v1')), original);
  await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
  assert.equal(await page.locator('#recovery-title').count(), 0);
  assert.equal(await page.isEnabled('#export'), true);
  assert.equal((await stored(page)).futureReplies[7].text, '返信');
  await page.goto(base + '#/day/1/3');
  assert.equal(await page.inputValue('#ans-0'), '復元する記録');
  assert.deepEqual(errors, []);
  await context.close();
});

test('RECOVERY 未対応形式では案内し、明示的な全削除で新しく始められる', { skip }, async () => {
  const { context, page } = await newPage();
  const original = JSON.stringify({ app: 'michiru-21days', schema: 2, futureLetter: { text: '未来の記録' } });
  await page.addInitScript(value => {
    if (!sessionStorage.getItem('recovery-seeded')) {
      localStorage.setItem('michiru21.v1', value); sessionStorage.setItem('recovery-seeded', '1');
    }
  }, original);
  await page.goto(base);
  await page.waitForSelector('#recovery-title');
  await page.click('#delete-all'); await page.click('#confirm-cancel');
  assert.equal(await page.evaluate(() => localStorage.getItem('michiru21.v1')), original);
  await page.click('#delete-all'); await page.click('#confirm-ok');
  await page.waitForSelector('#agree');
  assert.deepEqual((await stored(page)).entries, {});
  await context.close();
});

test('確認ダイアログのTab移動を内側に保ち、Escapeで元のボタンへ戻る', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page); await page.goto(base + '#/settings');
  await page.click('#delete-all');
  await page.waitForSelector('#confirm-cancel:focus');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#confirm-ok').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#confirm-cancel').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.confirm').count(), 0);
  assert.equal(await page.locator('#delete-all').evaluate(el => el === document.activeElement), true);
  await context.close();
});

test('ホームでも草案のミニ解説に確認中の注記を表示する', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  assert.match(await page.textContent('.door-guide .draft-mark'), /確認中/);
  await context.close();
});

test('未来の手紙の音声：操作してから再生し、33秒無音を3回経て書き出しへ進む', { skip }, async () => {
  const { context, page, errors } = await newPage({ width: 320 });
  await page.addInitScript(() => {
    const synth = new EventTarget();
    window.__guidanceSpoken = [];
    synth.getVoices = () => [{ name: 'テスト日本語音声', lang: 'ja-JP' }];
    synth.speak = u => { window.__guidanceSpoken.push(u.text); window.__guidanceLast = u; };
    synth.cancel = () => { window.__guidanceCancelled = (window.__guidanceCancelled || 0) + 1; };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  });
  await consent(page); await page.goto(base + '#/day/1/5');
  await page.click('.letter-box > summary');
  assert.equal(await page.evaluate(() => window.__guidanceSpoken.length), 0);
  await page.clock.install();
  await page.selectOption('#guidance-voice', 'テスト日本語音声');
  await page.click('#guidance-start');
  assert.equal(await page.evaluate(() => window.__guidanceSpoken.length), 1);
  await page.click('#guidance-pause');
  assert.match(await page.textContent('#guidance-status'), /一時停止/);
  await page.click('#guidance-resume');
  for (let i = 0; i < 7; i++) {
    await page.evaluate(() => window.__guidanceLast.onend());
    if ([2, 3, 4].includes(i)) {
      assert.match(await page.textContent('#guidance-seconds'), /33秒/);
      const count = await page.evaluate(() => window.__guidanceSpoken.length);
      await page.clock.fastForward(32000);
      assert.equal(await page.evaluate(() => window.__guidanceSpoken.length), count);
      await page.clock.fastForward(1000);
    }
  }
  assert.match(await page.textContent('#guidance-status'), /終わりました/);
  assert.equal(await page.isVisible('#letter-write'), true);
  await page.fill('#letter-text', '未来の自分から届いた言葉');
  await page.click('#guidance-start');
  const count = await page.evaluate(() => window.__guidanceSpoken.length);
  await page.goto(base + '#/settings');
  await page.waitForSelector('#export');
  await page.evaluate(() => window.__guidanceLast.onend());
  assert.equal(await page.evaluate(() => window.__guidanceSpoken.length), count);
  assert.ok(await page.evaluate(() => window.__guidanceCancelled > 0));
  assert.equal((await stored(page)).futureLetter.text, '未来の自分から届いた言葉');
  assert.deepEqual(errors, []);
  await context.close();
});

test('全21日の教材読み上げ：ミニ解説・本文・問いを読み、入力した記録は含めない', { skip }, async () => {
  const { context, page, errors } = await newPage({ width: 320 });
  await page.addInitScript(() => {
    const synth = new EventTarget();
    synth.getVoices = () => [{ name: '日本語', lang: 'ja-JP' }];
    synth.speak = utterance => { window.__readUtterance = utterance; window.__readTexts.push(utterance.text); };
    synth.cancel = () => {};
    window.__readTexts = [];
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  });
  await consent(page);
  for (let day = 1; day <= 21; day++) {
    await page.goto(base + '#/day/' + day + '/3');
    await page.waitForFunction(day => document.querySelector('.day-head .eyebrow')?.textContent === 'Day ' + String(day).padStart(2, '0') + ' / 21', day);
    await page.fill('#ans-0', '読み上げない個人の記録');
    await page.evaluate(() => { window.__readTexts = []; });
    await page.click('#lesson-read');
    if (day === 1) {
      await page.click('#lesson-read-pause');
      assert.match(await page.textContent('#lesson-read-status'), /一時停止/);
      await page.click('#lesson-read-resume');
    }
    await page.evaluate(() => {
      for (let i = 0; i < 12 && !document.getElementById('lesson-read-pause').hidden; i++) window.__readUtterance.onend();
    });
    assert.match(await page.textContent('#lesson-read-status'), /終わりました/);
    const spoken = await page.evaluate(() => window.__readTexts.join('\n'));
    const title = await page.textContent('.day-head h1');
    assert.ok(spoken.includes(title));
    assert.ok(spoken.includes((await page.textContent('.story p')).trim()));
    assert.ok(!spoken.includes('読み上げない個人の記録'));
  }
  await page.click('#lesson-read');
  const count = await page.evaluate(() => window.__readTexts.length);
  await page.goto(base + '#/settings'); await page.waitForSelector('#export');
  await page.evaluate(() => window.__readUtterance.onend());
  assert.equal(await page.evaluate(() => window.__readTexts.length), count);
  assert.deepEqual(errors, []);
  await context.close();
});

test('S01 はじめに：読んだ確認をしないと始められない', { skip }, async () => {
  const { context, page, errors } = await newPage();
  await page.goto(base);
  assert.ok(await page.isDisabled('#start'));
  assert.match(await page.textContent('.intro'), /治療・診断を目的としません/);
  await page.check('#agree');
  await page.click('#start');
  await page.waitForSelector('.day-list');
  assert.deepStrictEqual(errors, []);
  await context.close();
});

test('T01・T02・T22 21日分を開け、どの日へも移動・戻れる。完了は文字でもわかる', { skip }, async () => {
  const { context, page, errors } = await newPage();
  await consent(page);
  assert.strictEqual(await page.locator('.day-card').count(), 21);
  for (let n = 1; n <= 21; n++) {
    await page.goto(base + '#/day/' + n + '/3');
    await page.waitForSelector('.story');
    const h = await page.textContent('.day-head h1');
    assert.ok(h.trim().length > 0, 'Day' + n + ' 見出し');
    assert.ok((await page.textContent('.story')).trim().length > 10, 'Day' + n + ' 本文');
    assert.ok(await page.locator('textarea').count() >= 2, 'Day' + n + ' 問い');
  }
  // 順に移動：Day1 の5ステップを「次へ」でたどる
  await page.goto(base + '#/day/1/1');
  for (let s = 1; s < 5; s++) {
    await page.click('#next');
    await page.waitForFunction((s) => location.hash === '#/day/1/' + (s + 1), s);
  }
  await page.click('#complete');
  await page.click('text=Day 02へ');
  await page.waitForFunction(() => location.hash === '#/day/2/1');
  // 一覧から任意の日（Day 15）へ戻る
  await page.goto(base + '#/');
  await page.click('.day-card[href="#/day/15/1"]');
  await page.waitForFunction(() => location.hash === '#/day/15/1');
  await page.goto(base + '#/');
  const card = page.locator('.day-card[href="#/day/1/1"]');
  assert.match(await card.textContent(), /✓ 完了/); // 色だけに頼らない
  assert.deepStrictEqual(errors, []);
  await context.close();
});

test('T03・T04・T09 気分・回答が空でも保存・完了できる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/3/5');
  await page.click('#complete');
  await page.waitForSelector('.done-mark');
  await waitSaved(page);
  const s = await stored(page);
  assert.ok(s.entries[3].completed_at);
  assert.strictEqual(s.entries[3].mood_am, null);
  assert.strictEqual(s.entries[3].mood_pm, null);
  await context.close();
});

test('T05・T17 気分の端値0と10を保存・再表示し、良い悪いの評価を出さない', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/1/1');
  await page.fill('#mood-am', '0');
  await page.goto(base + '#/day/1/5');
  await page.fill('#mood-pm', '10');
  await waitSaved(page);
  await page.reload();
  await page.goto(base + '#/day/1/1');
  assert.strictEqual(await page.textContent('#mood-am-out'), '0');
  assert.strictEqual(await page.inputValue('#mood-am'), '0');
  await page.goto(base + '#/day/1/5');
  assert.strictEqual(await page.textContent('#mood-pm-out'), '10');
  await page.goto(base + '#/records/1');
  const text = await page.textContent('main');
  for (const w of ['良好', '悪化', '低い', '高い', '改善', '落ち込', '調子が良', '調子が悪']) assert.ok(!text.includes(w), w);
  // 記録を消して未記録に戻せる
  await page.goto(base + '#/day/1/1');
  await page.click('#mood-am-clear');
  await waitSaved(page);
  assert.strictEqual((await stored(page)).entries[1].mood_am, null);
  await context.close();
});

test('T06・T07・T08 33秒タイマー：33秒で終わる／一時停止・再開／とばせる', { skip }, async () => {
  const { context, page } = await newPage();
  await page.clock.install();
  await consent(page);
  await page.goto(base + '#/day/2/2');
  await page.click('#t-start');
  // 動いている間は「一時停止」と「最初から」だけを出す
  assert.ok(!(await page.isVisible('#t-start')) && !(await page.isVisible('#t-resume')));
  assert.ok(await page.isVisible('#t-pause'));
  await page.clock.runFor(10000);
  await page.click('#t-pause');
  const paused = await page.textContent('#t-sec');
  await page.clock.runFor(20000); // 止めている間は進まない
  assert.strictEqual(await page.textContent('#t-sec'), paused);
  assert.strictEqual(paused, '23');
  assert.ok(await page.isVisible('#t-resume') && !(await page.isVisible('#t-pause')));
  await page.click('#t-resume');
  await page.clock.runFor(22000);
  assert.notStrictEqual(await page.textContent('#t-sec'), '0'); // 合計32秒ではまだ終わらない
  await page.clock.runFor(1500);
  assert.strictEqual(await page.textContent('#t-sec'), '0');
  assert.match(await page.textContent('#t-guide'), /終わりました/);
  // とばして次へ
  await page.goto(base + '#/day/3/2');
  await page.click('#t-skip');
  await page.waitForFunction(() => location.hash === '#/day/3/3');
  await context.close();
});

test('T10・T11・T20 日本語・改行・絵文字・長文を保持し、幅320pxで横にはみ出さない', { skip }, async () => {
  const { context, page } = await newPage({ width: 320 });
  await consent(page);
  const text = '今日は👍うれしかった。\n二行目🐴\n' + 'とても長い文章'.repeat(400) + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await page.goto(base + '#/day/4/3');
  await page.fill('#ans-0', text);
  await waitSaved(page);
  await page.reload();
  await page.waitForSelector('#ans-0');
  assert.strictEqual(await page.inputValue('#ans-0'), text);
  for (const h of ['#/', '#/day/4/1', '#/day/4/2', '#/day/4/3', '#/day/4/4', '#/day/4/5', '#/records', '#/records/4', '#/compare', '#/complete', '#/settings', '#/intro', '#/discoveries', '#/letter', '#/day/1/5', '#/day/7/5']) {
    await page.goto(base + h);
    await page.waitForTimeout(50);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 320, h + ' の幅が ' + w + 'px');
  }
  await context.close();
});

test('T12 ブラウザを閉じて開き直しても記録が残る', { skip }, async () => {
  const a = await newPage();
  await consent(a.page);
  await a.page.goto(base + '#/day/6/3');
  await a.page.fill('#ans-1', '閉じても残る記録');
  await a.page.close({ runBeforeUnload: true }); // pagehide で保存される
  const state = await a.context.storageState();
  await a.context.close();
  const b = await newPage({ storageState: state });
  await b.page.goto(base + '#/day/6/3');
  assert.strictEqual(await b.page.inputValue('#ans-1'), '閉じても残る記録');
  await b.context.close();
});

test('T13・Day5とDay20の比較：Day20でDay5の記録を見られ、並べて表示できる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/5/3');
  await page.fill('#ans-0', '母');
  await page.fill('#ans-1', '毎朝の声かけ');
  await page.goto(base + '#/day/20/3');
  await page.fill('#ans-0', '母の笑い方');
  await page.click('.compare-inline summary');
  assert.match(await page.textContent('.compare-inline'), /毎朝の声かけ/);
  await page.goto(base + '#/compare');
  const cols = page.locator('.cmp-col');
  assert.strictEqual(await cols.count(), 2);
  assert.match(await cols.nth(0).textContent(), /Day 05[\s\S]*毎朝の声かけ/);
  assert.match(await cols.nth(1).textContent(), /Day 20[\s\S]*母の笑い方/);
  assert.match(await page.textContent('.compare'), /BIP-OTHER-01/);
  await context.close();
});

test('T14 21日の画面に黄金版の講師向け内容を出さない', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  for (const n of [1, 5, 19, 20, 21]) {
    for (let s = 1; s <= 5; s++) {
      await page.goto(base + '#/day/' + n + '/' + s);
      const t = await page.textContent('main');
      assert.ok(!/黄金の心から|黄金の心の視点|集中指導|出典|編集用/.test(t), 'Day' + n + '/' + s);
    }
  }
  await context.close();
});

test('T15・T16 未完了の日を後から完了でき、完了を取り消して再完了できる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/9/3');
  await page.fill('#ans-0', 'あとで書き足す前');
  await page.goto(base + '#/day/12/5');
  await page.click('#complete');
  await page.goto(base + '#/day/9/3');
  await page.fill('#ans-0', 'あとで書き足した');
  await page.goto(base + '#/day/9/5');
  await page.click('#complete');
  await page.waitForSelector('#undo');
  await page.click('#undo');
  await page.waitForSelector('#complete');
  await waitSaved(page);
  assert.strictEqual((await stored(page)).entries[9].completed_at, null);
  await page.click('#complete');
  await page.waitForSelector('.done-mark');
  await waitSaved(page);
  const s = await stored(page);
  assert.ok(s.entries[9].completed_at);
  assert.strictEqual(s.entries[9].answers[0], 'あとで書き足した');
  await context.close();
});

test('T18 全削除すると、再読み込みしても消えている', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/2/3');
  await page.fill('#ans-0', '消す記録');
  await waitSaved(page);
  await page.goto(base + '#/settings');
  await page.click('#delete-all');
  await page.click('#confirm-ok');
  await page.waitForSelector('#agree');
  await page.reload();
  const s = await stored(page);
  assert.deepStrictEqual(s.entries, {});
  assert.ok(!JSON.stringify(s).includes('消す記録'));
  await context.close();
});

test('T19 記録を外部に送信しない（通信は同じサーバーの画面ファイルだけ）', { skip }, async () => {
  const { context, page } = await newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  await consent(page);
  await page.goto(base + '#/day/5/3');
  await page.fill('#ans-0', '外に出ない記録');
  await page.goto(base + '#/day/5/5');
  await page.click('#complete');
  await waitSaved(page);
  for (const r of requests) {
    assert.ok(r.url.startsWith(base), '外部への通信：' + r.url);
    assert.strictEqual(r.method, 'GET');
  }
  await context.close();
});

test('T21 キーボードだけで主要な操作ができる', { skip }, async () => {
  const { context, page } = await newPage();
  await page.goto(base);
  // 同意 → 開始
  await page.focus('#agree');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.day-list');
  // Tab で Day 01 のカードまで移動して開く
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement.getAttribute('href') === '#/day/1/1' && document.activeElement.classList.contains('day-card'))) break;
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('#mood-am');
  await page.focus('#mood-am');
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await page.textContent('#mood-am-out'), '6');
  await page.focus('#next');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#t-start');
  await page.focus('#t-start');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#t-pause:not([hidden])');
  await page.keyboard.press('Tab');
  await page.focus('#t-skip');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#ans-0');
  await page.focus('#ans-0');
  await page.keyboard.type('キーボードで入力');
  await page.goto(base + '#/day/1/5');
  await page.focus('#complete');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.done-mark');
  await waitSaved(page);
  const s = await stored(page);
  assert.strictEqual(s.entries[1].answers[0], 'キーボードで入力');
  assert.ok(s.entries[1].completed_at);
  await context.close();
});

test('T23 どのステップでも中断でき、記録は残る', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  for (let s = 1; s <= 5; s++) {
    await page.goto(base + '#/day/10/' + s);
    assert.ok(await page.isVisible('#pause'), 'ステップ' + s);
  }
  await page.goto(base + '#/day/10/3');
  await page.fill('#ans-0', '途中まで');
  await page.click('#pause');
  await page.waitForSelector('.day-list');
  assert.match(await page.textContent('.day-card[href="#/day/10/1"]'), /記入あり/);
  // 今日の扉（前回の続き）が Day 10 を指す
  assert.match(await page.textContent('.daily-door'), /DAY 10 \/ 21[\s\S]*今日のテーマ：これで良かった①/);
  assert.strictEqual(await page.getAttribute('#door-open', 'href'), '#/day/10/1');
  await context.close();
});

test('T24・T25 Day21で完結。上位コース・面談の案内は任意で、申し込まなくても終われる', { skip }, async () => {
  const { context, page } = await newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await consent(page);
  await page.goto(base + '#/day/21/5');
  await page.click('#complete');
  await page.waitForSelector('.closing');
  const t = await page.textContent('main');
  assert.match(t, /この21日間は、これで完結です/);
  assert.ok(!(await page.isVisible('.optional p')), '案内は開かないと表示されない');
  assert.ok(!/購入|お支払い|申し込んでください/.test(t));
  await page.click('text=一覧へ戻る');
  await page.waitForSelector('.day-list');
  assert.ok(requests.every((u) => u.startsWith(base)));
  await context.close();
});

test('バックアップ：ファイルに保存し、全削除のあとに戻せる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/7/3');
  await page.fill('#ans-0', 'バックアップする記録\n二行目');
  await page.goto(base + '#/day/7/1');
  await page.fill('#mood-am', '0');
  await waitSaved(page);
  await page.goto(base + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  assert.match(dl.suggestedFilename(), /^michiru-21days-backup-\d{8}\.json$/);
  const file = await dl.path();
  const data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  assert.strictEqual(data.entries[7].answers[0], 'バックアップする記録\n二行目');
  await page.click('#delete-all');
  await page.click('#confirm-ok');
  await page.waitForSelector('#agree');
  assert.deepStrictEqual((await stored(page)).entries, {});
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', file);
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
  await page.goto(base + '#/day/7/3');
  assert.strictEqual(await page.inputValue('#ans-0'), 'バックアップする記録\n二行目');
  await page.goto(base + '#/day/7/1');
  assert.strictEqual(await page.textContent('#mood-am-out'), '0');
  // 形式の違うファイルは読み込まない
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await page.waitForFunction(() => /読み込めませんでした/.test(document.getElementById('import-msg').textContent));
  await context.close();
});

test('入力した文字はHTMLとして解釈されない（記録画面）', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  let alerted = false;
  page.on('dialog', () => { alerted = true; });
  await page.goto(base + '#/day/8/3');
  await page.fill('#ans-0', '<img src=x onerror=alert(1)><b>太字</b>');
  await waitSaved(page);
  await page.goto(base + '#/records/8');
  assert.match(await page.textContent('.record'), /<img src=x onerror=alert\(1\)><b>太字<\/b>/);
  assert.strictEqual(await page.locator('.record img, .record b').count(), 0);
  assert.ok(!alerted);
  await context.close();
});

test('文字の大きさを変えられ、記録にも残る', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/settings');
  await page.click('[data-fs="xl"]');
  assert.strictEqual(await page.getAttribute('html', 'data-font'), 'xl');
  await waitSaved(page);
  await page.reload();
  assert.strictEqual(await page.getAttribute('html', 'data-font'), 'xl');
  await context.close();
});

test('タップできる部分は44px以上', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  for (const h of ['#/', '#/day/1/1', '#/day/1/2', '#/day/1/4', '#/day/1/5', '#/settings', '#/discoveries', '#/records']) {
    await page.goto(base + h);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('main a.btn, main button, main .day-card, main .steps a, .app-nav a'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ t: el.textContent.trim().slice(0, 20), h: el.getBoundingClientRect().height }))
      .filter((x) => x.h < 44));
    assert.deepStrictEqual(small, [], h);
  }
  await context.close();
});

test('削除の確認は画面の中で行い、「やめる」で何も消えない', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/11/3');
  await page.fill('#ans-0', '残す記録');
  await waitSaved(page);
  await page.goto(base + '#/records/11');
  await page.click('#del-day');
  assert.ok(await page.isVisible('[role="alertdialog"]'));
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'confirm-cancel', '安全な方に最初のフォーカス');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('[role="alertdialog"]').count(), 0);
  assert.strictEqual((await stored(page)).entries[11].answers[0], '残す記録');
  await page.click('#del-day');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => location.hash === '#/records');
  await waitSaved(page);
  assert.ok(!(await stored(page)).entries[11]);
  await context.close();
});

// ---------- 今日の扉（P1） ----------
test('P1 今日の扉：開くと前回の日へ。完了した日のあとは次の未完了の日を案内し、入口は1つだけ', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  // 初めては Day 01
  assert.strictEqual(await page.getAttribute('#door-open', 'href'), '#/day/1/1');
  assert.match(await page.textContent('.daily-door'), /今日のテーマ：今の心を知る/);
  // 扉と同じ行き先の「前回の続き」ボタンを重ねて置かない
  assert.strictEqual(await page.locator('main a:not(.day-card)[href="#/day/1/1"]').count(), 1);
  // Day 03 を完了すると、扉は Day 04 を案内する
  await page.goto(base + '#/day/3/5');
  await page.click('#complete');
  await page.waitForSelector('.done-mark');
  await page.goto(base + '#/');
  await page.waitForSelector('.daily-door');
  assert.strictEqual(await page.getAttribute('#door-open', 'href'), '#/day/4/1');
  // 扉から1タップで今日のワークへ
  await page.click('#door-open');
  await page.waitForSelector('#mood-am');
  // 21日すべて完了すると、扉は「おわりに」へ
  for (let n = 1; n <= 21; n++) {
    await page.goto(base + '#/day/' + n + '/5');
    // WebKit の画面描画前に isVisible() が false になる競合を防ぐ。
    // Day 03 はこのテストの前半で完了済みなので、完了画面も待機対象にする。
    await page.waitForFunction(() => document.querySelector('#complete') || document.querySelector('.done-mark') || document.querySelector('.closing'));
    if (await page.locator('#complete').isVisible()) await page.click('#complete');
    await page.waitForSelector(n === 21 ? '.closing' : '.done-mark'); // Day 21 は完了すると「おわりに」へ進む
  }
  await page.goto(base + '#/');
  await page.waitForSelector('.daily-door');
  assert.strictEqual(await page.getAttribute('#door-open', 'href'), '#/complete');
  await context.close();
});

// ---------- 私の発見（P2） ----------
test('P2 私の発見：選んだ一言だけを残せる。記録の言葉を写して残せる。消せる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  // 空では残さない
  await page.goto(base + '#/day/2/5');
  await page.click('#disc-add');
  assert.match(await page.textContent('#disc-msg'), /書いてから/);
  // 夜のふりかえりから残す
  await page.fill('#disc-text', '当たり前の水が、ありがたかった🐴');
  await page.click('#disc-add');
  await page.waitForFunction(() => /残しました/.test(document.getElementById('disc-msg').textContent));
  assert.strictEqual(await page.inputValue('#disc-text'), '');
  assert.match(await page.textContent('.disc-mini'), /当たり前の水/);
  // 記録の画面から、答えを写して整えてから残す
  await page.goto(base + '#/day/5/3');
  await page.fill('#ans-1', '毎朝の声かけ。とても長い説明が続く');
  await waitSaved(page);
  await page.goto(base + '#/records/5');
  await page.click('[data-pick="1"]');
  assert.strictEqual(await page.inputValue('#disc-text'), '毎朝の声かけ。とても長い説明が続く');
  await page.fill('#disc-text', '毎朝の声かけ');
  await page.click('#disc-add');
  await waitSaved(page);
  // 一覧：新しい順。数や点数は出さない
  await page.goto(base + '#/discoveries');
  const items = page.locator('.disc-list li');
  assert.strictEqual(await items.count(), 2);
  assert.match(await items.nth(0).textContent(), /毎朝の声かけ[\s\S]*Day 05/);
  assert.match(await items.nth(1).textContent(), /当たり前の水[\s\S]*Day 02/);
  assert.ok(!/[0-9]+\s*(個|件|日連続|ポイント|点)/.test(await page.textContent('main')));
  // 保存され、再読み込みしても残る
  let s = await stored(page);
  assert.deepStrictEqual(s.discoveries.map((x) => [x.day, x.text]), [[2, '当たり前の水が、ありがたかった🐴'], [5, '毎朝の声かけ']]);
  await page.reload();
  await page.waitForSelector('.disc-list');
  // 消す（「やめる」では消えない）
  await page.locator('.disc-list [data-del]').first().click();
  await page.click('#confirm-cancel');
  assert.strictEqual(await items.count(), 2);
  await page.locator('.disc-list [data-del]').first().click();
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.querySelectorAll('.disc-list li').length === 1);
  await waitSaved(page);
  s = await stored(page);
  assert.deepStrictEqual(s.discoveries.map((x) => x.text), ['当たり前の水が、ありがたかった🐴']);
  // 日の記録を消しても、残した言葉は消えない（確認の文で知らせる）
  await page.goto(base + '#/records/2');
  await page.click('#del-day');
  assert.match(await page.textContent('#confirm-msg'), /私の発見.*消えません/);
  await page.click('#confirm-ok');
  await waitSaved(page);
  assert.strictEqual((await stored(page)).discoveries.length, 1);
  await context.close();
});

test('P2 私の発見：入力はHTMLとして動かない', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  let alerted = false;
  page.on('dialog', () => { alerted = true; });
  await page.goto(base + '#/day/3/5');
  await page.fill('#disc-text', '<img src=x onerror=alert(1)>');
  await page.click('#disc-add');
  await waitSaved(page);
  await page.goto(base + '#/discoveries');
  assert.strictEqual(await page.locator('.disc-list img').count(), 0);
  assert.match(await page.textContent('.disc-list'), /<img src=x onerror=alert\(1\)>/);
  assert.ok(!alerted);
  await context.close();
});

// ---------- 未来からの手紙（P3・オーナー仕様 2026-10-31） ----------
const INTRO_LINES = ['答えから、今を見てみましょう', '私たちは普段、今の自分から未来を見ています。', 'でも今日は、少しだけ反対のことをしてみます。',
  'あなたが望んだ未来。', '幸せで、喜びに満ち、心から「ありがとう」と感じているあなた。', 'その未来の自分になったつもりで、今のあなたを見てみましょう。',
  '今のあなたは、どんなふうに見えますか。', '何を伝えてあげたいですか。', '何かが足りない自分ではなく、すでに素晴らしいものを持っている自分が見えてくるかもしれません。',
  'その未来のあなたから、今のあなたへ。', '一通の手紙を届けてください。'];
const GUIDE_LINES = ['少し目を閉じて、21日間を歩み終えた自分をイメージしてみましょう。', 'そのあなたは、今のあなたに何を伝えたいでしょうか。',
  '未来のあなたになったつもりで、今のあなたへ手紙を書いてみましょう。', 'うまく書こうとしなくて大丈夫です。', '未来のあなたから、今のあなたへ。', 'その言葉を、自由に綴ってください。'];

// 手紙の欄を開いて、書く欄を出す（瞑想の確かめは別のテストで行う）
async function openLetterWriter(page) {
  if (!(await page.isVisible('.letter-intro'))) await page.click('.letter-box summary'); // 書きかけがあると最初から開いている
  if (await page.isVisible('#prep-skip')) await page.click('#prep-skip');
  await page.waitForSelector('#letter-text', { state: 'visible' });
}

async function writeAndSeal(page, text) {
  await page.goto(base + '#/day/1/5');
  await openLetterWriter(page);
  await page.fill('#letter-text', text);
  await page.click('#letter-seal');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /封をしました/.test(document.querySelector('.letter-box').textContent));
  await waitSaved(page);
}

const T1 = '書き終えたら、そっと封をしましょう。未来のあなたからの手紙は、7日後に届きます。書かなくてもかまいません。';
const T2 = '封をすると、7日間は開けることも、書き直すこともできません。今の言葉を大切に、そのまま残しておきましょう。';
const T3 = '未来のあなたから、手紙が届いています。';
const T3b = '今、開いても、もう少し後に開いてもかまいません。';
const T4 = '一度開いた手紙は、いつでも読み返せます。';

// サーバーの時刻を進めて、画面を読み込み直す（同じ画面の間は、最初に得た時刻からの経過で数えるため）
async function setServerTime(page, ms) { serverNow = ms; await page.reload(); }
async function letterState(page) {
  await page.waitForFunction(() => { const x = document.getElementById('letter-read'); return x && !x.hasAttribute('aria-busy'); });
  return page.textContent('#letter-read');
}

test('P3 手紙：Day1 にオーナーの文で書き、封をする（①②）。封のあとは中身を出さず、書き換えられない', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/1/5');
  assert.ok(!(await page.isVisible('#letter-text')), '任意・折りたたみ');
  await openLetterWriter(page);
  const box = await page.textContent('.letter-box');
  for (const l of INTRO_LINES.concat(GUIDE_LINES)) assert.ok(box.includes(l), '原文がない：' + l);
  assert.ok(box.includes(T1), '①の文');
  assert.ok(!/21日後の私へ|未来の私へ|未来の自分へ|Day 07 に届/.test(box));
  assert.ok(await page.isDisabled('#letter-seal'), '空では封をできない');
  await page.fill('#letter-text', '今のあなたへ。\nもう十分に、素晴らしいものを持っているよ。');
  await page.click('#letter-seal');
  assert.strictEqual(await page.textContent('#confirm-msg'), T2, '②の文');
  await page.click('#confirm-cancel');
  assert.ok(await page.isVisible('#letter-text'), '「やめる」なら封をしない');
  await page.click('#letter-seal');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /封をしました/.test(document.querySelector('.letter-box').textContent));
  assert.match(await page.textContent('.letter-box'), /未来のあなたからの手紙は、\d+月\d+日 \d+時ごろに届きます/);
  assert.strictEqual(await page.locator('#letter-text').count(), 0);
  assert.ok(!(await page.content()).includes('素晴らしいものを持っているよ'), '封のあとは画面のどこにも中身を出さない');
  await waitSaved(page);
  const s = await stored(page);
  assert.ok(s.futureLetter.sealed_at);
  assert.ok(s.futureLetter.sealed_trusted_at, 'サーバー時刻を封の基準に残す');
  assert.strictEqual(s.futureLetter.opened_at, null);
  await context.close();
});

test('P3 手紙：封から7日間は、どの画面からも開けない。端末の日付を進めても開かない', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await writeAndSeal(page, '7日間は開かない手紙');
  // 6日23時間後（サーバー時刻）：Day 7・14・21、手紙の画面、ホームのどこにも開くボタンが無い
  const sealed = Date.parse((await stored(page)).futureLetter.sealed_trusted_at);
  await setServerTime(page, sealed + 7 * DAY - 60 * 60 * 1000);
  for (const d of [7, 14, 21]) {
    await page.goto(base + '#/day/' + d + '/5');
    const t = await letterState(page);
    assert.match(t, /封をしたまま[\s\S]*封をしてから7日後/, 'Day' + d);
    assert.strictEqual(await page.locator('#letter-open').count(), 0, 'Day' + d + ' に開くボタンがある');
  }
  await page.goto(base + '#/letter');
  assert.match(await letterState(page), /封をしてから7日後/);
  assert.strictEqual(await page.locator('#letter-open').count(), 0);
  await page.goto(base + '#/');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('.letter-arrived').count(), 0);
  // 端末の日付を30日進めても（サーバー時刻は変わらない）開かない
  await page.clock.install({ time: Date.now() + 30 * DAY });
  await page.reload();
  await page.goto(base + '#/day/7/5');
  assert.match(await letterState(page), /封をしたまま/);
  assert.strictEqual(await page.locator('#letter-open').count(), 0);
  // 画面の部品を書き換えて開封の処理を呼んでも、保存の層で断る
  const forced = await page.evaluate(() => window.MichiruTestHook ? null : 'no-hook');
  assert.strictEqual(forced, 'no-hook', 'テスト用の抜け道を作っていない');
  assert.ok(!(await page.content()).includes('7日間は開かない手紙'));
  assert.strictEqual((await stored(page)).futureLetter.opened_at, null);
  await context.close();
  serverNow = null;
});

test('P3 手紙：7日たつと届く（③）。開けずに取っておける。開くと④になり、Day 14・21 で同じ手紙を振り返れる', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await writeAndSeal(page, '今のあなたへ。\nどんな日でも、ここに戻ってきていいよ。');
  const sealed = Date.parse((await stored(page)).futureLetter.sealed_trusted_at);
  await setServerTime(page, sealed + 7 * DAY + 60 * 1000);
  // ホームに届いた知らせ
  await page.goto(base + '#/');
  await page.waitForSelector('.letter-arrived');
  assert.strictEqual((await page.textContent('.letter-arrived')).trim(), '✉ ' + T3);
  // Day 07：③。開けずに取っておく
  await page.goto(base + '#/day/7/5');
  let t = await letterState(page);
  assert.ok(t.includes(T3) && t.includes(T3b), '③の文');
  assert.ok(!(await page.isVisible('.letter-quote')));
  await page.click('#letter-skip');
  assert.strictEqual(await page.locator('#letter-skip').count(), 0);
  assert.ok(await page.isVisible('#letter-open'), '取っておいた後も開ける');
  assert.strictEqual((await stored(page)).futureLetter.opened_at, null);
  // Day 14 で開く
  await page.goto(base + '#/day/14/5');
  await letterState(page);
  await page.click('#letter-open');
  await page.waitForSelector('.letter-quote');
  assert.match(await page.textContent('.letter-quote'), /ここに戻ってきていいよ/);
  assert.ok((await page.textContent('#letter-read')).includes(T4), '④の文');
  await page.fill('#letter-reply', '14日目に感じたこと');
  await waitSaved(page);
  let s = await stored(page);
  assert.ok(Date.parse(s.futureLetter.opened_at) >= sealed + 7 * DAY);
  // Day 21：同じ手紙を振り返る（取っておく選択肢は出ない）
  await page.goto(base + '#/day/21/5');
  t = await letterState(page);
  assert.ok(t.includes(T4));
  assert.strictEqual(await page.locator('#letter-skip').count(), 0);
  await page.click('#letter-open');
  await page.fill('#letter-reply', '21日目に感じたこと');
  await waitSaved(page);
  // 一度開いたら、通信できなくても・時刻を確かめられなくても読み返せる
  await context.setOffline(true);
  await page.goto(base + '#/letter');
  await letterState(page);
  await page.click('#letter-open');
  assert.match(await page.textContent('.letter-quote'), /ここに戻ってきていいよ/);
  assert.match(await page.textContent('main'), /Day 14[\s\S]*14日目に感じたこと[\s\S]*Day 21[\s\S]*21日目に感じたこと/);
  await context.setOffline(false);
  // Day 01 では④
  await page.goto(base + '#/day/1/5');
  assert.ok((await page.textContent('.letter-box')).includes(T4));
  await context.close();
  serverNow = null;
});

test('P3 手紙：通信できないとき・端末の時計を戻して封をしたときも、早く開かない', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await writeAndSeal(page, '早く開かない手紙');
  const sealed = Date.parse((await stored(page)).futureLetter.sealed_trusted_at);
  // 7日たっていても、時刻を確かめられない（時刻の問い合わせが通信できない）ときは開かない
  await page.route('**/*clock=*', (route) => route.abort());
  serverNow = sealed + 8 * DAY;
  await page.reload();
  for (const d of [7, 14]) {
    await page.goto(base + '#/day/' + d + '/5');
    const t = await letterState(page);
    assert.match(t, /通信できるときに確かめます/, 'Day' + d);
    assert.strictEqual(await page.locator('#letter-open').count(), 0);
  }
  // 端末の日付を進めても同じ
  await page.clock.install({ time: Date.now() + 30 * DAY });
  await page.reload();
  await page.goto(base + '#/day/7/5');
  assert.match(await letterState(page), /通信できるときに確かめます/);
  assert.strictEqual((await stored(page)).futureLetter.opened_at, null);
  // 通信が戻れば、7日たっているので届く
  await page.unroute('**/*clock=*');
  await page.reload();
  await page.goto(base + '#/day/7/5');
  assert.ok((await letterState(page)).includes(T3));
  await context.close();

  // 端末の時計を30日戻した状態で、通信できないまま封をした：端末の時刻の最大値を使うので、封の時刻は戻らない
  serverNow = null;
  const b = await newPage();
  await consent(b.page);
  await b.page.goto(base + '#/');
  await b.page.waitForTimeout(200);
  const maxSeen = Date.parse((await stored(b.page)).clock.maxSeen);
  await b.page.clock.install({ time: Date.now() - 30 * DAY });
  await b.page.reload();
  await b.context.setOffline(true);
  await b.page.goto(base + '#/day/1/5');
  await openLetterWriter(b.page);
  await b.page.fill('#letter-text', '時計を戻して書いた手紙');
  await b.page.click('#letter-seal');
  await b.page.click('#confirm-ok');
  await b.page.waitForFunction(() => /封をしました/.test(document.querySelector('.letter-box').textContent));
  await waitSaved(b.page);
  const s = await stored(b.page);
  assert.strictEqual(s.futureLetter.sealed_trusted_at, null, '通信できないときはサーバー時刻なし');
  assert.ok(Date.parse(s.futureLetter.sealed_at) >= maxSeen, '封の時刻が戻っていない');
  await b.context.setOffline(false);
  await b.page.clock.setSystemTime(Date.now() + 30 * DAY);
  // 本当の時刻で6日後：まだ開かない
  await setServerTime(b.page, Date.parse(s.futureLetter.sealed_at) + 6 * DAY);
  await b.page.goto(base + '#/day/7/5');
  assert.match(await letterState(b.page), /封をしてから7日後/);
  await b.context.close();
  serverNow = null;
});

test('P3 手紙：バックアップの復元・壊れた保存で、意図せず開封済みにならない', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await writeAndSeal(page, '守られる手紙');
  await page.goto(base + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const data = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  assert.ok(data.futureLetter.sealed_trusted_at);
  const sealed = Date.parse(data.futureLetter.sealed_trusted_at);
  async function restore(obj) {
    await page.goto(base + '#/settings');
    await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
    await page.click('#confirm-ok');
    await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
    return stored(page);
  }
  const cases = [
    ['封から7日未満の開封日時', Object.assign({}, data.futureLetter, { opened_at: new Date(sealed + 1000).toISOString() })],
    ['開封日時が壊れている', Object.assign({}, data.futureLetter, { opened_at: 'きのう' })],
    ['開封日時が数値', Object.assign({}, data.futureLetter, { opened_at: 12345 })],
    ['封の日時が壊れている', Object.assign({}, data.futureLetter, { sealed_at: 'abc', sealed_trusted_at: 'abc', opened_at: new Date(sealed + 8 * DAY).toISOString() })],
    ['封の無い手紙に開封日時だけ', { text: '守られる手紙', written_at: data.futureLetter.written_at, opened_at: new Date(sealed + 8 * DAY).toISOString() }],
  ];
  for (const [name, fl] of cases) {
    const s = await restore(Object.assign({}, data, { futureLetter: fl }));
    assert.strictEqual(s.futureLetter.opened_at, null, name);
    await page.goto(base + '#/letter');
    await page.waitForTimeout(300);
    assert.ok(!(await page.content()).includes('守られる手紙') || name.includes('封の'), name + '：中身が見える');
  }
  // 封の時刻が未来（端末の時計が進んでいた等）：その分、長く封をしたまま
  let s = await restore(Object.assign({}, data, { futureLetter: Object.assign({}, data.futureLetter, { sealed_trusted_at: new Date(sealed + 30 * DAY).toISOString(), opened_at: null }) }));
  await setServerTime(page, sealed + 8 * DAY);
  await page.goto(base + '#/day/7/5');
  assert.match(await letterState(page), /封をしてから7日後/);
  // 正しく開封された記録の復元は、開封済みのまま
  serverNow = null;
  await page.reload();
  s = await restore(Object.assign({}, data, { futureLetter: Object.assign({}, data.futureLetter, { opened_at: new Date(sealed + 7 * DAY + 5000).toISOString() }) }));
  assert.ok(s.futureLetter.opened_at);
  await page.goto(base + '#/letter');
  await letterState(page);
  assert.ok((await page.textContent('#letter-read')).includes(T4));
  // 端末に保存された記録そのものが壊れていた場合も、開封済みにならない
  // （画面を閉じるときの保存で上書きされないよう、画面を閉じてから、アプリが動く前に保存を書き換える）
  await page.close();
  await context.addInitScript((sealedIso) => {
    if (sessionStorage.getItem('tampered')) return;
    sessionStorage.setItem('tampered', '1');
    const st = JSON.parse(localStorage.getItem('michiru21.v1'));
    st.futureLetter.opened_at = new Date(Date.parse(sealedIso) + 1000).toISOString();
    localStorage.setItem('michiru21.v1', JSON.stringify(st));
  }, data.futureLetter.sealed_trusted_at);
  const p2 = await context.newPage();
  await p2.goto(base + '#/letter');
  await letterState(p2);
  assert.strictEqual(await p2.locator('.letter-quote').count(), 0);
  assert.ok(!(await p2.textContent('#letter-read')).includes(T4));
  assert.match(await p2.textContent('#letter-read'), /封をしてから7日後/);
  await context.close();
});

test('P3 以前の試作で書いた「21日後の私へ」の手紙は、消さずに別枠で読めるだけ（未来からの手紙として扱わない）', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  const old = { app: 'michiru-21days', schema: 1, consentedAt: new Date().toISOString(), settings: { fontSize: 'm' }, progress: { startedAt: null, lastOpenDay: 7 }, entries: {},
    letter: { text: '21日後の私へ。がんばってね', written_at: '2026-10-30T10:00:00.000Z', updated_at: '2026-10-30T10:00:00.000Z' },
    letterReplies: { 7: { text: '読んだよ', updated_at: '2026-10-30T11:00:00.000Z' } }, letterSkipped: { 14: true } };
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', { name: 'p3-old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
  const s = await stored(page);
  assert.strictEqual(s.letter.text, '21日後の私へ。がんばってね', '以前の手紙を消さない');
  assert.strictEqual(s.letterReplies[7].text, '読んだよ');
  assert.strictEqual(s.futureLetter, null, '未来からの手紙に入れ替えない');
  // Day 07 に「未来から届いた」とは出さない
  await page.goto(base + '#/day/7/5');
  assert.strictEqual(await page.locator('#letter-read').count(), 0);
  // 手紙の画面では、以前の形式として別枠（折りたたみ）で読める
  await page.goto(base + '#/letter');
  await page.waitForSelector('.letter-box.legacy');
  assert.match(await page.textContent('main'), /手紙はまだありません/);
  assert.match(await page.textContent('.letter-box.legacy summary'), /以前の形式で書いた手紙/);
  await page.click('.letter-box.legacy summary');
  assert.match(await page.textContent('.letter-box.legacy'), /がんばってね[\s\S]*Day 07[\s\S]*読んだよ/);
  await context.close();
});

test('P2・P3 バックアップ・全削除・古いバックアップとの互換', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/1/5');
  await openLetterWriter(page);
  await page.fill('#letter-text', 'バックアップする未来からの手紙');
  await page.fill('#disc-text', 'バックアップする発見');
  await page.click('#disc-add');
  await waitSaved(page);
  await page.goto(base + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const file = await dl.path();
  const data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  assert.strictEqual(data.futureLetter.text, 'バックアップする未来からの手紙');
  assert.strictEqual(data.discoveries[0].text, 'バックアップする発見');
  // 全削除で、発見と手紙も消える
  await page.click('#delete-all');
  await page.click('#confirm-ok');
  await page.waitForSelector('#agree');
  let s = await stored(page);
  assert.deepStrictEqual(s.discoveries, []);
  assert.strictEqual(s.futureLetter, null);
  // バックアップから戻すと、発見と手紙も戻る
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', file);
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
  s = await stored(page);
  assert.strictEqual(s.futureLetter.text, 'バックアップする未来からの手紙');
  assert.strictEqual(s.discoveries[0].text, 'バックアップする発見');
  // この機能を足す前の形式のバックアップ（discoveries・letter が無い）も読み込める
  const old = { app: 'michiru-21days', schema: 1, consentedAt: new Date().toISOString(), settings: { fontSize: 'm' }, progress: { startedAt: null, lastOpenDay: 3 },
    entries: { 3: { answers: ['前の版の記録'], completed_at: null, updated_at: new Date().toISOString() } } };
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻しました/.test(document.getElementById('import-msg').textContent));
  s = await stored(page);
  assert.strictEqual(s.entries[3].answers[0], '前の版の記録');
  assert.deepStrictEqual(s.discoveries, []);
  assert.strictEqual(s.futureLetter, null);
  assert.strictEqual(s.letter, null);
  await page.goto(base + '#/discoveries');
  assert.match(await page.textContent('main'), /まだありません/);
  await context.close();
});

// ---------- 2026-10-31 の修正 ----------
test('気分：画面を送るときに指が触れただけでは記録しない。軽く押せば初期位置のまま記録できる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/2/1');
  // 押し始めただけ（スクロールの始まり）では記録しない
  await page.dispatchEvent('#mood-am', 'pointerdown');
  await page.waitForTimeout(500);
  assert.strictEqual(await page.textContent('#mood-am-out'), '未記録');
  // 押して離す（タップ）と、初期位置のまま記録する
  await page.dispatchEvent('#mood-am', 'click');
  assert.strictEqual(await page.textContent('#mood-am-out'), '5');
  await waitSaved(page);
  assert.strictEqual((await stored(page)).entries[2].mood_am, 5);
  await context.close();
});

test('私の発見：残す前の書きかけは、画面を移っても消えない。残すと消える', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/4/5');
  await page.fill('#disc-text', '書きかけの発見');
  await waitSaved(page);
  await page.goto(base + '#/');
  await page.reload();
  await page.goto(base + '#/day/4/5');
  assert.strictEqual(await page.inputValue('#disc-text'), '書きかけの発見');
  await page.click('#disc-add');
  await waitSaved(page);
  await page.goto(base + '#/');
  await page.goto(base + '#/day/4/5');
  assert.strictEqual(await page.inputValue('#disc-text'), '');
  const s = await stored(page);
  assert.deepStrictEqual(s.drafts, {});
  assert.strictEqual(s.discoveries[0].text, '書きかけの発見');
  await context.close();
});

test('復元：記録の入っていないファイルでは上書きしない。確認でファイルといまの記録の件数を見せる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/6/3');
  await page.fill('#ans-0', '消えてはいけない記録');
  await waitSaved(page);
  await page.goto(base + '#/settings');
  const empty = { app: 'michiru-21days', schema: 1, consentedAt: null, settings: { fontSize: 'm' }, progress: { startedAt: null, lastOpenDay: 1 }, entries: {} };
  await page.setInputFiles('#import-file', { name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await page.waitForFunction(() => /記録が入っていないため/.test(document.getElementById('import-msg').textContent));
  assert.strictEqual(await page.locator('[role="alertdialog"]').count(), 0);
  assert.strictEqual((await stored(page)).entries[6].answers[0], '消えてはいけない記録');
  // 中身のあるファイル：件数と保存日を確認で見せる。「やめる」なら何も変わらない
  const full = Object.assign({}, empty, { exportedAt: '2026-10-29T09:00:00.000Z', entries: { 1: { answers: ['a'] }, 2: { mood_am: 3 } }, discoveries: [{ id: 'x', day: 1, text: 'b', created_at: '2026-10-29T09:00:00.000Z' }] });
  await page.setInputFiles('#import-file', { name: 'full.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(full)) });
  await page.waitForSelector('[role="alertdialog"]');
  const msg = await page.textContent('#confirm-msg');
  assert.match(msg, /2026\/10\/29 に保存/);
  assert.match(msg, /ファイル.*日々の記録 2日分・私の発見 1件・手紙 なし/);
  assert.match(msg, /いまの記録：日々の記録 1日分・私の発見 0件・手紙 なし/);
  await page.click('#confirm-cancel');
  assert.strictEqual((await stored(page)).entries[6].answers[0], '消えてはいけない記録');
  await context.close();
});

test('P3 未来からの手紙：書く前に33秒または感謝の瞑想で心を整える。「答えから見る」の解説がある', { skip }, async () => {
  const { context, page } = await newPage();
  await page.clock.install();
  await consent(page);
  await page.goto(base + '#/day/1/5');
  await page.click('.letter-box summary');
  // 書く欄は、心を整えるまで（または「瞑想をせずに書く」まで）出さない
  assert.ok(await page.isVisible('#prep-title'));
  assert.ok(!(await page.isVisible('#letter-text')));
  // 解説：「答えから見る」
  await page.click('.answer-view summary');
  assert.match(await page.textContent('.answer-view'), /望んだ未来がすでにかなった場所に立って、そこから今を見る/);
  // 感謝の瞑想（約1分）：途中は書く欄が出ず、60秒で終わると出る
  await page.click('#prep-thanks');
  assert.match(await page.textContent('#prep-guide'), /息をして/);
  await page.clock.runFor(31000);
  assert.match(await page.textContent('#prep-guide'), /満たされて、心から「ありがとう」と感じているあなた/);
  assert.ok(!(await page.isVisible('#letter-text')));
  await page.click('#prep-pause');
  await page.clock.runFor(20000);
  assert.match(await page.textContent('#prep-guide'), /一時停止中/);
  await page.click('#prep-resume');
  await page.clock.runFor(30000);
  assert.ok(await page.isVisible('#letter-text'));
  assert.match(await page.textContent('#prep-done'), /満たされた感覚のまま/);
  // 33秒の静かな時間でも整えられる（別の日に開き直す）
  await page.goto(base + '#/');
  await page.goto(base + '#/day/1/5');
  await page.click('.letter-box summary');
  assert.ok(!(await page.isVisible('#letter-text')), '画面を移ると、もう一度整えるところから');
  await page.click('#prep-33');
  await page.clock.runFor(32000);
  assert.ok(!(await page.isVisible('#letter-text')));
  await page.clock.runFor(1500);
  assert.ok(await page.isVisible('#letter-text'));
  // 途中で「終える」でも書ける。瞑想をせずに書くこともできる（強制しない）
  await page.goto(base + '#/');
  await page.goto(base + '#/day/1/5');
  await page.click('.letter-box summary');
  await page.click('#prep-thanks');
  await page.click('#prep-stop');
  assert.ok(await page.isVisible('#letter-text'));
  await page.goto(base + '#/');
  await page.goto(base + '#/day/1/5');
  await page.click('.letter-box summary');
  await page.click('#prep-skip');
  assert.ok(await page.isVisible('#letter-text'));
  // 書きかけがあれば、次に開いたときはすぐ書ける
  await page.fill('#letter-text', '書きかけ');
  await waitSaved(page);
  await page.goto(base + '#/');
  await page.goto(base + '#/day/1/5');
  assert.ok(await page.isVisible('#letter-text'));
  await context.close();
});

test('P3 手紙：通信できないまま、端末の時計が進んだ状態で封をしても、通信が戻れば今のサーバー時刻から7日', { skip }, async () => {
  serverNow = null;
  const { context, page } = await newPage();
  await consent(page);
  await page.clock.install({ time: Date.now() + 60 * DAY }); // 端末の時計が60日進んでいる
  await page.reload();
  await page.route('**/*clock=*', (route) => route.abort()); // 時刻を確かめられない
  await writeAndSeal(page, '時計が進んでいた手紙');
  let s = await stored(page);
  assert.strictEqual(s.futureLetter.sealed_trusted_at, null);
  await page.unroute('**/*clock=*');
  const real = Date.now();
  serverNow = real;
  await page.reload();
  await page.goto(base + '#/day/7/5');
  assert.match(await letterState(page), /封をしてから7日後/);
  await waitSaved(page);
  s = await stored(page);
  const basis = Date.parse(s.futureLetter.sealed_trusted_at);
  assert.ok(Math.abs(basis - real) < 60 * 1000, '基準が今のサーバー時刻に寄った');
  // 7日後に届く（60日待たなくてよい）。7日より前は届かない
  await setServerTime(page, basis + 7 * DAY - 1000);
  await page.goto(base + '#/day/7/5');
  assert.match(await letterState(page), /封をしてから7日後/);
  await setServerTime(page, basis + 7 * DAY + 1000);
  await page.goto(base + '#/day/7/5');
  assert.ok((await letterState(page)).includes(T3));
  await context.close();
  serverNow = null;
});

test('P3 手紙：書く前の「未来の自分の心を体感する」誘導が、瞑想のあとに出る', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/1/5');
  await page.click('.letter-box summary');
  assert.ok(!(await page.isVisible('.future-feel')));
  await page.click('#prep-thanks');
  await page.click('#prep-stop');
  assert.match(await page.textContent('.future-feel'), /21日間を歩き終えたあなたは、どんな表情をしていますか。[\s\S]*その心のまま、今のあなたを見てみましょう。/);
  await context.close();
});


// ---------- ミニ解説（今日の小さな理由） ----------
test('EXPL-01・02 21日すべてのワークの前に「今日の小さな理由」が出る。閉じてもすぐワークできる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  const g = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'content', 'mini-guides.draft.json'), 'utf8'));
  for (let n = 1; n <= 21; n++) {
    await page.goto(base + '#/day/' + n + '/3');
    await page.waitForSelector('.mini-guide');
    // 順番：ミニ解説 → 今日のお話 → 問い
    const order = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.mini-guide, .story, textarea'));
      return els.slice(0, 3).map((e) => e.className || e.tagName);
    });
    assert.deepStrictEqual(order, ['mini-guide', 'story', 'TEXTAREA'], 'Day' + n);
    assert.ok((await page.textContent('.mini-guide')).includes(g.days[n]), 'Day' + n + ' の文');
  }
  await page.goto(base + '#/day/2/3');
  assert.match(await page.textContent('.mini-guide summary'), /今日の小さな理由/);
  await page.click('.mini-guide summary');
  assert.ok(!(await page.isVisible('.mini-guide p')));
  await page.fill('#ans-0', '閉じたまま書ける');
  await waitSaved(page);
  assert.strictEqual((await stored(page)).entries[2].answers[0], '閉じたまま書ける');
  await context.close();
});

// ---------- 保存できないとき（DATA-FAIL） ----------
async function failingPage() {
  const x = await newPage();
  // window.__failSave = true のあいだ、端末への書き込みを失敗させる（容量不足などのまね）
  await x.context.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (window.__failSave && k === 'michiru21.v1') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      return orig.call(this, k, v);
    };
    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      if (window.__failRemove && k === 'michiru21.v1') throw new Error('SecurityError');
      return origRemove.call(this, k);
    };
  });
  return x;
}

test('DATA-FAIL 保存に失敗したら「保存しました」と出さない（入力・1日削除・全削除）', { skip }, async () => {
  const { context, page } = await failingPage();
  await consent(page);
  await page.goto(base + '#/day/3/3');
  await page.fill('#ans-0', '保存できた記録');
  await waitSaved(page);
  await page.evaluate(() => { window.__failSave = true; });
  // 入力：保存できないことを知らせる
  await page.fill('#ans-0', '保存できない記録');
  await page.waitForFunction(() => document.getElementById('save-status').getAttribute('data-state') === 'error');
  assert.match(await page.textContent('#save-status'), /保存できませんでした/);
  assert.ok(!/ここまでの記録は、この端末に保存されます/.test(await page.textContent('.pause-link')), '中断の案内でも保存済みと言わない');
  // 1日削除：失敗したら記録の一覧に戻らず、保存済みと出さない
  await page.goto(base + '#/records/3');
  await page.click('#del-day');
  await page.click('#confirm-ok');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.getAttribute('#save-status', 'data-state'), 'error');
  assert.ok(page.url().endsWith('#/records/3'));
  // 全削除：消すことも書くこともできなかったら、最初の画面に移らない
  await page.evaluate(() => { window.__failRemove = true; });
  await page.goto(base + '#/settings');
  await page.click('#delete-all');
  await page.click('#confirm-ok');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.getAttribute('#save-status', 'data-state'), 'error');
  assert.ok(page.url().endsWith('#/settings'));
  // 端末に残っているのは、最後に保存できた内容
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('michiru21.v1')));
  assert.strictEqual(s.entries[3].answers[0], '保存できた記録');
  // 書き込めるようになれば、次の保存で「保存しました」に戻る
  await page.evaluate(() => { window.__failSave = false; window.__failRemove = false; });
  await page.goto(base + '#/day/4/3');
  await page.fill('#ans-0', 'また保存できる');
  await waitSaved(page);
  await context.close();
});

test('DATA-FAIL 手紙：保存に失敗したら、封をしたことにも開封したことにもならない', { skip }, async () => {
  serverNow = null;
  const { context, page } = await failingPage();
  await consent(page);
  await page.goto(base + '#/day/1/5');
  await openLetterWriter(page);
  await page.fill('#letter-text', '保存できないときの手紙');
  await waitSaved(page);
  await page.evaluate(() => { window.__failSave = true; });
  await page.click('#letter-seal');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /封をしていません/.test(document.getElementById('seal-msg').textContent));
  assert.ok(await page.isVisible('#letter-text'), '書く欄のまま');
  assert.ok(!/封をしました/.test(await page.textContent('.letter-box')));
  // 書き込めるようになってから封をする
  await page.evaluate(() => { window.__failSave = false; });
  await page.click('#letter-seal');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /封をしました/.test(document.querySelector('.letter-box').textContent));
  await waitSaved(page);
  const sealed = Date.parse((await stored(page)).futureLetter.sealed_trusted_at);
  // 7日後：開封の保存に失敗したら、開封済みにしない
  await setServerTime(page, sealed + 8 * DAY);
  await page.goto(base + '#/day/7/5');
  await letterState(page);
  await page.evaluate(() => { window.__failSave = true; });
  await page.click('#letter-open');
  await page.waitForSelector('.warn-msg');
  assert.match(await page.textContent('#letter-read'), /まだ開封していません/);
  assert.strictEqual(await page.locator('.letter-quote').count(), 0);
  await page.evaluate(() => { window.__failSave = false; });
  await page.click('#letter-open');
  await page.waitForSelector('.letter-quote');
  await context.close();
  serverNow = null;
});

// ---------- クリームイエロー＋21日の花 ----------
const FLOWER_NAMES = ['マーガレット', 'チューリップ', 'コスモス', 'ミモザ', 'ガーベラ', 'ひまわり', 'すずらん', 'デイジー', 'ラナンキュラス', 'フリージア',
  'カモミール', 'スイートピー', 'スミレ', 'ポピー', 'ジャスミン', 'アネモネ', 'ネモフィラ', 'ダリア', 'カスミソウ', 'キンモクセイ', '黄金色のバラ'];

test('FLOWER-01・02 21日すべて違う花が、その日の画面と一覧に出る（名前は文字で読める）', { skip }, async () => {
  assert.strictEqual(new Set(FLOWER_NAMES).size, 21);
  const { context, page, errors } = await newPage();
  await consent(page);
  for (let n = 1; n <= 21; n++) {
    await page.goto(base + '#/day/' + n + '/1');
    await page.waitForSelector('.head-flower');
    assert.strictEqual((await page.textContent('.head-flower .flower-name')).trim(), FLOWER_NAMES[n - 1], 'Day' + n);
    assert.strictEqual(await page.locator('.head-flower svg[aria-hidden="true"]').count(), 1, '絵は読み上げない');
  }
  await page.goto(base + '#/');
  await page.waitForSelector('.day-list');
  assert.strictEqual(await page.locator('.day-card .card-flower svg').count(), 21);
  assert.deepStrictEqual(errors, []);
  await context.close();
});

test('FLOWER-03 今日の扉：花・Day・テーマ・今日の小さな理由・今日の実践・目安が最初の画面にあり、扉のボタンが画面内に見える', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/5/1');
  await page.goto(base + '#/');
  await page.waitForSelector('.daily-door');
  const t = await page.textContent('.daily-door');
  assert.match(t, /DAY 05 \/ 21[\s\S]*今日の花：ガーベラ[\s\S]*今日のテーマ：身近な人の美点[\s\S]*目安 10〜15分[\s\S]*相手をほめる言葉を探すのではなく[\s\S]*今日の小さな実践[\s\S]*ノートに三つ書く/);
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('#door-open').boundingBox();
  assert.ok(box.y + box.height <= 800, '扉のボタンが最初の画面（高さ800px）に入る：' + box.y);
  await context.close();
});

test('FLOWER-07 「視差効果を減らす」設定では花を動かさない', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await consent(page);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.door-flower .flower')).animationName);
  assert.strictEqual(anim, 'none');
  await context.close();
  const b = await newPage();
  await consent(b.page);
  assert.strictEqual(await b.page.evaluate(() => getComputedStyle(document.querySelector('.door-flower .flower')).animationName), 'flower-sway');
  await b.context.close();
});

test('FLOWER-08 花の表示は記録・保存の形に影響しない', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  await page.goto(base + '#/day/3/3');
  await page.fill('#ans-0', 'デザインと関係ない記録');
  await waitSaved(page);
  const s = await stored(page);
  assert.ok(!/flower|花/.test(JSON.stringify(s)), '保存に花の情報が入っていない');
  await context.close();
});

test('読みやすさ：主な文字と背景の明るさの差（WCAG 4.5:1 以上）', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  const pairs = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const hex = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255); };
    const lum = (h) => { const c = hex(h).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bg = v('--beige'), card = v('--white'), light = v('--beige-deep');
    return {
      '本文/背景': ratio(v('--ink'), bg), '本文/カード': ratio(v('--ink'), card), '補助/背景': ratio(v('--muted'), bg), '補助/淡黄': ratio(v('--muted'), light),
      '緑の文字/カード': ratio(v('--green'), card), 'ボタン白文字/緑': ratio(card, v('--green')), '金茶/背景': ratio(v('--gold'), bg),
    };
  });
  for (const [k, r] of Object.entries(pairs)) assert.ok(r >= 4.5, k + ' = ' + r.toFixed(2));
  await context.close();
});

test('DATA-FAIL 復元：保存に失敗したら戻さず、いまの記録をそのまま残す', { skip }, async () => {
  const { context, page } = await failingPage();
  await consent(page);
  await page.goto(base + '#/day/6/3');
  await page.fill('#ans-0', 'いまの記録');
  await waitSaved(page);
  await page.evaluate(() => { window.__failSave = true; });
  const other = { app: 'michiru-21days', schema: 1, consentedAt: new Date().toISOString(), settings: { fontSize: 'm' }, progress: { startedAt: null, lastOpenDay: 1 }, entries: { 1: { answers: ['ファイルの記録'] } } };
  await page.goto(base + '#/settings');
  await page.setInputFiles('#import-file', { name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
  await page.click('#confirm-ok');
  await page.waitForFunction(() => /戻せませんでした/.test(document.getElementById('import-msg').textContent));
  await page.evaluate(() => { window.__failSave = false; });
  await page.goto(base + '#/day/6/3');
  assert.strictEqual(await page.inputValue('#ans-0'), 'いまの記録', '画面の記録も元のまま');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('michiru21.v1')));
  assert.strictEqual(s.entries[6].answers[0], 'いまの記録');
  assert.ok(!s.entries[1]);
  await context.close();
});
