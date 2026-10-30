// 試作版の受け入れテスト（実際のブラウザで操作する）。T01〜T27 のうち画面にかかわるもの。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createStaticServer } = require('../tools/static-server');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = chromium ? false : 'playwright が見つからないため省略';

let server, base, browser;

test.before(async () => {
  if (skip) return;
  server = createStaticServer(path.join(__dirname, '..', 'app'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  const fs = require('fs');
  browser = await chromium.launch(fs.existsSync(EXEC) ? { executablePath: EXEC } : {});
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
  await page.click('a[href="#/day/15/1"]');
  await page.waitForFunction(() => location.hash === '#/day/15/1');
  await page.goto(base + '#/');
  const card = page.locator('a[href="#/day/1/1"]');
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
  for (const h of ['#/', '#/day/4/1', '#/day/4/2', '#/day/4/3', '#/day/4/4', '#/day/4/5', '#/records', '#/records/4', '#/compare', '#/complete', '#/settings', '#/intro']) {
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
  assert.match(await page.textContent('.home'), /前回の続き：Day 10/);
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
  for (const h of ['#/', '#/day/1/1', '#/day/1/2', '#/day/1/4', '#/day/1/5', '#/settings']) {
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
