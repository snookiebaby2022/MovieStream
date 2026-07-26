const CACHE = 'flixnova-v14';

self.addEventListener('install', (e) => {
  // Don't precache HTML — always take fresh UI after deploys
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  if (e.request.method !== 'GET') return;

  // Network-first for app shell so updates aren't stuck on "Loading..."
  const isShell =
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('manifest.json') ||
    url.pathname === '/sw.js';

  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then((res) => res)
        .catch(async () => {
          const cached = await caches.match(e.request);
          return cached || Response.error();
        })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            cache.put(e.request, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
