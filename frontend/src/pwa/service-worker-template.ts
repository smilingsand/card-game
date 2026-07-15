export const PWA_CACHE_PREFIX = "card-game-shell:";

export function createServiceWorkerSource({
  buildVersion,
  rulesVersion,
  staticAssets
}: {
  readonly buildVersion: string;
  readonly rulesVersion: string;
  readonly staticAssets: readonly string[];
}): string {
  const cacheName = `${PWA_CACHE_PREFIX}${rulesVersion}:${buildVersion}`;
  return `const CACHE_PREFIX = ${JSON.stringify(PWA_CACHE_PREFIX)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const STATIC_ASSETS = ${JSON.stringify(staticAssets)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match("/index.html"))));
    return;
  }
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && STATIC_ASSETS.includes(pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => cached ?? fetch(request)))
    );
  }
});
`;
}
