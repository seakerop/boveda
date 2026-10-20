// Service worker: la app abre sin conexión con el último código descargado (los
// datos viven cifrados en IndexedDB, no aquí). El build sustituye __BUILD_ID__
// por un id único y __ASSETS__ por la lista de archivos de esa versión: la
// instalación los descarga TODOS antes de activarse, así que la caché nueva está
// completa antes de borrar la vieja (si no, tras cada despliegue la app no abriría
// sin conexión hasta una segunda visita con red). Si la descarga falla, la
// instalación falla y sigue mandando la versión anterior, que está entera.
// Las llamadas a /api y a APIs externas nunca se cachean.
const CACHE = 'boveda-__BUILD_ID__';
const ASSETS = __ASSETS__;
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png', ...ASSETS];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Solo se guarda lo que de verdad es ese archivo (un 200 que no sea el HTML de
// la página, que el hosting devuelve para rutas desconocidas).
const cacheable = (res, wantHtml) => {
  if (!res.ok || res.type === 'opaque') return false;
  const html = (res.headers.get('content-type') || '').includes('text/html');
  return wantHtml ? html : !html;
};

async function networkFirst(req, cacheKey, wantHtml) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (cacheable(fresh, wantHtml)) cache.put(cacheKey || req, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(cacheKey || req, { ignoreSearch: true })) || (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (cacheable(fresh, false)) cache.put(req, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, '/', true));
  } else if (url.pathname.startsWith('/assets/')) {
    // Archivos con hash en el nombre: nunca cambian, primero la caché.
    e.respondWith(cacheFirst(req));
  } else {
    e.respondWith(networkFirst(req, null, false));
  }
});
