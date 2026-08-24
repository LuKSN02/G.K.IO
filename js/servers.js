// ============================================================
// G.K.IO — Servidores, categorias e canais (estilo Discord)
// ============================================================
import {
  db, auth, serversCol, serverDoc, categoriesCol, channelsCol, channelDoc,
  membersCol, memberDoc, invitesCol, inviteDoc, userDoc, rolesCol, roleDoc,
  doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion,
} from './db.js';
import { state, el, toast, cleanupListener, fallbackAvatar, genInviteCode } from './state.js';
import { selectChannel } from './chat.js';
import { openProfileCard } from './profile.js';
import { joinVoiceChannel } from './calls.js';
import { uploadToCloudinary } from './cloudinary.js';
import { SERVER_TEMPLATES } from './server-templates.js';
import { isConversationUnread, onReadStatesChange } from './unread.js';

// Sempre que o estado de leitura mudar, re-renderiza a sidebar de canais
// do servidor atualmente aberto pra atualizar os indicadores de não lida.
onReadStatesChange(() => {
  if (state.currentServerId) renderServerSidebar(state.currentServerId, lastCategories, lastChannels);
});

let unsubServers = null;
let unsubCategories = null;
let unsubChannels = null;
let unsubMembers = null;
let unsubRoles = null;
// Guarda o último snapshot de categorias/canais renderizado, para poder
// re-renderizar a sidebar (mostrar/esconder "Novo canal") quando o cargo
// do usuário atual mudar, sem esperar um novo snapshot de canais.
let lastCategories = [];
let lastChannels = [];
// Último snapshot de cargos personalizados do servidor atualmente aberto,
// indexado por id — reaproveitado pelo painel de Configurações (aba
// "Cargos") e pelo cálculo de permissões efetivas de cada membro.
let lastRoles = new Map();

// ---------- Catálogo de permissões dos cargos personalizados ----------
// Cada permissão soma poderes ao que o membro já teria como "membro comum".
// 'owner' e o campo legado member.role === 'admin' continuam concedendo
// tudo, por compatibilidade com servidores criados antes deste recurso.
export const PERMISSION_CATALOG = [
  { key: 'manageChannels', label: 'Gerenciar canais', desc: 'Criar, renomear e excluir categorias e canais.' },
  { key: 'manageServer', label: 'Gerenciar servidor', desc: 'Editar nome, descrição, ícone e banner do servidor.' },
  { key: 'manageMembers', label: 'Expulsar membros', desc: 'Remover membros do servidor.' },
];

export const ROLE_COLOR_SWATCHES = [
  '#5B6EE8', '#1F6F78', '#4C5FD5', '#C24868', '#B9812E', '#22916A', '#7C4FC2',
  '#D64545', '#565F66', '#1C2733', '#1FA7C9',
];

// ---------- Permissões por canal (overwrites, estilo Discord) ----------
// Diferente de PERMISSION_CATALOG (server inteiro), estas são específicas
// de um canal e ficam guardadas em channels/{id}.overwrites, no formato:
//   { [roleId]: { viewChannel: 'allow'|'deny', sendMessages: 'allow'|'deny' } }
// Sem entrada = neutro (o cargo nem permite nem nega, herda o padrão).
// IMPORTANTE: isto é calculado e aplicado só no client (esconder o canal
// na sidebar, desabilitar o composer) — as firestore.rules continuam
// liberando leitura de qualquer canal para qualquer membro do servidor,
// então não é uma barreira de segurança real, só de navegação/UI. Se
// precisar de canais realmente privados (ex: canal de staff com dados
// sensíveis), a próxima etapa é levar essa checagem pras rules também.
export const CHANNEL_OVERWRITE_PERMISSIONS = {
  text: [
    { key: 'viewChannel', label: 'Ver canal' },
    { key: 'sendMessages', label: 'Enviar mensagens' },
  ],
  voice: [
    { key: 'viewChannel', label: 'Ver canal' },
  ],
};

function emptyPermissions() {
  return { manageChannels: false, manageServer: false, manageMembers: false };
}

// Combina (OR) as permissões de todos os cargos atribuídos a um membro.
function computePermissions(roleIds = [], rolesMap = lastRoles) {
  const perms = emptyPermissions();
  for (const rid of roleIds) {
    const role = rolesMap.get(rid);
    if (!role) continue;
    for (const key of Object.keys(perms)) {
      if (role.permissions?.[key]) perms[key] = true;
    }
  }
  return perms;
}

