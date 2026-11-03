'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runBackup } = require('../runtime/backup-run');
const { restoreEncryptedBackup } = require('../runtime/encrypted-backup');

const secret = 'test-only-passphrase-with-at-least-16-characters';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'live.sqlite');
  const backupDirectory = path.join(root, 'private-backups');
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  t.after(() => db.close());
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT)');
  db.prepare('INSERT INTO notes(body) VALUES(?)').run('架空の受講生の記録');
  return { root, databasePath, backupDirectory };
}

test('一回実行で暗号化・復元検証した日時付きファイルを作り、平文を出力しない', async t => {
  const f = fixture(t);
  const now = new Date('2026-11-02T01:20:00.000Z');
  const args = { ...f, passphrase: secret, now, suffix: '0123456789ab' };
  const result = await runBackup(args);
  assert.equal(path.basename(result.destination), 'michiru-2026-11-02T01-20-00-000Z-0123456789ab.enc');
  assert.equal(fs.statSync(result.destination).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(result.destination).includes(Buffer.from('架空の受講生の記録')), false);
  const recovered = path.join(f.root, 'recovered.sqlite');
  await restoreEncryptedBackup(result.destination, recovered, secret);
  const db = new DatabaseSync(recovered, { readOnly: true });
  try { assert.equal(db.prepare('SELECT body FROM notes').get().body, '架空の受講生の記録'); }
  finally { db.close(); }
  assert.equal(fs.readdirSync(f.backupDirectory).length, 1);
  await assert.rejects(runBackup(args), { code: 'EEXIST' });
  assert.equal(fs.readdirSync(f.backupDirectory).length, 1);
});

test('誤った保存先・弱い秘密・公開リポジトリ内の出力を拒否する', async t => {
  const f = fixture(t);
  const args = { ...f, passphrase: secret, now: new Date('2026-11-02T01:20:00.000Z'), suffix: '0123456789ab' };
  await assert.rejects(runBackup({ ...args, passphrase: 'short' }), /16文字/);
  await assert.rejects(runBackup({ ...args, backupDirectory: path.join(f.root, 'not-mounted') }), { code: 'ENOENT' });
  fs.chmodSync(f.backupDirectory, 0o755);
  await assert.rejects(runBackup(args), /0700/);
  fs.chmodSync(f.backupDirectory, 0o700);
  const link = path.join(f.root, 'link');
  fs.symlinkSync(f.backupDirectory, link);
  await assert.rejects(runBackup({ ...args, backupDirectory: link }), /シンボリックリンク/);
  await assert.rejects(runBackup({ ...args, backupDirectory: path.resolve(__dirname, '..') }), /リポジトリ/);
  assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
});
