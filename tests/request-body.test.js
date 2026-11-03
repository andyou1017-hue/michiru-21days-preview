'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readJsonBody } = require('../runtime/request-body');

function request(chunks, type = 'application/json; charset=utf-8') {
  return {
    headers: { 'content-type': type },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

test('日本語と絵文字のUTF-8文字がネットワーク境界で分割されても欠損しない', async () => {
  const original = { day: 1, entry: { day_number: 1, answers: ['ありがとう🌼', '在る'] } };
  const encoded = Buffer.from(JSON.stringify(original), 'utf8');
  const japanese = encoded.indexOf(Buffer.from('あ', 'utf8'));
  const flower = encoded.indexOf(Buffer.from('🌼', 'utf8'));
  assert.ok(japanese > 0 && flower > japanese);
  const chunks = [
    encoded.subarray(0, japanese + 1),
    encoded.subarray(japanese + 1, flower + 2),
    encoded.subarray(flower + 2)
  ];
  assert.deepEqual(await readJsonBody(request(chunks)), original);
});

test('JSONの最大サイズは文字数でなく受信バイト数で制限する', async () => {
  const encoded = Buffer.from(JSON.stringify({ text: 'あいう' }), 'utf8');
  assert.deepEqual(await readJsonBody(request([encoded]), encoded.length), { text: 'あいう' });
  await assert.rejects(readJsonBody(request([encoded.subarray(0, 4), encoded.subarray(4)]), encoded.length - 1), error => error.status === 413);
});

test('不正なContent-Type・JSON・配列を拒否する', async () => {
  await assert.rejects(readJsonBody(request([Buffer.from('{}')], 'text/plain')), error => error.status === 415);
  await assert.rejects(readJsonBody(request([Buffer.from('{')])), error => error.status === 400);
  await assert.rejects(readJsonBody(request([Buffer.from('[]')])), error => error.status === 400);
});