// ---------- Criar / entrar em servidor ----------
export async function createServer(name, description = '', iconUrl = '', bannerUrl = '', templateKey = 'custom') {
  const uid = auth.currentUser.uid;
  const template = SERVER_TEMPLATES[templateKey] || SERVER_TEMPLATES.custom;

  const ref = await addDoc(serversCol(), {
    name: name.trim() || 'Novo Servidor',
    description: (description || '').trim(),
    iconUrl: iconUrl || '',
    bannerUrl: bannerUrl || '',
    ownerId: uid,
    memberIds: [uid],
    template: templateKey,
    createdAt: serverTimestamp(),
  });
  // Quem cria o servidor nasce com o cargo 'owner' — só ele (ou quem ele
  // promover a 'admin') pode criar/editar/excluir canais e categorias.
  await setDoc(memberDoc(ref.id, uid), { nickname: null, role: 'owner', joinedAt: serverTimestamp() });

  // Categorias e canais do template escolhido (Gaming, Estudos ou "Criar
  // do zero"). De propósito NÃO usa writeBatch aqui: as regras do
  // Firestore para categories/channels dependem de canManageChannels(),
  // que lê servers/{id} e members/{uid} via get() — num writeBatch essas
  // leituras enxergam o estado de ANTES do lote inteiro ser aplicado, não
  // os outros writes do mesmo lote. Por isso o servidor e o membro dono
  // precisam estar de fato confirmados (await) antes de criar categorias
  // e canais, exatamente como já funcionava antes desta mudança.
  let catPosition = 0;
  for (const cat of template.categories) {
    const catRef = await addDoc(categoriesCol(ref.id), { name: cat.name, position: catPosition++ });
    let chPosition = 0;
    for (const ch of cat.channels) {
      await addDoc(channelsCol(ref.id), {
        name: ch.name, type: ch.type, categoryId: catRef.id, position: chPosition++,
      });
    }
  }

  toast(`Servidor "${name}" criado.`);
  return ref.id;
}

export async function createInvite(serverId) {
  const code = genInviteCode();
  await setDoc(inviteDoc(code), {
    serverId, createdBy: auth.currentUser.uid, uses: 0, maxUses: null, createdAt: serverTimestamp(),
  });
  return code;
}

export async function joinServerByInviteCode(code) {
  code = code.trim().toUpperCase();
  const snap = await getDoc(inviteDoc(code));
  if (!snap.exists()) throw new Error('Convite inválido ou expirado.');
  const { serverId } = snap.data();
  const uid = auth.currentUser.uid;
  await updateDoc(serverDoc(serverId), { memberIds: arrayUnion(uid) });
  // Quem entra por convite começa como 'member' comum — sem permissão para
  // criar canais, a menos que o dono promova depois (ver setMemberRole).
  await setDoc(memberDoc(serverId, uid), { nickname: null, role: 'member', joinedAt: serverTimestamp() });
  await updateDoc(inviteDoc(code), { uses: (snap.data().uses || 0) + 1 });
  const serverSnap = await getDoc(serverDoc(serverId));
  toast(`Você entrou em "${serverSnap.data().name}".`);
  return serverId;
}

// ---------- Cargos / permissões ----------
// Promove ou rebaixa um membro entre 'admin' e 'member'. Só o dono pode
// chamar isso na prática (a regra do Firestore também garante isso do
// lado do servidor — ver firestore.rules).
export async function setMemberRole(serverId, targetUid, role) {
  await updateDoc(memberDoc(serverId, targetUid), { role });
  toast(role === 'admin' ? 'Membro promovido a administrador.' : 'Cargo de administrador removido.');
}

// ---------- Cargos personalizados (roles) ----------
export function listenRoles(serverId) {
  cleanupListener('roles');
  const q = query(rolesCol(serverId), orderBy('position'));
  unsubRoles = onSnapshot(q, (snap) => {
    lastRoles = new Map();
    snap.forEach((d) => lastRoles.set(d.id, { id: d.id, ...d.data() }));
    if (state.currentServerId === serverId) {
      // Cargos e permissões afetam o rótulo dos membros — re-renderiza.
      const cache = state.serverMembersCache.get(serverId);
      if (cache) renderMembersPanel(cache, serverId);
    }
  });
  state.unsubscribers.roles = () => unsubRoles && unsubRoles();
}

export function getRoles() {
  return [...lastRoles.values()].sort((a, b) => (a.position || 0) - (b.position || 0));
}

export async function createRole(serverId, { name, color }) {
  const existing = await getDocs(query(rolesCol(serverId)));
  await addDoc(rolesCol(serverId), {
    name: (name || '').trim() || 'Novo cargo',
    color: color || ROLE_COLOR_SWATCHES[0],
    permissions: emptyPermissions(),
    position: existing.size,
    createdAt: serverTimestamp(),
  });
  toast('Cargo criado.');
}

export async function updateRole(serverId, roleId, patch) {
  const clean = {};
  if (patch.name !== undefined) clean.name = patch.name.trim() || 'Cargo';
  if (patch.color !== undefined) clean.color = patch.color;
  if (patch.permissions !== undefined) clean.permissions = { ...emptyPermissions(), ...patch.permissions };
  await updateDoc(roleDoc(serverId, roleId), clean);
  // As permissões desse cargo podem ter mudado — recalcula e regrava a
  // permissão efetiva (denormalizada) de todo membro que tem esse cargo,
  // já que as regras do Firestore leem esse campo direto do membro em vez
  // de "percorrer" a lista de cargos (o Firestore Rules não permite isso).
  if (patch.permissions !== undefined) await resyncMembersWithRole(serverId, roleId);
  toast('Cargo atualizado.');
}

