// 未来からの手紙の「7日間の封」に使う時刻。
// 端末の時計は手で変えられるため、開封の判断には、このページを配信しているサーバーの時刻
// （同じ場所への読み込みの応答に付く Date）を使う。記録は送らない（読み込むのはこのページ自身だけ）。
// サーバーの時刻が得られないとき（通信できない・ファイルで開いた等）は、開封できないものとして扱う。
(function () {
  'use strict';

  var base = null; // { server: サーバー時刻(ms), perf: そのときの performance.now() }

  function fromCache() {
    return base ? base.server + (performance.now() - base.perf) : null;
  }

  // サーバー時刻を得る（同じ画面を開いている間は、最初に得た時刻からの経過で数える）
  function trustedNow() {
    var cached = fromCache();
    if (cached !== null) return Promise.resolve(cached);
    if (!window.fetch || location.protocol === 'file:') return Promise.resolve(null);
    var t0 = performance.now();
    var url = location.pathname + (location.pathname.indexOf('?') < 0 ? '?' : '&') + 'clock=' + Date.now().toString(36);
    return fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit' }).then(function (r) {
      var d = Date.parse(r.headers.get('Date') || '');
      if (!r.ok || isNaN(d)) return null;
      // 配信の途中で保存（キャッシュ）された応答は Date が古い。Age（保存されていた秒数）を足す
      var age = parseInt(r.headers.get('Age') || '0', 10);
      if (age > 0 && age < 86400 * 30) d += age * 1000;
      var t1 = performance.now();
      base = { server: d, perf: (t0 + t1) / 2 };
      return fromCache();
    }, function () { return null; });
  }

  function reset() { base = null; } // テスト用

  window.MichiruClock = { trustedNow: trustedNow, reset: reset };
})();
