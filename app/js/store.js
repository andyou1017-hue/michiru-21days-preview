// 記録の保存。端末内（localStorage）に保存し、本番ではサーバーへの送信も行う。
// 記録は外部の分析ツールなどには送らない。
(function () {
  'use strict';

  var SCHEMA = 1;
  var APP_ID = 'michiru-21days';

  function now() { return new Date().toISOString(); }

  function emptyState() {
    return {
      app: APP_ID,
      schema: SCHEMA,
      consentedAt: null,
      settings: { fontSize: 'm' },
      progress: { startedAt: null, lastOpenDay: 1 },
      entries: {}
    };
  }

  function emptyEntry(day) {
    return {
      day_number: day,
      mood_am: null,
      mood_pm: null,
      answers: [],
      action_text: '',
      action_status: null,
      reflection: '',
      updated_at: null,
      completed_at: null
    };
  }

  function isMood(v) { return v === null || (Number.isInteger(v) && v >= 0 && v <= 10); }

  // 読み込んだデータ（バックアップ・サーバー）を検査し、使える形にそろえる。
  function normalizeEntry(day, e) {
    if (!e || typeof e !== 'object') return null;
    var out = emptyEntry(day);
    out.mood_am = isMood(e.mood_am) ? e.mood_am : null;
    out.mood_pm = isMood(e.mood_pm) ? e.mood_pm : null;
    out.answers = Array.isArray(e.answers) ? e.answers.slice(0, 10).map(function (a) { return typeof a === 'string' ? a : ''; }) : [];
    out.action_text = typeof e.action_text === 'string' ? e.action_text : '';
    out.action_status = (e.action_status === 'done' || e.action_status === 'skipped') ? e.action_status : null;
    out.reflection = typeof e.reflection === 'string' ? e.reflection : '';
    out.updated_at = typeof e.updated_at === 'string' ? e.updated_at : null;
    out.completed_at = typeof e.completed_at === 'string' ? e.completed_at : null;
    return out;
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || raw.app !== APP_ID || raw.schema !== SCHEMA) {
      throw new Error('満ちる眼21日間の記録ファイルではないか、形式が違います。');
    }
    var s = emptyState();
    s.consentedAt = typeof raw.consentedAt === 'string' ? raw.consentedAt : null;
    if (raw.settings && ['s', 'm', 'l', 'xl'].indexOf(raw.settings.fontSize) >= 0) s.settings.fontSize = raw.settings.fontSize;
    if (raw.progress) {
      s.progress.startedAt = typeof raw.progress.startedAt === 'string' ? raw.progress.startedAt : null;
      var lod = raw.progress.lastOpenDay;
      s.progress.lastOpenDay = Number.isInteger(lod) && lod >= 1 && lod <= 21 ? lod : 1;
    }
    var entries = raw.entries || {};
    for (var d = 1; d <= 21; d++) {
      if (entries[d]) {
        var e = normalizeEntry(d, entries[d]);
        if (e) s.entries[d] = e;
      }
    }
    return s;
  }

  // localStorage が使えない環境（プライベートブラウズ等）ではメモリに保持し、画面で知らせる。
  function LocalBackend(key) {
    this.key = key;
    this.memory = null;
    this.available = true;
    try {
      var t = '__michiru_test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
    } catch (e) {
      this.available = false;
    }
  }
  LocalBackend.prototype.read = function () {
    if (!this.available) return this.memory;
    try {
      var txt = window.localStorage.getItem(this.key);
      return txt ? JSON.parse(txt) : null;
    } catch (e) {
      return null;
    }
  };
  LocalBackend.prototype.write = function (state) {
    if (!this.available) { this.memory = JSON.parse(JSON.stringify(state)); return false; }
    try {
      window.localStorage.setItem(this.key, JSON.stringify(state));
      return true;
    } catch (e) {
      this.memory = JSON.parse(JSON.stringify(state));
      return false;
    }
  };
  LocalBackend.prototype.clear = function () {
    this.memory = null;
    if (!this.available) return;
    try { window.localStorage.removeItem(this.key); } catch (e) { /* 何もしない */ }
  };

  // remote: 本番のみ。{ pushEntry(day, entry) -> Promise, deleteEntry(day), deleteAll() }
  function Store(opts) {
    opts = opts || {};
    this.backend = new LocalBackend(opts.key || 'michiru21.v1');
    this.remote = opts.remote || null;
    this.listeners = [];
    this.timer = null;
    this.dirtyDays = {};
    this.pendingRemote = {};
    this.status = 'saved';
    var raw = this.backend.read();
    try {
      this.state = raw ? normalizeState(raw) : emptyState();
    } catch (e) {
      this.state = emptyState();
    }
  }

  Store.prototype.onStatus = function (fn) { this.listeners.push(fn); };
  Store.prototype.setStatus = function (s) {
    this.status = s;
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](s);
  };

  Store.prototype.entry = function (day) {
    return this.state.entries[day] || emptyEntry(day);
  };
  Store.prototype.hasEntry = function (day) {
    var e = this.state.entries[day];
    if (!e) return false;
    return !!(e.completed_at || e.mood_am !== null || e.mood_pm !== null || e.reflection || e.action_text || e.action_status ||
      e.answers.some(function (a) { return a && a.length; }));
  };

  // 入力のたびに呼ぶ。少し待ってからまとめて保存する（打鍵ごとの書き込みを避ける）。
  Store.prototype.updateEntry = function (day, patch) {
    var e = this.state.entries[day] || emptyEntry(day);
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) e[k] = patch[k];
    e.updated_at = now();
    this.state.entries[day] = e;
    if (!this.state.progress.startedAt) this.state.progress.startedAt = e.updated_at;
    this.dirtyDays[day] = true;
    this.scheduleSave();
  };

  Store.prototype.setMeta = function (fn) {
    fn(this.state);
    this.scheduleSave();
  };

  Store.prototype.scheduleSave = function () {
    var self = this;
    if (this.detached) return;
    this.setStatus('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.flush(); }, 400);
  };

  // ログアウト・アカウント削除のあと：端末の記録を消し、以後は保存しない（共用の端末に残さない）
  Store.prototype.detach = function () {
    this.detached = true;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.backend.clear();
  };

  Store.prototype.flush = function () {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.detached) return;
    var ok = this.backend.write(this.state);
    var days = Object.keys(this.dirtyDays);
    this.dirtyDays = {};
    if (this.remote) {
      for (var i = 0; i < days.length; i++) this.pendingRemote[days[i]] = true;
      this.pushRemote();
    } else {
      this.setStatus(ok ? 'saved' : 'memory');
    }
  };

  Store.prototype.pushRemote = function () {
    var self = this;
    if (!this.remote || this.pushing) return;
    var days = Object.keys(this.pendingRemote);
    if (!days.length) { this.setStatus(this.backend.available ? 'saved' : 'memory'); return; }
    this.pushing = true;
    var day = Number(days[0]);
    var e = this.state.entries[day];
    var p = e ? this.remote.pushEntry(day, e) : this.remote.deleteEntry(day);
    p.then(function () {
      delete self.pendingRemote[day];
      self.pushing = false;
      self.pushRemote();
    }, function () {
      self.pushing = false;
      self.setStatus('offline');
      clearTimeout(self.retryTimer);
      self.retryTimer = setTimeout(function () { self.pushRemote(); }, 15000);
    });
  };

  Store.prototype.toggleComplete = function (day, done) {
    this.updateEntry(day, { completed_at: done ? now() : null });
    this.flush();
  };

  Store.prototype.deleteDay = function (day) {
    delete this.state.entries[day];
    if (this.remote) this.pendingRemote[day] = true;
    this.backend.write(this.state);
    if (this.remote) this.pushRemote(); else this.setStatus(this.backend.available ? 'saved' : 'memory');
  };

  Store.prototype.deleteAll = function () {
    var self = this;
    var settings = this.state.settings;
    this.state = emptyState();
    this.state.settings = settings;
    this.dirtyDays = {};
    this.pendingRemote = {};
    this.backend.clear();
    this.backend.write(this.state);
    if (this.remote) return this.remote.deleteAll().then(function () { self.setStatus('saved'); });
    this.setStatus(this.backend.available ? 'saved' : 'memory');
    return Promise.resolve();
  };

  Store.prototype.completedDays = function () {
    var out = [];
    for (var d = 1; d <= 21; d++) if (this.state.entries[d] && this.state.entries[d].completed_at) out.push(d);
    return out;
  };

  Store.prototype.exportBackup = function () {
    this.flush();
    var copy = JSON.parse(JSON.stringify(this.state));
    copy.exportedAt = now();
    return copy;
  };

  Store.prototype.importBackup = function (raw) {
    var s = normalizeState(raw);
    this.state = s;
    for (var d = 1; d <= 21; d++) this.dirtyDays[d] = true;
    this.flush();
  };

  // サーバーの記録と合わせる（日ごとに新しい方を使う）。
  Store.prototype.mergeRemote = function (remoteEntries) {
    for (var d = 1; d <= 21; d++) {
      var r = remoteEntries[d] ? normalizeEntry(d, remoteEntries[d]) : null;
      var l = this.state.entries[d];
      if (r && (!l || (r.updated_at || '') > (l.updated_at || ''))) this.state.entries[d] = r;
      else if (l && (!r || (l.updated_at || '') > (r.updated_at || ''))) this.pendingRemote[d] = true;
    }
    this.backend.write(this.state);
    this.pushRemote();
  };

  window.MichiruStore = { Store: Store, normalizeState: normalizeState, emptyEntry: emptyEntry, SCHEMA: SCHEMA, APP_ID: APP_ID };
})();