export async function deleteRole(serverId, roleId) {
  const cache = state.serverMembersCache.get(serverId) || new Map();
  for (const m of cache.values()) {
    if (!(m.roleIds || []).includes(roleId)) continue;
    const newRoleIds = m.roleIds.filter((r) => r !== roleId);
    await writeMemberRoles(serverId, m.uid, newRoleIds);
  }
  await deleteDoc(roleDoc(serverId, roleId));
  toast('Cargo excluído.');
}

export async function assignRoleToMember(serverId, targetUid, roleId, assign) {
  const cache = state.serverMembersCache.get(serverId) || new Map();
  const member = cache.get(targetUid);
  const current = member?.roleIds || [];
  const newRoleIds = assign ? [...new Set([...current, roleId])] : current.filter((r) => r !== roleId);
  await writeMemberRoles(serverId, targetUid, newRoleIds);
}

async function resyncMembersWithRole(serverId, roleId) {
  const cache = state.serverMembersCache.get(serverId) || new Map();
  for (const m of cache.values()) {
    if ((m.roleIds || []).includes(roleId)) await writeMemberRoles(serverId, m.uid, m.roleIds);
  }
}

async function writeMemberRoles(serverId, targetUid, roleIds) {
  await updateDoc(memberDoc(serverId, targetUid), {
    roleIds,
    permissions: computePermissions(roleIds),
  });
}

export function canManageChannels(serverId) {
  return hasServerPermission(serverId, 'manageChannels');
}

// Editar nome/descrição/ícone/banner do servidor — antes ficava amarrado a
// canManageChannels (admin genérico); agora tem sua própria permissão, para
// dar pra criar um cargo "Editor de canais" que não mexe na identidade do
// servidor, ou um cargo "Curador visual" que só troca o ícone/banner.
export function canManageServerInfo(serverId) {
  return hasServerPermission(serverId, 'manageServer');
}

// Expulsar membros do servidor.
export function canKickMembers(serverId) {
  return hasServerPermission(serverId, 'manageMembers');
}

// Só o dono gerencia os cargos em si (criar/editar/excluir/atribuir) — a
// mesma trava que já existia para promover/rebaixar admin. É intencional:
// delegar "quem pode dar poder a quem" é um risco à parte, fora do escopo
// deste MVP (ver firestore.rules).
export function canManageRoles(serverId) {
  return isServerOwner(serverId);
}

function hasServerPermission(serverId, key) {
  const server = state.servers.get(serverId);
  const uid = auth.currentUser?.uid;
  if (!server || !uid) return false;
  if (server.ownerId === uid) return true;
  const member = state.serverMembersCache.get(serverId)?.get(uid);
  if (!member) return false;
  if (member.role === 'admin') return true; // cargo legado — mantém tudo, como antes
  return !!member.permissions?.[key];
}

// ---------- Permissões efetivas por canal (overwrites) ----------
// Ordem de precedência, igual Discord: começa no padrão (permitido),
// aplica os cargos do membro na ordem de position (o de position mais
// alta é aplicado por último e vence em caso de conflito). Dono e o
// cargo legado 'admin' sempre enxergam/enviam em tudo.
function computeChannelPermission(serverId, channel, key, defaultValue = true) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  if (isServerOwner(serverId)) return true;
  const member = state.serverMembersCache.get(serverId)?.get(uid);
  if (!member) return false;
  if (member.role === 'admin') return true;

  const overwrites = channel.overwrites || {};
  let result = defaultValue;
  const myRoles = getRoles().filter((r) => (member.roleIds || []).includes(r.id));
  for (const role of myRoles) {
    const value = overwrites[role.id]?.[key];
    if (value === 'allow') result = true;
    else if (value === 'deny') result = false;
  }
  return result;
}

export function canViewChannel(serverId, channel) {
  return computeChannelPermission(serverId, channel, 'viewChannel', true);
}

export function canSendInChannel(serverId, channel) {
  if (channel.type !== 'text') return true;
  return computeChannelPermission(serverId, channel, 'sendMessages', true);
}

// Define (ou remove, se value === null) o overwrite de um cargo para uma
// permissão específica de um canal.
export async function setChannelOverwrite(serverId, channelId, roleId, key, value) {
  const channel = lastChannels.find((c) => c.id === channelId);
  const overwrites = { ...(channel?.overwrites || {}) };
  const roleOverwrite = { ...(overwrites[roleId] || {}) };
  if (value === null) delete roleOverwrite[key];
  else roleOverwrite[key] = value;
  if (Object.keys(roleOverwrite).length === 0) delete overwrites[roleId];
  else overwrites[roleId] = roleOverwrite;
  await updateDoc(channelDoc(serverId, channelId), { overwrites });
}

