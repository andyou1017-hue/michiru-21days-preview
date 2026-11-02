'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { exportEncryptedBackup, restoreEncryptedBackup } = require('../runtime/encrypted-backup');
const { copyOffsite } = require('../runtime/offsite-copy');
const passphrase = 'test-only-offsite-passphrase-over-16-characters';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-offsite-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbFile = path.join(root, 'live.sqlite');
  const local = path.join(root, 'local');
  const offsite = path.join(root, 'offsite');
  fs.mkdirSync(local, { mode: 0o700 });
  fs.mkdirSync(offsite, { mode: 0o700 });
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE notes (body TEXT)');
  db.prepare('INSERT INTO notes(body) VALUES(?)').run('架空の受講生の記録');
  db.close();
  const source = path.join(local, 'michiru-2026-11-02.enc');
  await exportEncryptedBackup(dbFile, source, passphrase);
  return { root, local, offsite, source };
}

test('外部保管先へのコピーを復元検証し、原本不変・0600・上書き禁止を確認', async t => {
  const f = await fixture(t);
  const original = fs.readFileSync(f.source);
  const result = await copyOffsite({ source: f.source, offsiteDirectory: f.offsite, passphrase });
  assert.equal(result.destination, path.join(f.offsite, path.basename(f.source)));
  assert.deepEqual(fs.readFileSync(result.destination), original);
  assert.deepEqual(fs.readFileSync(f.source), original);
  assert.equal(fs.statSync(result.destination).mode & 0o777, 0o600);
  const restored = path.join(f.root, 'restored.sqlite');
  await restoreEncryptedBackup(result.destination, restored, passphrase);
  const db = new DatabaseSync(restored, { readOnly: true });
  try { assert.equal(db.prepare('SELECT body FROM notes').get().body, '架空の受講生の記録'); }
  finally { db.close(); }
  await assert.rejects(copyOffsite({ source: f.source, offsiteDirectory: f.offsite, passphrase }), { code: 'EEXIST' });
  assert.deepEqual(fs.readdirSync(f.offsite), [path.basename(f.source)]);
});

test('改ざん・誤った秘密では保管先にファイルを公開しない', async t => {
  const f = await fixture(t);
  const args = { source: f.source, offsiteDirectory: f.offsite, passphrase };
  await assert.rejects(copyOffsite({ ...args, passphrase: 'incorrect-secret-long-enough' }));
  assert.deepEqual(fs.readdirSync(f.offsite), []);
  const corrupted = fs.readFileSync(f.source);
  corrupted[corrupted.length - 20] ^= 1;
  fs.writeFileSync(f.source, corrupted);
  await assert.rejects(copyOffsite(args));
  assert.deepEqual(fs.readdirSync(f.offsite), []);
});

test('不正な外部保管先、シンボリックリンク、同一場所を拒否', async t => {
  const f = await fixture(t);
  const args = { source: f.source, offsiteDirectory: f.offsite, passphrase };
  await assert.rejects(copyOffsite({ ...args, offsiteDirectory: f.local }), /同じディレクトリ/);
  fs.chmodSync(f.offsite, 0o755);
  await assert.rejects(copyOffsite(args), /0700/);
  fs.chmodSync(f.offsite, 0o700);
  const link = path.join(f.root, 'offsite-link');
  fs.symlinkSync(f.offsite, link);
  await assert.rejects(copyOffsite({ ...args, offsiteDirectory: link }), /0700/);
  await assert.rejects(copyOffsite({ ...args, offsiteDirectory: path.resolve(__dirname, '..') }), /リポジトリ/);
  assert.deepEqual(fs.readdirSync(f.offsite), []);
});
