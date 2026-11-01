'use strict';
// The backup command must validate the file it actually wrote, not only the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackup } = require('../runtime/backup');

test('バックアップ実体の整合性・記録・0600権限を確認する', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite');
  const target = path.join(dir, 'backup.sqlite');
  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);');
    db.prepare('INSERT INTO notes(body) VALUES(?)').run('テスト用の記録');
    await createBackup(source, target);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    const recovered = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(recovered.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(recovered.prepare('SELECT body FROM notes WHERE id=1').get().body, 'テスト用の記録');
    } finally {
      recovered.close();
    }
  } finally {
    db.close();
  }
});

test('破損した元DBからはバックアップを残さない', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'invalid.sqlite');
  const target = path.join(dir, 'backup.sqlite');
  fs.writeFileSync(source, 'this is not a SQLite database');
  await assert.rejects(createBackup(source, target));
  assert.equal(fs.existsSync(target), false, '失敗時に空のバックアップを残さない');
});

test('既存のバックアップを上書きしない', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-existing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite');
  const target = path.join(dir, 'backup.sqlite');
  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE notes (body TEXT)');
  db.close();
  fs.writeFileSync(target, 'keep existing backup');
  await assert.rejects(createBackup(source, target), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep existing backup');
});

test('公開リポジトリ直下やシンボリックリンク経由にはバックアップしない', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-backup-private-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite');
  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE notes (body TEXT)');
  db.close();
  const repoRoot = path.resolve(__dirname, '..');
  const direct = path.join(repoRoot, 'should-never-write-student-data.sqlite');
  await assert.rejects(createBackup(source, direct), /リポジトリ/);
  assert.equal(fs.existsSync(direct), false);
  const link = path.join(dir, 'repo-link');
  fs.symlinkSync(repoRoot, link, 'dir');
  const indirect = path.join(link, 'should-never-write-student-data.sqlite');
  await assert.rejects(createBackup(source, indirect), /リポジトリ/);
  assert.equal(fs.existsSync(direct), false);
});
