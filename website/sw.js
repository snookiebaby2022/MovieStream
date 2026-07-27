const CACHE = 'flixnova-v33';

self.addEventListener('install', (e) => {
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

  // Network-first for navigations + app shell (avoids stale /watch/... SPA shells)
  const isNav = e.request.mode === 'navigate';
  const isShell =
    isNav ||
    url.pathname === '/' ||
    url.pathname.startsWith('/watch/') ||
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
          return cached || caches.match('/index.html') || Response.error();
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
