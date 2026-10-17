// ============================================================
// G.K.IO — Moderação: banir, castigo (timeout) e a janela "Moderar"
//   banimento : servers/{id}/bans/{uid}   (bloqueia voltar por convite — ver firestore.rules)
//   castigo   : campo `timeoutUntil` no doc do membro (as regras barram mensagem enquanto valer)
// ============================================================
import { auth, db, collection, doc, setDoc, deleteDoc, updateDoc, getDocs, serverTimestamp, memberDoc } from './db.js';
import { state, el, toast, fallbackAvatar, formatTime } from './state.js';
import { icon } from './icons.js';
import { canKickMembers, isServerOwner, kickMember } from './servers.js';
import { logAudit } from './audit.js';
import { confirmDangerAction, resetGenericModal } from './dialogs.js';
import { formatLong } from './message-utils.js';

const bansCol = (serverId) => collection(db, 'servers', serverId, 'bans');
const banDoc = (serverId, uid) => doc(db, 'servers', serverId, 'bans', uid);

export const TIMEOUT_OPTIONS = [
  [60, '60 segundos'], [300, '5 minutos'], [600, '10 minutos'], [3600, '1 hora'], [86400, '1 dia'], [604800, '1 semana'],
];

// timeoutUntil pode vir como Timestamp do Firestore, Date ou número.
export function getTimeoutUntilMs(member) {
  const t = member?.timeoutUntil;
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return Number(t) || 0;
}
export const isTimedOut = (member) => getTimeoutUntilMs(member) > Date.now();

// Hierarquia: ninguém modera a si mesmo nem o dono; admin só o dono modera.
export function canModerateTarget(serverId, member) {
  if (!member || member.uid === auth.currentUser?.uid || !canKickMembers(serverId)) return false;
  if (member.role === 'owner') return false;
  if (member.role === 'admin' && !isServerOwner(serverId)) return false;
  return true;
}

const displayNameOf = (m) => m.nickname || m.user?.displayName || m.user?.username || 'Membro';

// ---------- Castigo ----------
export async function timeoutMember(serverId, member, seconds) {
  await updateDoc(memberDoc(serverId, member.uid), {
    timeoutUntil: new Date(Date.now() + seconds * 1000),
    timeoutBy: auth.currentUser.uid,
  });
  const label = (TIMEOUT_OPTIONS.find(([s]) => s === seconds) || [0, `${seconds} s`])[1];
  logAudit(serverId, 'member.timeout', { targetId: member.uid, targetName: displayNameOf(member), details: { seconds, label } });
  toast(`${displayNameOf(member)} ficou de castigo por ${label}.`);
}

export async function clearTimeoutMember(serverId, member) {
  await updateDoc(memberDoc(serverId, member.uid), { timeoutUntil: null, timeoutBy: null });
  logAudit(serverId, 'member.timeout.clear', { targetId: member.uid, targetName: displayNameOf(member) });
  toast('Castigo removido.');
}

// ---------- Banimento ----------
export async function banMember(serverId, member, reason = '') {
  const me = state.user || {};
  const u = member.user || {};
  // 1) registra o ban primeiro: se isso falhar, ninguém é removido
  await setDoc(banDoc(serverId, member.uid), {
    uid: member.uid,
    username: u.username || '',
    displayName: u.displayName || u.username || '',
    avatarUrl: u.avatarUrl || '',
    reason: reason.trim().slice(0, 200),
    bannedBy: auth.currentUser.uid,
    bannedByName: me.displayName || me.username || '',
    createdAt: serverTimestamp(),
  });
  // 2) tira da lista de membros; se falhar, desfaz o ban para não ficar pela metade
  try {
    await kickMember(serverId, member.uid, { silent: true, audit: false });
  } catch (err) {
    await deleteDoc(banDoc(serverId, member.uid)).catch(() => {});
    throw err;
  }
  logAudit(serverId, 'member.ban', { targetId: member.uid, targetName: displayNameOf(member), details: { reason: reason.trim().slice(0, 200) } });
  toast(`${displayNameOf(member)} foi banido.`);
}

export async function unbanMember(serverId, ban) {
  await deleteDoc(banDoc(serverId, ban.uid));
  logAudit(serverId, 'member.unban', { targetId: ban.uid, targetName: ban.displayName || ban.username });
  toast(`${ban.displayName || ban.username || 'Usuário'} foi desbanido.`);
}

