'use strict';
// 受講生向けの基本体験を守る回帰テスト。正式教材・原文は書き換えない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScripts(paths) {
  const context = { window: {} };
  for (const file of paths) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context.window;
}

test('21日すべてに別の花とミニ解説があり、教材の並びが欠けない', () => {
  const w = loadScripts(['app/js/content.js', 'app/js/flowers.js']);
  const days = w.MICHIRU_CONTENT.days;
  const guides = w.MICHIRU_CONTENT.mini_guides.days;
  assert.equal(days.length, 21);
  assert.equal(w.MichiruFlowers.count, 21);
  assert.deepEqual(Array.from(days, d => d.day), Array.from({ length: 21 }, (_, i) => i + 1));
  const names = days.map(d => w.MichiruFlowers.name(d.day));
  assert.equal(new Set(names).size, 21, '花は21日すべて異なる');
  for (const day of days) {
    assert.ok(typeof guides[day.day] === 'string' && guides[day.day].trim(), 'Day ' + day.day + ' にミニ解説が必要');
    assert.ok(w.MichiruFlowers.svg(day.day, 96).includes('<svg'), 'Day ' + day.day + ' の花を描画できる');
  }
});

test('最高の未来の瞑想は原文の7段階・33秒の無言3回を維持', () => {
  const w = loadScripts(['app/js/future-guidance.js']);
  const sections = w.MichiruFutureGuidance.sections;
  assert.equal(sections.length, 7);
  assert.deepEqual(Array.from(sections, s => s.silence || 0), [0, 0, 33, 33, 33, 0, 0]);
  assert.equal(sections[0].title, '① 心と身体を整える');
  assert.equal(sections[6].title, '⑦ 書き出し');
  assert.equal(sections[6].text[0], '今、感じた最高の未来の気持ちを書いてみましょう。');
});

test('命の瞑想は独立した33秒の鼓動ワークとして適用される', () => {
  const w = loadScripts(['app/js/content.js', 'app/js/life-meditation.js', 'app/js/future-guidance.js']);
  const sectionsBefore = JSON.stringify(w.MichiruFutureGuidance.sections);
  const content = w.MichiruLifeMeditation.apply(w.MICHIRU_CONTENT);
  assert.equal(content.meditation.seconds, 33);
  assert.equal(content.meditation.phases.length, 3);
  assert.equal(content.meditation.phases[0].from, 0);
  assert.equal(content.meditation.phases[2].to, 33);
  assert.ok(content.meditation.phases.some(p => /脈|鼓動/.test(p.text)));
  assert.equal(JSON.stringify(w.MichiruFutureGuidance.sections), sectionsBefore, '最高の未来の瞑想の原文に触れない');
});
