// Minimaler Service Worker für Marmotte Zeiterfassung
// Sorgt dafür, dass die App auf dem Smartphone als "installierbar" erkannt wird
// und die Grundseiten auch bei kurzzeitig fehlender Verbindung geladen werden können.
// Zeigt ausserdem die Push-Meldungen von M.A.R.M.O.T. an.

// Achtung: Cache Storage ist pro Origin, nicht pro App. Die Bestellungen-App
// liegt auf derselben Origin und nutzt das Praefix "marmotte-bestellungen-".
// Beim Aufraeumen darf daher nur geloescht werden, was zu DIESER App gehoert –
// sonst raeumen sich die beiden Apps gegenseitig den Cache ab.
const CACHE_PREFIX = "marmotte-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v10`;
const DESIGN_ORIGIN = "https://bakerymarmotte-cmyk.github.io";
const DESIGN = "https://bakerymarmotte-cmyk.github.io/marmotte-design";
const SHELL_FILES = [
  "./index.html",
  "./app.html",
  "./change-password.html",
  "./style.css",
  "./manifest.json",
  `${DESIGN}/marmotte.css`,
  `${DESIGN}/theme.js`,
  `${DESIGN}/icons.js`,
  `${DESIGN}/fonts/roboto-400.woff2`,
  `${DESIGN}/fonts/roboto-500.woff2`,
  `${DESIGN}/fonts/roboto-700.woff2`,
  `${DESIGN}/fonts/roboto-mono-500.woff2`
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
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Nur die Grund-Shell-Dateien (HTML/CSS/Manifest, Design-Dateien) werden zwischengespeichert.
// JavaScript-Module (.js) werden absichtlich NICHT gecacht, damit Updates am Code
// immer sofort ankommen und nicht durch eine alte, gecachte Version blockiert werden.

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isDesignOrigin = url.origin === DESIGN_ORIGIN;
  if (!isOwnOrigin && !isDesignOrigin) return;
  // App-eigenes JS immer frisch vom Netzwerk laden (nicht cachen).
  // Ausnahme: die Design-Skripte (theme.js, icons.js) – die werden wie CSS behandelt:
  // zuerst Netzwerk, bei fehlender Verbindung aus dem Cache.
  const isDesignFile = url.pathname.startsWith("/marmotte-design/");
  if (isOwnOrigin && url.pathname.endsWith(".js") && !isDesignFile) return;
  // Seitenaufrufe mit Parametern (z.B. app.html?zeige=… aus einer Meldung) nicht cachen
  if (isOwnOrigin && url.search) return;

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

// ---------- Push-Meldungen von M.A.R.M.O.T. ----------
// Inhalt: { titel, text, url, tag }
self.addEventListener("push", (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { text: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(m.titel || "Marmotte Zeiterfassung", {
      body: m.text || "",
      icon: "assets/icon-192.png",
      tag: m.tag || undefined,
      renotify: !!m.tag,
      data: { url: m.url || "./app.html" },
    })
  );
});

// Antippen: offene App nach vorne holen und an die richtige Stelle springen, sonst neu öffnen
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = new URL(event.notification.data?.url || "./app.html", self.registration.scope).href;
  event.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenster) {
      if (f.url.startsWith(self.registration.scope) && "navigate" in f) {
        await f.focus();
        return f.navigate(ziel);
      }
    }
    return self.clients.openWindow(ziel);
  })());
});
