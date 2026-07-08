// Minimaler Service Worker für Marmotte Zeiterfassung
// Sorgt dafür, dass die App auf dem Smartphone als "installierbar" erkannt wird
// und die Grundseiten auch bei kurzzeitig fehlender Verbindung geladen werden können.

const CACHE_NAME = "marmotte-shell-v1";
const SHELL_FILES = [
  "./index.html",
  "./style.css",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Netzwerk zuerst, bei Fehler auf Cache zurückfallen (Live-Daten von Firebase bleiben unberührt,
// da Firebase-Anfragen an eine andere Domain gehen und hier nicht abgefangen werden)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
