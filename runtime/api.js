// 招待された利用者の記録だけを、同一オリジンのサーバーへ同期する。
// 書きかけの手紙・私の発見などは、このAPIでは送信しない。
(function () {
  'use strict';
  function post(path, payload) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      if (r.status === 401) throw new Error('ログインが切れました。もう一度ログインしてください。');
      if (!r.ok) throw new Error('サーバーに保存できませんでした。');
      return r.json();
    });
  }
  window.MichiruApi = {
    boot: function () {
      return fetch('/api/bootstrap', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        if (r.status === 401) { location.reload(); return null; }
        if (!r.ok) throw new Error('認証を確認できませんでした。');
        return r.json();
      });
    },
    remote: function () {
      return {
        pushEntry: function (day, entry) { return post('/api/entry', { day: day, entry: entry }); },
        deleteEntry: function (day) { return post('/api/entry/delete', { day: day }); },
        deleteAll: function () { return post('/api/entries/delete-all', {}); }
      };
    },
    consent: function () {},
    logout: function () { return post('/api/logout'); },
    deleteAccount: function () { return post('/api/delete-account'); }
  };
})();
