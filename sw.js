// KEEPER OF CHRONICLES - SERVICE WORKER
// Keeps a copy of the app on the phone so it opens even without internet.
// When you change any app file, raise the number in CACHE_NAME (for example keeper-v2.1).

const CACHE_NAME = 'keeper-v2.0';
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// Remove old copies of the app. The saved pictures ("keeper-images") are kept.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((n) => n.indexOf('keeper-v') === 0 && n !== CACHE_NAME)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Try the internet first (so updates arrive quickly); if it is slow or missing, use the saved copy.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch the Google API calls
  if (url.pathname.indexOf('/__keeper-image/') === 0) return; // pictures are handled by the app itself

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const fromNetwork = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
    try {
      const response = await Promise.race([fromNetwork, timeout]);
      if (response) return response;
    } catch (e) {
      // offline: fall through to the saved copy
    }
    const saved = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('index.html') : null);
    if (saved) return saved;
    return fromNetwork; // nothing saved yet: keep waiting for the network
  })());
});
