const CACHE_NAME = 'kuruma-v2'
const STATIC_ASSETS = ['/', '/manifest.json']

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch — stale-while-revalidate for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return
  if (url.protocol === 'chrome-extension:') return

  // API requests: stale-while-revalidate (serve cached, update in background)
  if (url.pathname === '/api/store') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request)
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone())
          return response
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
    return
  }

  // Static assets: network-first for JS/CSS (they have hashes), cache images
  if (url.origin === self.location.origin) {
    // Don't cache Next.js JS/CSS bundles or HTML pages — always fetch fresh
    if (url.pathname.startsWith('/_next/') || url.pathname.endsWith('.html') || !url.pathname.includes('.')) {
      return // Let browser handle normally
    }
    // Cache images and other static assets
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      })
    )
  }
})
