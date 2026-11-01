// Service Worker：オフライン起動用のキャッシュ。アプリの部品だけを持ち、API の通信はキャッシュしない
// 部品を更新したら VERSION を上げる

const VERSION = 'v6';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/db/storage.js', 'js/db/backup.js',
  'js/config/categories.js', 'js/config/settings.js', 'js/config/csv-formats.js',
  'js/features/transactions.js', 'js/features/receipt-scan.js', 'js/features/dashboard.js',
  'js/features/review.js', 'js/features/todo.js', 'js/features/assets.js', 'js/features/settings.js', 'js/features/members.js',
  'js/utils/format.js', 'js/utils/ui.js', 'js/utils/receipt-text.js',
  'assets/icons/apple-touch-icon.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 同じサイトの GET だけ、ネット優先・失敗したらキャッシュ（更新がすぐ届くように）
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
