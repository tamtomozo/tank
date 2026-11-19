// Service Worker: makes the game an installable PWA and lets it start offline.
// Network first: always fetch the latest files (so a GitHub Pages update shows up on the
// next launch) and fall back to the cached copy only when the network is unavailable.
// Bump CACHE when the caching logic itself changes; file updates need no bump.
const CACHE = 'planet-panzer-v1';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page sends the files it loaded on its first visit (before this worker was in
// control), so every script and stylesheet is available offline right away.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    data.urls
      .filter((u) => new URL(u).origin === self.location.origin)
      .map((u) => c.match(u).then((hit) => hit || c.add(u)).catch(() => {}))
  )));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => fromCache(req))
  );
});

// offline: same URL, else ignore the query (?lang=en), else the start page
async function fromCache(req) {
  const hit = (await caches.match(req))
    || (await caches.match(req, { ignoreSearch: true }))
    || (req.mode === 'navigate' ? await caches.match('./') : undefined);
  return hit || Response.error();
}
