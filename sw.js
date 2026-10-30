// ============================================================
// G.K.IO — Service worker (PWA): instalável e abre sem rede.
//  · páginas: rede primeiro, cai para o último index.html guardado se estiver offline;
//  · arquivos do app (js/css/img): servem do cache e atualizam em segundo plano;
//  · SDK do Firebase / LiveKit (CDN): cache primeiro (são versões fixas na URL).
// Nada de dados de conversa passa por aqui: Firestore e Cloudinary vão direto pra rede.
// Para forçar todo mundo a baixar de novo, aumente VERSION.
// ============================================================
const VERSION = 'gkio-pwa-v1.8.2';
const CDN_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', 'index.html', 'manifest.json']).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(req, res) {
  if (!res || !res.ok || res.type === 'opaque') return res;
  try { (await caches.open(VERSION)).put(req, res.clone()); } catch (e) { /* cota cheia */ }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(async () => (await caches.match(req)) || (await caches.match('index.html')) || (await caches.match('./')) || Response.error()));
    return;
  }
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
  if (CDN_HOSTS.includes(url.hostname) && /\.(js|mjs|css|woff2?)(\?|$)/.test(url.pathname + url.search)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
  }
});
