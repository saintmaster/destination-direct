// Oceanic Assistant Service Worker
// Caches the app shell on first load so it works fully offline thereafter.
// Update CACHE_NAME version string to force a refresh when you redeploy.

const CACHE_NAME = 'oceanic-assistant-v62'; // v48: All Tesseract files local in /ocr/ // Fetch lang data in main thread, pass as ArrayBuffer to worker

// Everything the app needs to run — just the two files
const PRECACHE = [
  '/',
  '/index.html',
  '/sw.js',
    '/ocr/worker.min.js',
    '/ocr/tesseract-core.wasm.js',
    '/ocr/tesseract-core-lstm.wasm.js',
    '/ocr/tesseract-core-simd-lstm.wasm.js',
    '/ocr/tesseract-core-simd.wasm.js',
    '/ocr/tessdata/eng.traineddata.gz',
];

// ── Install: cache all files immediately ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean up old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Separate cache for map tiles so they don't get evicted with app updates
const TILE_CACHE = 'oceanic-assistant-tiles-v3'; // v3: OSM restored

// ── Fetch: serve from cache, fall back to network ────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Map tiles — cache aggressively for offline use
  // Handles CartoDB fastly CDN and OSM tiles
  // Map tiles — pass straight through to network, no SW caching
  const isTile = url.hostname.endsWith('.tile.openstreetmap.org') ||
                 url.hostname.includes('cartodb-basemaps') ||
                 url.hostname.includes('fastly.net');
  if (isTile) {
    return;
  }
  // Pass CDN scripts through to network (Tesseract, pdf.js)
  const isCDN = url.hostname.includes('jsdelivr.net') ||
                url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('unpkg.com');
  if (isCDN) {
    event.respondWith(
      caches.open('oceanic-cdn-v1').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp && resp.status === 200) cache.put(event.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // App shell — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
