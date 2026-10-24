// ============================================================
// G.K.IO — Tópicos (threads): respostas organizadas debaixo de uma mensagem
// As respostas ficam em .../messages/{id}/threadMessages/{replyId} (canal ou DM)
// e a mensagem-mãe guarda threadCount / threadLastAt para mostrar "N respostas".
// Aqui só há a tela do tópico; o botão e o contador são ligados em chat.js.
// ============================================================
import {
  auth, onSnapshot, query, orderBy, limit, addDoc, updateDoc, deleteDoc, increment, serverTimestamp,
  channelThreadCol, channelThreadDoc, channelMessageDoc, dmThreadCol, dmThreadDoc, dmMessageDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { renderRichText } from './markdown.js';
import { isBlocked } from './blocks.js';
import { messagePreview } from './message-utils.js';

const MAX_LEN = 2000;
const MAX_LOAD = 200;
let activeUnsub = null;

function ctx() {
  if (state.currentDmId) return { kind: 'dm', dmId: state.currentDmId };
  if (state.currentServerId && state.currentChannelId) return { kind: 'channel', serverId: state.currentServerId, channelId: state.currentChannelId };
  return null;
}
const parentRef = (c, id) => (c.kind === 'dm' ? dmMessageDoc(c.dmId, id) : channelMessageDoc(c.serverId, c.channelId, id));
const repliesCol = (c, id) => (c.kind === 'dm' ? dmThreadCol(c.dmId, id) : channelThreadCol(c.serverId, c.channelId, id));
const replyRef = (c, id, rid) => (c.kind === 'dm' ? dmThreadDoc(c.dmId, id, rid) : channelThreadDoc(c.serverId, c.channelId, id, rid));

/** Texto do contador: "1 resposta", "5 respostas". */
export function threadCountLabel(n) { return n === 1 ? '1 resposta' : `${n} respostas`; }

/** Botão "N respostas" que aparece embaixo da mensagem-mãe (ou null se não houver). */
export function buildThreadLink(msg) {
  const n = Number(msg.threadCount) || 0;
  if (n <= 0) return null;
  return el('button', {
    class: 'gk-thread-link', type: 'button', title: 'Abrir tópico',
    onclick: () => openThread(msg),
  }, [icon('chatBubble', { size: 13 }), el('b', {}, threadCountLabel(n))]);
}

function closeThread() {
  if (activeUnsub) { try { activeUnsub(); } catch (e) { /* já fechado */ } activeUnsub = null; }
  document.getElementById('gk-generic-modal')?.classList.remove('gk-thread-modal');
  document.getElementById('gk-generic-modal-overlay')?.classList.remove('gk-open');
}

function fmtTime(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  if (!d) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function openThread(msg) {
  const c = ctx();
  if (!c || !msg?.id) return;
  const me = auth.currentUser?.uid;
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  if (activeUnsub) { activeUnsub(); activeUnsub = null; }
  modal.innerHTML = '';
  modal.classList.remove('gk-modal-wizard');
  modal.classList.add('gk-thread-modal');

  const list = el('div', { class: 'gk-thread-list', role: 'log', 'aria-live': 'polite' });
  const counter = el('span', { class: 'gk-thread-count' }, threadCountLabel(Number(msg.threadCount) || 0));
  const input = el('textarea', {
    class: 'gk-thread-input', rows: '1', maxlength: String(MAX_LEN), placeholder: 'Responder no tópico…', 'aria-label': 'Responder no tópico',
  });
  const sendBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, [icon('send', { size: 14 }), ' Enviar']);

  const closeBtn = el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Fechar', 'aria-label': 'Fechar tópico', onclick: closeThread }, [icon('close', { size: 16 })]);
  modal.appendChild(el('div', { class: 'gk-thread-head' }, [
    el('div', { class: 'gk-thread-title' }, [icon('chatBubble', { size: 16 }), el('h2', {}, 'Tópico'), counter]),
    closeBtn,
  ]));
  const parentText = msg.content ? renderRichText(msg.content) : [messagePreview(msg, 200) || 'Mensagem'];
  modal.appendChild(el('div', { class: 'gk-thread-parent' }, [
    el('div', { class: 'gk-avatar gk-sz-32' }, [el('img', { src: msg.authorAvatar || fallbackAvatar(msg.authorName || 'GK'), alt: '' })]),
    el('div', { class: 'gk-thread-parent-body' }, [
      el('b', {}, msg.authorName || 'Usuário'),
      el('div', { class: 'gk-thread-parent-text' }, parentText),
    ]),
  ]));
  modal.appendChild(list);
  modal.appendChild(el('div', { class: 'gk-thread-composer' }, [input, sendBtn]));
  overlay.classList.add('gk-open');
  overlay.addEventListener('click', onOverlayClick);
  function onOverlayClick(e) {
    if (e.target === overlay) { closeThread(); overlay.removeEventListener('click', onOverlayClick); }
  }

  function render(docs) {
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    list.innerHTML = '';
    counter.textContent = threadCountLabel(docs.length);
    if (!docs.length) {
      list.appendChild(el('div', { class: 'gk-empty-state' }, [el('div', {}, 'Nenhuma resposta ainda. Comece o tópico!')]));
      return;
    }
    for (const r of docs) {
      const hidden = isBlocked(r.authorId) && r.authorId !== me;
      const row = el('div', { class: 'gk-thread-reply', 'data-id': r.id }, [
        el('div', { class: 'gk-avatar gk-sz-32' }, [el('img', { src: r.authorAvatar || fallbackAvatar(r.authorName || 'GK'), alt: '' })]),
        el('div', { class: 'gk-thread-reply-body' }, [
          el('div', { class: 'gk-thread-reply-head' }, [el('b', {}, r.authorName || 'Usuário'), el('small', {}, fmtTime(r.createdAt))]),
          hidden
            ? el('div', { class: 'gk-thread-blocked' }, 'Mensagem de um usuário bloqueado.')
            : el('div', { class: 'gk-thread-reply-text' }, renderRichText(r.content || '')),
        ]),
      ]);
      if (r.authorId === me) {
        row.appendChild(el('button', {
          class: 'gk-msg-action-btn gk-msg-action-danger', type: 'button', title: 'Apagar resposta', 'aria-label': 'Apagar resposta',
          onclick: async () => {
            try {
              await deleteDoc(replyRef(c, msg.id, r.id));
              await updateDoc(parentRef(c, msg.id), { threadCount: increment(-1) });
            } catch (e) { toast('Não foi possível apagar a resposta.', 'danger'); }
          },
        }, [icon('trash', { size: 13 })]));
      }
      list.appendChild(row);
    }
    if (stick) list.scrollTop = list.scrollHeight;
  }

  const q = query(repliesCol(c, msg.id), orderBy('createdAt', 'asc'), limit(MAX_LOAD));
  activeUnsub = onSnapshot(q, (snap) => render(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {
    list.innerHTML = '';
    list.appendChild(el('div', { class: 'gk-empty-state' }, [el('div', {}, 'Não foi possível carregar o tópico.')]));
  });

  let sending = false;
  async function send() {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; sendBtn.disabled = true;
    try {
      await addDoc(repliesCol(c, msg.id), {
        authorId: me,
        authorName: state.user.displayName || state.user.username,
        authorAvatar: state.user.avatarUrl || '',
        content: text.slice(0, MAX_LEN),
        createdAt: serverTimestamp(),
      });
      await updateDoc(parentRef(c, msg.id), { threadCount: increment(1), threadLastAt: serverTimestamp() });
      input.value = '';
      input.style.height = '';
    } catch (e) {
      toast(e?.code === 'permission-denied' ? 'Você não pode responder neste tópico agora.' : 'Não foi possível enviar a resposta.', 'danger');
    } finally { sending = false; sendBtn.disabled = false; input.focus(); }
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') closeThread();
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  setTimeout(() => input.focus(), 30);
}
