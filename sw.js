/* LockYourGains | © 2026 Alex Hundt | Alle Rechte vorbehalten – siehe LICENSE */
// Service Worker: hält die App offline verfügbar.
// Antwortet sofort aus dem Cache und lädt im Hintergrund die neueste Version nach.
// Wichtig: immer direkt vom Server laden (cache: 'reload' / 'no-cache'), nicht aus dem Browser-Zwischenspeicher –
// GitHub Pages erlaubt dort 10 Minuten, sonst landen kurz nach einem Update noch alte Dateien im neuen Cache.

const CACHE = 'trainingsapp-v395';
const FILES = [
  './',
  './index.html',
  './style.css',
  './i18n.js',
  './lang-en.js',
  './food-en.js',
  './exercises.js',
  './app.js',
  './charts.js',
  './library.js',
  './guide.js',
  './musclemap.js',
  './figures.js',
  './wizard.js',
  './nutrition.js',
  './food.js',
  './phaseplan.js',
  './bls.js',
  './micro.js',
  './bls-micro.js',
  './menstrual.js',
  './cardio.js',
  './yoga.js',
  './mobility.js',
  './nutplan.js',
  './rezepte.js',
  './mealgen.js',
  './trainplan.js',
  './about.js',
  './media.js',
  './tour.js',
  './sports.js',
  './cali.js',
  './zxing.min.js',
  './fonts/barlow-400.woff2',
  './fonts/barlow-600.woff2',
  './fonts/barlow-semicond-600.woff2',
  './fonts/plex-sans.woff2',
  './fonts/plex-mono-400.woff2',
  './fonts/arimo.woff2',
  './fonts/orbitron.woff2',
  './fonts/sharetechmono.woff2',
  './fonts/alfaslab.woff2',
  './fonts/oswald.woff2',
  './fonts/chakra-600.woff2',
  './fonts/chakra-700.woff2',
  './fonts/michroma.woff2',
  './fonts/spacemono.woff2',
  './fonts/shippori.woff2',
  './fonts/blackops.woff2',
  './fonts/nunito.woff2',
  './fonts/cinzel.woff2',
  './manifest.json',
  './manifest-beta.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './intro-1.jpg',
  './intro-2.jpg',
  './intro-3.jpg',
  './intro-1-en.jpg',
  './intro-2-en.jpg',
  './intro-3-en.jpg',
  './bg-cyber.webp',
];

self.addEventListener('install', event => {
  // v280: jede Datei einzeln. Fehlt online eine (z. B. ein nicht hochgeladener Ordner), bricht sonst die ganze Installation ab:
  // kein Offline-Betrieb und auf Android nur „Verknüpfung“ statt „Installieren“. Fehlende Dateien lädt der fetch-Teil später nach.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(FILES.map(f =>
    cache.add(new Request(f, { cache: 'reload' })).catch(() => null)))));
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
