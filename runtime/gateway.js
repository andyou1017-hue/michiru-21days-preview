'use strict';
// 招待制の配信入口。DB・招待コード・利用者情報はリポジトリへ保存しない。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { publicContent, readSource } = require('../tools/build-content');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const SESSION_MS = 24 * 60 * 60 * 1000;
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const LOGIN_ERROR = 'ログインできませんでした。入力内容と招待の有効期限を確認してください。';

function createGateway({ databasePath, origin, development = false, now = Date.now } = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw Error('本番では正確なHTTPS originが必要です。');
  }
  if (!databasePath || !path.isAbsolute(databasePath)) throw Error('DBには絶対パスを指定してください。');
  const appRoot = path.resolve(__dirname, '../app');
  if (databasePath === appRoot || databasePath.startsWith(appRoot + path.sep)) throw Error('公開ファイルの中へDBを置けません。');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  // WAL等の補助ファイルも所有者だけが読めるようにする。
  process.umask(0o077);
  const db = new DatabaseSync(databasePath);
  fs.chmodSync(databasePath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (account TEXT NOT NULL, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 21), payload TEXT NOT NULL, PRIMARY KEY(account, day));
    CREATE TABLE IF NOT EXISTS future_letters (account TEXT PRIMARY KEY, body TEXT NOT NULL, sealed_at INTEGER NOT NULL, opened_at INTEGER);`);
  const cookieName = development ? 'michiru_session' : '__Host-michiru_session';
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${development ? '' : '; Secure'}`;
  function createInvite(email, ttl = 72 * 60 * 60 * 1000) {
    email = emailOf(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !Number.isFinite(ttl) || ttl <= 0 || ttl > 30 * 86400000) throw Error('招待のメールアドレス・期限が不正です。');
    const token = random();
    db.prepare('INSERT INTO invites(hash,email,expires) VALUES(?,?,?)').run(hash(token), email, now() + ttl);
    return token;
  }
  function revoke(email) {
    const account = db.prepare('SELECT id FROM accounts WHERE email=?').get(emailOf(email));
    db.prepare('UPDATE accounts SET active=0 WHERE email=?').run(emailOf(email));
    if (account) db.prepare('DELETE FROM sessions WHERE account=?').run(account.id);
    db.prepare('DELETE FROM invites WHERE email=?').run(emailOf(email));
  }
  function session(req) {
    const match = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='));
    if (!match) return null;
    const token = match.slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare('SELECT a.id,a.email FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.hash=? AND s.expires>? AND a.active=1').get(hash(token), now());
  }
  function limited(key, limit) {
    const record = db.prepare('SELECT count,expires FROM attempts WHERE key=?').get(key);
    if (record && record.expires > now()) {
      if (record.count >= limit) return true;
      db.prepare('UPDATE attempts SET count=count+1 WHERE key=?').run(key);
    } else db.prepare('INSERT OR REPLACE INTO attempts VALUES(?,1,?)').run(key, now() + 15 * 60000);
    return false;
  }
  function send(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(Error(), { status: 415 });
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192) throw Object.assign(Error(), { status: 413 });
    }
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      return value;
    } catch (_) { throw Object.assign(Error(), { status: 400 }); }
  }
  // First stage of account-scoped server persistence. Client opt-in/sync is intentionally
  // not enabled until the privacy notice, conflict rules, and full-record scope are reviewed.
  function validEntry(day, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.day_number !== day) return null;
    const mood = x => x === null || (Number.isInteger(x) && x >= 0 && x <= 10);
    const timestamp = x => x === null || (typeof x === 'string' && !Number.isNaN(Date.parse(x)) && x.length <= 40);
    if (!mood(value.mood_am) || !mood(value.mood_pm) ||
        !Array.isArray(value.answers) || value.answers.length > 10 ||
        !value.answers.every(x => typeof x === 'string' && x.length <= 4000) ||
        typeof value.action_text !== 'string' || value.action_text.length > 4000 ||
        typeof value.reflection !== 'string' || value.reflection.length > 4000 ||
        ![null, 'done', 'skipped'].includes(value.action_status) ||
        !timestamp(value.updated_at) || !timestamp(value.completed_at)) return null;
    return { day_number: day, mood_am: value.mood_am, mood_pm: value.mood_pm,
      answers: value.answers, action_text: value.action_text, action_status: value.action_status,
      reflection: value.reflection, updated_at: value.updated_at, completed_at: value.completed_at };
  }
  function savedEntries(accountId) {
    const result = {};
    for (const row of db.prepare('SELECT day,payload FROM entries WHERE account=? ORDER BY day').all(accountId)) {
      result[row.day] = JSON.parse(row.payload);
    }
    return result;
  }
  function serve(res, filename, type) {
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(filename));
  }
  const server = http.createServer(async (req, res) => {
    const nonce = crypto.randomBytes(18).toString('base64');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    if (!development) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== url.host) return send(res, 400, { error: '接続先を確認してください。' });
      const pathname = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && pathname === '/healthz') {
        db.prepare('SELECT 1').get();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.headers.origin !== origin) return send(res, 403, { error: 'この操作は許可されていません。' });
      if (req.method === 'POST' && ['/api/login', '/api/enroll'].includes(pathname)) {
        if (limited('ip:' + hash(req.socket.remoteAddress || ''), 60)) return send(res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
        const input = await body(req), email = emailOf(input.email);
        if (!email || email.length > 254 || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return send(res, 401, { error: LOGIN_ERROR });
        if (limited('email:' + hash(email), 10)) return send(res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
        let account;
        if (pathname === '/api/enroll') {
          if (typeof input.invite !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.invite)) return send(res, 401, { error: LOGIN_ERROR });
          const inviteHash = hash(input.invite);
          const invite = db.prepare('SELECT * FROM invites WHERE hash=? AND email=? AND used=0 AND expires>?').get(inviteHash, email, now());
          if (!invite) return send(res, 401, { error: LOGIN_ERROR });
          const salt = random(), password = Buffer.from(await scrypt(input.password, salt, 64)).toString('hex');
          db.exec('BEGIN IMMEDIATE');
          try {
            const changed = db.prepare('UPDATE invites SET used=1 WHERE hash=? AND used=0 AND expires>?').run(inviteHash, now());
            if (changed.changes !== 1) throw Error();
            account = { id: crypto.randomUUID(), email };
            db.prepare('INSERT INTO accounts(id,email,salt,password) VALUES(?,?,?,?)').run(account.id, email, salt, password);
            db.exec('COMMIT');
          } catch (_) { db.exec('ROLLBACK'); return send(res, 401, { error: LOGIN_ERROR }); }
        } else {
          account = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
          const actual = Buffer.from(await scrypt(input.password, account ? account.salt : 'missing-account', 64));
          const expected = account ? Buffer.from(account.password, 'hex') : Buffer.alloc(64);
          if (!crypto.timingSafeEqual(actual, expected) || !account || !account.active) return send(res, 401, { error: LOGIN_ERROR });
        }
        const token = random();
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), account.id, now() + SESSION_MS);
        res.setHeader('Set-Cookie', cookie(token, SESSION_MS / 1000));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/_login.js') return serve(res, path.join(__dirname, 'login.js'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/_login.css') return serve(res, path.join(__dirname, '../app/css/app.css'), 'text/css; charset=utf-8');
      const account = session(req);
      if (!account) {
        if (req.method === 'GET' && pathname === '/') return serve(res, path.join(__dirname, 'login.html'), 'text/html; charset=utf-8');
        return send(res, 401, { error: '招待されたアカウントでログインしてください。' });
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='));
        if (token) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token.slice(cookieName.length + 1)));
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/delete-account') {
        // Unlike administrator suspension, user-requested deletion removes credentials and records.
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM entries WHERE account=?').run(account.id);
          db.prepare('DELETE FROM future_letters WHERE account=?').run(account.id);
          db.prepare('DELETE FROM sessions WHERE account=?').run(account.id);
          db.prepare('DELETE FROM accounts WHERE id=?').run(account.id);
          db.prepare('DELETE FROM invites WHERE email=?').run(account.email);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(res, 200, { ok: true });
      }
      // Future letters are stored server-side: the body never appears in bootstrap or status.
      // Device clocks and client-provided timestamps cannot shorten the seven-day wait.
      if (req.method === 'POST' && pathname === '/api/future-letter/seal') {
        const input = await body(req);
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
          return send(res, 400, { error: '手紙の文章を確認してください。' });
        }
        const sealedAt = now();
        const changed = db.prepare('INSERT OR IGNORE INTO future_letters(account,body,sealed_at,opened_at) VALUES(?,?,?,NULL)')
          .run(account.id, input.text, sealedAt);
        if (changed.changes !== 1) return send(res, 409, { error: 'この手紙はすでに封を閉じています。' });
        return send(res, 200, { ok: true, sealedAt: new Date(sealedAt).toISOString(), unlockAt: new Date(sealedAt + 7 * 86400000).toISOString() });
      }
      if (req.method === 'GET' && pathname === '/api/future-letter/status') {
        const letter = db.prepare('SELECT sealed_at,opened_at FROM future_letters WHERE account=?').get(account.id);
        if (!letter) return send(res, 200, { sealed: false });
        return send(res, 200, { sealed: true, sealedAt: new Date(letter.sealed_at).toISOString(),
          unlockAt: new Date(letter.sealed_at + 7 * 86400000).toISOString(),
          available: now() >= letter.sealed_at + 7 * 86400000, opened: letter.opened_at !== null });
      }
      if (req.method === 'POST' && pathname === '/api/future-letter/open') {
        const letter = db.prepare('SELECT body,sealed_at,opened_at FROM future_letters WHERE account=?').get(account.id);
        if (!letter) return send(res, 404, { error: '封をした手紙がありません。' });
        if (now() < letter.sealed_at + 7 * 86400000) return send(res, 423, { error: '手紙はまだ開けられません。' });
        const openedAt = letter.opened_at === null ? now() : letter.opened_at;
        if (letter.opened_at === null) db.prepare('UPDATE future_letters SET opened_at=? WHERE account=? AND opened_at IS NULL').run(openedAt, account.id);
        return send(res, 200, { text: letter.body, openedAt: new Date(openedAt).toISOString() });
      }
      if (req.method === 'POST' && pathname === '/api/entry') {
        const input = await body(req), day = input.day;
        if (!Number.isInteger(day) || day < 1 || day > 21) return send(res, 400, { error: '日付が不正です。' });
        const entry = validEntry(day, input.entry);
        if (!entry) return send(res, 400, { error: '記録の形式が不正です。' });
        db.prepare('INSERT INTO entries(account,day,payload) VALUES(?,?,?) ON CONFLICT(account,day) DO UPDATE SET payload=excluded.payload')
          .run(account.id, day, JSON.stringify(entry));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/entry/delete') {
        const input = await body(req), day = input.day;
        if (!Number.isInteger(day) || day < 1 || day > 21) return send(res, 400, { error: '日付が不正です。' });
        db.prepare('DELETE FROM entries WHERE account=? AND day=?').run(account.id, day);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/entries/delete-all') {
        db.prepare('DELETE FROM entries WHERE account=?').run(account.id);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/bootstrap') return send(res, 200, { account: { ...account, access: true }, content: publicContent(readSource()), entries: savedEntries(account.id) });
      if (req.method !== 'GET') return send(res, 405, { error: '許可されていない操作です。' });
      if (pathname === '/') {
        const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8')
          .replace('<script src="js/content.js"></script>', '')
          .replace('<!--CONFIG-->', `<script nonce="${nonce}">window.MICHIRU_CONFIG={server:true,localOnly:true};</script><script src="js/api.js"></script>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (pathname === '/js/api.js') return serve(res, path.join(__dirname, 'api.js'), 'text/javascript; charset=utf-8');
      const allowed = ['/css/app.css', '/js/app.js', '/js/life-meditation.js', '/js/store.js', '/js/timer.js', '/js/future-guidance.js', '/js/clock.js', '/js/flowers.js'];
      if (allowed.includes(pathname)) return serve(res, path.join(appRoot, pathname), pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      return send(res, 404, { error: '見つかりません。' });
    } catch (error) { if (!res.headersSent) send(res, error.status || 500, { error: '処理できませんでした。時間をおいて再度お試しください。' }); else res.end(); }
  });
  server.requestTimeout = 15000;
  if (development && url.port === '0') server.once('listening', () => {
    url.port = String(server.address().port); origin = url.origin;
  });
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return { server, createInvite, revoke };
}
if (require.main === module) {
  const { server } = createGateway({ databasePath: process.env.MICHIRU_DB, origin: process.env.MICHIRU_ORIGIN });
  server.listen(Number(process.env.PORT || 8341), '127.0.0.1');
}
module.exports = { createGateway };
