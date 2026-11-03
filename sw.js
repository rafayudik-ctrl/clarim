"use strict";

/* BUILD_HASH é injetado em dist/sw.js por tools/build-site.mjs. */
const BUILD_HASH = 'dev';

const SHELL_CACHE = `clarim-shell-${BUILD_HASH}`;
const DATA_CACHE = "clarim-data-v3";

const SCOPE_URL = new URL("./", self.location.href);
const INDEX_URL = new URL("index.html", SCOPE_URL).href;
const DATA_PREFIX = new URL("./data/", SCOPE_URL).pathname;
const MANIFEST_PATH = new URL("data/manifest.json", SCOPE_URL).pathname;
const SHARDS_PREFIX = new URL("./data/shards/", SCOPE_URL).pathname;
const DATASETS_PREFIX = new URL("./data/datasets/", SCOPE_URL).pathname;

const SHELL_PATHS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./assets/css/styles.css",
  "./assets/stopwords.json",
  "./assets/js/app.js",
  "./assets/js/modules/cache.js",
  "./assets/js/modules/data.js",
  "./assets/js/modules/export-format.js",
  "./assets/js/modules/quota.js",
  "./assets/js/modules/query-engine.js",
  "./assets/js/modules/query-service.js",
  "./assets/js/modules/ui.js",
  "./assets/js/modules/worker-client.js",
  "./assets/js/workers/query-worker.js"
];

const SHELL_URLS = SHELL_PATHS.map((path) => new URL(path, SCOPE_URL).href);
const SHELL_PATH_SET = new Set(SHELL_URLS.map((url) => new URL(url).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // cache: "reload" evita pré-cachear cópias antigas do cache HTTP do navegador.
      .then((cache) =>
        cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: "reload" })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((key) => {
          if (key.startsWith("clarim-shell-") && key !== SHELL_CACHE) {
            return caches.delete(key);
          }

          if (key.startsWith("clarim-data-") && key !== DATA_CACHE) {
            return caches.delete(key);
          }

          return undefined;
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(DATA_PREFIX)) {
    if (url.pathname === MANIFEST_PATH) {
      event.respondWith(handleManifestRequest(request));
      return;
    }

    if (
      url.pathname.startsWith(SHARDS_PREFIX) ||
      url.pathname.startsWith(DATASETS_PREFIX)
    ) {
      event.respondWith(cacheFirstImmutable(request));
      return;
    }

    event.respondWith(staleWhileRevalidate(request, DATA_CACHE, event));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, event));
    return;
  }

  if (SHELL_PATH_SET.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE, event));
  }
});

/* Manifesto: rede primeiro (dados novos), cache só como reserva offline. */
async function handleManifestRequest(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetch(request, { cache: "no-store" });

    if (response && response.ok) {
      await cache.put(request, response.clone());
      await pruneDataCache(response.clone());
      return response;
    }
  } catch {
    // sem rede: usa o cache
  }

  return (await cache.match(request)) || jsonOfflineResponse();
}

/* Remove do cache arquivos de dados que o manifesto novo não referencia mais. */
async function pruneDataCache(response) {
  let manifest;

  try {
    manifest = await response.json();
  } catch {
    return;
  }

  const keep = new Set();

  for (const entry of [...(manifest.files || []), ...(manifest.shards || [])]) {
    if (typeof entry.path === "string") {
      keep.add(new URL(entry.path, SCOPE_URL).pathname);
    }
  }

  const cache = await caches.open(DATA_CACHE);

  await Promise.all(
    (await cache.keys()).map((cachedRequest) => {
      const { pathname } = new URL(cachedRequest.url);

      const isHashedData =
        pathname.startsWith(SHARDS_PREFIX) || pathname.startsWith(DATASETS_PREFIX);

      return isHashedData && !keep.has(pathname) ? cache.delete(cachedRequest) : undefined;
    })
  );
}

/* Arquivos de dados têm o hash no nome: o conteúdo nunca muda. */
async function cacheFirstImmutable(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request).catch(() => null);

  if (response && response.ok) {
    await cache.put(request, response.clone());
    return response;
  }

  return jsonOfflineResponse();
}

async function handleNavigation(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(request)) || (await cache.match(INDEX_URL));

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  return (await networkPromise) || textOfflineResponse();
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  return cacheName === DATA_CACHE ? jsonOfflineResponse() : textOfflineResponse();
}

function textOfflineResponse() {
  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

function jsonOfflineResponse() {
  return new Response(
    JSON.stringify({ error: "offline", message: "Dados indisponíveis offline." }),
    {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    }
  );
}
