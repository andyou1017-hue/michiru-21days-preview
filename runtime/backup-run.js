'use strict';
// One encrypted backup per invocation. Scheduling and offsite transfer are external.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exportEncryptedBackup, verifyEncryptedBackup } = require('./encrypted-backup');
const { assertPrivatePath } = require('./private-path');

async function runBackup({ databasePath, backupDirectory, passphrase, now = new Date(), suffix } = {}) {
  if (typeof backupDirectory !== 'string' || !path.isAbsolute(backupDirectory)) {
    throw Error('バックアップ先には既存の非公開ディレクトリの絶対パスが必要です。');
  }
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
    throw Error('DBの絶対パスが必要です。');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw Error('16文字以上のバックアップ用パスフレーズが必要です。');
  }
  // Never silently create a local directory that an operator intended to mount offsite.
  if (fs.lstatSync(backupDirectory).isSymbolicLink()) {
    throw Error('バックアップ先のシンボリックリンクは使用できません。');
  }
  const dir = fs.realpathSync(backupDirectory);
  const stat = fs.statSync(dir);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw Error('バックアップ先は所有者専用（0700）のディレクトリにしてください。');
  }
  assertPrivatePath(databasePath);
  assertPrivatePath(path.join(dir, 'backup-check.enc'));
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw Error('日時が不正です。');
  const id = suffix === undefined ? crypto.randomBytes(6).toString('hex') : suffix;
  if (!/^[a-f0-9]{12}$/.test(id)) throw Error('バックアップ識別子が不正です。');
  const name = 'michiru-' + now.toISOString().replace(/[:.]/g, '-') + '-' + id + '.enc';
  const destination = path.join(dir, name);
  await exportEncryptedBackup(databasePath, destination, passphrase);
  // Verify the final published artifact, not only the temporary encrypted copy.
  await verifyEncryptedBackup(destination, passphrase);
  return { destination, bytes: fs.statSync(destination).size };
}

if (require.main === module) {
  runBackup({
    databasePath: process.env.MICHIRU_DB,
    backupDirectory: process.env.MICHIRU_BACKUP_DIR,
    passphrase: process.env.MICHIRU_BACKUP_PASSPHRASE
  }).then(result => {
    process.stdout.write('暗号化バックアップの作成・復元検証に成功しました: ' + result.destination + '\n');
  }).catch(() => {
    process.stderr.write('暗号化バックアップに失敗しました。設定・権限・空き容量・整合性を確認してください。\n');
    process.exitCode = 1;
  });
}
module.exports = { runBackup };
