'use strict';
// Optional offline encrypted export. Does not configure storage, billing, or deployment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');
const { createBackup } = require('./backup');
const { assertPrivatePath } = require('./private-path');

const MAGIC = Buffer.from('MICHIRU1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

function validate(source, destination, passphrase) {
  assertPrivatePath(source);
  assertPrivatePath(destination);
  if (path.resolve(source) === path.resolve(destination)) throw Error('入力と出力を同じ場所にできません。');
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw Error('16文字以上の長いバックアップ用パスフレーズが必要です。');
}
function privateTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-encrypted-'));
  fs.chmodSync(dir, 0o700);
  return dir;
}
function key(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}
function integrity(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(row)[0] !== 'ok') throw Error('バックアップDBの整合性を確認できませんでした。');
  } finally { db.close(); }
}

async function exportEncryptedBackup(source, destination, passphrase) {
  validate(source, destination, passphrase);
  const dir = privateTemp();
  const snapshot = path.join(dir, 'snapshot.sqlite');
  const staged = path.join(dir, 'encrypted.enc');
  try {
    await createBackup(source, snapshot);
    // Do not overwrite existing backups or put plaintext in the export directory.
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    assertPrivatePath(destination);
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
    fs.writeFileSync(staged, Buffer.concat([MAGIC, salt, iv]), { flag: 'wx', mode: 0o600 });
    await pipeline(fs.createReadStream(snapshot), cipher, fs.createWriteStream(staged, { flags: 'a', mode: 0o600 }));
    fs.appendFileSync(staged, cipher.getAuthTag());
    // Publish only a complete encrypted artifact; never overwrite an older backup.
    fs.copyFileSync(staged, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
    return { bytes: fs.statSync(destination).size };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function restoreEncryptedBackup(source, destination, passphrase) {
  validate(source, destination, passphrase);
  const dir = privateTemp();
  const snapshot = path.join(dir, 'snapshot.sqlite');
  try {
    const size = fs.statSync(source).size;
    if (size <= HEADER_BYTES + TAG_BYTES) throw Error('暗号化バックアップの形式が不正です。');
    const fd = fs.openSync(source, 'r');
    let header, tag;
    try {
      header = Buffer.alloc(HEADER_BYTES);
      tag = Buffer.alloc(TAG_BYTES);
      if (fs.readSync(fd, header, 0, HEADER_BYTES, 0) !== HEADER_BYTES ||
          fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES) !== TAG_BYTES ||
          !header.subarray(0, MAGIC.length).equals(MAGIC)) throw Error('暗号化バックアップの形式が不正です。');
    } finally { fs.closeSync(fd); }
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    await pipeline(
      fs.createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      fs.createWriteStream(snapshot, { flags: 'wx', mode: 0o600 })
    );
    integrity(snapshot); // Only authenticated, valid SQLite can be restored.
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    assertPrivatePath(destination);
    fs.copyFileSync(snapshot, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
    return { bytes: fs.statSync(destination).size };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [action, source, destination] = process.argv.slice(2);
  const passphrase = process.env.MICHIRU_BACKUP_PASSPHRASE;
  const task = action === 'export' ? exportEncryptedBackup : action === 'restore' ? restoreEncryptedBackup : null;
  if (!task || !source || !destination) {
    process.stderr.write('使い方: node runtime/encrypted-backup.js export|restore /絶対パス/元 /絶対パス/先\n');
    process.exitCode = 1;
  } else task(source, destination, passphrase).then(() => {
    process.stdout.write('暗号化バックアップ処理が完了しました。外部保管・復元運用は別途確認してください。\n');
  }).catch(() => {
    process.stderr.write('処理に失敗しました。パスフレーズ・保存先・整合性を確認してください。\n');
    process.exitCode = 1;
  });
}
module.exports = { exportEncryptedBackup, restoreEncryptedBackup };
