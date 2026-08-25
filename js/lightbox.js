// ============================================================
// G.K.IO — Lightbox de imagens (clique para dar zoom, estilo Discord)
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';

let overlayEl = null;
let imgEl = null;

function buildLightbox() {
  imgEl = el('img', { class: 'gk-lightbox-img' });
  const closeBtn = el('button', {
    class: 'gk-lightbox-close', title: 'Fechar (Esc)',
    onclick: (e) => { e.stopPropagation(); closeLightbox(); },
  }, [icon('close', { size: 18 })]);
  const openBtn = el('a', {
    class: 'gk-lightbox-open', title: 'Abrir em nova aba', target: '_blank', rel: 'noopener',
    onclick: (e) => e.stopPropagation(),
  }, [icon('externalLink', { size: 18 })]);

  overlayEl = el('div', { class: 'gk-lightbox-overlay', id: 'gk-lightbox-overlay' }, [
    closeBtn, openBtn, imgEl,
  ]);
  overlayEl.addEventListener('click', () => closeLightbox());
  document.body.appendChild(overlayEl);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('gk-open')) closeLightbox();
  });
}

export function openImageLightbox(url) {
  if (!overlayEl) buildLightbox();
  imgEl.src = url;
  overlayEl.querySelector('.gk-lightbox-open').href = url;
  overlayEl.classList.add('gk-open');
}

function closeLightbox() {
  if (!overlayEl) return;
  overlayEl.classList.remove('gk-open');
  imgEl.src = '';
}
