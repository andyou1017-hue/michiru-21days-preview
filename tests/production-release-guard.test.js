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

test('ゲートウェイ直接CLIは承認フラグを迂回せずDBも作らない', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-release-guard-'));
  try {
    const databasePath = path.join(dir, 'must-not-create.sqlite');
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../runtime/gateway.js')], {
      encoding: 'utf8', timeout: 5000,
      env: {
        ...process.env,
        MICHIRU_ORIGIN: 'https://review.example.invalid',
        MICHIRU_DB: databasePath,
        MICHIRU_RELEASE_APPROVED: 'no'
      }
    });
    assert.notEqual(result.status, 0, 'direct CLI must fail closed');
    assert.match(result.stderr, /直接起動は禁止/);
    assert.equal(fs.existsSync(databasePath), false, 'no personal-data DB may be created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
