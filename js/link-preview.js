// ============================================================
// G.K.IO — Pré-visualização de links nas mensagens
//  · link de imagem (https) -> a imagem aparece embaixo da mensagem
//  · link do YouTube -> card com título e miniatura (oEmbed, sem servidor)
//  · demais sites -> card via Worker (js/preview-server.js), se configurado
// Tudo é mostrado com textContent; imagens só em https; links com rel=noopener.
// Dá para desligar em Configurações > Aparência.
// ============================================================
import { el } from './state.js';
import { previewConfig } from './preview-config.js';

const KEY = 'gkio-link-previews';
export const linkPreviewsEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } };
export function setLinkPreviews(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage indisponível */ } }

/** Primeiro link http(s) do texto, fora de blocos de código. */
export function firstUrl(text) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const m = t.match(/https?:\/\/[^\s<>"]+/i);
  if (!m) return null;
  const url = m[0].replace(/[)\].,;:!?'"]+$/, '');
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; }
}
export const isImageUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /\.(png|jpe?g|gif|webp|avif)$/i.test(x.pathname); } catch (e) { return false; } };
export function youtubeUrl(u) {
  try {
    const x = new URL(u); const h = x.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return x.pathname.length > 1;
    return h === 'youtube.com' && (x.pathname === '/watch' && x.searchParams.has('v') || /^\/(shorts|live)\//.test(x.pathname));
  } catch (e) { return false; }
}
const clean = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const httpsOrEmpty = (s) => { try { return new URL(s).protocol === 'https:' ? s : ''; } catch (e) { return ''; } };

const cache = new Map(); // url -> Promise<card|null>
export function fetchPreview(url) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    let raw = null;
    if (previewConfig.endpoint) {
      const r = await fetch(`${previewConfig.endpoint.replace(/\/$/, '')}/?url=${encodeURIComponent(url)}`, { cache: 'force-cache' });
      if (r.ok) raw = await r.json();
    } else if (youtubeUrl(url)) {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (r.ok) { const j = await r.json(); raw = { title: j.title, description: j.author_name, image: j.thumbnail_url, site: 'YouTube' }; }
    }
    if (!raw) return null;
    const card = { url, title: clean(raw.title, 140), description: clean(raw.description, 280), image: httpsOrEmpty(raw.image), site: clean(raw.site, 60) };
    return card.title || card.image ? card : null;
  })().catch(() => null);
  cache.set(url, p);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return p;
}

export function buildPreviewCard(c) {
  const kids = [];
  if (c.site) kids.push(el('div', { class: 'gk-lp-site' }, c.site));
  if (c.title) kids.push(el('div', { class: 'gk-lp-title' }, c.title));
  if (c.description) kids.push(el('div', { class: 'gk-lp-desc' }, c.description));
  const body = el('div', { class: 'gk-lp-body' }, kids);
  const card = el('a', { class: 'gk-link-preview', href: c.url, target: '_blank', rel: 'noopener noreferrer nofollow', 'aria-label': `Abrir ${c.title || c.url}` }, [body]);
  if (c.image) card.appendChild(el('img', { class: 'gk-lp-img', src: c.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  return card;
}

/** Chamado por chat.js depois de desenhar a mensagem. Não faz nada se a prévia estiver desligada. */
export function attachLinkPreview(row, msg) {
  if (!linkPreviewsEnabled() || !msg?.content) return;
  const url = firstUrl(msg.content); if (!url) return;
  if (isImageUrl(url)) {
    row.appendChild(el('a', { class: 'gk-link-img', href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, [
      el('img', { src: url, alt: 'Imagem do link', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    ]));
    return;
  }
  if (!previewConfig.endpoint && !youtubeUrl(url)) return;
  const slot = el('div', { class: 'gk-lp-slot' });
  row.appendChild(slot);
  fetchPreview(url).then((c) => { if (c) slot.appendChild(buildPreviewCard(c)); else slot.remove(); });
}
