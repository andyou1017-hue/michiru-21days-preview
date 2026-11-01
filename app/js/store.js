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
      entries: {},
      discoveries: [],      // 私の発見：本人が選んで残した一言 [{ id, day, text, created_at }]
      // 未来からの手紙：21日間を歩き終えた未来の自分になったつもりで、今の自分に宛てて書く手紙
      // { text, written_at, updated_at, sealed_at（Day1で封を閉じた日時）, opened_at（初めて開封した日時） }
      futureLetter: null,
      futureReplies: {},    // 手紙を受け取った、今の自分からのひとこと { 7: { text, updated_at }, 14: …, 21: … }
      futureSkipped: {},    // 「今は読まない」を選んだ日 { 7: true }
      // 以前の試作（「21日後の私へ」＝今の自分から未来の自分へ）で書かれた手紙。宛先が逆のため
      // 未来からの手紙としては扱わず、消さずに残して読めるだけにする
      letter: null,
      letterReplies: {},
      drafts: {},           // まだ「私の発見」に残していない書きかけ { 5: '…' }（画面を移っても消えないように）
      clock: { maxSeen: null } // これまでに見た端末時刻の最大値（端末の時計を戻しても封の時刻が早まらないように）
    };
  }

  var DISCOVERY_MAX = 400;
  var LETTER_MAX = 4000;
  var LETTER_DAYS = [7, 14, 21];

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function isoOrNull(v) { return typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null; }

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

  var SEAL_MS = 7 * 24 * 60 * 60 * 1000;
  // 開けられるようになる時刻：封をしたときのサーバー時刻（無ければ端末時刻）から7日後
  function unlockTime(fl) {
    var basis = Date.parse(fl.sealed_trusted_at || fl.sealed_at);
    return isNaN(basis) ? Infinity : basis + SEAL_MS;
  }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
    // 以下は「私の発見」「手紙」の追加分。古いバックアップには無いので、無ければ空のまま
    if (Array.isArray(raw.discoveries)) {
      raw.discoveries.slice(0, 500).forEach(function (x) {
        if (!x || typeof x.text !== 'string' || !x.text.trim()) return;
        var day = Number.isInteger(x.day) && x.day >= 1 && x.day <= 21 ? x.day : null;
        s.discoveries.push({ id: str(x.id, 40) || newId(), day: day, text: str(x.text, DISCOVERY_MAX), created_at: isoOrNull(x.created_at) || new Date().toISOString() });
      });
    }
    function letterOf(x) {
      return x && typeof x.text === 'string' ? { text: str(x.text, LETTER_MAX), written_at: isoOrNull(x.written_at), updated_at: isoOrNull(x.updated_at) } : null;
    }
    if (raw.drafts && typeof raw.drafts === 'object') {
      for (var k = 1; k <= 21; k++) if (typeof raw.drafts[k] === 'string' && raw.drafts[k]) s.drafts[k] = str(raw.drafts[k], DISCOVERY_MAX);
    }
    s.futureLetter = letterOf(raw.futureLetter);
    if (s.futureLetter) {
      // 封（sealed_at・sealed_trusted_at）・開封（opened_at）。封の無い手紙は、まだ書きかけとして扱う。
      // 開封の日時は「封の基準時刻＋7日」以降のものだけ認める（壊れた・書き換えられた保存で開封済みにしない）
      var fl = s.futureLetter;
      fl.sealed_at = isoOrNull(raw.futureLetter.sealed_at);
      fl.sealed_trusted_at = fl.sealed_at ? isoOrNull(raw.futureLetter.sealed_trusted_at) : null;
      var op = fl.sealed_at ? isoOrNull(raw.futureLetter.opened_at) : null;
      fl.opened_at = op && Date.parse(op) >= unlockTime(fl) ? op : null;
    }
    if (raw.clock && isoOrNull(raw.clock.maxSeen)) s.clock.maxSeen = raw.clock.maxSeen;
    s.letter = letterOf(raw.letter);
    LETTER_DAYS.forEach(function (d) {
      var r = raw.futureReplies && raw.futureReplies[d];
      if (r && typeof r.text === 'string') s.futureReplies[d] = { text: str(r.text, LETTER_MAX), updated_at: isoOrNull(r.updated_at) };
      if (raw.futureSkipped && raw.futureSkipped[d] === true) s.futureSkipped[d] = true;
      var o = raw.letterReplies && raw.letterReplies[d];
      if (o && typeof o.text === 'string') s.letterReplies[d] = { text: str(o.text, LETTER_MAX), updated_at: isoOrNull(o.updated_at) };
    });
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
    if (!this.available || this.failed) return this.memory;
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
      this.failed = false;
      return true;
    } catch (e) {
      // 容量不足などで書けなかった：この画面の間はメモリの内容を正とし、保存できていないことを知らせる
      this.failed = true;
      this.memory = JSON.parse(JSON.stringify(state));
      return false;
    }
  };
  LocalBackend.prototype.clear = function () {
    this.memory = null;
    if (!this.available) return true;
    try { window.localStorage.removeItem(this.key); return true; } catch (e) { return false; }
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

  Store.prototype.localStatus = function (ok) {
    if (ok) return 'saved';
    return this.backend.available ? 'error' : 'memory';
  };

  // 保存できたら true。保存できなかったら false（画面には「保存できませんでした」と出す）
  Store.prototype.flush = function () {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.detached) return false;
    var ok = this.backend.write(this.state);
    var days = Object.keys(this.dirtyDays);
    this.dirtyDays = {};
    if (this.remote && ok) {
      for (var i = 0; i < days.length; i++) this.pendingRemote[days[i]] = true;
      this.pushRemote();
    } else {
      this.setStatus(this.localStatus(ok));
    }
    return ok;
  };

  Store.prototype.pushRemote = function () {
    var self = this;
    if (!this.remote || this.pushing) return;
    var days = Object.keys(this.pendingRemote);
    if (!days.length) { this.setStatus(this.localStatus(!this.backend.failed && this.backend.available)); return; }
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
    var prev = this.state.entries[day];
    delete this.state.entries[day];
    var ok = this.backend.write(this.state);
    if (!ok && prev) this.state.entries[day] = prev; // 消せなかったら、画面の記録も元のまま
    if (this.remote && ok) { this.pendingRemote[day] = true; this.pushRemote(); } else this.setStatus(this.localStatus(ok));
    return ok;
  };

  Store.prototype.deleteAll = function () {
    var self = this;
    var prev = this.state;
    var settings = this.state.settings;
    this.state = emptyState();
    this.state.settings = settings;
    this.dirtyDays = {};
    this.pendingRemote = {};
    // 消すこと自体（clear）ができていれば、全削除はできている。空の状態の書き込みに失敗しても記録は残らない
    var cleared = this.backend.clear();
    var written = this.backend.write(this.state);
    var ok = cleared || written;
    if (!ok) { this.state = prev; this.backend.write(prev); } // 消せなかったら、画面の記録も元のまま
    if (this.remote && ok) return this.remote.deleteAll().then(function () { self.setStatus('saved'); return true; });
    this.setStatus(this.localStatus(ok));
    return Promise.resolve(ok);
  };

  // ---- 私の発見 ----
  Store.prototype.addDiscovery = function (day, text) {
    text = str(text, DISCOVERY_MAX).trim();
    if (!text) return null;
    var item = { id: newId(), day: day || null, text: text, created_at: now() };
    this.state.discoveries.push(item);
    this.scheduleSave();
    return item;
  };
  Store.prototype.setDraft = function (day, text) {
    if (text) this.state.drafts[day] = str(text, DISCOVERY_MAX); else delete this.state.drafts[day];
    this.scheduleSave();
  };
  Store.prototype.deleteDiscovery = function (id) {
    this.state.discoveries = this.state.discoveries.filter(function (x) { return x.id !== id; });
    this.flush();
  };
  Store.prototype.discoveriesOf = function (day) {
    return this.state.discoveries.filter(function (x) { return x.day === day; });
  };

  // ---- 未来からの手紙 ----
  Store.prototype.setFutureLetter = function (text) {
    if (this.isSealed()) return; // 封を閉じたあとは書き換えない
    var t = now();
    var l = this.state.futureLetter || { text: '', written_at: t, updated_at: t, sealed_at: null, opened_at: null };
    l.text = str(text, LETTER_MAX);
    l.updated_at = t;
    if (!l.written_at) l.written_at = t;
    this.state.futureLetter = l;
    this.scheduleSave();
  };
  Store.prototype.hasFutureLetter = function () { return !!(this.state.futureLetter && this.state.futureLetter.text.trim()); };
  Store.prototype.isSealed = function () { return !!(this.hasFutureLetter() && this.state.futureLetter.sealed_at); };
  Store.prototype.isOpened = function () { return !!(this.isSealed() && this.state.futureLetter.opened_at); };
  // 端末の時計が戻されても、封の時刻が早まらないように、見た時刻の最大値を覚える
  Store.prototype.noteDeviceTime = function () {
    var t = Date.now(), m = Date.parse(this.state.clock.maxSeen || '');
    if (isNaN(m) || t > m) this.state.clock.maxSeen = new Date(t).toISOString();
  };
  // Day1：書き終えたら封を閉じる。trusted＝サーバー時刻（得られなければ null）
  Store.prototype.sealFutureLetter = function (trusted) {
    if (!this.hasFutureLetter() || this.isSealed()) return false;
    this.noteDeviceTime();
    var dev = Math.max(Date.now(), Date.parse(this.state.clock.maxSeen) || 0);
    this.state.futureLetter.sealed_at = new Date(dev).toISOString();
    this.state.futureLetter.sealed_trusted_at = typeof trusted === 'number' ? new Date(trusted).toISOString() : null;
    if (!this.flush()) { // 保存できないまま「封をした」と見せない
      this.state.futureLetter.sealed_at = null;
      this.state.futureLetter.sealed_trusted_at = null;
      return false;
    }
    return true;
  };
  // 通信できないまま封をし、そのとき端末の時計が進んでいた場合：封の時刻が「今」より未来になっている。
  // 本当に封をしたのは今より前なので、基準を今のサーバー時刻に寄せる（早く開くことはない）
  Store.prototype.rebaseSeal = function (trusted) {
    var fl = this.state.futureLetter;
    if (!this.isSealed() || fl.sealed_trusted_at || typeof trusted !== 'number') return;
    if (Date.parse(fl.sealed_at) > trusted) { fl.sealed_trusted_at = new Date(trusted).toISOString(); this.flush(); }
  };
  Store.prototype.unlockAt = function () { return this.isSealed() ? unlockTime(this.state.futureLetter) : Infinity; };
  // 開けられるか：サーバー時刻が「封の時刻＋7日」を過ぎているときだけ（端末の時計では判断しない）
  Store.prototype.canOpen = function (trusted) {
    return this.isSealed() && typeof trusted === 'number' && trusted >= this.unlockAt();
  };
  // 開封（一度開けたら、いつでも読み返せる）
  Store.prototype.openFutureLetter = function (trusted) {
    if (this.isOpened()) return true;
    if (!this.canOpen(trusted)) return false;
    this.state.futureLetter.opened_at = new Date(trusted).toISOString();
    var skipped = this.state.futureSkipped;
    this.state.futureSkipped = {};
    if (!this.flush()) { this.state.futureLetter.opened_at = null; this.state.futureSkipped = skipped; return false; }
    return true;
  };
  Store.prototype.setFutureReply = function (day, text) {
    this.state.futureReplies[day] = { text: str(text, LETTER_MAX), updated_at: now() };
    this.scheduleSave();
  };
  Store.prototype.setFutureSkipped = function (day, skipped) {
    if (skipped) this.state.futureSkipped[day] = true; else delete this.state.futureSkipped[day];
    this.scheduleSave();
  };
  // 以前の試作の手紙（読むだけ）
  Store.prototype.hasLegacyLetter = function () { return !!(this.state.letter && this.state.letter.text.trim()); };

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

  // バックアップの中身の件数（復元の前に確認で見せる）
  function summarize(st) {
    var days = 0;
    for (var d = 1; d <= 21; d++) {
      var e = st.entries[d];
      if (e && (e.completed_at || e.mood_am !== null || e.mood_pm !== null || e.reflection || e.action_text || e.action_status ||
        e.answers.some(function (a) { return a && a.length; }))) days++;
    }
    return { days: days, discoveries: st.discoveries.length, letter: !!(st.futureLetter && st.futureLetter.text.trim()) || !!(st.letter && st.letter.text.trim()) };
  }
  Store.prototype.summary = function () { return summarize(this.state); };

  Store.prototype.importBackup = function (raw) {
    var s = normalizeState(raw);
    var prev = this.state;
    this.state = s;
    for (var d = 1; d <= 21; d++) this.dirtyDays[d] = true;
    if (!this.flush()) { // 保存できなかったら、元の記録のままにする（画面と端末の中身を食い違わせない）
      this.state = prev;
      this.dirtyDays = {};
      return false;
    }
    return true;
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

  window.MichiruStore = { Store: Store, normalizeState: normalizeState, summarize: summarize, emptyEntry: emptyEntry, SCHEMA: SCHEMA, APP_ID: APP_ID, LETTER_DAYS: LETTER_DAYS, DISCOVERY_MAX: DISCOVERY_MAX };
})();
