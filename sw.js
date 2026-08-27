const CACHE = "fitness-tracker-v29";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Never cache GitHub API calls — sync must always hit the network.
  if (url.origin === "https://api.github.com") return;
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  if (!url.pathname.startsWith(scope.pathname)) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return cached || (await network) || cache.match("./");
    })(),
  );
});
