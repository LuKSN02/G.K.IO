// Menus de clique direito numa PESSOA dentro de um servidor (lista de membros, avatar/nome nas mensagens).
//  · no próprio perfil:   Perfil, Mencionar, Silenciar/Desativar áudio, Editar perfil por servidor, Apps, Cargos, moderador
//  · no de outra pessoa:  Perfil, Mencionar, Mensagem, Iniciar chamada, Adicionar nota, Volume, Silenciar,
//                         Apps, Convidar para o servidor, Desfazer amizade, Bloquear, Cargos, moderador
import { state, el, toast } from './state.js';
import { auth, updateDoc, memberDoc } from './db.js';
import { openProfileCard } from './profile.js';
import { isBlocked, toggleBlock } from './blocks.js';
import { sendServerInvite } from './server-invite.js';
import { openServerSettingsModal } from './server-settings.js';
import { openModerateModal } from './moderation.js';
import { openOrCreateDm, removeFriend } from './dms.js';
import { startDmCall, toggleMute, toggleDeafen, isInCall } from './calls.js';
import { getRoles, assignRoleToMember, isServerOwner, canKickMembers, canViewAuditLog } from './servers.js';
import { getPersonVolume, setPersonVolume, VOLUME_MAX } from './voice-fx.js';
import { serverBots } from './bots.js';
import { confirmDialog, resetGenericModal } from './dialogs.js';

let micMuted = false; let deafened = false;
window.addEventListener('gkio-mic-state', (e) => { micMuted = !!e.detail?.muted; });
window.addEventListener('gkio-deafen-state', (e) => { deafened = !!e.detail?.deafened; });
window.addEventListener('gkio-call-ended', () => { micMuted = false; deafened = false; });

const memberOf = (sid, uid) => state.serverMembersCache.get(sid)?.get(uid) || null;
const nameOfMember = (m) => m?.nickname || m?.user?.displayName || m?.user?.username || 'Membro';
const lastVol = new Map(); // uid -> último volume antes de silenciar