export function isServerOwner(serverId) {
  const server = state.servers.get(serverId);
  return !!server && server.ownerId === auth.currentUser?.uid;
}

// ---------- Configurações de servidor: visão geral ----------
export async function updateServerInfo(serverId, { name, description, iconUrl, bannerUrl }) {
  const patch = {};
  if (name !== undefined) patch.name = name.trim() || 'Servidor sem nome';
  if (description !== undefined) patch.description = (description || '').trim();
  if (iconUrl !== undefined) patch.iconUrl = iconUrl || '';
  if (bannerUrl !== undefined) patch.bannerUrl = bannerUrl || '';
  await updateDoc(serverDoc(serverId), patch);
  toast('Servidor atualizado.');
}

export async function deleteServerPermanently(serverId) {
  // Exclui o documento do servidor — categorias, canais e mensagens ficam
  // órfãos (o Firestore não faz cascade), mas ficam inacessíveis, já que
  // as regras exigem checar memberIds no doc do servidor pra liberar
  // leitura/escrita das subcoleções. Consistente com o restante do MVP.
  await deleteDoc(serverDoc(serverId));
  toast('Servidor excluído.');
}

export async function leaveServer(serverId) {
  const uid = auth.currentUser.uid;
  await deleteDoc(memberDoc(serverId, uid)).catch(() => {});
  await updateDoc(serverDoc(serverId), { memberIds: state.servers.get(serverId).memberIds.filter((id) => id !== uid) });
  toast('Você saiu do servidor.');
}

export async function kickMember(serverId, targetUid) {
  const server = state.servers.get(serverId);
  await updateDoc(serverDoc(serverId), { memberIds: (server.memberIds || []).filter((id) => id !== targetUid) });
  await deleteDoc(memberDoc(serverId, targetUid)).catch(() => {});
  toast('Membro removido do servidor.');
}

// ---------- Configurações de servidor: categorias e canais ----------
export async function createCategory(serverId, name) {
  const existing = await getDocs(query(categoriesCol(serverId)));
  await addDoc(categoriesCol(serverId), { name: name.trim() || 'Nova categoria', position: existing.size });
}

export async function renameCategory(serverId, catId, name) {
  await updateDoc(doc(db, 'servers', serverId, 'categories', catId), { name: name.trim() || 'Categoria' });
}

export async function deleteCategory(serverId, catId) {
  const hasChannels = lastChannels.some((c) => c.categoryId === catId);
  if (hasChannels) throw new Error('Mova ou exclua os canais desta categoria antes de excluí-la.');
  await deleteDoc(doc(db, 'servers', serverId, 'categories', catId));
}

export async function renameChannel(serverId, channelId, name) {
  await updateDoc(channelDoc(serverId, channelId), { name: name.trim().toLowerCase().replace(/\s+/g, '-') || 'canal' });
}

export async function deleteChannel(serverId, channelId) {
  await deleteDoc(channelDoc(serverId, channelId));
  if (state.currentChannelId === channelId) state.currentChannelId = null;
  toast('Canal excluído.');
}

// ---------- Rail de servidores ----------
export function listenUserServers() {
  cleanupListener('_servers');
  const uid = auth.currentUser.uid;
  const q = query(serversCol(), where('memberIds', 'array-contains', uid));
  unsubServers = onSnapshot(q, (snap) => {
    state.servers.clear();
    snap.forEach((d) => state.servers.set(d.id, { id: d.id, ...d.data() }));
    renderRail();
  });
  state.unsubscribers._servers = () => unsubServers && unsubServers();
}

function renderRail() {
  const rail = document.getElementById('gk-rail-servers');
  rail.innerHTML = '';
  for (const server of state.servers.values()) {
    const item = el('div', {
      class: 'gk-rail-item' + (state.currentServerId === server.id ? ' gk-active' : ''),
      title: server.name,
      onclick: () => selectServer(server.id),
    }, [
      el('div', { class: 'gk-rail-pill' }),
      server.iconUrl
        ? el('img', { src: server.iconUrl })
        : document.createTextNode((server.name || '?').slice(0, 2).toUpperCase()),
    ]);
    rail.appendChild(item);
  }
}

// ---------- Selecionar servidor ----------
export function selectServer(serverId) {
  state.currentView = 'server';
  state.currentServerId = serverId;
  state.currentChannelId = null;
  document.getElementById('gk-dm-rail-item')?.classList.remove('gk-active');
  renderRail();
  listenCategoriesAndChannels(serverId);
  listenMembers(serverId);
  listenRoles(serverId);
  document.getElementById('gk-sidebar-header-title').textContent = state.servers.get(serverId)?.name || 'Servidor';
  document.getElementById('gk-members').style.display = 'block';
  document.getElementById('gk-server-settings-btn').style.display = 'inline-flex';
  document.getElementById('gk-members-toggle-btn').style.display = 'inline-flex';
}

