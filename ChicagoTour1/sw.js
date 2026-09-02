/* =========================================================================
   Service Worker für die Chicago-Tagestour

   Ziel: Wenn unterwegs das Netz wegbricht, soll die App weiter benutzbar
   sein. Karten-Kacheln lassen sich nicht vollständig vorhalten, aber alles
   andere schon: die Seite selbst, die Route, die Bilder und Mapbox GL.

   Drei Strategien:
   - App-Dateien (HTML, Manifest, Icons): erst Cache, dann Netz
   - Route (Directions API): erst Netz, bei Fehler der letzte Stand
   - Bilder, Fonts, Kacheln: erst Cache, sonst Netz und danach ablegen
   ========================================================================= */

/* Bei jeder inhaltlichen Änderung hochzählen. Alte Caches werden dadurch
   beim Aktivieren gelöscht und die Nutzer bekommen die neue Version. */
const VERSION = 'v8';
const APP_CACHE = `chicago-app-${VERSION}`;
const RUNTIME_CACHE = `chicago-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(c => c.addAll(APP_SHELL))
      /* Ein fehlendes Icon darf die Installation nicht kippen */
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Nur GET wird behandelt, alles andere geht direkt ans Netz. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Directions: aktuelle Route bevorzugen, offline den letzten Stand nehmen */
  if (url.hostname === 'api.mapbox.com' && url.pathname.startsWith('/directions')){
    event.respondWith(networkFirst(req));
    return;
  }

  /* Eigene Dateien */
  if (url.origin === self.location.origin){
    event.respondWith(cacheFirst(req, APP_CACHE));
    return;
  }

  /* Fremde Ressourcen: Mapbox GL, Fonts, Wikimedia-Bilder, Kacheln */
  if (['api.mapbox.com', 'events.mapbox.com', 'fonts.googleapis.com',
       'fonts.gstatic.com', 'upload.wikimedia.org'].includes(url.hostname)){
    /* Telemetrie nicht zwischenspeichern */
    if (url.hostname === 'events.mapbox.com') return;
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName){
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    /* Auch opaque Antworten (no-cors) ablegen, sie sind für Bilder brauchbar */
    if (res && (res.ok || res.type === 'opaque')){
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    /* Offline und nichts im Cache: bei Seitenaufrufen die Startseite liefern */
    if (req.mode === 'navigate'){
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function networkFirst(req){
  try {
    const res = await fetch(req);
    if (res && res.ok){
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}
