// Service Worker: hält die App offline verfügbar.
// Antwortet sofort aus dem Cache und lädt im Hintergrund die neueste Version nach.
// Wichtig: immer direkt vom Server laden (cache: 'reload' / 'no-cache'), nicht aus dem Browser-Zwischenspeicher –
// GitHub Pages erlaubt dort 10 Minuten, sonst landen kurz nach einem Update noch alte Dateien im neuen Cache.

const CACHE = 'trainingsapp-v97';
const FILES = [
  './',
  './index.html',
  './style.css',
  './exercises.js',
  './app.js',
  './charts.js',
  './library.js',
  './wizard.js',
  './nutrition.js',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' && await cache.match('./index.html'));

      const network = fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    })
  );
});
