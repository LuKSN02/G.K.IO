// Canal-fórum: um canal de texto marcado com forum:true. Cada mensagem enviada nele vira um "post"
// (título + etiquetas) e as respostas vão para o tópico (threads.js).
import { state, el, toast } from './state.js';
import { getCategoriesAndChannels } from './servers.js';

export function isForumChannel() {
  if (!state.currentServerId || !state.currentChannelId) return false;
  return !!getCategoriesAndChannels().channels?.find((c) => c.id === state.currentChannelId)?.forum;
}

export function parseTags(s) {
  return String(s || '').split(',').map((t) => t.trim().replace(/^#/, '').slice(0, 20)).filter(Boolean).slice(0, 3);
}

/** Pede título e etiquetas; chama onDone({title, tags}). */
export function openForumPostModal(preview, onDone) {
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const title = el('input', { type: 'text', maxlength: '100', placeholder: 'Título do post' });
  const tags = el('input', { type: 'text', maxlength: '70', placeholder: 'dúvida, ideia, bug (até 3, separadas por vírgula)' });
  modal.appendChild(el('h2', {}, 'Novo post no fórum'));
  modal.appendChild(el('div', { class: 'gk-delete-preview' }, preview.length > 160 ? preview.slice(0, 160) + '…' : preview));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Título'), title]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Etiquetas (opcional)'), tags]));
  const go = () => {
    const t = title.value.trim(); if (!t) { toast('Dê um título ao post.', 'danger'); title.focus(); return; }
    overlay.classList.remove('gk-open'); onDone({ title: t, tags: parseTags(tags.value) });
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', { class: 'gk-btn gk-btn-primary', onclick: go }, 'Publicar'),
  ]));
  overlay.classList.add('gk-open'); setTimeout(() => title.focus(), 30);
}
