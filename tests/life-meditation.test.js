'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/js/life-meditation.js'), 'utf8');

test('命の瞑想は教材APIの取得後に適用でき、33秒のまま', () => {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const content = { meditation: { seconds: 33, note: '保護対象の旧誘導', phases: [{ from: 0, to: 33, text: '旧誘導' }] } };
  const updated = context.window.MichiruLifeMeditation.apply(content);
  assert.equal(updated.meditation.seconds, 33);
  assert.match(updated.meditation.note, /命の瞑想/);
  assert.deepEqual(Array.from(updated.meditation.phases, p => [p.from, p.to]), [[0, 11], [11, 22], [22, 33]]);
  assert.match(updated.meditation.phases[0].text, /吸って、吐き/);
  assert.match(updated.meditation.phases[1].text, /脈を感じ/);
  assert.match(updated.meditation.phases[2].text, /命が在る/);
});

test('正式な生成教材ファイルは書き換えず、画面表示だけ変更する', () => {
  const original = fs.readFileSync(path.join(root, 'app/js/content.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.equal(fs.readFileSync(path.join(root, 'app/js/content.js'), 'utf8'), original);
  assert.ok(!context.window.MICHIRU_CONTENT, 'スクリプト単体で教材を必要としない');
});

test('招待制ゲートウェイでも瞑想スクリプトを認証後に配信できる', () => {
  const gateway = fs.readFileSync(path.join(root, 'runtime/gateway.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app/js/app.js'), 'utf8');
  assert.match(gateway, /'\\/js\\/life-meditation\\.js'/);
  assert.match(html, /<script src="js\\/life-meditation\\.js"><\\/script>/);
  assert.match(app, /MichiruLifeMeditation\\.apply\\(content\\)/);
});
