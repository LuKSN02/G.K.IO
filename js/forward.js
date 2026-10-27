// ============================================================
// G.K.IO — Encaminhar mensagem
// Copia texto e anexos para outra conversa (DM, grupo ou canal do servidor aberto),
// marcando "Encaminhada de {autor}". Enquetes e respostas não são copiadas.
// ============================================================
import {
  auth, dmDoc, dmMessagesCol, channelDoc, addChannelMessage, addDoc, updateDoc, serverTimestamp,
} from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { getCategoriesAndChannels, canSendInChannel, canViewChannel } from './servers.js';
import { messagePreview } from './message-utils.js';

const COPY_KEYS = ['attachmentUrl', 'attachmentType', 'attachmentName', 'attachments', 'sticker'];

export const canForward = (msg) => !!msg && !msg.poll && !msg.system && !!(msg.content || msg.attachmentUrl || (Array.isArray(msg.attachments) && msg.attachments.length) || msg.sticker);

/** Documento da mensagem encaminhada (puro, para teste). */
export function buildForwardPayload(msg, me) {
  const p = {
    authorId: me.uid, authorName: me.displayName || me.username || 'Usuário', authorAvatar: me.avatarUrl || '', authorRole: me.role || 'free',
    authorTag: me.tag || '', authorFrameStyle: me.frameStyle || 'none', createdAt: serverTimestamp(),
    content: String(msg.content || '').slice(0, 4000),
    forwarded: { name: String(msg.forwarded?.name || msg.authorName || 'Usuário').slice(0, 60) }, // mantém o autor original
  };
  for (const k of COPY_KEYS) if (msg[k] !== undefined && msg[k] !== null) p[k] = msg[k];
  return p;
}

async function sendTo(target, payload) {
  const preview = (payload.content || '').slice(0, 80) || '↪ Mensagem encaminhada';
  if (target.kind === 'dm') {
    await addDoc(dmMessagesCol(target.id), payload);
    await updateDoc(dmDoc(target.id), { lastMessageAt: serverTimestamp(), lastMessageAuthorId: payload.authorId, lastMessagePreview: preview });
  } else {
    await addChannelMessage(target.serverId, target.id, payload, target.slow || 0);
    await updateDoc(channelDoc(target.serverId, target.id), { lastMessageAt: serverTimestamp(), lastMessageAuthorId: payload.authorId });
  }
}

export function listTargets() {
  const out = [];
  for (const dm of state.dms?.values?.() || []) {
    const name = dm.other?.displayName || dm.other?.username; if (!name) continue;
    out.push({ kind: 'dm', id: dm.id, label: name, sub: dm.isGroup ? 'Grupo' : 'Mensagem direta' });
  }
  const sid = state.currentServerId;
  if (sid && !state.currentDmId) {
    for (const ch of getCategoriesAndChannels().channels) {
      if (ch.type !== 'text' || !canViewChannel(sid, ch) || !canSendInChannel(sid, ch)) continue;
      out.push({ kind: 'channel', id: ch.id, serverId: sid, slow: Number(ch.slowmodeSeconds) || 0, label: '# ' + ch.name, sub: state.servers.get(sid)?.name || 'Servidor' });
    }
  }
  return out;
}

export function openForwardModal(msg) {
  const me = state.user; if (!me || !canForward(msg)) return;
  me.uid = me.uid || auth.currentUser?.uid;
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
  const close = () => overlay.classList.remove('gk-open');
  const search = el('input', { type: 'search', class: 'gk-sv-input', placeholder: 'Buscar conversa…', 'aria-label': 'Buscar conversa' });
  const list = el('div', { class: 'gk-forward-list' });
  const chosen = new Set(); const targets = listTargets();
  const send = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', disabled: 'true' }, [icon('send', { size: 14 }), ' Encaminhar']);
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const paint = () => {
    list.innerHTML = ''; const q = norm(search.value.trim());
    const shown = targets.filter((t) => !q || norm(t.label).includes(q));
    if (!shown.length) list.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhuma conversa encontrada.'));
    for (const t of shown) {
      const key = t.kind + ':' + t.id; const box = el('input', { type: 'checkbox' }); box.checked = chosen.has(key);
      box.addEventListener('change', () => { box.checked ? chosen.add(key) : chosen.delete(key); send.disabled = chosen.size === 0; });
      list.appendChild(el('label', { class: 'gk-forward-row' }, [box, el('span', {}, [el('b', {}, t.label), el('small', {}, t.sub)])]));
    }
  };
  search.addEventListener('input', paint); paint();
  send.addEventListener('click', async () => {
    send.disabled = true; let ok = 0, fail = 0;
    for (const t of targets.filter((x) => chosen.has(x.kind + ':' + x.id))) {
      try { await sendTo(t, buildForwardPayload(msg, me)); ok++; } catch (e) { fail++; }
    }
    toast(fail ? `Encaminhada para ${ok}; ${fail} falhou (permissão ou modo lento).` : `Mensagem encaminhada para ${ok} conversa${ok === 1 ? '' : 's'}.`, fail ? 'danger' : undefined);
    close();
  });
  modal.appendChild(el('h2', {}, 'Encaminhar mensagem'));
  modal.appendChild(el('div', { class: 'gk-delete-preview' }, messagePreview(msg, 200) || 'Mensagem'));
  modal.appendChild(search); modal.appendChild(list);
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn', type: 'button', onclick: close }, 'Cancelar'), send]));
  overlay.classList.add('gk-open'); search.focus();
}
