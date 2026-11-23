// Keep the editor available offline after a successful initial visit.
const cacheName = 'paneltranslate-shell-v1';
const shell = ['./','./index.html','./style.css','./app.js','./render.js','./engine.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok && shell.some(path => new URL(path,self.registration.scope).href === event.request.url)) {
      const copy=response.clone();
      event.waitUntil(caches.open(cacheName).then(cache=>cache.put(event.request,copy)));
    }
    return response;
  }).catch(()=>caches.match(event.request).then(response=>response || Response.error())));
});
