// Shell and pinned runtime files belong to this Pages project's scope. Models and
// language data have their own caches managed by Transformers.js and Tesseract.
const prefix = 'paneltranslate:' + self.registration.scope;
const shellCache = prefix + ':shell-v2';
const runtimeCache = prefix + ':runtimes-v1';
const shell = [
  './', './index.html', './style.css', './app.js', './render.js', './engine.js',
  './archive.js', './vendor/zip-2.25.0/zip-core.mjs', './examples/indonesian.png',
];
const shellURLs = new Set(shell.map(path => new URL(path, self.registration.scope).href));
const runtimeRoots = [
  '/npm/tesseract.js@6.0.1/dist/',
  '/npm/tesseract.js-core@6.0.0/',
  '/npm/@xenova/transformers@2.17.2/dist/',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(shellCache).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix + ':shell-') && name !== shellCache) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (shellURLs.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(shellCache);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return await cache.match(request) || Response.error();
      }
    })());
  } else if (url.origin === 'https://cdn.jsdelivr.net' && runtimeRoots.some(path => url.pathname.startsWith(path))) {
    event.respondWith((async () => {
      const cache = await caches.open(runtimeCache);
      const hit = await cache.match(request);
      if (hit) return hit;
      // Public version-pinned assets support CORS even for classic worker imports.
      // Fetch readable responses to avoid opaque-response quota inflation.
      const response = await fetch(url.href, {mode: 'cors', credentials: 'omit'});
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
