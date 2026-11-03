'use strict';
// Copy one encrypted backup to an operator-mounted private directory, then verify it.
// This does NOT provision external storage or prove that a directory is off-host.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyEncryptedBackup } = require('./encrypted-backup');
const { assertPrivatePath } = require('./private-path');

async function copyOffsite({ source, offsiteDirectory, passphrase } = {}) {
  if (typeof source !== 'string' || !path.isAbsolute(source) || !source.endsWith('.enc')) {
    throw Error('暗号化バックアップの絶対パス（.enc）が必要です。');
  }
  if (typeof offsiteDirectory !== 'string' || !path.isAbsolute(offsiteDirectory)) {
    throw Error('既存の外部保管先ディレクトリの絶対パスが必要です。');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw Error('16文字以上のバックアップ用パスフレーズが必要です。');
  }
  assertPrivatePath(source);
  assertPrivatePath(path.join(offsiteDirectory, 'backup-check.enc'));
  const sourceInfo = fs.lstatSync(source);
  const destinationInfo = fs.lstatSync(offsiteDirectory);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile() || (sourceInfo.mode & 0o077) !== 0) {
    throw Error('元の暗号化ファイルは通常ファイルかつ所有者専用（0600）にしてください。');
  }
  if (destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory() || (destinationInfo.mode & 0o077) !== 0) {
    throw Error('外部保管先は既存の所有者専用（0700）ディレクトリにしてください。');
  }
  const realSource = fs.realpathSync(source);
  const realDirectory = fs.realpathSync(offsiteDirectory);
  if (path.dirname(realSource) === realDirectory) {
    throw Error('元ファイルと同じディレクトリには外部保管できません。');
  }
  const destination = path.join(realDirectory, path.basename(source));
  assertPrivatePath(destination);
  // No overwrites. A temporary file on the destination filesystem is never
  // exposed under the final filename before authenticated SQLite verification.
  if (fs.existsSync(destination)) throw Object.assign(Error('既存バックアップは上書きしません。'), { code: 'EEXIST' });
  const temporary = path.join(realDirectory, '.michiru-copy-' + crypto.randomBytes(12).toString('hex') + '.tmp');
  try {
    fs.copyFileSync(realSource, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    const fd = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    await verifyEncryptedBackup(temporary, passphrase);
    fs.linkSync(temporary, destination); // Atomic and exclusive; never replaces an existing file.
    return { destination, bytes: fs.statSync(destination).size };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

if (require.main === module) {
  copyOffsite({
    source: process.argv[2],
    offsiteDirectory: process.env.MICHIRU_OFFSITE_DIR,
    passphrase: process.env.MICHIRU_BACKUP_PASSPHRASE
  }).then(() => {
    process.stdout.write('暗号化バックアップのコピーと復元検証に成功しました。外部保管先の実体・定期実行は別途確認してください。\n');
  }).catch(() => {
    process.stderr.write('外部保管コピーに失敗しました。保存先・権限・容量・復元検証を確認してください。\n');
    process.exitCode = 1;
  });
}
module.exports = { copyOffsite };
