// ============================================================
// G.K.IO — Service worker (PWA): instalável e abre sem rede.
//  · páginas: rede primeiro, cai para o último index.html guardado se estiver offline;
//  · arquivos do app (js/css/img): servem do cache e atualizam em segundo plano;
//  · SDK do Firebase / LiveKit (CDN): cache primeiro (são versões fixas na URL).
// Nada de dados de conversa passa por aqui: Firestore e Cloudinary vão direto pra rede.
// Para forçar todo mundo a baixar de novo, aumente VERSION.
// ============================================================
const VERSION = 'gkio-pwa-v1.9.89';
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

// ---------- Push (FCM Web) com o site fechado ----------
// O Worker manda só "data" ({title, body, type, dmId, serverId, channelId}). Se existe
// alguma aba do G.K.IO aberta, ela mesma já avisa (background-notify.js) — então não duplicamos.
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { /* sem corpo */ }
  const d = p.data || p; // FCM entrega { data: {...} }
  const title = d.title || (p.notification && p.notification.title) || 'G.K.IO';
  const body = d.body || (p.notification && p.notification.body) || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return;
    await self.registration.showNotification(title, {
      body,
      icon: 'img/favicon-180.png',
      badge: 'img/favicon-32.png',
      tag: d.dmId ? 'dm-' + d.dmId : d.channelId ? 'ch-' + d.channelId : 'gkio',
      renotify: true,
      data: { type: d.type, dmId: d.dmId, serverId: d.serverId, channelId: d.channelId },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      try { await w.focus(); } catch (err) { /* noop */ }
      w.postMessage({ type: 'gkio-notif-tap', data });
      return;
    }
    await self.clients.openWindow('./?gk-open=' + encodeURIComponent(JSON.stringify(data)));
  })());
});