function listenCategoriesAndChannels(serverId) {
  cleanupListener('categories');
  cleanupListener('channels');
  const catQ = query(categoriesCol(serverId), orderBy('position'));
  unsubCategories = onSnapshot(catQ, (catSnap) => {
    const categories = [];
    catSnap.forEach((d) => categories.push({ id: d.id, ...d.data() }));
    const chQ = query(channelsCol(serverId), orderBy('position'));
    unsubChannels = onSnapshot(chQ, (chSnap) => {
      const channels = [];
      chSnap.forEach((d) => channels.push({ id: d.id, ...d.data() }));
      lastCategories = categories;
      lastChannels = channels;
      renderServerSidebar(serverId, categories, channels);
      if (!state.currentChannelId) {
        const firstText = channels.find((c) => c.type === 'text' && canViewChannel(serverId, c));
        if (firstText) selectChannel(serverId, firstText.id, firstText.name, !canSendInChannel(serverId, firstText));
      }
    });
    state.unsubscribers.channels = () => unsubChannels && unsubChannels();
  });
  state.unsubscribers.categories = () => unsubCategories && unsubCategories();
}

function renderServerSidebar(serverId, categories, channels) {
  const body = document.getElementById('gk-sidebar-body');
  body.innerHTML = '';
  for (const cat of categories) {
    const catChannels = channels.filter((c) => c.categoryId === cat.id && canViewChannel(serverId, c));
    const list = el('div', { class: 'gk-channel-list' });
    for (const ch of catChannels) {
      const isActive = state.currentChannelId === ch.id;
      // Só canais de texto têm indicador de não lida (voz não guarda
      // histórico de "mensagens" da mesma forma) — a própria conversa
      // aberta nunca mostra o indicador, ela já é marcada como lida em
      // tempo real (ver markConversationRead em chat.js).
      const unread = ch.type === 'text' && !isActive && isConversationUnread(ch.id, ch.lastMessageAt, ch.lastMessageAuthorId);
      const row = el('div', {
        class: 'gk-channel' + (isActive ? ' gk-active' : '') + (unread ? ' gk-unread' : ''),
        onclick: () => ch.type === 'text'
          ? selectChannel(serverId, ch.id, ch.name, !canSendInChannel(serverId, ch))
          : confirmJoinVoiceChannel(serverId, ch),
      }, [
        el('span', { class: 'gk-channel-icon', html: ch.type === 'text' ? '#' : '&#128266;' }),
        el('span', {}, ch.name),
      ]);
      list.appendChild(row);
      if (ch.type === 'voice') {
        const membersBox = el('div', { class: 'gk-voice-members', id: `gk-voice-members-${ch.id}` });
        list.appendChild(membersBox);
      }
    }
    const catNode = el('div', { class: 'gk-category' }, [
      el('div', {
        class: 'gk-category-label',
        onclick: (e) => e.currentTarget.parentElement.classList.toggle('gk-collapsed'),
      }, [el('span', { class: 'gk-chevron' }, '▾'), el('span', {}, cat.name)]),
      list,
    ]);
    body.appendChild(catNode);
  }
  // Só quem pode gerenciar canais (dono ou admin) vê o botão de criar.
  // Membros comuns enxergam a lista normalmente, sem essa opção.
  if (canManageChannels(serverId)) {
    const addBtn = el('div', {
      class: 'gk-channel', style: 'color:var(--gk-accent);font-weight:600;margin-top:6px;',
      onclick: () => openCreateChannelModal(serverId, categories),
    }, [el('span', { class: 'gk-channel-icon', html: '&#43;' }), el('span', {}, 'Novo canal')]);
    body.appendChild(addBtn);
  }
}

// Confirmação antes de entrar numa sala de voz — evita entrar sem
// querer (ex: clique perdido na sidebar) e, se a pessoa já estiver em
// outra chamada/sala, avisa que ela vai ser encerrada automaticamente
// ao entrar nessa nova, pra não pegar ninguém de surpresa.
function confirmJoinVoiceChannel(serverId, ch) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  let warning = '';
  if (state.activeCall && !(state.activeCall.kind === 'voiceChannel' && state.activeCall.id === ch.id)) {
    warning = state.activeCall.kind === 'dm'
      ? ' Sua chamada em andamento será encerrada automaticamente.'
      : ' Você vai sair da sala de voz atual automaticamente.';
  }

  modal.appendChild(el('h2', {}, 'Entrar na sala de voz?'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, `Você está prestes a entrar em "${ch.name}".${warning}`));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: () => { overlay.classList.remove('gk-open'); joinVoiceChannel(serverId, ch.id, ch.name); },
    }, '🔊 Entrar'),
  ]));
  overlay.classList.add('gk-open');
}

