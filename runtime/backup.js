'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
async function createBackup(source, destination) {
  const appRoot = path.resolve(__dirname, '../app');
  for (const file of [source, destination]) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file === appRoot || file.startsWith(appRoot + path.sep)) throw Error('DBとバックアップは公開領域の外の絶対パスにしてください。');
  }
  if (!fs.existsSync(source)) throw Error('元のDBがありません。');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(destination, 'wx', 0o600));
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    const result = db.prepare('PRAGMA quick_check').get();
    if (Object.values(result)[0] !== 'ok') throw Error('DBの整合性を確認できませんでした。');
    await backup(db, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) { fs.rmSync(destination, { force: true }); throw error; }
  finally { if (db) db.close(); }
}
if (require.main === module) createBackup(process.env.MICHIRU_DB, process.argv[2]).then(() => {
  process.stdout.write('バックアップを保存しました。\n');
}).catch(() => { process.stderr.write('バックアップできませんでした。保存先・権限・DBを確認してください。\n'); process.exitCode = 1; });
module.exports = { createBackup };
