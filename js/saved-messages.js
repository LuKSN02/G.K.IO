// ============================================================
// G.K.IO — Mensagens salvas (só para você)
// Guarda uma cópia curta da mensagem em users/{uid}/saved/{msgId} para ler depois.
// Clique num item para ir até a conversa. Regras: ver firestore.rules (users/{uid}/saved).
// ============================================================
import { auth, db, doc, collection, setDoc, deleteDoc, getDocs, query, orderBy, limit, serverTimestamp } from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';
import { getCategoriesAndChannels } from './servers.js';
import { triggerNotificationTap } from './push.js';

const col = () => collection(db, 'users', auth.currentUser.uid, 'saved');

export async function saveMessage(msg) {
  if (!auth.currentUser || !msg?.id) return;
  const channel = state.currentServerId ? getCategoriesAndChannels().channels.find((c) => c.id === state.currentChannelId) : null;
  const where = state.currentDmId
    ? { type: 'dm', dmId: state.currentDmId }
    : { type: 'channel', serverId: state.currentServerId, channelId: state.currentChannelId, channelName: channel?.name || '' };
  try {
    await setDoc(doc(col(), msg.id), {
      content: String(msg.content || '').slice(0, 1000),
      authorName: String(msg.authorName || '').slice(0, 60),
      authorId: msg.authorId || '',
      attachmentName: msg.attachmentName ? String(msg.attachmentName).slice(0, 120) : '',
      sentAt: msg.createdAt?.toMillis ? msg.createdAt.toMillis() : Date.now(),
      where,
      savedAt: serverTimestamp(),
    });
    toast('Mensagem salva. Veja em "Mensagens salvas".');
  } catch (e) { toast('Não foi possível salvar (publicou o firestore.rules novo?).', 'danger'); }
}

export async function openSavedModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal(); modal.innerHTML = '';
  const close = () => overlay.classList.remove('gk-open');
  const list = el('div', { class: 'gk-saved-list' }, el('div', { class: 'gk-hint' }, 'Carregando…'));
  modal.append(
    el('div', { class: 'gk-modal-icon-header' }, [el('div', { class: 'gk-modal-icon' }, [icon('pin', { size: 22 })]),
      el('div', {}, [el('h2', {}, 'Mensagens salvas'), el('p', { class: 'gk-modal-sub' }, 'Só você vê esta lista.')])]),
    list,
    el('div', { class: 'gk-poll-footer-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar')]),
  );
  overlay.classList.add('gk-open');
  let docs = [];
  try { docs = (await getDocs(query(col(), orderBy('savedAt', 'desc'), limit(100)))).docs; }
  catch (e) { list.replaceChildren(el('div', { class: 'gk-hint' }, 'Não foi possível carregar as mensagens salvas.')); return; }
  if (!docs.length) { list.replaceChildren(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nada salvo ainda. Clique com o botão direito numa mensagem → "Salvar mensagem".')); return; }
  list.replaceChildren(...docs.map((d) => {
    const x = d.data();
    return el('div', { class: 'gk-saved-item' }, [
      el('div', { class: 'gk-saved-body', onclick: () => { close(); triggerNotificationTap({ ...x.where, id: d.id }); } }, [
        el('b', {}, x.authorName || 'Alguém'),
        el('span', { class: 'gk-saved-where' }, x.where?.type === 'dm' ? ' · conversa direta' : x.where?.channelName ? ` · #${x.where.channelName}` : ''),
        el('div', { class: 'gk-saved-text' }, x.content || (x.attachmentName ? `📎 ${x.attachmentName}` : '(sem texto)')),
      ]),
      el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Remover dos salvos', 'aria-label': 'Remover dos salvos',
        onclick: async (e) => { e.stopPropagation(); try { await deleteDoc(d.ref); e.currentTarget.closest('.gk-saved-item').remove(); } catch (err) { toast('Não foi possível remover.', 'danger'); } } }, [icon('trash', { size: 14 })]),
    ]);
  }));
}
