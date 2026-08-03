// Offline support, which for this game is nearly free: there is no backend,
// no API, and no asset the player waits on. Today's Nook is a pure function of
// the date, so a plane with no wifi still gets the right puzzle.
//
// Cache-first with a versioned cache. Bump CACHE on deploy — the build hashes
// its own filenames, so a new build simply misses the old cache and refills it,
// and the old one is deleted on activate.

const CACHE = 'nook-v1';

// Everything the app shell needs. The hashed JS and CSS are not listed: they
// change every build, so they are cached on first request instead.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // A failed precache must not wedge the install — the runtime handler below
  // will pick up anything that missed.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network first so a deploy is picked up promptly, and
  // fall back to the cached shell when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  // Everything else is content-hashed or static: cache first, fill on miss.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return response;
      });
    }),
  );
});
