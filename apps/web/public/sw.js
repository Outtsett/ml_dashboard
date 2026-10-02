/**
 * Service Worker — App Shell Cache
 *
 * Caches static assets (JS, CSS, fonts) so the Electron/browser app
 * renders instantly even when the server is still booting.
 *
 * Strategy:
 * - /assets/* (Vite hashed files): Cache-first (immutable, safe to cache forever)
 * - /api/*: Network-only (never cache API responses — TanStack Query handles that)
 * - Everything else: Network-first with cache fallback (index.html, favicon)
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `ml-dashboard-${CACHE_VERSION}`;

// Assets to pre-cache on install (app shell essentials)
const PRECACHE_URLS = [
  '/',
  '/favicon.svg',
  '/favicon.png',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // Pre-cache failures are non-critical — SW still activates
        console.warn('[SW] Pre-cache failed for some URLs');
      });
    })
  );
  // Activate immediately (don't wait for existing tabs to close)
  self.skipWaiting();
});

// Activate: clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name.startsWith('ml-dashboard-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch: route-based caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls — TanStack Query manages its own caching
  if (url.pathname.startsWith('/api/')) return;

  // Skip SSE streams and health checks
  if (url.pathname.includes('/stream/') || url.pathname === '/health') return;

  // /assets/* — Cache-first (Vite hashed, immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
