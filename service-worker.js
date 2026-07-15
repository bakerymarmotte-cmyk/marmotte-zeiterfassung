// Minimaler Service Worker für Marmotte Zeiterfassung
// Sorgt dafür, dass die App auf dem Smartphone als "installierbar" erkannt wird
// und die Grundseiten auch bei kurzzeitig fehlender Verbindung geladen werden können.

const CACHE_NAME = "marmotte-shell-v7";
const DESIGN_ORIGIN = "https://bakerymarmotte-cmyk.github.io";
const SHELL_FILES = [
  "./index.html",
  "./style.css",
  "./manifest.json",
  "https://bakerymarmotte-cmyk.github.io/marmotte-design/tokens.css",
  "https://bakerymarmotte-cmyk.github.io/marmotte-design/components.css"
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

// Nur die Grund-Shell-Dateien (HTML/CSS/Manifest) werden zwischengespeichert.
// JavaScript-Module (.js) werden absichtlich NICHT gecacht, damit Updates am Code
// immer sofort ankommen und nicht durch eine alte, gecachte Version blockiert werden.

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isDesignOrigin = url.origin === DESIGN_ORIGIN;
  if (!isOwnOrigin && !isDesignOrigin) return;
  if (isOwnOrigin && url.pathname.endsWith(".js")) return; // JS immer frisch vom Netzwerk laden

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
