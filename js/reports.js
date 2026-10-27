// ============================================================
// G.K.IO — Denúncias de mensagens e de usuários
// Vão para a coleção `reports`. Quem lê: os administradores do app (isAdmin) e,
// nas denúncias feitas dentro de um servidor, quem pode expulsar membros dali.
// Em DMs ninguém além de você enxerga a conversa — por isso a denúncia leva um
// trecho da mensagem (até 300 caracteres) e o administrador só vê isso.
// ============================================================
import {
  auth, reportsCol, reportDoc, addDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, limit, serverTimestamp,
} from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { messagePreview } from './message-utils.js';

export const REASONS = [
  ['spam', 'Spam ou propaganda'], ['harassment', 'Assédio ou ofensas'], ['sexual', 'Conteúdo sexual / NSFW'],
  ['violence', 'Violência ou ameaça'], ['scam', 'Golpe ou phishing'], ['other', 'Outro motivo'],
];
export const reasonLabel = (k) => REASONS.find((r) => r[0] === k)?.[1] || k;

/** Monta o documento da denúncia (puro, para teste). */
export function buildReport({ reporterId, kind, targetUid, targetName, reason, details, msg, serverId, channelId, dmId }) {
  const r = {
    reporterId, kind: kind === 'user' ? 'user' : 'message', targetUid: String(targetUid || ''), targetName: String(targetName || '').slice(0, 60),
    reason: REASONS.some((x) => x[0] === reason) ? reason : 'other', details: String(details || '').trim().slice(0, 300),
    snippet: msg ? messagePreview(msg, 300).slice(0, 300) : '', messageId: msg?.id || null,
    serverId: serverId || null, channelId: channelId || null, dmId: dmId || null, status: 'open', createdAt: serverTimestamp(),
  };
  return r;
}
export async function submitReport(args) {
  const me = auth.currentUser?.uid; if (!me) throw new Error('Entre para denunciar.');
  if (args.targetUid === me) throw new Error('Você não pode denunciar a si mesmo.');
  await addDoc(reportsCol(), buildReport({ ...args, reporterId: me }));
}

export function openReportModal({ kind = 'message', msg = null, targetUid, targetName }) {
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
  const close = () => overlay.classList.remove('gk-open');
  const sel = el('select', { class: 'gk-select', 'aria-label': 'Motivo da denúncia' }, REASONS.map(([k, l]) => el('option', { value: k }, l)));
  const details = el('textarea', { class: 'gk-sv-input gk-sv-textarea', rows: '3', maxlength: '300', placeholder: 'Conte o que aconteceu (opcional)', 'aria-label': 'Detalhes' });
  const send = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, [icon('shield', { size: 14 }), ' Enviar denúncia']);
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await submitReport({
        kind, targetUid, targetName, reason: sel.value, details: details.value, msg,
        serverId: state.currentDmId ? null : state.currentServerId, channelId: state.currentDmId ? null : state.currentChannelId, dmId: state.currentDmId || null,
      });
      toast('Denúncia enviada. Obrigado por avisar.'); close();
    } catch (e) { send.disabled = false; toast(e.message || 'Não foi possível enviar a denúncia.', 'danger'); }
  });
  modal.appendChild(el('h2', {}, kind === 'user' ? `Denunciar ${targetName || 'usuário'}` : 'Denunciar mensagem'));
  if (msg) modal.appendChild(el('div', { class: 'gk-delete-preview' }, messagePreview(msg, 220) || 'Mensagem'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Motivo'), sel]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Detalhes'), details]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn', type: 'button', onclick: close }, 'Cancelar'), send]));
  overlay.classList.add('gk-open');
}

/** Lista denúncias para moderação. scope: { serverId } (moderadores do servidor) ou {} (admin do app). */
export async function loadReports({ serverId = null } = {}) {
  const q = serverId ? query(reportsCol(), where('serverId', '==', serverId), limit(100)) : query(reportsCol(), orderBy('createdAt', 'desc'), limit(100));
  const snap = await getDocs(q);
  const list = []; snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  const ms = (r) => r.createdAt?.toMillis?.() || 0;
  return list.sort((a, b) => ms(b) - ms(a));
}
export async function setReportStatus(id, status) {
  await updateDoc(reportDoc(id), { status: status === 'resolved' ? 'resolved' : 'open', resolvedBy: auth.currentUser.uid, resolvedAt: serverTimestamp() });
}
export async function removeReport(id) { await deleteDoc(reportDoc(id)); }

/** Cartão com a lista de denúncias (usado em Administração e Moderação). */
export function buildReportsCard({ serverId = null, canDelete = false } = {}) {
  const body = el('div', { class: 'gk-reports-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);
  const card = el('div', { class: 'gk-sv-card gk-settings-card' }, [el('div', { class: 'gk-settings-card-title' }, [icon('shield', { size: 14 }), ' Denúncias']), body]);
  const render = async () => {
    body.innerHTML = '';
    let list; try { list = await loadReports({ serverId }); } catch (e) { body.appendChild(el('div', { class: 'gk-sv-empty' }, 'Não foi possível carregar as denúncias.')); return; }
    if (!list.length) { body.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhuma denúncia.')); return; }
    for (const r of list) {
      const open = r.status !== 'resolved';
      body.appendChild(el('div', { class: 'gk-report-row' + (open ? '' : ' gk-resolved') }, [
        el('div', { class: 'gk-report-head' }, [el('b', {}, r.targetName || 'Usuário'), el('span', { class: 'gk-report-reason' }, reasonLabel(r.reason)), el('small', {}, r.createdAt?.toDate?.().toLocaleString('pt-BR') || '')]),
        r.snippet ? el('div', { class: 'gk-report-snippet' }, r.snippet) : null,
        r.details ? el('div', { class: 'gk-report-details' }, r.details) : null,
        el('div', { class: 'gk-extras-row' }, [
          el('button', { class: 'gk-btn', type: 'button', onclick: async () => { try { await setReportStatus(r.id, open ? 'resolved' : 'open'); render(); } catch (e) { toast('Não foi possível atualizar.', 'danger'); } } }, open ? 'Marcar como resolvida' : 'Reabrir'),
          canDelete ? el('button', { class: 'gk-btn', type: 'button', onclick: async () => { try { await removeReport(r.id); render(); } catch (e) { toast('Não foi possível apagar.', 'danger'); } } }, [icon('trash', { size: 13 }), ' Apagar']) : null,
        ]),
      ]));
    }
  };
  render();
  return card;
}
