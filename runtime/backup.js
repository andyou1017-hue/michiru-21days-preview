'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { assertPrivatePath } = require('./private-path');

async function createBackup(source, destination) {
  assertPrivatePath(source);
  assertPrivatePath(destination);
  if (!fs.existsSync(source)) throw Error('元のDBがありません。');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  // Recheck after creating the parent, including symbolic links.
  assertPrivatePath(destination);
  fs.closeSync(fs.openSync(destination, 'wx', 0o600));
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    const result = db.prepare('PRAGMA quick_check').get();
    if (Object.values(result)[0] !== 'ok') throw Error('DBの整合性を確認できませんでした。');
    await backup(db, destination);

    // A successful copy operation alone does not prove the destination is usable.
    // Check the actual backup file before reporting success or handing it to storage.
    const restored = new DatabaseSync(destination, { readOnly: true });
    try {
      const verified = restored.prepare('PRAGMA integrity_check').get();
      if (Object.values(verified)[0] !== 'ok') throw Error('バックアップの整合性を確認できませんでした。');
    } finally {
      restored.close();
    }
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    if (db) db.close();
  }
}
if (require.main === module) createBackup(process.env.MICHIRU_DB, process.argv[2]).then(() => {
  process.stdout.write('バックアップを保存しました。\n');
}).catch(() => {
  process.stderr.write('バックアップできませんでした。保存先・権限・DBを確認してください。\n');
  process.exitCode = 1;
});
module.exports = { createBackup };