function mention(m) {
  const ta = document.getElementById('gk-composer-input');
  if (!ta || !m?.user?.username) return;
  ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '@' + m.user.username + ' ';
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function nicknameModal(serverId) {
  const uid = auth.currentUser.uid; const m = memberOf(serverId, uid);
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = resetGenericModal();
  const input = el('input', { type: 'text', maxlength: '32', placeholder: m?.user?.displayName || m?.user?.username || 'Apelido' });
  input.value = m?.nickname || '';
  const save = async () => {
    try { await updateDoc(memberDoc(serverId, uid), { nickname: input.value.trim() || null }); overlay.classList.remove('gk-open'); toast('Perfil neste servidor atualizado.'); }
    catch { toast('Não foi possível salvar o apelido.', 'danger'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  modal.appendChild(el('h2', {}, 'Editar perfil por servidor'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'O apelido vale só neste servidor. Deixe vazio para voltar ao seu nome normal.'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Apelido no servidor'), input]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', { class: 'gk-btn gk-btn-primary', onclick: save }, 'Salvar'),
  ]));
  overlay.classList.add('gk-open'); setTimeout(() => input.focus(), 30);
}

function appsItem(serverId, target) {
  if (target?.user?.isBot && Array.isArray(target.user.botCommands) && target.user.botCommands.length) {
    return { label: 'Apps', submenu: target.user.botCommands.slice(0, 20).map((c) => ({ label: '/' + c.name, hint: c.desc, onClick: () => {
      const ta = document.getElementById('gk-composer-input'); if (!ta) return;
      ta.value = '/' + c.name + ' '; ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
    } })) };
  }
  const bots = serverBots(serverId);
  return { label: 'Apps', submenu: bots.length ? bots.map((b) => ({ label: nameOfMember(b), onClick: () => openProfileCard(b.uid) })) : [{ label: 'Nenhum app neste servidor', disabled: true }] };
}

function rolesItem(serverId, target) {
  const roles = getRoles(); if (!roles.length) return null;
  const owner = isServerOwner(serverId);
  return { label: 'Cargos', submenu: roles.map((r) => ({
    label: r.name, checked: (target.roleIds || []).includes(r.id),
    onClick: owner ? async () => { await assignRoleToMember(serverId, target.uid, r.id, !(target.roleIds || []).includes(r.id)); toast('Cargo atualizado.'); } : undefined,
    disabled: !owner,
  })) };
}

export function userMenuItems(serverId, uid) {
  const target = memberOf(serverId, uid); if (!target) return null;
  const mine = uid === auth.currentUser?.uid;
  const name = nameOfMember(target);
  const mod = (canKickMembers(serverId) || canViewAuditLog(serverId))
    ? { label: 'Abrir na visualização de moderador', onClick: () => (mine ? openServerSettingsModal(serverId) : openModerateModal(serverId, target)) } : null;

  if (mine) {
    return [
      { label: 'Perfil', onClick: () => openProfileCard(uid) },
      { label: 'Mencionar', onClick: () => mention(target) },
      { sep: true },
      { label: 'Silenciar', checked: micMuted, onClick: () => (isInCall() ? toggleMute() : toast('Entre numa chamada de voz para silenciar o microfone.')) },
      { label: 'Desativar áudio', checked: deafened, onClick: () => (isInCall() ? toggleDeafen() : toast('Entre numa chamada de voz para desativar o áudio.')) },
      { label: 'Editar perfil por servidor', onClick: () => nicknameModal(serverId) },
      appsItem(serverId, target),
      { sep: true },
      rolesItem(serverId, target),
      mod ? { sep: true } : null,
      mod,
    ];
  }

  const servers = [...state.servers.values()].filter((s) => s.id !== serverId || true);
  const vol = getPersonVolume(uid);
  return [
    { label: 'Perfil', onClick: () => openProfileCard(uid) },
    { label: 'Mencionar', onClick: () => mention(target) },
    { label: 'Mensagem', onClick: () => openOrCreateDm(uid) },
    { label: 'Iniciar chamada', onClick: async () => { await openOrCreateDm(uid); await new Promise((r) => setTimeout(r, 250)); startDmCall(false); } },
    { label: 'Adicionar nota', hint: 'Visível apenas para você', onClick: () => { openProfileCard(uid); setTimeout(() => document.querySelector('.gk-note-input')?.focus(), 350); } },
    { sep: true },
    { slider: { label: 'Volume do usuário', value: vol, min: 0, max: VOLUME_MAX, onInput: (v) => setPersonVolume(uid, v) } },
    { sep: true },
    { label: 'Silenciar', checked: vol === 0, onClick: () => {
      if (vol === 0) setPersonVolume(uid, lastVol.get(uid) || 100); else { lastVol.set(uid, vol); setPersonVolume(uid, 0); }
    } },
    appsItem(serverId, target),
    { label: 'Convidar para o servidor', disabled: !servers.length, submenu: servers.map((s) => ({ label: s.name || 'Servidor', onClick: async () => { await sendServerInvite(s.id, uid); toast(`Convite enviado para ${name}.`); } })) },
    state.friends.has(uid) ? { label: 'Desfazer amizade', onClick: () => confirmDialog({
      title: 'Desfazer amizade', message: `Remover "${name}" da sua lista de amigos?`, confirmLabel: 'Desfazer',
      onConfirm: async () => { await removeFriend(uid); toast('Amizade desfeita.'); },
    }) } : null,
    { label: isBlocked(uid) ? 'Desbloquear' : 'Bloquear', danger: !isBlocked(uid), onClick: () => toggleBlock(uid) },
    { sep: true },
    rolesItem(serverId, target),
    mod ? { sep: true } : null,
    mod,
  ];
}