function listenMembers(serverId) {
  cleanupListener('members');
  unsubMembers = onSnapshot(membersCol(serverId), async (snap) => {
    const cache = new Map();
    for (const d of snap.docs) {
      const userSnap = await getDoc(userDoc(d.id));
      if (userSnap.exists()) cache.set(d.id, { uid: d.id, ...d.data(), user: userSnap.data() });
    }
    state.serverMembersCache.set(serverId, cache);
    renderMembersPanel(cache, serverId);
    // Um cargo pode ter mudado (ex: alguém virou admin) — re-renderiza a
    // sidebar de canais para atualizar a visibilidade do "Novo canal".
    if (state.currentServerId === serverId) renderServerSidebar(serverId, lastCategories, lastChannels);
  });
  state.unsubscribers.members = () => unsubMembers && unsubMembers();
}

function renderMembersPanel(cache, serverId) {
  const panel = document.getElementById('gk-members');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'gk-members-label' }, `Membros — ${cache.size}`));
  const isOwner = canIManageMembers(serverId);
  for (const m of cache.values()) {
    const role = m.role || 'member';
    const roleLabel = role === 'owner' ? 'Dono' : role === 'admin' ? 'Admin' : null;

    const nameLine = el('div', { class: 'gk-name' }, [
      document.createTextNode(m.nickname || m.user.displayName || m.user.username),
    ]);
    if (roleLabel) nameLine.appendChild(el('span', { class: `gk-role-badge gk-role-${role}` }, roleLabel));
    for (const rid of m.roleIds || []) {
      const customRole = lastRoles.get(rid);
      if (!customRole) continue;
      nameLine.appendChild(el('span', {
        class: 'gk-role-chip', title: customRole.name,
        style: `background:${customRole.color}22;color:${customRole.color};border-color:${customRole.color}55;`,
      }, customRole.name));
    }

    const rowChildren = [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': m.user.statusPresence || 'offline' }, [
        el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) }),
      ]),
      el('div', {}, [nameLine]),
    ];

    // Só o dono vê o botão de promover/rebaixar, e nunca para si mesmo ou para outro dono.
    if (isOwner && role !== 'owner' && m.uid !== auth.currentUser?.uid) {
      rowChildren.push(el('button', {
        class: 'gk-member-role-btn',
        title: role === 'admin' ? 'Remover cargo de administrador' : 'Tornar administrador (pode criar canais)',
        onclick: (e) => { e.stopPropagation(); setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin'); },
      }, role === 'admin' ? '★' : '☆'));
    }

    const row = el('div', { class: 'gk-member-row', onclick: () => openProfileCard(m.uid) }, rowChildren);
    panel.appendChild(row);
  }
}

// Promover/rebaixar o cargo legado 'admin' continua exclusivo do dono
// (mesma lógica de canManageRoles) — é diferente de canKickMembers, que
// agora também pode ser delegado via um cargo personalizado.
export function canIManageMembers(serverId) {
  return isServerOwner(serverId);
}

// ---------- Criação de categoria / canal ----------
export function openCreateChannelModal(serverId, categories) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  let selectedType = 'text';

  // Campo de nome, com prefixo # (texto) ou 🔊 (voz) que acompanha o tipo escolhido.
  const nameInput = el('input', { type: 'text', placeholder: 'novo-canal', maxlength: '80' });
  const prefixEl = el('span', { class: 'gk-channel-name-prefix' }, '#');
  const nameWrap = el('div', { class: 'gk-channel-name-input-wrap' }, [prefixEl, nameInput]);

  // Normaliza o nome enquanto digita (minúsculas, sem espaço), como no Discord.
  nameInput.addEventListener('input', () => {
    const cursor = nameInput.selectionStart;
    const before = nameInput.value.length;
    nameInput.value = nameInput.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    nameInput.selectionStart = nameInput.selectionEnd = Math.max(0, cursor + (nameInput.value.length - before));
  });

  const textOption = el('button', { type: 'button', class: 'gk-type-option gk-active', onclick: () => selectType('text') }, [
    el('span', { class: 'gk-type-icon' }, '#'),
    el('div', {}, [el('div', { class: 'gk-type-name' }, 'Texto'), el('div', { class: 'gk-type-desc' }, 'Mensagens, imagens e GIFs')]),
  ]);
  const voiceOption = el('button', { type: 'button', class: 'gk-type-option', onclick: () => selectType('voice') }, [
    el('span', { class: 'gk-type-icon', html: '&#128266;' }),
    el('div', {}, [el('div', { class: 'gk-type-name' }, 'Voz'), el('div', { class: 'gk-type-desc' }, 'Conversa por áudio e vídeo')]),
  ]);

  function selectType(type) {
    selectedType = type;
    textOption.classList.toggle('gk-active', type === 'text');
    voiceOption.classList.toggle('gk-active', type === 'voice');
    prefixEl.innerHTML = type === 'text' ? '#' : '&#128266;';
  }

  const catSelect = el('select', { class: 'gk-select' },
    categories.map((c) => el('option', { value: c.id }, c.name)));

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, '#'),
    el('div', {}, [
      el('h2', {}, 'Criar canal'),
      el('p', { class: 'gk-modal-sub' }, 'Canais organizam as conversas do seu servidor.'),
    ]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do canal'), nameWrap]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Tipo'), el('div', { class: 'gk-type-picker' }, [textOption, voiceOption])]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Categoria'), catSelect]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        if (!nameInput.value.trim()) return;
        const chQ = query(channelsCol(serverId));
        const existing = await getDocs(chQ);
        await addDoc(channelsCol(serverId), {
          name: nameInput.value.trim(),
          type: selectedType,
          categoryId: catSelect.value,
          position: existing.size,
        });
        closeGenericModal();
      },
    }, 'Criar canal'),
  ]));
  overlay.classList.add('gk-open');
  nameInput.focus();
}

