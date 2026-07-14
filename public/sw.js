// Service worker: network-first con caché de respaldo para el shell de la app.
// Así, sin conexión la app abre y muestra los últimos datos (que viven cifrados
// en IndexedDB, no aquí). Las llamadas a /api y a APIs externas no se cachean.
const CACHE = 'boveda-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(e.request);
        cache.put(e.request, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(e.request, { ignoreSearch: true });
        return hit || cache.match('/index.html');
      }
    })
  );
});
