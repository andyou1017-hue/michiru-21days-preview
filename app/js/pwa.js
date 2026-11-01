(function () {
  'use strict';
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
      // インストールできなくても記録保存や画面操作を妨げない。
    });
  }
})();
