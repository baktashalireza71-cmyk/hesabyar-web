/* Hesab-Yar service worker — installable PWA
 * Strategy:
 *  - navigations: network-first, offline fallback to cached app shell
 *  - immutable static assets (icons, manifest, logo, _next/static): stale-while-revalidate
 *  - /api/* and everything else: network only (financial data must always be fresh)
 *
 * Base-path aware: on GitHub Pages the app lives under /hesabyar/ — every path
 * below is derived from the SW's own registration scope, so the same file works
 * at the root (web / Capacitor) and under a sub-path (Pages) unchanged.
 */
const CACHE = 'hesabaneh-v5';
// هر نسخه کش حداکثر این‌ تعداد ورودی نگه می‌دارد تا در دیپلوی‌های بعدی بی‌رویه رشد نکند
const MAX_ENTRIES = 80;

function scopePath() {
  try { return new URL(self.registration.scope).pathname } catch { return '/' }
}

/** path relative to the SW scope — e.g. 'icons/icon-192.png' */
function rel(url) {
  const base = scopePath();
  return url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.slice(1);
}

self.addEventListener('install', (event) => {
  // relative URLs resolve against the SW script URL → correct under any base path
  const PRECACHE = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'logo.png'];
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => trimCache(CACHE))
      .then(() => self.clients.claim())
  );
});

/** Caches keep insertion order in keys() — deletes the oldest entries past the cap. */
async function trimCache(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]).catch(() => undefined);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = rel(url);
  if (p.startsWith('api/')) return; // never cache financial data

  // Page navigations: fresh when online, cached shell offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(scopePath()).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  const isStatic =
    p.startsWith('_next/static/') ||
    p.startsWith('icons/') ||
    p === 'logo.png' ||
    p === 'manifest.webmanifest';
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => hit || Response.error());
        return hit || network;
      })
    );
  }
});
