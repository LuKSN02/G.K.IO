// ============================================================
// G.K.IO — Lightbox de imagens com zoom (estilo Discord)
//  · clique na imagem: aproxima no ponto clicado (clique de novo: volta)
//  · roda do mouse / pinça: zoom contínuo em volta do cursor (100% a 800%)
//  · arrastar: move a imagem quando está aproximada
//  · + / − / 0 no teclado, botões na barra de baixo, Esc ou clique fora fecham
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';

const MIN = 1, MAX = 8;
let overlayEl = null, imgEl = null, pctEl = null, hintEl = null;
let s = 1, x = 0, y = 0;                 // escala e deslocamento (px) a partir do centro da tela
const pointers = new Map();               // ponteiros ativos (mouse/toque)
let drag = null, pinch = null, moved = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const vw = () => overlayEl.clientWidth, vh = () => overlayEl.clientHeight;

function limitPan() {
  const w = imgEl.offsetWidth * s, h = imgEl.offsetHeight * s;
  const mx = Math.max(0, (w - vw()) / 2), my = Math.max(0, (h - vh()) / 2);
  x = w <= vw() ? 0 : clamp(x, -mx, mx);
  y = h <= vh() ? 0 : clamp(y, -my, my);
}
function paint(smooth = false) {
  limitPan();
  imgEl.style.transition = smooth ? 'transform .18s cubic-bezier(.2,.8,.2,1)' : 'none';
  imgEl.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  overlayEl.classList.toggle('gk-zoomed', s > 1.001);
  pctEl.textContent = Math.round(s * 100) + '%';
  hintEl.style.opacity = s > 1.001 ? '0' : '';
}
// Zoom mantendo o ponto (px,py) da tela parado.
function zoomAt(next, px, py, smooth) {
  next = clamp(next, MIN, MAX);
  const cx = vw() / 2, cy = vh() / 2, k = next / s;
  x = (px - cx) - k * ((px - cx) - x);
  y = (py - cy) - k * ((py - cy) - y);
  s = next;
  if (s <= 1.001) { s = 1; x = 0; y = 0; }
  paint(smooth);
}
const reset = (smooth = true) => { s = 1; x = 0; y = 0; paint(smooth); };
// Alvo do clique: tamanho real da imagem (se couber) ou pelo menos 2,5x.
function clickScale() {
  const nat = imgEl.naturalWidth / (imgEl.offsetWidth || 1);
  return clamp(Math.max(2.5, nat), 2.5, 5);
}

function buildLightbox() {
  imgEl = el('img', { class: 'gk-lightbox-img', draggable: 'false', alt: '' });
  const closeBtn = el('button', { class: 'gk-lightbox-close', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: (e) => { e.stopPropagation(); closeLightbox(); } }, [icon('close', { size: 18 })]);
  const openBtn = el('a', { class: 'gk-lightbox-open', title: 'Abrir em nova aba', 'aria-label': 'Abrir em nova aba', target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, [icon('externalLink', { size: 18 })]);

  pctEl = el('span', { class: 'gk-lb-pct' }, '100%');
  const step = (f) => (e) => { e.stopPropagation(); zoomAt(s * f, vw() / 2, vh() / 2, true); };
  const bar = el('div', { class: 'gk-lb-bar', onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation() }, [
    el('button', { type: 'button', title: 'Diminuir (−)', 'aria-label': 'Diminuir zoom', onclick: step(1 / 1.5) }, [icon('minus', { size: 16 })]),
    pctEl,
    el('button', { type: 'button', title: 'Aumentar (+)', 'aria-label': 'Aumentar zoom', onclick: step(1.5) }, [icon('plus', { size: 16 })]),
    el('i', { class: 'gk-lb-sep' }),
    el('button', { type: 'button', title: 'Tamanho original da tela (0)', 'aria-label': 'Redefinir zoom', onclick: (e) => { e.stopPropagation(); reset(); } }, [icon('resetView', { size: 16 })]),
  ]);
  hintEl = el('div', { class: 'gk-lb-hint' }, 'Clique ou role para dar zoom');

  overlayEl = el('div', { class: 'gk-lightbox-overlay', id: 'gk-lightbox-overlay' }, [closeBtn, openBtn, imgEl, hintEl, bar]);
  document.body.appendChild(overlayEl);

  // roda do mouse (e pinça do touchpad, que chega como ctrl+roda)
  overlayEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(s * f, e.clientX, e.clientY, false);
  }, { passive: false });

  // arrastar / pinça / clique
  overlayEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, .gk-lb-bar')) return;
    overlayEl.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, onImg: e.target === imgEl };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: s };
      drag = null; moved = true;
    }
  });
  overlayEl.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
    } else if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!moved && Math.hypot(dx, dy) > 4) moved = true;
      if (moved && s > 1.001) { x = drag.ox + dx; y = drag.oy + dy; overlayEl.classList.add('gk-dragging'); paint(false); }
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    overlayEl.classList.remove('gk-dragging');
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && drag && !moved) {
      // clique parado: na imagem alterna o zoom; fora dela fecha
      if (drag.onImg) { if (s > 1.001) reset(); else zoomAt(clickScale(), e.clientX, e.clientY, true); }
      else closeLightbox();
    }
    if (pointers.size === 0) drag = null;
  };
  overlayEl.addEventListener('pointerup', end);
  overlayEl.addEventListener('pointercancel', end);

  document.addEventListener('keydown', (e) => {
    if (!overlayEl.classList.contains('gk-open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === '+' || e.key === '=') zoomAt(s * 1.5, vw() / 2, vh() / 2, true);
    else if (e.key === '-' || e.key === '_') zoomAt(s / 1.5, vw() / 2, vh() / 2, true);
    else if (e.key === '0') reset();
  });
  window.addEventListener('resize', () => { if (overlayEl.classList.contains('gk-open')) paint(false); });
}

export function openImageLightbox(url) {
  if (!overlayEl) buildLightbox();
  s = 1; x = 0; y = 0; pointers.clear(); drag = pinch = null;
  imgEl.src = url;
  overlayEl.querySelector('.gk-lightbox-open').href = url;
  overlayEl.classList.add('gk-open');
  paint(false);
}

function closeLightbox() {
  if (!overlayEl) return;
  overlayEl.classList.remove('gk-open', 'gk-zoomed', 'gk-dragging');
  imgEl.src = '';
}
