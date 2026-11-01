'use strict';
// 本番公開を誤って開始しないための設定検査。
// ここでは起動・DB作成・外部通信・Render課金を行わない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { productionOptions } = require('../runtime/production');
const { createGateway } = require('../runtime/gateway');

const valid = {
  MICHIRU_RELEASE_APPROVED: 'yes',
  MICHIRU_ORIGIN: 'https://example.com',
  MICHIRU_DB: '/var/data/michiru.sqlite',
  MICHIRU_PERSISTENT_DISK_CONFIRMED: 'yes',
  RENDER: 'true'
};

test('未承認では本番起動用の設定を作れない', () => {
  assert.throws(() => productionOptions({ ...valid, MICHIRU_RELEASE_APPROVED: 'no' }), /未承認/);
  assert.throws(() => productionOptions({ ...valid, MICHIRU_RELEASE_APPROVED: undefined }), /未承認/);
});

test('ドメインまたはDBが未設定なら本番設定を拒否する', () => {
  assert.throws(() => productionOptions({ ...valid, MICHIRU_ORIGIN: '' }), /HTTPS/);
  assert.throws(() => productionOptions({ ...valid, MICHIRU_DB: '' }), /永続DB/);
});

test('Renderの一時ディスクと永続ディスク未確認を拒否する', () => {
  assert.throws(() => productionOptions({ ...valid, MICHIRU_DB: '/tmp/michiru.sqlite' }), /永続ディスク/);
  assert.throws(() => productionOptions({ ...valid, MICHIRU_PERSISTENT_DISK_CONFIRMED: 'no' }), /永続ディスク/);
});

test('Renderの設定が揃えばDBを作らず設定値のみ返す', () => {
  assert.deepEqual(productionOptions(valid), {
    origin: 'https://example.com',
    databasePath: '/var/data/michiru.sqlite'
  });
});

test('本番のゲートウェイはHTTPやパス付きHTTPSをDB作成前に拒否する', () => {
  assert.throws(() => createGateway({ origin: 'http://example.com', databasePath: '/tmp/michiru-test-should-not-exist.sqlite' }), /HTTPS origin/);
  assert.throws(() => createGateway({ origin: 'https://example.com/path', databasePath: '/tmp/michiru-test-should-not-exist.sqlite' }), /HTTPS origin/);
});
