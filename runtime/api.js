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
      return r.json().then(function (data) {
        if (!r.ok) { var error = new Error(r.status === 401 ? 'ログインが切れました。もう一度ログインしてください。' : (data.error || 'サーバーに保存できませんでした。')); error.status = r.status; throw error; }
        return data;
      });
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
    remote: function (initialGeneration) {
      // Generation is assigned by the server. A stale device cannot silently
      // recreate records deleted on another device.
      var generation = Number.isInteger(initialGeneration) ? initialGeneration : undefined;
      function payload(data) {
        if (generation !== undefined) data.generation = generation;
        return data;
      }
      function deleted(response) {
        if (Number.isInteger(response.generation)) generation = response.generation;
        return response;
      }
      return {
        pushEntry: function (day, entry) { return post('/api/entry', payload({ day: day, entry: entry })); },
        deleteEntry: function (day) { return post('/api/entry/delete', payload({ day: day })).then(deleted); },
        deleteAll: function () { return post('/api/entries/delete-all', payload({})).then(deleted); },
        getGeneration: function () { return generation; }
      };
    },
    consent: function () {},
    letterStatus: function () { return fetch('/api/future-letter/status', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('手紙の状態を確認できませんでした。通信とログインを確認してください。');
      return r.json();
    }); },
    sealLetter: function (text) { return post('/api/future-letter/seal', { text: text }); },
    openLetter: function () { return post('/api/future-letter/open'); },
    logout: function () { return post('/api/logout'); },
    deleteAccount: function () { return post('/api/delete-account'); }
  };
})();
