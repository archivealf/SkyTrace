const CACHE = "skytrace-web-v34-4";
const SHELL = [
  "/app/",
  "/app/web.css?v=34.4",
  "/app/web-mobile.css?v=34.4",
  "/app/web-mobile-interactions.css?v=34.4",
  "/app/web.js?v=34.4",
  "/app/web-mobile.js?v=34.4",
  "/app/manifest.webmanifest",
  "/app/icon.svg",
  "/app/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("skytrace-web-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/app")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch {
      return (await cache.match(request)) || (await cache.match("/app/")) || Response.error();
    }
  })());
});
