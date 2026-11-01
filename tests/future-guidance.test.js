'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup() {
  const spoken = [], timers = [];
  let cancelled = 0;
  const speechSynthesis = { speak: u => spoken.push(u), cancel: () => { cancelled++; } };
  class FakeTimer {
    constructor(seconds, tick, done) { this.seconds = seconds; this.tick = tick; this.done = done; timers.push(this); }
    start() { this.state = 'running'; this.tick(this.seconds); }
    pause() { this.state = 'paused'; }
    remainingSeconds() { return this.seconds; }
    dispose() { this.state = 'disposed'; }
    finish() { this.done(); }
  }
  const window = { speechSynthesis, SpeechSynthesisUtterance: function (text) { this.text = text; }, MichiruTimer: FakeTimer };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/future-guidance.js'), 'utf8'), { window });
  return { window, spoken, timers, get cancelled() { return cancelled; } };
}
test('音声原稿はオーナー提供の全文と一致し、既存の33秒原稿とは分離する', () => {
  const { window } = setup();
  const text = window.MichiruFutureGuidance.sections.map(s => [s.title].concat(s.text, s.silence ? ['【ここで33秒間、無言】'] : []).join('\n\n')).join('\n\n');
  assert.equal(text, fs.readFileSync(path.join(__dirname, '../content/future-guidance.owner.txt'), 'utf8').trim());
});
test('7段階を順番に読み、読み終えた後の無音は33秒を3回だけ入れる', () => {
  const fixture = setup(), g = fixture.window.MichiruFutureGuidance;
  let done = 0;
  const p = new g.Player(() => {}, () => { done++; });
  p.start();
  for (let i = 0; i < 7; i++) {
    assert.equal(fixture.spoken[i].text, g.sections[i].text.join('\n\n'));
    fixture.spoken[i].onend();
    if (g.sections[i].silence) fixture.timers.at(-1).finish();
  }
  assert.deepEqual(fixture.timers.map(t => t.seconds), [33, 33, 33]);
  assert.equal(done, 1); assert.equal(p.state, 'done');
  assert.equal(fixture.spoken.some(u => u.text.includes('【')), false);
});
test('一時停止・再開で古い音声の終了通知を無視し、停止時に無音タイマーも破棄する', () => {
  const f = setup(), p = new f.window.MichiruFutureGuidance.Player(() => {}, () => {});
  p.start(); const old = f.spoken[0]; p.pause(); old.onend();
  assert.equal(p.index, 0);
  p.resume(); assert.equal(f.spoken[1].text, old.text);
  f.spoken.at(-1).onend(); f.spoken.at(-1).onend(); f.spoken.at(-1).onend();
  assert.equal(p.phase, 'silence');
  p.pause(); assert.equal(f.timers[0].state, 'paused');
  p.resume(); assert.equal(f.timers[0].state, 'running');
  p.stop(); assert.equal(f.timers[0].state, 'disposed');
  assert.equal(p.state, 'idle');
});
test('音声エラー・未対応環境は完了扱いにせず再開や原稿表示へ渡す', () => {
  const f = setup(); let done = 0;
  const p = new f.window.MichiruFutureGuidance.Player(() => {}, () => { done++; });
  p.start(); f.spoken[0].onerror(); assert.equal(p.state, 'error');
  p.resume(); assert.equal(p.state, 'playing');
  delete f.window.speechSynthesis;
  p.start(); assert.equal(p.state, 'unsupported'); assert.equal(done, 0);
});
test('無音終了と一時停止が重なっても勝手に読み上げず、停止後の古い通知を無視する', () => {
  const f = setup(), p = new f.window.MichiruFutureGuidance.Player(() => {}, () => {});
  p.start();
  for (let i = 0; i < 3; i++) f.spoken.at(-1).onend();
  p.pause(); f.timers[0].finish();
  assert.equal(p.state, 'paused'); assert.equal(f.spoken.length, 3);
  p.resume(); assert.equal(f.spoken.length, 4);
  f.spoken.at(-1).onend(); const old = f.timers.at(-1);
  p.stop(); old.finish();
  assert.equal(p.state, 'idle'); assert.equal(f.spoken.length, 4);
});
test('教材読み上げは指定原稿だけを順に読み、再開・停止で古い通知を無視する', () => {
  const f = setup(), states = [];
  const reader = new f.window.MichiruFutureGuidance.Reader(['本文そのまま', '問いそのまま'], state => states.push(state));
  reader.start(); assert.equal(f.spoken[0].text, '本文そのまま');
  reader.pause(); f.spoken[0].onend(); assert.equal(reader.index, 0);
  reader.resume(); assert.equal(f.spoken.at(-1).text, '本文そのまま');
  f.spoken.at(-1).onend(); assert.equal(f.spoken.at(-1).text, '問いそのまま');
  f.spoken.at(-1).onend(); assert.equal(reader.state, 'done');
  reader.start(); const old = f.spoken.at(-1); reader.stop(); old.onend();
  assert.equal(reader.state, 'idle'); assert.ok(states.includes('paused'));
});
