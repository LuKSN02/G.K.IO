// ============================================================
// G.K.IO — Worker de pré-visualização de links (Cloudflare Workers, plano grátis)
// ------------------------------------------------------------
// Como publicar:
//  1. dash.cloudflare.com > Workers & Pages > Create > Worker > cole este arquivo > Deploy.
//  2. Copie a URL (https://....workers.dev) para js/preview-config.js (endpoint).
// Uso: GET /?url=https://site.com/pagina  ->  { url, title, description, image, site }
// Proteções: só http/https; recusa localhost/IPs privados; lê no máximo 512 KB; 4 s de limite;
// responde com cache de 1 h; devolve só texto curto (o app mostra com textContent, nunca como HTML).
// ============================================================
const MAX_BYTES = 512 * 1024;
const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'content-type': 'application/json; charset=utf-8' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, ...extra } });

function decode(s = '') {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff))).trim();
}
function meta(html, keys) {
  for (const k of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const val = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (val) return decode(val);
  }
  return '';
}
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(req.url).searchParams.get('url') || '';
    let u; try { u = new URL(target); } catch (e) { return json({ error: 'url inválida' }, 400); }
    if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) return json({ error: 'url não permitida' }, 400);
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(u.href, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; GKIO-LinkPreview/1.0)', accept: 'text/html' }, cf: { cacheTtl: 3600, cacheEverything: true } });
      clearTimeout(t);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/text\/html|application\/xhtml/i.test(type)) return json({ url: u.href }, 200, { 'cache-control': 'public, max-age=3600' });
      const reader = res.body.getReader(); const chunks = []; let size = 0;
      while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
      try { reader.cancel(); } catch (e) { /* ok */ }
      const html = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
      const head = html.slice(0, MAX_BYTES);
      let image = meta(head, ['og:image', 'twitter:image']);
      if (image) { try { image = new URL(image, u.href).href; } catch (e) { image = ''; } if (!/^https:/i.test(image)) image = ''; }
      const title = meta(head, ['og:title', 'twitter:title']) || decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '');
      return json({
        url: u.href, title: title.slice(0, 140),
        description: (meta(head, ['og:description', 'twitter:description', 'description'])).slice(0, 280),
        image, site: (meta(head, ['og:site_name']) || u.hostname.replace(/^www\./, '')).slice(0, 60),
      }, 200, { 'cache-control': 'public, max-age=3600' });
    } catch (e) { return json({ url: u.href }, 200); }
  },
};
