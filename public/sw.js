const CACHE_VERSION = 'v1.3.0'
const CACHE_NAME = `daily-predict-${CACHE_VERSION}`
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => {
        // Notify all clients that a new version is active
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION })
          })
        })
      })
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  // Don't cache API calls
  if (request.url.includes('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })))
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (new URL(request.url).origin === self.location.origin) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})
