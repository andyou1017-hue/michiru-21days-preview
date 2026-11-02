'use strict';
// One-shot local encrypted backup + verified copy to an operator-mounted directory.
// No scheduler, remote storage provisioning, or production deployment is performed.
const fs = require('node:fs');
const path = require('node:path');
const { runBackup } = require('./backup-run');
const { copyOffsite } = require('./offsite-copy');
const { assertPrivatePath } = require('./private-path');

function checkOffsiteDirectory(offsiteDirectory, backupDirectory) {
  if (typeof offsiteDirectory !== 'string' || !path.isAbsolute(offsiteDirectory)) {
    throw Error('外部保管先の既存ディレクトリの絶対パスが必要です。');
  }
  if (typeof backupDirectory !== 'string' || !path.isAbsolute(backupDirectory)) {
    throw Error('バックアップ先の絶対パスが必要です。');
  }
  // Preflight before creating a local backup: do not silently succeed locally
  // when the operator forgot to mount the offsite directory.
  assertPrivatePath(path.join(offsiteDirectory, 'offsite-check.enc'));
  const info = fs.lstatSync(offsiteDirectory);
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw Error('外部保管先は既存の所有者専用（0700）ディレクトリが必要です。');
  }
  const realOffsite = fs.realpathSync(offsiteDirectory);
  const realBackup = fs.realpathSync(backupDirectory);
  // A nested directory is not a separate storage location. Reject both
  // directions so a mistaken path cannot be reported as offsite protection.
  const nestedWithin = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  };
  if (nestedWithin(realBackup, realOffsite) || nestedWithin(realOffsite, realBackup)) {
    throw Error('バックアップ先と外部保管先は同一・親子ディレクトリにできません。別のディレクトリを指定してください。');
  }
  return realOffsite;
}

async function runBackupAndCopy({ databasePath, backupDirectory, offsiteDirectory, passphrase, now, suffix } = {}) {
  const target = checkOffsiteDirectory(offsiteDirectory, backupDirectory);
  const local = await runBackup({ databasePath, backupDirectory, passphrase, now, suffix });
  // If this fails, retain the verified local backup and report a nonzero exit.
  // Do not claim offsite protection on partial success.
  const copied = await copyOffsite({ source: local.destination, offsiteDirectory: target, passphrase });
  return { local: local.destination, offsite: copied.destination, bytes: copied.bytes };
}

if (require.main === module) {
  runBackupAndCopy({
    databasePath: process.env.MICHIRU_DB,
    backupDirectory: process.env.MICHIRU_BACKUP_DIR,
    offsiteDirectory: process.env.MICHIRU_OFFSITE_DIR,
    passphrase: process.env.MICHIRU_BACKUP_PASSPHRASE
  }).then(() => {
    process.stdout.write('暗号化バックアップと別ディレクトリへの復元検証済みコピーに成功しました。実際の外部マウントは別途確認してください。\n');
  }).catch(() => {
    process.stderr.write('バックアップまたは外部保管コピーに失敗しました。保管先・マウント・権限・空き容量を確認してください。\n');
    process.exitCode = 1;
  });
}
module.exports = { checkOffsiteDirectory, runBackupAndCopy };
