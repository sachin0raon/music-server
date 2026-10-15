// App-shell cache only. Never touches /api (private data and audio) or anything cross-origin.
const SHELL = "music-shell-v1";
const ASSETS = "music-assets-v1";
const KEEP = [SHELL, ASSETS];
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Hashed build files never change, so the first copy is always right
async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Pages and small static files: always try the server first so updates show up, fall back offline
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const nav = req.mode === "navigate";
  const key = nav ? "/" : req;
  try {
    const res = await fetch(req);
    const isPage = (res.headers.get("content-type") || "").includes("text/html");
    if (res.ok && (!nav || isPage)) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/docs") || url.pathname.startsWith("/openapi")) return;
  e.respondWith(url.pathname.startsWith("/assets/") ? cacheFirst(req) : networkFirst(req));
});
