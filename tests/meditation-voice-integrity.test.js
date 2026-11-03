'use strict';
// 教材原文を変更せず、二つの瞑想と音声導線の欠落を検出する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('命の瞑想は呼吸・脈・命の在るを含む33秒の3区間', () => {
  const s = read('app/js/life-meditation.js');
  for (const t of ['命の瞑想','ゆっくり息を吸って','脈を感じます','命が在る','from: 0, to: 11','from: 11, to: 22','from: 22, to: 33']) assert.ok(s.includes(t),t);
});

test('最高の未来の瞑想は3回の33秒静寂と未来からの言葉を保つ', () => {
  const s = read('app/js/future-guidance.js');
  assert.equal((s.match(/silence: 33/g)||[]).length,3);
  for (const t of ['最高の未来へ','未来の自分から、今の自分へ','今のあなたに、どんな言葉','SpeechSynthesisUtterance','ja-JP']) assert.ok(s.includes(t),t);
});

test('受講画面は命の瞑想と最高の未来の音声操作を提供する', () => {
  const s = read('app/js/app.js');
  for (const t of ['命の瞑想（33秒）','最高の未来の瞑想（33秒×3回）','meditationReader.start()','guidancePlayer.start(','guidancePlayer.pause()','guidancePlayer.resume()']) assert.ok(s.includes(t),t);
});
