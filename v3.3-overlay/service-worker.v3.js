const CACHE = "skytrace-v3-3-commerce-glass-shell-20260818";
const SHELL = [
  "/",
  "/index.html",
  "/styles.v3.css",
  "/v3.3-glass.css",
  "/app.v3.js",
  "/v3.3-commerce.js",
  "/airlines.v2.2.js",
  "/favicon.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("skytrace-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.hostname !== location.hostname || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (await caches.match("/index.html"))));
});
