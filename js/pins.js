// ============================================================
// G.K.IO — Painel de mensagens fixadas
// A lista vem de uma consulta própria (where pinned == true), então mostra
// TODAS as fixadas da conversa, não só as últimas 200 carregadas na tela.
// ctx (montado em chat.js): getMessagesCol, canPin, jumpToMessage, togglePin
// ============================================================
import { query, where, getDocs } from './db.js';
import { el, toast, formatTime } from './state.js';
import { icon } from './icons.js';
import { messagePreview } from './message-utils.js';

export async function openPinnedPanel(ctx) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  const close = () => overlay.classList.remove('gk-open');

  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Mensagens fixadas'));
  const body = el('div', { class: 'gk-pins-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);
  modal.appendChild(body);
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar'),
  ]));
  overlay.classList.add('gk-open');

  const pins = [];
  try {
    const snap = await getDocs(query(ctx.getMessagesCol(), where('pinned', '==', true)));
    snap.forEach((d) => pins.push({ id: d.id, ...d.data() }));
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'gk-sv-empty' }, 'Não foi possível carregar as mensagens fixadas.'));
    return;
  }
  const pinnedAtMs = (m) => (m.pinnedAt?.toMillis ? m.pinnedAt.toMillis() : 0);
  pins.sort((a, b) => pinnedAtMs(b) - pinnedAtMs(a));

  const showEmptyIfNeeded = () => {
    if (body.querySelector('.gk-pin-item')) return;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhuma mensagem fixada ainda. Passe o mouse sobre uma mensagem e clique no alfinete.'));
  };

  body.innerHTML = '';
  for (const msg of pins) {
    const actions = [
      el('button', {
        class: 'gk-sv-pill', type: 'button',
        onclick: () => {
          close();
          if (!ctx.jumpToMessage(msg.id)) toast('Essa mensagem é mais antiga que as últimas 200 — role a conversa para cima.');
        },
      }, 'Ir para a mensagem'),
    ];
    const item = el('div', { class: 'gk-pin-item' });
    if (ctx.canPin()) {
      actions.push(el('button', {
        class: 'gk-sv-pill', type: 'button',
        onclick: async () => {
          if (await ctx.togglePin(msg)) { item.remove(); showEmptyIfNeeded(); }
        },
      }, 'Desafixar'));
    }
    item.appendChild(el('div', { class: 'gk-pin-head' }, [
      icon('pin', { size: 13 }),
      el('b', {}, msg.authorName || 'Usuário'),
      el('span', { class: 'gk-pin-time' }, formatTime(msg.createdAt)),
    ]));
    item.appendChild(el('div', { class: 'gk-pin-text' }, messagePreview(msg, 240) || '(mensagem vazia)'));
    item.appendChild(el('div', { class: 'gk-pin-actions' }, actions));
    body.appendChild(item);
  }
  showEmptyIfNeeded();
}