export async function listBans(serverId) {
  const snap = await getDocs(bansCol(serverId));
  const bans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ms = (b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
  return bans.sort((a, b) => ms(b) - ms(a));
}

// ---------- Janela "Moderar" ----------
export function openModerateModal(serverId, member) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  const close = () => overlay.classList.remove('gk-open');
  const name = displayNameOf(member);
  const run = async (fn, button) => {
    if (button) button.disabled = true;
    try { await fn(); close(); }
    catch (err) { toast(err.message || 'Não foi possível concluir a ação.', 'danger'); if (button) button.disabled = false; }
  };

  modal.innerHTML = '';
  modal.appendChild(el('div', { class: 'gk-mod-head' }, [
    el('div', { class: 'gk-avatar gk-sz-40' }, [el('img', { src: member.user?.avatarUrl || fallbackAvatar(member.user?.username || name) })]),
    el('div', {}, [el('h2', {}, `Moderar ${name}`), el('p', { class: 'gk-modal-sub' }, 'Escolha uma ação. Tudo fica registrado no log de auditoria.')]),
  ]));

  // --- castigo ---
  const timeoutCard = el('div', { class: 'gk-mod-card' });
  timeoutCard.appendChild(el('div', { class: 'gk-mod-card-title' }, [icon('clock', { size: 15 }), ' Castigo']));
  if (isTimedOut(member)) {
    const left = getTimeoutUntilMs(member) - Date.now();
    timeoutCard.appendChild(el('p', { class: 'gk-mod-card-text' }, `Em castigo — falta ${formatLong(left)}. Enquanto isso a pessoa não consegue enviar mensagens nos canais.`));
    const clearBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', id: 'gk-mod-clear-timeout' }, 'Remover castigo');
    clearBtn.addEventListener('click', () => run(() => clearTimeoutMember(serverId, member), clearBtn));
    timeoutCard.appendChild(clearBtn);
  } else {
    timeoutCard.appendChild(el('p', { class: 'gk-mod-card-text' }, 'A pessoa fica sem poder enviar mensagens nos canais pelo tempo escolhido.'));
    const select = el('select', { class: 'gk-sv-select', id: 'gk-mod-timeout-duration' }, TIMEOUT_OPTIONS.map(([s, label]) => el('option', { value: String(s) }, label)));
    select.value = '600';
    const applyBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', id: 'gk-mod-apply-timeout' }, 'Aplicar castigo');
    applyBtn.addEventListener('click', () => run(() => timeoutMember(serverId, member, Number(select.value)), applyBtn));
    timeoutCard.appendChild(el('div', { class: 'gk-mod-row' }, [select, applyBtn]));
  }
  modal.appendChild(timeoutCard);

  // --- expulsar ---
  const kickBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', id: 'gk-mod-kick' }, 'Expulsar');
  kickBtn.addEventListener('click', () => confirmDangerAction(
    'Expulsar membro', `Remover "${name}" deste servidor? Ele ainda pode voltar com um convite.`,
    () => kickMember(serverId, member.uid),
    { confirmLabel: 'Expulsar', iconName: 'block' },
  ));
  modal.appendChild(el('div', { class: 'gk-mod-card' }, [
    el('div', { class: 'gk-mod-card-title' }, [icon('block', { size: 15 }), ' Expulsar']),
    el('p', { class: 'gk-mod-card-text' }, 'Remove do servidor, mas a pessoa pode entrar de novo por convite.'),
    kickBtn,
  ]));

  // --- banir ---
  const reason = el('input', { type: 'text', class: 'gk-sv-input', id: 'gk-mod-ban-reason', maxlength: '200', placeholder: 'Motivo (opcional)' });
  const banBtn = el('button', { class: 'gk-btn gk-confirm-btn', type: 'button', id: 'gk-mod-ban' }, [icon('block', { size: 15 }), ' Banir']);
  banBtn.addEventListener('click', () => confirmDangerAction(
    'Banir membro', `Banir "${name}"? Ele será removido e não conseguirá voltar nem por convite, até ser desbanido.`,
    () => banMember(serverId, member, reason.value),
    { confirmLabel: 'Banir', iconName: 'block' },
  ));
  modal.appendChild(el('div', { class: 'gk-mod-card gk-danger' }, [
    el('div', { class: 'gk-mod-card-title' }, [icon('block', { size: 15 }), ' Banir']),
    el('p', { class: 'gk-mod-card-text' }, 'Remove e impede a volta por convite. Dá para desbanir em Moderação.'),
    el('div', { class: 'gk-mod-row' }, [reason, banBtn]),
  ]));

  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar'),
  ]));
  overlay.classList.add('gk-open');
}
