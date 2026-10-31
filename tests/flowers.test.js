// 21日それぞれの花が欠けず、別々の名前で表示されることを守る回帰テスト。
// 正式原稿・花の割当・デザインは変更せず、現行仕様のみを検証する。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.readFileSync(path.join(__dirname, '../app/js/flowers.js'), 'utf8');
vm.runInNewContext(source, context, { filename: 'flowers.js' });
const flowers = context.window.MichiruFlowers;

test('21日間は毎日違う名前の花が用意されている', () => {
  assert.equal(flowers.count, 21);
  const names = Array.from({ length: 21 }, (_, index) => flowers.name(index + 1));
  names.forEach((name, index) => {
    assert.equal(typeof name, 'string', 'Day ' + (index + 1));
    assert.ok(name.trim().length > 0, 'Day ' + (index + 1) + ' の花名が空');
  });
  assert.equal(new Set(names).size, 21, '同じ花の名前が複数の日に割り当てられている');
});

test('21日すべてで外部画像を使わずSVGを描ける', () => {
  for (let day = 1; day <= 21; day++) {
    const svg = flowers.svg(day, 64);
    assert.match(svg, /^<svg class="flower" /, 'Day ' + day);
    assert.match(svg, /width="64" height="64"/, 'Day ' + day);
    assert.match(svg, /aria-hidden="true"/, 'Day ' + day);
    assert.match(svg, /<\/svg>$/, 'Day ' + day);
    assert.doesNotMatch(svg, /<image\b|<script\b|https?:\/\//i, 'Day ' + day + ' の外部依存');
  }
});

test('範囲外の日付では誤った花を表示しない', () => {
  for (const day of [0, 22, -1]) {
    assert.equal(flowers.name(day), '');
    assert.equal(flowers.svg(day), '');
  }
});
