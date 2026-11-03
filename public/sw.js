/* DTF Prep service worker: makes the app work offline after the first load, and adds the
   cross-origin isolation headers (COOP/COEP) that let the AI upscaler use several threads on hosts
   that can't set headers (GitHub Pages). Threads switch on from the second visit. */

const CACHE = 'dtf-prep-v1'
const scope = self.registration.scope
const url = (p) => new URL(p, scope).toString()

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const files = ['./', './index.html', './models/realesr-general-x4v3.onnx', './favicon.svg']
      try {
        const res = await fetch(url('./precache-manifest.json'), { cache: 'no-store' })
        if (res.ok) files.push(...(await res.json()).map((f) => './' + f))
      } catch {
        // dev server or missing manifest: runtime caching still works
      }
      // Cache one by one so a single failure doesn't abort the install.
      await Promise.all(files.map((f) => cache.add(url(f)).catch(() => {})))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

function isolate(response) {
  if (!response || response.status === 0 || response.type === 'opaque') return response
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // Network first so new versions show up; cache when offline.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put(url('./index.html'), res.clone())
          return isolate(res)
        } catch {
          return isolate((await caches.match(url('./index.html'))) || (await caches.match(url('./'))))
        }
      })(),
    )
    return
  }

  // Hashed assets, the model and the ORT wasm: cache first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return isolate(cached)
      const res = await fetch(req)
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return isolate(res)
    })(),
  )
})
