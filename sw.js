// Guarda la app en el celular para que abra rápido. Los datos siempre se piden en línea.
const VERSION = 'mde-taller-v2';
const ARCHIVOS = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/api.js', 'js/app.js',
  'js/v-mecanico.js', 'js/v-oficina.js', 'js/v-clientes.js', 'js/v-stock.js', 'js/v-admin.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Primero la red (para recibir actualizaciones); si no hay conexión, la copia guardada.
self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;
  ev.respondWith(
    fetch(ev.request).then(r => {
      const copia = r.clone();
      caches.open(VERSION).then(c => c.put(ev.request, copia));
      return r;
    }).catch(() => caches.match(ev.request).then(r => r || caches.match('index.html')))
  );
});