// Getter para o módulo de configurações de servidor reaproveitar o
// último snapshot de categorias/canais sem precisar de um listener próprio.
export function getCategoriesAndChannels() {
  return { categories: lastCategories, channels: lastChannels };
}

// ---------- Permissões por canal (overwrites por cargo) ----------
export function openChannelPermissionsModal(serverId, channel) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  const perms = CHANNEL_OVERWRITE_PERMISSIONS[channel.type] || CHANNEL_OVERWRITE_PERMISSIONS.text;

  render();
  overlay.classList.add('gk-open');

  function render() {
    modal.innerHTML = '';
    // Sempre lê o canal mais recente do último snapshot (pode ter mudado
    // entre um clique e outro, já que cada clique salva no Firestore).
    const current = lastChannels.find((c) => c.id === channel.id) || channel;
    const roles = getRoles();

    modal.appendChild(el('h2', {}, `Permissões — ${current.type === 'text' ? '#' : '🔊'} ${current.name}`));
    modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Restrinja este canal por cargo. Sem nenhuma marcação, o canal fica visível a todo mundo (dono e admin sempre veem tudo).'));

    if (roles.length === 0) {
      modal.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Crie um cargo primeiro, na aba Cargos, para poder restringir este canal por ele.'));
    }

    const list = el('div', { class: 'gk-channel-overwrite-list' });
    for (const role of roles) {
      const overwrite = current.overwrites?.[role.id] || {};
      const permCols = perms.map((perm) => {
        const value = overwrite[perm.key] || 'neutral';
        const btnRow = el('div', { class: 'gk-tri-toggle' }, [
          triBtn('✕', 'deny', value === 'deny'),
          triBtn('–', 'neutral', value !== 'allow' && value !== 'deny'),
          triBtn('✓', 'allow', value === 'allow'),
        ]);
        function triBtn(label, val, active) {
          return el('button', {
            type: 'button', class: 'gk-tri-toggle-btn' + (active ? ' gk-active' : ''),
            onclick: async () => {
              await setChannelOverwrite(serverId, current.id, role.id, perm.key, val === 'neutral' ? null : val);
              render();
            },
          }, label);
        }
        return el('div', { class: 'gk-channel-overwrite-perm' }, [
          el('div', { class: 'gk-hint' }, perm.label),
          btnRow,
        ]);
      });

      list.appendChild(el('div', { class: 'gk-channel-overwrite-row' }, [
        el('div', { class: 'gk-channel-overwrite-role' }, [
          el('span', { class: 'gk-role-dot', style: `background:${role.color};` }),
          el('span', {}, role.name),
        ]),
        ...permCols,
      ]));
    }
    modal.appendChild(list);

    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-primary gk-btn-block', onclick: () => overlay.classList.remove('gk-open') }, 'Concluído'),
    ]));
  }
}

function closeGenericModal() {
  document.getElementById('gk-generic-modal-overlay').classList.remove('gk-open');
}

