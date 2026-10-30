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
    if (await page.isVisible('#complete')) await page.click('#complete');
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

// ---------- 未来からの手紙（P3） ----------
test('P3 未来からの手紙：Day01に「未来の自分から今の自分へ」書き、Day07・14・21で読むかどうかを選べる', { skip }, async () => {
  const { context, page } = await newPage();
  await consent(page);
  // 手紙がないうちは、Day 07 に何も出さない（書かなかったことを責めない）
  await page.goto(base + '#/day/7/5');
  assert.strictEqual(await page.locator('#letter-read').count(), 0);
  // Day 01：宛先と時間の向き（未来の自分 → 今の自分）が文言でわかる。任意・折りたたみ
  await page.goto(base + '#/day/1/5');
  assert.ok(!(await page.isVisible('#letter-text')));
  assert.match(await page.textContent('.letter-box summary'), /未来からの手紙/);
  await page.click('.letter-box summary');
  const box = await page.textContent('.letter-box');
  assert.match(box, /未来のあなたは、今のあなたに何を伝えたいでしょう。/);
  assert.match(box, /先のあなたになったつもりで、今日のあなたへ書いて/);
  assert.ok(!/21日後の私へ|未来の私へ|未来の自分へ/.test(box), '逆向き（今→未来）の文言が残っている');
  assert.strictEqual(await page.getAttribute('#letter-text', 'placeholder'), '今のあなたへ。');
  await page.fill('#letter-text', '今のあなたへ。\nどんな日でも、ここに戻ってきていいよ。');
  await waitSaved(page);
  let s = await stored(page);
  assert.strictEqual(s.futureLetter.text, '今のあなたへ。\nどんな日でも、ここに戻ってきていいよ。');
  assert.ok(s.futureLetter.written_at);
  assert.strictEqual(s.letter, null, '以前の形式の項目には書かない');
  // Day 05 には出ない
  await page.goto(base + '#/day/5/5');
  assert.strictEqual(await page.locator('#letter-read').count(), 0);
  // Day 07：未来のあなたから届いた手紙として案内。中身は本人が選ぶまで見せない
  await page.goto(base + '#/day/7/5');
  assert.match(await page.textContent('#letter-read'), /未来のあなたから、手紙が届いています/);
  assert.ok(!(await page.isVisible('.letter-quote')));
  await page.click('#letter-skip');
  assert.match(await page.textContent('#letter-read'), /今は読まないことにしました/);
  await waitSaved(page);
  assert.strictEqual((await stored(page)).futureSkipped[7], true);
  // あとから読める。受け取った今のあなたから、ひとことを書ける
  await page.click('#letter-open');
  assert.match(await page.textContent('.letter-quote'), /ここに戻ってきていいよ/);
  assert.match(await page.textContent('#letter-body'), /未来のあなたになって書いた手紙/);
  assert.match(await page.textContent('label[for="letter-reply"]'), /手紙を受け取った今のあなたから/);
  await page.fill('#letter-reply', 'ありがとう。受け取ったよ');
  await waitSaved(page);
  s = await stored(page);
  assert.ok(!s.futureSkipped[7]);
  assert.strictEqual(s.futureReplies[7].text, 'ありがとう。受け取ったよ');
  // Day 14・21 でも選べる
  for (const d of [14, 21]) {
    await page.goto(base + '#/day/' + d + '/5');
    assert.ok(await page.isVisible('#letter-open'), 'Day' + d);
  }
  // 手紙の画面：未来からの手紙と、受け取った今のあなたからのひとこと
  await page.goto(base + '#/letter');
  const t = await page.textContent('main');
  assert.match(t, /未来からの手紙[\s\S]*ここに戻ってきていいよ[\s\S]*Day 07[\s\S]*受け取ったよ/);
  assert.ok(!/21日後の私へ|以前の形式/.test(t));
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
  await page.click('.letter-box summary');
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
