/*
 * Memora's service worker (§9.6, D26): keeps the app itself on the device, so it opens
 * without a connection. Notes never pass through here: the app keeps those in IndexedDB.
 *
 * - Pages (navigations): network first, the kept app after 3 s or when offline.
 * - Built files (/assets/…, content-hashed): from the cache, fetched once otherwise.
 * - The API: untouched.
 *
 * The build fills in PRECACHE: the files of this version, and a version string.
 */
const PRECACHE = self.__MEMORA_PRECACHE__;
const CACHE = `memora-${PRECACHE.version}`;
const SHELL = '/';
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.urls)));
  // No skipWaiting: open tabs keep the version they started with (and its lazy files) until
  // they close, and the next start uses the new one.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('memora-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith('/assets/') || PRECACHE.urls.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function navigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    // Every route answers with the app; keep the newest copy.
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  // Named by their content, so the URL is enough: module scripts send an Origin header the
  // precache requests didn't, which `Vary: Origin` would otherwise tell apart.
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