export function openCreateServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');

  let step = 'template'; // 'template' -> 'details'
  let chosenTemplate = 'custom';
  let iconFile = null;

  renderStep();
  overlay.classList.add('gk-open');

  function renderStep() {
    modal.innerHTML = '';
    if (step === 'template') renderTemplateStep();
    else renderDetailsStep();
  }

  // ---------- Etapa 1: escolher um template ----------
  function renderTemplateStep() {
    modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
      el('div', { class: 'gk-modal-icon' }, 'SV'),
      el('div', {}, [
        el('h2', {}, 'Criar servidor'),
        el('p', { class: 'gk-modal-sub' }, 'Escolha um ponto de partida. Dá pra reorganizar tudo depois.'),
      ]),
    ]));

    // Reaproveita o mesmo padrão visual do seletor de tipo de canal
    // (.gk-type-picker/.gk-type-option), só que empilhado em coluna e
    // com mais de duas opções.
    const picker = el('div', { class: 'gk-type-picker gk-template-picker' });
    for (const [key, tpl] of Object.entries(SERVER_TEMPLATES)) {
      picker.appendChild(el('button', {
        type: 'button', class: 'gk-type-option',
        onclick: () => { chosenTemplate = key; step = 'details'; renderStep(); },
      }, [
        el('span', { class: 'gk-type-icon' }, tpl.icon),
        el('div', {}, [
          el('div', { class: 'gk-type-name' }, tpl.label),
          el('div', { class: 'gk-type-desc' }, tpl.desc),
        ]),
      ]));
    }
    modal.appendChild(picker);

    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    ]));
  }

  // ---------- Etapa 2: ícone, nome e descrição ----------
  function renderDetailsStep() {
    // Ícone do servidor (opcional) — clique abre o seletor de arquivo,
    // preview local imediato via object URL, upload real só ao criar.
    const iconImg = el('img', { style: 'display:none;' });
    const iconPlaceholder = el('span', {}, '+');
    const iconInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
    const iconPicker = el('div', {
      class: 'gk-server-icon-picker', title: 'Ícone do servidor (opcional)',
      onclick: () => iconInput.click(),
    }, [iconImg, iconPlaceholder]);
    iconInput.addEventListener('change', () => {
      const file = iconInput.files[0];
      if (!file) return;
      iconFile = file;
      iconImg.src = URL.createObjectURL(file);
      iconImg.style.display = 'block';
      iconPlaceholder.style.display = 'none';
    });

    const nameInput = el('input', { type: 'text', placeholder: 'ex: Clã Fênix', maxlength: '60' });
    const descInput = el('textarea', { rows: '2', placeholder: 'Do que se trata o servidor? (opcional)', maxlength: '200' });

    const tpl = SERVER_TEMPLATES[chosenTemplate] || SERVER_TEMPLATES.custom;
    modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
      el('div', { class: 'gk-modal-icon' }, tpl.icon),
      el('div', {}, [
        el('h2', {}, 'Personalize seu servidor'),
        el('p', { class: 'gk-modal-sub' }, `Template: ${tpl.label}.`),
      ]),
    ]));
    modal.appendChild(el('div', { class: 'gk-field', style: 'display:flex;justify-content:center;margin-bottom:18px;' }, [iconPicker, iconInput]));
    modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do servidor'), nameInput]));
    modal.appendChild(el('div', { class: 'gk-field' }, [
      el('label', {}, 'Descrição'), descInput,
      el('div', { class: 'gk-hint' }, 'Só você começa como dono — dá pra promover outros membros a administrador depois, no painel 👥 Membros.'),
    ]));

    const createBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Criar servidor');
    createBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) return;
      createBtn.disabled = true;
      const originalLabel = createBtn.textContent;
      try {
        let iconUrl = '';
        if (iconFile) {
          createBtn.textContent = 'Enviando ícone...';
          const uploaded = await uploadToCloudinary(iconFile, `server-icons/${auth.currentUser.uid}`);
          iconUrl = uploaded.url;
        }
        createBtn.textContent = 'Criando servidor...';
        const id = await createServer(nameInput.value.trim(), descInput.value, iconUrl, '', chosenTemplate);
        closeGenericModal();
        selectServer(id);
      } catch (err) {
        toast(err.message || 'Não foi possível criar o servidor.', 'danger');
        createBtn.disabled = false;
        createBtn.textContent = originalLabel;
      }
    });

    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => { step = 'template'; renderStep(); } }, '← Voltar'),
      createBtn,
    ]));
    nameInput.focus();
  }
}

export function openJoinServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const codeInput = el('input', { type: 'text', placeholder: 'Código do convite (ex: 7F3KQ2LM)' });
  const errorBox = el('div', { class: 'gk-error', style: 'display:none;' });
  modal.appendChild(el('h2', {}, 'Entrar em um servidor'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Código de convite'), codeInput, errorBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        try {
          const id = await joinServerByInviteCode(codeInput.value);
          closeGenericModal();
          selectServer(id);
        } catch (err) {
          errorBox.textContent = err.message;
          errorBox.style.display = 'block';
        }
      },
    }, 'Entrar'),
  ]));
  overlay.classList.add('gk-open');
}

export async function openServerInviteModal(serverId) {
  const code = await createInvite(serverId);
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Convidar para o servidor'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Compartilhe este código. Qualquer pessoa com ele pode entrar.'));
  const codeBox = el('input', { type: 'text', value: code, readonly: 'true', class: 'gk-mono' });
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Código'), codeBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Fechar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: () => { navigator.clipboard.writeText(code); toast('Código copiado.'); },
    }, 'Copiar'),
  ]));
  overlay.classList.add('gk-open');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gk-generic-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'gk-generic-modal-overlay') closeGenericModal();
  });
});
