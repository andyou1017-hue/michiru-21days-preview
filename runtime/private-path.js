'use strict';
// Personal data and backups must never be placed in this public repository,
// including through symlinked parent directories.
const fs = require('node:fs');
const path = require('node:path');
const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
const inside = value => value === projectRoot || value.startsWith(projectRoot + path.sep);
function assertPrivatePath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw Error('DBとバックアップは非公開領域の絶対パスにしてください。');
  }
  const target = path.resolve(file);
  if (inside(target)) throw Error('個人記録をリポジトリ内へ置けません。');
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw Error('保存先の親ディレクトリを確認できません。');
    ancestor = parent;
  }
  const effective = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  if (inside(effective) || (fs.existsSync(target) && inside(fs.realpathSync(target)))) {
    throw Error('個人記録をリポジトリ内へ置けません。');
  }
}
module.exports = { assertPrivatePath };
