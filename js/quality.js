// ============================================================
// Qualidade de vida: rascunhos por conversa + teclado no celular.
// ============================================================
import { state } from './state.js';

// ---------- Rascunhos ----------
const KEY = 'gkio-drafts';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* noop */ } };
const convKey = () => state.currentDmId ? `dm:${state.currentDmId}` : (state.currentServerId && state.currentChannelId ? `ch:${state.currentServerId}/${state.currentChannelId}` : null);

let lastKey = null;
function setDraft(k, v) {
  if (!k) return;
  const o = load();
  if (v) o[k] = { t: v, at: Date.now() }; else delete o[k];
  // guarda no máximo 60 rascunhos (os mais recentes)
  const ks = Object.keys(o);
  if (ks.length > 60) ks.sort((a, b) => o[a].at - o[b].at).slice(0, ks.length - 60).forEach((x) => delete o[x]);
  save(o);
}
function tick() {
  const ta = document.getElementById('gk-composer-input');
  if (!ta) return;
  const k = convKey();
  if (k !== lastKey) {
    // Trocou de conversa: o texto que estava no campo é da conversa ANTERIOR (já foi
    // salvo por ela) — o campo passa a mostrar só o rascunho da nova conversa.
    const prev = lastKey;
    if (prev && ta.value.trim()) setDraft(prev, ta.value);
    lastKey = k;
    if (k) {
      const d = load()[k];
      ta.value = d ? d.t : '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }
  setDraft(k, ta.value.trim() ? ta.value : '');
}
setInterval(tick, 120);
document.addEventListener('input', (e) => { if (e.target?.id === 'gk-composer-input') { const k = convKey(); if (k && k === lastKey) setDraft(k, e.target.value.trim() ? e.target.value : ''); } }, true);

// ---------- Teclado no celular ----------
const vv = window.visualViewport;
if (vv) {
  const app = () => document.getElementById('gk-app');
  const fit = () => {
    const el = app(); if (!el) return;
    const mobile = window.innerWidth <= 900;
    const kb = mobile && window.innerHeight - vv.height > 120;
    if (kb) {
      el.style.height = vv.height + 'px';
      window.scrollTo(0, 0);
      const ta = document.getElementById('gk-composer-input');
      if (document.activeElement === ta) document.getElementById('gk-messages')?.scrollTo({ top: 1e9 });
    } else if (el.style.height) el.style.height = '';
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

// ---------- Imagens do chat: desfoque até carregar ----------
(function imgBlurUp() {
  const mark = (img) => img.classList.add('gk-img-ok');
  const handle = (img) => {
    if (img.classList.contains('gk-img-ok')) return;
    if (img.complete && img.naturalWidth > 0) { mark(img); return; }
    img.addEventListener('load', () => mark(img), { once: true });
    img.addEventListener('error', () => mark(img), { once: true });
  };
  const scan = (root) => root.querySelectorAll?.('.gk-msg-attachment img').forEach(handle);
  const start = () => {
    const box = document.getElementById('gk-messages');
    if (!box) { setTimeout(start, 1000); return; }
    new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches?.('.gk-msg-attachment img')) handle(n); else scan(n); } }); }).observe(box, { childList: true, subtree: true });
    scan(box);
  };
  start();
})();
