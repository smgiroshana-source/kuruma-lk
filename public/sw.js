// Self-destruct: clear all caches and unregister
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  )
})
