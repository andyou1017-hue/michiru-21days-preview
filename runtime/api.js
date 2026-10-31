(function () {
  'use strict';
  function request(path) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function (r) {
      if (!r.ok) throw new Error('操作を完了できませんでした。');
      return r.json();
    });
  }
  window.MichiruApi = {
    boot: function () { return fetch('/api/bootstrap', { cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      if (!r.ok) throw new Error('認証を確認できませんでした。');
      return r.json();
    }); },
    remote: function () { return null; },
    consent: function () {},
    logout: function () { return request('/api/logout'); },
    deleteAccount: function () { return request('/api/delete-account'); }
  };
})();
