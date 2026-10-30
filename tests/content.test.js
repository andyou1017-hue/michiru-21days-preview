// 教材データと公開ファイルの検査（T01・T13・T14・T26・T27）
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { publicContent, readSource } = require('../tools/build-content');

const ROOT = path.join(__dirname, '..');
const src = readSource();
const appFiles = ['index.html', 'js/app.js', 'js/store.js', 'js/timer.js', 'js/content.js', 'js/api.js', 'css/app.css']
  .map((f) => path.join(ROOT, 'app', f)).filter((f) => fs.existsSync(f));
const appText = appFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('T01 21日分の見出しと本文がすべてある', () => {
  assert.strictEqual(src.days.length, 21);
  src.days.forEach((d, i) => {
    assert.strictEqual(d.day, i + 1);
    for (const k of ['work_id', 'title', 'intro', 'action', 'reflection']) assert.ok(d[k] && d[k].trim(), `Day${d.day} の ${k}`);
    assert.ok(Array.isArray(d.prompts) && d.prompts.length >= 2, `Day${d.day} の問い`);
    d.prompts.forEach((p) => assert.ok(p.trim()));
  });
});

test('T13 Day5 と Day20 は同じワーク番号', () => {
  assert.strictEqual(src.days[4].work_id, src.days[19].work_id);
  assert.strictEqual(src.days[19].compare_with_day, 5);
});

test('content.js は教材データと一致している（生成し忘れがない）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'app', 'js', 'content.js'), 'utf8');
  const json = js.slice(js.indexOf('=') + 1).trim().replace(/;$/, '');
  assert.deepStrictEqual(JSON.parse(json), publicContent(src));
});

test('T14 受講者向けファイルに黄金版のメモ・出典を含めない', () => {
  assert.ok(!/gold_prompt|source_ref|license_status|編集用/.test(appText));
  assert.ok(!/黄金の心から|黄金の心の視点|集中指導下/.test(appText), '黄金版のメモが含まれている');
  const pub = JSON.stringify(publicContent(src));
  assert.ok(!/gold|source_ref/.test(pub));
});

test('T26 第三者の名前・固有表現を受講者向けファイルに含めない', () => {
  for (const w of ['佐藤康行', '真我', 'YSメソッド', 'YS', 'くまざわ', 'クリニック']) {
    assert.ok(!appText.includes(w), `「${w}」が含まれている`);
  }
});

test('T27 未承認の料金・治療効果を表示しない', () => {
  assert.ok(!/[0-9,０-９]+\s*円|¥|税込|税別/.test(appText), '料金の表示がある');
  for (const w of ['治る', '治ります', '改善します', '効果があります', '必ず変わ', '保証']) {
    assert.ok(!appText.includes(w), `「${w}」が含まれている`);
  }
});

test('内部用のファイル・本番サーバーのコードを、この公開リポジトリに置かない', () => {
  for (const f of ['content/editorial.internal.json', 'server', 'app/js/api.js']) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), f + ' がある');
  }
});

test('外部への送信先（分析ツール等）を含めない（T19）', () => {
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(appText.replace(/<!--[\s\S]*?-->/g, '')), '外部URLがある');
  assert.ok(!/gtag|google-analytics|googletagmanager|sendBeacon/.test(appText));
});
