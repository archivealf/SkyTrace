const CACHE = "skytrace-web-v35-0-6";
const SHELL = [
  "/app/",
  "/app/web.css?v=35.0.6",
  "/app/web-mobile.css?v=35.0.6",
  "/app/web-mobile-35.css?v=35.0.6",
  "/app/web-mobile-35-fix.css?v=35.0.6",
  "/app/web-session-35.js?v=35.0.6",
  "/app/airlines.js?v=35.0.6",
  "/app/web.js?v=35.0.6",
  "/app/web-mobile.js?v=35.0.6",
  "/app/web-mobile-35.js?v=35.0.6",
  "/app/web-mobile-35-fix.js?v=35.0.6",
  "/app/web-live-recovery-35.js?v=35.0.6",
  "/app/web-credits-35.js?v=35.0.6",
  "/app/vendor/maplibre-gl/maplibre-gl.css?v=35.0.6",
  "/app/vendor/maplibre-gl/maplibre-gl.js?v=35.0.6",
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
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("skytrace-web-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
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
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") return (await cache.match("/app/")) || Response.error();
      return Response.error();
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification?.data?.url || "/app/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
