'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runBackupAndCopy } = require('../runtime/backup-offsite-run');
const { restoreEncryptedBackup } = require('../runtime/encrypted-backup');

const passphrase = 'test-only-backup-offsite-passphrase-over-16-characters';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-offsite-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'live.sqlite');
  const backupDirectory = path.join(root, 'local');
  const offsiteDirectory = path.join(root, 'offsite');
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  fs.mkdirSync(offsiteDirectory, { mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT)');
  db.prepare('INSERT INTO notes(body) VALUES(?)').run('架空の受講生の記録🌼');
  t.after(() => db.close());
  return { root, databasePath, backupDirectory, offsiteDirectory, passphrase,
    now: new Date('2026-11-02T04:00:00.000Z'), suffix: '123456789abc' };
}

test('一回の操作で暗号化バックアップを作成・別保管先へコピー・復元検証する', async t => {
  const f = fixture(t);
  const result = await runBackupAndCopy(f);
  assert.equal(path.dirname(result.local), f.backupDirectory);
  assert.equal(path.dirname(result.offsite), f.offsiteDirectory);
  assert.equal(path.basename(result.local), path.basename(result.offsite));
  assert.deepEqual(fs.readFileSync(result.local), fs.readFileSync(result.offsite));
  assert.equal(fs.statSync(result.offsite).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(result.offsite).includes(Buffer.from('架空の受講生の記録')), false);
  const restored = path.join(f.root, 'restored.sqlite');
  await restoreEncryptedBackup(result.offsite, restored, passphrase);
  const db = new DatabaseSync(restored, { readOnly: true });
  try { assert.equal(db.prepare('SELECT body FROM notes').get().body, '架空の受講生の記録🌼'); }
  finally { db.close(); }
  await assert.rejects(runBackupAndCopy(f), { code: 'EEXIST' });
  assert.equal(fs.readdirSync(f.offsiteDirectory).length, 1);
});

test('外部保管先のマウント忘れ・同一ディレクトリ・権限不備はローカル作成前に拒否する', async t => {
  const f = fixture(t);
  await assert.rejects(runBackupAndCopy({ ...f, offsiteDirectory: path.join(f.root, 'missing') }), { code: 'ENOENT' });
  await assert.rejects(runBackupAndCopy({ ...f, offsiteDirectory: f.backupDirectory }), /別のディレクトリ/);
  fs.chmodSync(f.offsiteDirectory, 0o755);
  await assert.rejects(runBackupAndCopy(f), /0700/);
  fs.chmodSync(f.offsiteDirectory, 0o700);
  const link = path.join(f.root, 'offsite-link');
  fs.symlinkSync(f.offsiteDirectory, link);
  await assert.rejects(runBackupAndCopy({ ...f, offsiteDirectory: link }), /0700/);
  assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
  assert.deepEqual(fs.readdirSync(f.offsiteDirectory), []);
});

test('外部コピー失敗時は成功を返さず、復元可能なローカルバックアップを残す', async t => {
  const f = fixture(t);
  // A directory with the final filename makes the exclusive offsite publish fail.
  const filename = 'michiru-2026-11-02T04-00-00-000Z-123456789abc.enc';
  fs.mkdirSync(path.join(f.offsiteDirectory, filename), { mode: 0o700 });
  await assert.rejects(runBackupAndCopy(f), { code: 'EEXIST' });
  assert.deepEqual(fs.readdirSync(f.backupDirectory), [filename]);
  const restored = path.join(f.root, 'local-restored.sqlite');
  await restoreEncryptedBackup(path.join(f.backupDirectory, filename), restored, passphrase);
  const db = new DatabaseSync(restored, { readOnly: true });
  try { assert.equal(db.prepare('SELECT body FROM notes').get().body, '架空の受講生の記録🌼'); }
  finally { db.close(); }
  assert.deepEqual(fs.readdirSync(f.offsiteDirectory), [filename]);
});
