/*
 * LOTUS service worker: makes the patient app installable and usable offline.
 *  - App shell and the zero-knowledge circuit files are cached (proving works offline).
 *  - Page navigations are network-first with a cached fallback.
 *  - Blockchain RPC and relayer calls always go to the network.
 * Recall matching needs the decrypted secret, so it runs in the page (on open and every 30 s),
 * never in the worker; the worker only shows the notification.
 */
const CACHE = "lotus-v1";
const PRECACHE = ["/", "/patient", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/zk/lotus_membership.wasm", "/zk/lotus_final.zkey"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/patient").then((r) => r || caches.match("/"))));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/zk/"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("/patient"))));
});
