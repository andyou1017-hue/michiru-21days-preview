'use strict';
// 認証済みHTML・教材・API・個人記録は一切キャッシュしない。
const CACHE = 'michiru-public-v1';
const PUBLIC = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('michiru-public-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (PUBLIC.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
  } else if (event.request.mode === 'navigate') {
    event.respondWith(fetch(new Request(event.request, { cache: 'no-store' })).then(response => response.type === 'error' || response.status >= 500 ? caches.match('/offline.html') : response).catch(() => caches.match('/offline.html')));
  }
});
