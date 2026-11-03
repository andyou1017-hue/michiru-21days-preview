'use strict';
// Regression: the seven-day seal is durable across a server restart.
// Synthetic data only; no owner manuscript or real student data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../runtime/gateway');

test('封印した未来の手紙はサーバー再起動後も7日未満は開けず、7日経過後だけ開ける', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michiru-letter-restart-'));
  const db = path.join(dir, 'student.sqlite');
  let now = Date.parse('2026-11-01T00:00:00.000Z');
  let running;
  async function start() {
    const gateway = createGateway({
      databasePath: db,
      origin: 'http://127.0.0.1:0',
      development: true,
      now: () => now
    });
    await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + gateway.server.address().port;
    running = gateway.server;
    return { gateway, base };
  }
  async function stop() {
    if (!running) return;
    const server = running;
    running = null;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  async function post(base, route, payload, cookie = '') {
    return fetch(base + route, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(payload)
    });
  }
  const email = 'restart-letter@example.invalid';
  const password = 'test-only-password-123';
  const body = '架空の未来からの手紙：再起動しても守られる';
  const week = 7 * 86400000;
  try {
    let { gateway, base } = await start();
    const invite = gateway.createInvite(email);
    const enrolled = await post(base, '/api/enroll', { email, password, invite });
    assert.equal(enrolled.status, 200);
    const cookie = enrolled.headers.get('set-cookie').split(';')[0];
    const sealed = await post(base, '/api/future-letter/seal', { text: body }, cookie);
    assert.equal(sealed.status, 200);
    assert.equal((await sealed.json()).unlockAt, new Date(now + week).toISOString());
    await stop();

    ({ base } = await start());
    const before = await (await fetch(base + '/api/future-letter/status', { headers: { Cookie: cookie } })).json();
    assert.equal(before.sealed, true);
    assert.equal(before.available, false);
    assert.equal('text' in before, false);
    assert.equal((await post(base, '/api/future-letter/open', {}, cookie)).status, 423);
    assert.equal((await post(base, '/api/future-letter/seal', { text: '上書き' }, cookie)).status, 409);

    now += week - 1;
    const login = await post(base, '/api/login', { email, password });
    assert.equal(login.status, 200);
    const renewedCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await post(base, '/api/future-letter/open', {}, renewedCookie)).status, 423);
    await stop();

    ({ base } = await start());
    now += 1;
    const loginAfterWeek = await post(base, '/api/login', { email, password });
    assert.equal(loginAfterWeek.status, 200);
    const finalCookie = loginAfterWeek.headers.get('set-cookie').split(';')[0];
    const opened = await post(base, '/api/future-letter/open', {}, finalCookie);
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).text, body);
    const status = await (await fetch(base + '/api/future-letter/status', { headers: { Cookie: finalCookie } })).json();
    assert.equal(status.opened, true);
    assert.equal(status.available, true);
    assert.equal('text' in status, false);
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
