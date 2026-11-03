'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { exportEncryptedBackup, restoreEncryptedBackup, verifyEncryptedBackup } = require('../runtime/encrypted-backup');
const passphrase = 'long-test-only-passphrase-not-for-production';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-encrypted-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'live.sqlite');
  const encrypted = path.join(dir, 'external-mount', 'backup.enc');
  const restored = path.join(dir, 'restored.sqlite');
  const db = new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE notes (body TEXT)');
  db.prepare('INSERT INTO notes(body) VALUES(?)').run('受講生の秘密のテスト記録');
  return { dir, source, encrypted, restored, db };
}

test('稼働中DBの暗号化書き出し・整合性確認付き復元・所有者限定権限', async t => {
  const f = fixture(t);
  t.after(() => f.db.close());
  await exportEncryptedBackup(f.source, f.encrypted, passphrase);
  const data = fs.readFileSync(f.encrypted);
  assert.equal(data.includes(Buffer.from('受講生の秘密のテスト記録')), false);
  assert.equal(fs.statSync(f.encrypted).mode & 0o777, 0o600);
  await restoreEncryptedBackup(f.encrypted, f.restored, passphrase);
  assert.equal(fs.statSync(f.restored).mode & 0o777, 0o600);
  const db = new DatabaseSync(f.restored, { readOnly: true });
  try { assert.equal(db.prepare('SELECT body FROM notes').get().body, '受講生の秘密のテスト記録'); }
  finally { db.close(); }
  const bytes = fs.readFileSync(f.restored);
  await assert.rejects(restoreEncryptedBackup(f.encrypted, f.restored, passphrase), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(f.restored), bytes);
  await assert.rejects(exportEncryptedBackup(f.source, f.encrypted, passphrase), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(f.encrypted), data);
});

test('暗号化ファイルを復元先指定なしで検証し、破損と誤った秘密を拒否する', async t => {
  const f = fixture(t);
  t.after(() => f.db.close());
  await exportEncryptedBackup(f.source, f.encrypted, passphrase);
  const before = fs.readFileSync(f.encrypted);
  const verified = await verifyEncryptedBackup(f.encrypted, passphrase);
  assert.ok(verified.bytes > 0, '復元したSQLiteのサイズが正しい');
  assert.deepEqual(fs.readFileSync(f.encrypted), before, '検証は暗号化原本を変更しない');
  assert.equal(fs.existsSync(f.restored), false, '検証では恒久的な復元DBを作らない');
  await assert.rejects(verifyEncryptedBackup(f.encrypted, 'wrong-passphrase-but-long-enough'));
  const tampered = Buffer.from(before);
  tampered[tampered.length - 20] ^= 1;
  fs.writeFileSync(f.encrypted, tampered);
  await assert.rejects(verifyEncryptedBackup(f.encrypted, passphrase));
  assert.equal(fs.existsSync(f.restored), false);
});

test('誤ったパスフレーズ・改ざん・短い秘密鍵では復元ファイルを残さない', async t => {
  const f = fixture(t);
  t.after(() => f.db.close());
  await exportEncryptedBackup(f.source, f.encrypted, passphrase);
  await assert.rejects(restoreEncryptedBackup(f.encrypted, f.restored, 'wrong-passphrase-but-long-enough'));
  assert.equal(fs.existsSync(f.restored), false);
  const bytes = fs.readFileSync(f.encrypted);
  bytes[bytes.length - 20] ^= 0x01;
  fs.writeFileSync(f.encrypted, bytes);
  await assert.rejects(restoreEncryptedBackup(f.encrypted, f.restored, passphrase));
  assert.equal(fs.existsSync(f.restored), false);
  await assert.rejects(exportEncryptedBackup(f.source, path.join(f.dir, 'short.enc'), 'short'));
});

test('公開リポジトリ内への暗号化出力・復元を拒否する', async t => {
  const f = fixture(t);
  t.after(() => f.db.close());
  const repoRoot = path.resolve(__dirname, '..');
  const forbidden = path.join(repoRoot, 'never-export-backup.enc');
  await assert.rejects(exportEncryptedBackup(f.source, forbidden, passphrase), /リポジトリ/);
  assert.equal(fs.existsSync(forbidden), false);
  await exportEncryptedBackup(f.source, f.encrypted, passphrase);
  await assert.rejects(restoreEncryptedBackup(f.encrypted, path.join(repoRoot, 'never-restore-db.sqlite'), passphrase), /リポジトリ/);
});

// Simulate a filesystem refusing the final atomic publication after staging succeeded.
// Neither encrypted exports nor plaintext recovery destinations may appear half-written.
test('公開段階の失敗で部分ファイルを公開しない・一時ファイルを片付ける', async t => {
  const f = fixture(t);
  t.after(() => f.db.close());
  const originalLink = fs.linkSync;
  function failPublication() {
    throw Object.assign(new Error('synthetic atomic publication failure'), { code: 'EIO' });
  }
  try {
    fs.linkSync = failPublication;
    await assert.rejects(exportEncryptedBackup(f.source, f.encrypted, passphrase), /synthetic atomic publication failure/);
  } finally {
    fs.linkSync = originalLink;
  }
  assert.equal(fs.existsSync(f.encrypted), false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.encrypted)), []);

  await exportEncryptedBackup(f.source, f.encrypted, passphrase);
  try {
    fs.linkSync = failPublication;
    await assert.rejects(restoreEncryptedBackup(f.encrypted, f.restored, passphrase), /synthetic atomic publication failure/);
  } finally {
    fs.linkSync = originalLink;
  }
  assert.equal(fs.existsSync(f.restored), false);
  assert.equal(fs.readdirSync(f.dir).some(name => name.startsWith('.michiru-publish-')), false);
  await restoreEncryptedBackup(f.encrypted, f.restored, passphrase);
  assert.equal(fs.statSync(f.restored).mode & 0o777, 0o600);
});
