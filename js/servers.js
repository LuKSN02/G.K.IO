// ============================================================
// G.K.IO — Servidores, categorias e canais (estilo Discord)
// ============================================================
import {
  db, auth, serversCol, serverDoc, categoriesCol, channelsCol, channelDoc, channelMessagesCol, addChannelMessage,
  membersCol, memberDoc, invitesCol, inviteDoc, userDoc, rolesCol, roleDoc,
  doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, writeBatch,
} from './db.js';
import { state, el, toast, cleanupListener, fallbackAvatar, genInviteCode, effectiveStatus, currentActivity, profileCosmetics } from './state.js';
import { syncServerWatchers, registerChannelViewCheck } from './background-notify.js';
import { selectChannel } from './chat.js';
import { openProfileCard } from './profile.js';
import { joinVoiceChannel, expandCallScreen } from './calls.js';
import { uploadToCloudinary } from './cloudinary.js';
import { SERVER_TEMPLATES } from './server-templates.js';
import { openImageCropper } from './cropper.js';
import { isConversationUnread, onReadStatesChange } from './unread.js';
import { showUnreadDot, isMuted, onNotifPrefsChange } from './notify-prefs.js';
import { logAudit } from './audit.js';
import { confirmDialog, resetGenericModal } from './dialogs.js';
import { icon, iconHtml } from './icons.js';
import { hideFriendsHome } from './dms.js';
import { maybeShowRules } from './server-extras.js';

// Sempre que o estado de leitura mudar, re-renderiza a sidebar de canais
// do servidor atualmente aberto pra atualizar os indicadores de não lida.
onReadStatesChange(() => {
  if (state.currentServerId) renderServerSidebar(state.currentServerId, lastCategories, lastChannels);
});
// Silenciar / "só @menções" também muda o que a sidebar mostra.
onNotifPrefsChange(() => {
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

// Nome para exibir/registrar de quem é membro do servidor.
function memberName(serverId, uid) {
  const m = state.serverMembersCache.get(serverId)?.get(uid);
  return m ? (m.nickname || m.user?.displayName || m.user?.username || 'Membro') : 'Membro';
}
const channelNameOf = (id) => lastChannels.find((c) => c.id === id)?.name || 'canal';

// Aviso "os dados do servidor mudaram" (canais, categorias, cargos, membros).
// A tela de Configurações do servidor se inscreve aqui para se redesenhar
// sozinha — antes ela só mostrava a mudança depois de trocar de aba.
const serverDataHandlers = new Set();
export function onServerDataChange(fn) {
  serverDataHandlers.add(fn);
  return () => serverDataHandlers.delete(fn);
}
function emitServerDataChange(serverId) {
  for (const fn of serverDataHandlers) {
    try { fn(serverId); } catch (err) { console.error('[servers] onServerDataChange', err); }
  }
}

// ---------- Catálogo de permissões dos cargos personalizados ----------
// Cada permissão soma poderes ao que o membro já teria como "membro comum".
// 'owner' e o campo legado member.role === 'admin' continuam concedendo
// tudo, por compatibilidade com servidores criados antes deste recurso.
export const PERMISSION_CATALOG = [
  { key: 'manageChannels', label: 'Gerenciar canais', desc: 'Criar, renomear e excluir categorias e canais.' },
  { key: 'manageServer', label: 'Gerenciar servidor', desc: 'Editar nome, descrição, ícone e banner do servidor.' },
  { key: 'manageMembers', label: 'Moderar membros', desc: 'Expulsar, banir, dar castigo e ver o log de auditoria.' },
  { key: 'mentionEveryone', label: 'Mencionar @everyone e @here', desc: 'Avisar todos os membros (ou só quem está online) numa mensagem.' },
  { key: 'manageMessages', label: 'Gerenciar mensagens', desc: 'Apagar mensagens de outras pessoas e fixar/desafixar mensagens nos canais.' },
  { key: 'viewAuditLog', label: 'Ver log de auditoria', desc: 'Abrir a aba Moderação e ler o histórico de ações do servidor (sem poder moderar).' },
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
  return { manageChannels: false, manageServer: false, manageMembers: false, mentionEveryone: false, manageMessages: false, viewAuditLog: false };
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
export async function createServer(name, description = '', iconUrl = '', bannerUrl = '', templateKey = 'custom', visibility = 'private') {
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
    // 'public' aparece pra qualquer pessoa em "Comunidades" (ver
    // js/communities.js) e pode ser entrado sem convite; 'private'
    // (padrão) só é alcançável por convite, como sempre foi.
    visibility: visibility === 'public' ? 'public' : 'private',
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

// Validade e limite de usos são opcionais (null = sem limite). Quem usa o convite é barrado
// pelo app (joinServerByInviteCode); o contador só sobe de 1 em 1 por causa das regras.
export async function createInvite(serverId, { expiresInSeconds = null, maxUses = null } = {}) {
  const code = genInviteCode();
  await setDoc(inviteDoc(code), {
    serverId, createdBy: auth.currentUser.uid, uses: 0,
    maxUses: maxUses ? Math.max(1, Math.round(maxUses)) : null,
    expiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null,
    createdAt: serverTimestamp(),
  });
  if (canAuditHere(serverId)) logAudit(serverId, 'invite.create', { details: { code, maxUses: maxUses || null, seconds: expiresInSeconds || null } });
  return code;
}

// Quem tem permissão para escrever no log (evita avisos no console de quem só cria convite).
const canAuditHere = (serverId) => canViewAuditLog(serverId);

// 'active' | 'expired' | 'full' (+ tempo restante quando tem validade)
export function inviteStatus(inv) {
  const exp = inv.expiresAt?.toMillis ? inv.expiresAt.toMillis() : (inv.expiresAt instanceof Date ? inv.expiresAt.getTime() : 0);
  if (exp && exp <= Date.now()) return { state: 'expired', expiresInMs: 0 };
  if (inv.maxUses && (inv.uses || 0) >= inv.maxUses) return { state: 'full', expiresInMs: exp ? exp - Date.now() : null };
  return { state: 'active', expiresInMs: exp ? exp - Date.now() : null };
}

// Quem gerencia o servidor pode listar todos os convites (all: true); os demais, só os seus.
// As regras não deixam listar convites de outras pessoas — se a consulta "todos" for negada,
// cai para "só os meus" em vez de quebrar a tela.
export async function listServerInvites(serverId, { all = false } = {}) {
  const mine = () => getDocs(query(invitesCol(), where('serverId', '==', serverId), where('createdBy', '==', auth.currentUser.uid)));
  let snap;
  if (all) {
    try { snap = await getDocs(query(invitesCol(), where('serverId', '==', serverId))); }
    catch (err) { if (err?.code !== 'permission-denied') throw err; snap = await mine(); }
  } else {
    snap = await mine();
  }
  const ms = (i) => (i.createdAt?.toMillis ? i.createdAt.toMillis() : 0);
  return snap.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => ms(b) - ms(a));
}

// Privacidade: 'private' = só entra com convite · 'public' = aparece em Comunidades e qualquer pessoa entra.
export async function setServerVisibility(serverId, visibility) {
  const value = visibility === 'public' ? 'public' : 'private';
  await updateDoc(serverDoc(serverId), { visibility: value });
  logAudit(serverId, 'server.visibility', { details: { visibility: value } });
}

export async function revokeInvite(serverId, code) {
  await deleteDoc(inviteDoc(code));
  if (canAuditHere(serverId)) logAudit(serverId, 'invite.revoke', { details: { code } });
}

// Boas-vindas + cargo automático (campos do doc do servidor: `welcome` e `autoRoleId`).
export const DEFAULT_WELCOME = 'Bem-vindo(a) ao {servidor}, {usuario}! 🎉';
export function renderWelcomeText(template, { usuario, servidor }) {
  return String(template || DEFAULT_WELCOME).slice(0, 300)
    .replace(/\{usuario\}/gi, usuario).replace(/\{servidor\}/gi, servidor);
}
export async function saveWelcomeSettings(serverId, { enabled, channelId, message, autoRoleId }) {
  await updateDoc(serverDoc(serverId), {
    welcome: { enabled: !!enabled, channelId: channelId || null, message: (message || '').trim().slice(0, 300) },
    autoRoleId: autoRoleId || null,
  });
  logAudit(serverId, 'server.welcome', { details: { enabled: !!enabled, autoRole: autoRoleId ? (lastRoles.get(autoRoleId)?.name || 'cargo') : null } });
}

// Vira membro de um servidor — mesmo passo usado tanto ao entrar por
// convite quanto ao entrar direto por uma comunidade pública (ver
// js/communities.js). Sempre nasce como 'member' comum, nunca 'owner'.
// Entrar num servidor.
//  · público ('public'): entra direto — doc do servidor + doc de membro (como sempre).
//  · privado ('private', o padrão): só com convite. As regras do Firestore exigem a prova do
//    convite no doc de membro e que ele seja consumido (uses + 1) na MESMA gravação em lote,
//    então a entrada é UM lote atômico: convite + doc de membro + lista de membros.
// Devolve { usesCounted }: true quando o uso do convite já foi contado no lote.
export async function joinServerAsMember(serverId, { inviteCode = null, inviteUses = 0 } = {}) {
  const uid = auth.currentUser.uid;
  let cfg = {};
  try { const snap = await getDoc(serverDoc(serverId)); cfg = snap.exists() ? snap.data() : {}; } catch (e) { /* segue: as regras decidem */ }
  const isPrivate = (cfg.visibility || 'private') === 'private';

  if (isPrivate) {
    if (!inviteCode) throw new Error('Este servidor é privado: só dá para entrar com um convite.');
    await joinPrivateWithInvite(serverId, cfg, { inviteCode, inviteUses });
    postWelcomeMessage(serverId, cfg);
    return { usesCounted: true };
  }

  try {
    await updateDoc(serverDoc(serverId), { memberIds: arrayUnion(uid) });
    // Agora já somos membros, então dá para ler os cargos: cargo automático e boas-vindas.
    const roleIds = await autoRoleIdsFor(serverId, cfg);
    const base = { nickname: null, role: 'member', joinedAt: serverTimestamp() };
    try {
      await setDoc(memberDoc(serverId, uid), roleIds.length ? { ...base, roleIds } : base);
    } catch (err) {
      // Regras ainda sem o cargo automático: entra mesmo assim, só sem o cargo.
      if (!roleIds.length) throw err;
      await setDoc(memberDoc(serverId, uid), base);
    }
    postWelcomeMessage(serverId, cfg); // sem await: a entrada não depende disso
  } catch (err) {
    // As regras barram quem foi banido (servers/{id}/bans/{uid}) — a pessoa não pode ler a
    // lista de bans, então não dá para confirmar; deixamos a pista na mensagem.
    if (err?.code === 'permission-denied') throw new Error('Não foi possível entrar neste servidor. Você pode ter sido banido dele.');
    throw err;
  }
  return { usesCounted: false };
}

async function joinPrivateWithInvite(serverId, cfg, { inviteCode, inviteUses }) {
  const uid = auth.currentUser.uid;
  // Quem ainda não é membro não consegue ler os cargos, então não dá para conferir se o cargo
  // automático ainda é "sem permissões" — se a leitura for negada, confiamos na configuração (o
  // app apaga o autoRoleId quando o cargo ganha permissões ou é excluído).
  let roleIds = [];
  if (cfg.autoRoleId) {
    roleIds = [cfg.autoRoleId];
    try {
      const r = await getDoc(roleDoc(serverId, cfg.autoRoleId));
      if (!r.exists() || Object.values(r.data().permissions || {}).some(Boolean)) roleIds = [];
    } catch (e) { /* sem acesso antes de entrar: mantém */ }
  }
  const attempt = async (withRoles) => {
    const batch = writeBatch(db);
    batch.update(inviteDoc(inviteCode), { uses: inviteUses + 1 });
    batch.set(memberDoc(serverId, uid), {
      nickname: null, role: 'member', joinedAt: serverTimestamp(), inviteCode,
      ...(withRoles && roleIds.length ? { roleIds } : {}),
    });
    batch.update(serverDoc(serverId), { memberIds: arrayUnion(uid) });
    await batch.commit();
  };
  try {
    try {
      await attempt(true);
    } catch (err) {
      // Regras sem o cargo automático: tenta de novo sem ele (o lote anterior não gravou nada).
      if (err?.code === 'permission-denied' && roleIds.length) await attempt(false); else throw err;
    }
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw new Error('Não foi possível entrar com este convite. Ele pode ter expirado ou esgotado, ou você foi banido deste servidor.');
    }
    throw err;
  }
}

// Cargo automático só vale se ainda existir e não tiver permissões (cosmético).
async function autoRoleIdsFor(serverId, cfg) {
  if (!cfg.autoRoleId) return [];
  try {
    const r = await getDoc(roleDoc(serverId, cfg.autoRoleId));
    if (!r.exists()) return [];
    const hasPerms = Object.values(r.data().permissions || {}).some(Boolean);
    return hasPerms ? [] : [cfg.autoRoleId];
  } catch (e) { return []; }
}

// Mensagem de boas-vindas no canal escolhido. É escrita pelo próprio app de quem entrou
// (não há servidor para fazer isso), marcada como `system: 'welcome'` para aparecer como aviso.
async function postWelcomeMessage(serverId, cfg) {
  const w = cfg.welcome;
  if (!w?.enabled || !w.channelId) return;
  try {
    const ch = await getDoc(channelDoc(serverId, w.channelId));
    if (!ch.exists()) return;
    const me = state.user || {};
    const name = me.displayName || me.username || 'Alguém';
    await addChannelMessage(serverId, w.channelId, {
      system: 'welcome',
      content: renderWelcomeText(w.message, { usuario: name, servidor: cfg.name || 'servidor' }),
      authorId: auth.currentUser.uid, authorName: name, authorAvatar: me.avatarUrl || '',
      createdAt: serverTimestamp(),
    }, Number(ch.data().slowmodeSeconds) || 0);
    await updateDoc(channelDoc(serverId, w.channelId), { lastMessageAt: serverTimestamp(), lastMessageAuthorId: auth.currentUser.uid }).catch(() => {});
  } catch (err) {
    console.warn('[boas-vindas] não consegui enviar a mensagem', err.code || err.message);
  }
}

// Aceita o código puro ("7F3KQ2LM") ou um texto colado com ele dentro
// (link, "Convite: 7F3KQ2LM"…): pega o último "pedaço" alfanumérico.
export function parseInviteCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const fromParam = s.match(/[?&](?:invite|convite|code)=([A-Za-z0-9]+)/i);
  if (fromParam) return fromParam[1].toUpperCase();
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (parts[parts.length - 1] || '').toUpperCase();
}

export async function joinServerByInviteCode(code) {
  code = parseInviteCode(code);
  if (!code) throw new Error('Cole o código do convite.');
  const snap = await getDoc(inviteDoc(code));
  if (!snap.exists()) throw new Error('Convite inválido ou expirado.');
  const inv = snap.data();
  const status = inviteStatus(inv);
  if (status.state === 'expired') throw new Error('Este convite expirou.');
  if (status.state === 'full') throw new Error('Este convite atingiu o limite de usos.');
  // Quem já está no servidor não gasta um uso do convite.
  if (state.servers.has(inv.serverId)) {
    toast(`Você já está em "${state.servers.get(inv.serverId).name}".`);
    return inv.serverId;
  }
  const { usesCounted } = await joinServerAsMember(inv.serverId, { inviteCode: code, inviteUses: inv.uses || 0 });
  if (!usesCounted) {
    try { await updateDoc(inviteDoc(code), { uses: (inv.uses || 0) + 1 }); } catch (e) { /* a contagem é só informativa */ }
  }
  const serverSnap = await getDoc(serverDoc(inv.serverId));
  toast(`Você entrou em "${serverSnap.data().name}".`);
  return inv.serverId;
}

// ---------- Cargos / permissões ----------
// Promove ou rebaixa um membro entre 'admin' e 'member'. Só o dono pode
// chamar isso na prática (a regra do Firestore também garante isso do
// lado do servidor — ver firestore.rules).
export async function setMemberRole(serverId, targetUid, role) {
  await updateDoc(memberDoc(serverId, targetUid), { role });
  logAudit(serverId, 'member.admin', { targetId: targetUid, targetName: memberName(serverId, targetUid), details: { admin: role === 'admin' } });
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
    emitServerDataChange(serverId);
  });
  state.unsubscribers.roles = () => unsubRoles && unsubRoles();
}

export function getRoles() {
  return [...lastRoles.values()].sort((a, b) => (a.position || 0) - (b.position || 0));
}

export async function createRole(serverId, { name, color, permissions }) {
  const existing = await getDocs(query(rolesCol(serverId)));
  const ref = await addDoc(rolesCol(serverId), {
    name: (name || '').trim() || 'Novo cargo',
    color: color || ROLE_COLOR_SWATCHES[0],
    permissions: { ...emptyPermissions(), ...(permissions || {}) },
    position: existing.size,
    createdAt: serverTimestamp(),
  });
  logAudit(serverId, 'role.create', { details: { name: (name || '').trim() || 'Novo cargo' } });
  toast('Cargo criado.');
  return ref.id;
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
  // Cargo automático precisa continuar sem permissões; se ganhou alguma, deixa de ser automático.
  if (clean.permissions && Object.values(clean.permissions).some(Boolean) && state.servers.get(serverId)?.autoRoleId === roleId) {
    await updateDoc(serverDoc(serverId), { autoRoleId: null }).catch(() => {});
  }
  logAudit(serverId, 'role.update', { details: { name: clean.name || lastRoles.get(roleId)?.name || 'Cargo' } });
  toast('Cargo atualizado.');
}

export async function deleteRole(serverId, roleId) {
  const roleName = lastRoles.get(roleId)?.name || 'Cargo';
  const cache = state.serverMembersCache.get(serverId) || new Map();
  for (const m of cache.values()) {
    if (!(m.roleIds || []).includes(roleId)) continue;
    const newRoleIds = m.roleIds.filter((r) => r !== roleId);
    await writeMemberRoles(serverId, m.uid, newRoleIds);
  }
  await deleteDoc(roleDoc(serverId, roleId));
  if (state.servers.get(serverId)?.autoRoleId === roleId) await updateDoc(serverDoc(serverId), { autoRoleId: null }).catch(() => {});
  logAudit(serverId, 'role.delete', { details: { name: roleName } });
  toast('Cargo excluído.');
}

export async function assignRoleToMember(serverId, targetUid, roleId, assign) {
  const cache = state.serverMembersCache.get(serverId) || new Map();
  const member = cache.get(targetUid);
  const current = member?.roleIds || [];
  const newRoleIds = assign ? [...new Set([...current, roleId])] : current.filter((r) => r !== roleId);
  await writeMemberRoles(serverId, targetUid, newRoleIds);
  logAudit(serverId, assign ? 'role.assign' : 'role.remove', {
    targetId: targetUid, targetName: memberName(serverId, targetUid), details: { name: lastRoles.get(roleId)?.name || 'Cargo' },
  });
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

// Usar @everyone / @here (dono e admin sempre; demais precisam do cargo com a permissão).
export function canMentionEveryone(serverId) {
  return hasServerPermission(serverId, 'mentionEveryone');
}

// Apagar mensagens de outras pessoas e fixar mensagens (quem gerencia canais também pode).
export function canManageMessages(serverId) {
  return hasServerPermission(serverId, 'manageMessages') || hasServerPermission(serverId, 'manageChannels');
}

// Ler o log de auditoria (aba Moderação).
export function canViewAuditLog(serverId) {
  return canKickMembers(serverId) || canManageChannels(serverId) || canManageServerInfo(serverId)
    || hasServerPermission(serverId, 'viewAuditLog');
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

  // Canal privado: só enxerga quem gerencia canais ou tem um cargo marcado como "permitir".
  // É o mesmo cálculo das firestore.rules (viewRoleIds), então a interface não mente.
  if (key === 'viewChannel' && channel.private) {
    if (member.permissions?.manageChannels) return true;
    const allowed = channel.viewRoleIds || [];
    return (member.roleIds || []).some((r) => allowed.includes(r));
  }

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

registerChannelViewCheck(canViewChannel);

export function canSendInChannel(serverId, channel) {
  if (channel.type !== 'text') return true;
  // Canal de anúncios: só quem gerencia canais publica (as regras do Firestore também exigem).
  if (channel.announcement && !canManageChannels(serverId)) return false;
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
  // viewRoleIds = cargos com "Ver canal: permitir" — cópia que as firestore.rules conseguem
  // conferir (elas não leem o mapa de overwrites). Só vale quando o canal é privado.
  await updateDoc(channelDoc(serverId, channelId), { overwrites, viewRoleIds: viewRoleIdsFrom(overwrites) });
}

export function viewRoleIdsFrom(overwrites = {}) {
  return Object.entries(overwrites).filter(([, v]) => v?.viewChannel === 'allow').map(([rid]) => rid);
}

// Liga/desliga o modo privado de um canal: privado = só os cargos marcados com "Ver canal: permitir"
// (e quem gerencia canais) enxergam. As firestore.rules barram a leitura e o envio de verdade.
export async function setChannelPrivate(serverId, channelId, isPrivate) {
  const channel = lastChannels.find((c) => c.id === channelId);
  await updateDoc(channelDoc(serverId, channelId), {
    private: !!isPrivate,
    viewRoleIds: viewRoleIdsFrom(channel?.overwrites || {}),
  });
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

// opts.silent: sem toast (o banimento mostra o próprio) · opts.audit: registrar no log (padrão sim)
export async function kickMember(serverId, targetUid, { silent = false, audit = true } = {}) {
  const server = state.servers.get(serverId);
  const targetName = memberName(serverId, targetUid);
  await updateDoc(serverDoc(serverId), { memberIds: (server.memberIds || []).filter((id) => id !== targetUid) });
  await deleteDoc(memberDoc(serverId, targetUid)).catch(() => {});
  if (audit) logAudit(serverId, 'member.kick', { targetId: targetUid, targetName });
  if (!silent) toast('Membro removido do servidor.');
}

// ---------- Configurações de servidor: categorias e canais ----------
export async function createCategory(serverId, name) {
  const existing = await getDocs(query(categoriesCol(serverId)));
  await addDoc(categoriesCol(serverId), { name: name.trim() || 'Nova categoria', position: existing.size });
  logAudit(serverId, 'category.create', { details: { name: name.trim() || 'Nova categoria' } });
}

export async function renameCategory(serverId, catId, name) {
  await updateDoc(doc(db, 'servers', serverId, 'categories', catId), { name: name.trim() || 'Categoria' });
}

export async function deleteCategory(serverId, catId) {
  const hasChannels = lastChannels.some((c) => c.categoryId === catId);
  if (hasChannels) throw new Error('Mova ou exclua os canais desta categoria antes de excluí-la.');
  const catName = lastCategories.find((c) => c.id === catId)?.name || 'Categoria';
  await deleteDoc(doc(db, 'servers', serverId, 'categories', catId));
  logAudit(serverId, 'category.delete', { details: { name: catName } });
}

export async function renameChannel(serverId, channelId, name) {
  const from = channelNameOf(channelId);
  const to = name.trim().toLowerCase().replace(/\s+/g, '-') || 'canal';
  await updateDoc(channelDoc(serverId, channelId), { name: to });
  logAudit(serverId, 'channel.rename', { details: { from, to } });
}

export async function setChannelNsfw(serverId, channelId, nsfw) {
  await updateDoc(channelDoc(serverId, channelId), { nsfw: !!nsfw });
  logAudit(serverId, 'channel.nsfw', { details: { name: channelNameOf(channelId), nsfw: !!nsfw } });
}

// Modo lento: segundos mínimos entre duas mensagens da mesma pessoa no canal (0 = desligado).
// Quem gerencia canais (e o dono/admin) é isento. É aplicado pelo app (composer) — ver chat.js.
export async function setChannelSlowmode(serverId, channelId, seconds) {
  const value = Math.max(0, Math.min(21600, Math.round(Number(seconds) || 0)));
  await updateDoc(channelDoc(serverId, channelId), { slowmodeSeconds: value });
  logAudit(serverId, 'channel.slowmode', { details: { name: channelNameOf(channelId), seconds: value } });
}

export async function deleteChannel(serverId, channelId) {
  const chName = channelNameOf(channelId);
  await deleteDoc(channelDoc(serverId, channelId));
  logAudit(serverId, 'channel.delete', { details: { name: chName } });
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
    if (state.currentView === 'server-picker') renderServerPicker();
    syncServerWatchers();
  });
  state.unsubscribers._servers = () => unsubServers && unsubServers();
}

// Lista nomeada de servidores — mostrada na sidebar quando a seção
// "Servidor" do rail está ativa e nenhum servidor específico foi
// escolhido ainda (ver goToServerPickerView). Substituiu o rail de
// ícones que existia antes: agora o rail principal é fixo (seções do
// app), e trocar de servidor acontece aqui dentro.
function renderServerPicker() {
  const body = document.getElementById('gk-sidebar-body');
  if (!body) return;
  body.innerHTML = '';
  if (!state.servers.size) {
    body.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('gamepad', { size: 32 })]),
      el('div', {}, 'Você ainda não está em nenhum servidor. Crie um ou entre com um convite.'),
    ]));
    return;
  }
  const list = el('div', { class: 'gk-server-picker-list' });
  for (const server of state.servers.values()) {
    list.appendChild(el('div', {
      class: 'gk-server-picker-row',
      onclick: () => selectServer(server.id),
    }, [
      el('div', { class: 'gk-avatar gk-sz-40' }, [
        server.iconUrl
          ? el('img', { src: server.iconUrl })
          : el('div', { class: 'gk-server-picker-fallback' }, (server.name || '?').slice(0, 2).toUpperCase()),
      ]),
      el('div', { class: 'gk-server-picker-info' }, [
        el('div', { class: 'gk-server-picker-name' }, server.name || 'Servidor'),
        el('div', { class: 'gk-server-picker-sub' }, `${(server.memberIds || []).length} membro(s)`),
      ]),
    ]));
  }
  body.appendChild(list);
}

// Chamado quando a pessoa clica em "Servidor" no rail principal — mostra
// a lista acima em vez de pular direto pro último servidor aberto, pra
// combinar com a navegação por seções fixas.
export function goToServerPickerView() {
  hideFriendsHome();
  cleanupListener('categories');
  cleanupListener('channels');
  cleanupListener('members');
  cleanupListener('roles');
  state.currentView = 'server-picker';
  state.currentServerId = null;
  state.currentChannelId = null;
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-home-view').style.display = 'none';
  document.getElementById('gk-files-view').style.display = 'none';
  document.getElementById('gk-communities-view').style.display = 'none';
  document.getElementById('gk-add-friend-btn').style.display = 'none';
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  { const b = document.getElementById('gk-server-events-btn'); if (b) b.style.display = 'none'; }
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-video-call-btn').style.display = 'none';
  document.getElementById('gk-topbar-title').textContent = 'Servidores';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  document.getElementById('gk-sidebar-header-title').textContent = 'Servidores';
  document.getElementById('gk-server-picker-add').style.display = 'block';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-servers')?.classList.add('gk-active');
  renderServerPicker();
}

// ---------- Selecionar servidor ----------
export function selectServer(serverId) {
  state.currentView = 'server';
  state.currentServerId = serverId;
  state.currentChannelId = null;
  hideFriendsHome();
  document.getElementById('gk-home-view').style.display = 'none';
  document.getElementById('gk-files-view').style.display = 'none';
  document.getElementById('gk-communities-view').style.display = 'none';
  document.getElementById('gk-messages').style.display = 'flex';
  document.getElementById('gk-composer').style.display = 'block';
  document.getElementById('gk-server-picker-add').style.display = 'none';
  document.getElementById('gk-add-friend-btn').style.display = 'none';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-servers')?.classList.add('gk-active');
  listenCategoriesAndChannels(serverId);
  listenMembers(serverId);
  listenRoles(serverId);
  document.getElementById('gk-sidebar-header-title').textContent = state.servers.get(serverId)?.name || 'Servidor';
  document.getElementById('gk-members').style.display = 'block';
  document.getElementById('gk-server-settings-btn').style.display = 'inline-flex';
  const evBtn = document.getElementById('gk-server-events-btn'); if (evBtn) evBtn.style.display = 'inline-flex';
  document.getElementById('gk-members-toggle-btn').style.display = 'inline-flex';
  maybeShowRules(serverId); // tela de regras (só aparece se o servidor exige aceite e você ainda não aceitou)
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
      emitServerDataChange(serverId);
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
      const chCtx = { serverId, channelId: ch.id };
      const unread = ch.type === 'text' && !isActive
        && isConversationUnread(ch.id, ch.lastMessageAt, ch.lastMessageAuthorId)
        && showUnreadDot(chCtx, ch.lastMentionedUids);
      const row = el('div', {
        class: 'gk-channel' + (isActive ? ' gk-active' : '') + (unread ? ' gk-unread' : '') + (ch.type === 'text' && isMuted(chCtx) ? ' gk-muted' : ''),
        // Canal marcado como +18: fica exposto como atributo para temas/plugins
        // (ex.: o plugin BetterNsfwTag mostra uma tag "NSFW" ao lado do nome).
        'data-nsfw': ch.nsfw ? 'true' : undefined,
        onclick: () => ch.type === 'text'
          ? selectChannel(serverId, ch.id, ch.name, !canSendInChannel(serverId, ch))
          : confirmJoinVoiceChannel(serverId, ch),
      }, [
        el('span', { class: 'gk-channel-icon' }, ch.type === 'text' ? '#' : [icon('speaker', { size: 14 })]),
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
      }, [el('span', { class: 'gk-chevron' }, [icon('chevronDown', { size: 13 })]), el('span', {}, cat.name)]),
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
    }, [el('span', { class: 'gk-channel-icon' }, [icon('plus', { size: 14 })]), el('span', {}, 'Novo canal')]);
    body.appendChild(addBtn);
  }
}

// Confirmação antes de entrar numa sala de voz — evita entrar sem
// querer (ex: clique perdido na sidebar) e, se a pessoa já estiver em
// outra chamada/sala, avisa que ela vai ser encerrada automaticamente
// ao entrar nessa nova, pra não pegar ninguém de surpresa.
function confirmJoinVoiceChannel(serverId, ch) {
  // Já está conectado NESTA sala: não pergunta de novo, abre o painel da
  // chamada (participantes, mic, fone, tela, desligar), como no Discord.
  if (state.activeCall?.kind === 'voiceChannel' && state.activeCall.id === ch.id) {
    expandCallScreen();
    return;
  }
  let note = null;
  if (state.activeCall && !(state.activeCall.kind === 'voiceChannel' && state.activeCall.id === ch.id)) {
    note = state.activeCall.kind === 'dm'
      ? 'Sua chamada em andamento será encerrada automaticamente.'
      : 'Você vai sair da sala de voz atual automaticamente.';
  }
  confirmDialog({
    title: 'Entrar na sala de voz?',
    message: `Você está prestes a entrar em "${ch.name}".`,
    note,
    confirmLabel: 'Entrar',
    iconName: 'speaker',
    tone: 'accent',
    onConfirm: () => joinVoiceChannel(serverId, ch.id, ch.name),
  });
}

function listenMembers(serverId) {
  cleanupListener('members');
  unsubMembers = onSnapshot(membersCol(serverId), async (snap) => {
    // Busca os docs de usuário de todos os membros em paralelo — num
    // servidor com muita gente, isso evita que o painel de membros
    // demore vários segundos pra aparecer (era um getDoc por vez).
    const cache = new Map();
    const resolved = await Promise.all(snap.docs.map(async (d) => {
      const userSnap = await getDoc(userDoc(d.id));
      return userSnap.exists() ? { uid: d.id, ...d.data(), user: userSnap.data() } : null;
    }));
    resolved.forEach((m) => { if (m) cache.set(m.uid, m); });
    state.serverMembersCache.set(serverId, cache);
    renderMembersPanel(cache, serverId);
    // Um cargo pode ter mudado (ex: alguém virou admin) — re-renderiza a
    // sidebar de canais para atualizar a visibilidade do "Novo canal".
    if (state.currentServerId === serverId) renderServerSidebar(serverId, lastCategories, lastChannels);
    emitServerDataChange(serverId);
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
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': effectiveStatus(m.user) }, [
        el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) }),
      ]),
      el('div', { class: 'gk-member-text' }, [
        nameLine,
        (currentActivity(m.user) && !(m.user.privacy?.hideActivity && m.uid !== auth.currentUser?.uid)) ? el('div', { class: 'gk-activity-line', title: 'Jogando ' + currentActivity(m.user).name }, 'Jogando ' + currentActivity(m.user).name) : null,
      ]),
    ];

    // Só o dono vê o botão de promover/rebaixar, e nunca para si mesmo ou para outro dono.
    if (isOwner && role !== 'owner' && m.uid !== auth.currentUser?.uid) {
      rowChildren.push(el('button', {
        class: 'gk-member-role-btn',
        title: role === 'admin' ? 'Remover cargo de administrador' : 'Tornar administrador (pode criar canais)',
        onclick: (e) => { e.stopPropagation(); setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin'); },
      }, [icon(role === 'admin' ? 'starFilled' : 'starOutline', { size: 14 })]));
    }

    const row = el('div', { class: 'gk-member-row', 'data-nameplate': profileCosmetics(m.user).nameplate, onclick: () => openProfileCard(m.uid) }, rowChildren);
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
    el('span', { class: 'gk-type-icon' }, [icon('speaker', { size: 18 })]),
    el('div', {}, [el('div', { class: 'gk-type-name' }, 'Voz'), el('div', { class: 'gk-type-desc' }, 'Conversa por áudio e vídeo')]),
  ]);

  function selectType(type) {
    selectedType = type;
    textOption.classList.toggle('gk-active', type === 'text');
    voiceOption.classList.toggle('gk-active', type === 'voice');
    prefixEl.innerHTML = type === 'text' ? '#' : iconHtml('speaker', { size: 15 });
    nsfwRow.style.display = type === 'text' ? '' : 'none';
  }

  const catSelect = el('select', { class: 'gk-select' },
    categories.map((c) => el('option', { value: c.id }, c.name)));

  // Canal +18 (só faz sentido em canais de texto).
  const nsfwCheckbox = el('input', { type: 'checkbox' });
  const nsfwRow = el('label', { class: 'gk-nsfw-option' }, [
    nsfwCheckbox,
    el('span', {}, [el('strong', {}, 'Canal NSFW (+18)'), el('small', {}, 'Marca o canal como conteúdo adulto. Plugins e temas podem destacá-lo.')]),
  ]);

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
  modal.appendChild(nsfwRow);
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
          nsfw: selectedType === 'text' && nsfwCheckbox.checked,
        });
        logAudit(serverId, 'channel.create', { details: { name: nameInput.value.trim() } });
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

    modal.appendChild(el('h2', {}, ['Permissões — ', current.type === 'text' ? '#' : icon('speaker', { size: 16 }), ` ${current.name}`]));
    modal.appendChild(el('p', { class: 'gk-modal-sub' }, current.private
      ? 'Canal privado: só enxerga quem tem um cargo marcado com ✓ em “Ver canal” (e quem gerencia canais). O ✗ não faz diferença aqui.'
      : 'Restrinja este canal por cargo. Sem nenhuma marcação, o canal fica visível a todo mundo (dono e admin sempre veem tudo).'));
    if (current.type === 'text' || current.type === 'voice') {
      const privToggle = el('label', { class: 'gk-role-perm-row' }, [
        el('input', { type: 'checkbox', ...(current.private ? { checked: 'true' } : {}) }),
        el('div', {}, [
          el('div', { class: 'gk-role-perm-label' }, 'Canal privado'),
          el('div', { class: 'gk-hint' }, 'Esconde o canal de todo mundo, menos dos cargos marcados com ✓. Vale também no servidor do Firebase (as mensagens não podem ser lidas por quem não tem acesso).'),
        ]),
      ]);
      privToggle.querySelector('input').addEventListener('change', async (e) => {
        try { await setChannelPrivate(serverId, current.id, e.target.checked); } catch (err) { toast('Não foi possível alterar o canal.', 'danger'); }
        render();
      });
      modal.appendChild(privToggle);
    }

    if (roles.length === 0) {
      modal.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Crie um cargo primeiro, na aba Cargos, para poder restringir este canal por ele.'));
    }

    const list = el('div', { class: 'gk-channel-overwrite-list' });
    for (const role of roles) {
      const overwrite = current.overwrites?.[role.id] || {};
      const permCols = perms.map((perm) => {
        const value = overwrite[perm.key] || 'neutral';
        const btnRow = el('div', { class: 'gk-tri-toggle' }, [
          triBtn('close', 'deny', value === 'deny'),
          triBtn('minus', 'neutral', value !== 'allow' && value !== 'deny'),
          triBtn('check', 'allow', value === 'allow'),
        ]);
        function triBtn(iconName, val, active) {
          return el('button', {
            type: 'button', class: 'gk-tri-toggle-btn' + (active ? ' gk-active' : ''),
            onclick: async () => {
              await setChannelOverwrite(serverId, current.id, role.id, perm.key, val === 'neutral' ? null : val);
              render();
            },
          }, [icon(iconName, { size: 13 })]);
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

const ICON_PRESETS = [
  { id: 'brand', label: 'G.K.IO', kind: 'logo' },
  { id: 'gamepad', label: 'Jogos', icon: 'gamepad' },
  { id: 'book', label: 'Estudos', icon: 'book' },
  { id: 'sparkles', label: 'Geral', icon: 'sparkles' },
];

export function openCreateServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.classList.add('gk-modal-wizard');

  const STEPS = [
    { id: 1, label: 'Informações básicas', hint: 'Nome, ícone e descrição' },
    { id: 2, label: 'Configurações', hint: 'Estrutura inicial e privacidade' },
    { id: 3, label: 'Finalizar', hint: 'Revisar e criar servidor' },
  ];

  let step = 1;
  let name = '';
  let description = '';
  let chosenTemplate = 'custom';
  let visibility = 'private';
  let iconMode = 'brand';   // um dos ICON_PRESETS.id, ou 'custom'
  let iconFile = null;      // File já recortado (ver cropper.js), só quando iconMode === 'custom'

  renderAll();
  overlay.classList.add('gk-open');

  overlay.addEventListener('click', onOverlayClick);
  function onOverlayClick(e) { if (e.target === overlay) close(); }
  function close() {
    overlay.classList.remove('gk-open');
    overlay.removeEventListener('click', onOverlayClick);
    modal.classList.remove('gk-modal-wizard');
  }

  function renderAll() {
    modal.innerHTML = '';
    modal.appendChild(buildStepList());
    modal.appendChild(buildStepBody());
    modal.appendChild(buildPreview());
  }

  // ---------- Coluna 1: indicador de etapas ----------
  function buildStepList() {
    const col = el('div', { class: 'gk-wizard-steps' }, [
      el('h3', {}, 'Criar servidor'),
    ]);
    STEPS.forEach((s) => {
      col.appendChild(el('div', {
        class: 'gk-wizard-step' + (step === s.id ? ' gk-active' : '') + (step > s.id ? ' gk-done' : ''),
      }, [
        el('span', { class: 'gk-wizard-step-num' }, step > s.id ? [icon('check', { size: 12 })] : String(s.id)),
        el('div', {}, [el('b', {}, s.label), el('small', {}, s.hint)]),
      ]));
    });
    return col;
  }

  // ---------- Coluna 2: o formulário da etapa atual ----------
  function buildStepBody() {
    const body = el('div', { class: 'gk-wizard-body' });
    if (step === 1) body.appendChild(buildStep1());
    else if (step === 2) body.appendChild(buildStep2());
    else body.appendChild(buildStep3());
    return body;
  }

  function refreshLive() {
    // Reconstrói só o preview + a lista de etapas (pra marcar concluídas),
    // sem perder o foco de quem está digitando no formulário.
    const oldPreview = modal.querySelector('.gk-wizard-preview');
    const newPreview = buildPreview();
    oldPreview.replaceWith(newPreview);
    const oldSteps = modal.querySelector('.gk-wizard-steps');
    const newSteps = buildStepList();
    oldSteps.replaceWith(newSteps);
  }

  // ---------- Etapa 1: identidade ----------
  function buildStep1() {
    const wrap = el('div', {});
    wrap.appendChild(el('h2', {}, 'Informações básicas'));
    wrap.appendChild(el('p', { class: 'gk-modal-sub' }, 'Nome, ícone e descrição do seu servidor.'));

    const nameInput = el('input', { type: 'text', placeholder: 'ex: Clã Fênix', maxlength: '60', value: name });
    nameInput.addEventListener('input', () => { name = nameInput.value; refreshLive(); });
    wrap.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do servidor'), nameInput]));

    const descInput = el('textarea', { rows: '2', placeholder: 'Do que se trata o servidor? (opcional)', maxlength: '200' }, description);
    descInput.addEventListener('input', () => { description = descInput.value; refreshLive(); });
    wrap.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Descrição'), descInput]));

    const iconField = el('div', { class: 'gk-field' }, [el('label', {}, 'Ícone do servidor')]);
    const grid = el('div', { class: 'gk-server-icon-grid' });
    for (const preset of ICON_PRESETS) {
      grid.appendChild(el('button', {
        type: 'button', class: 'gk-server-icon-option' + (iconMode === preset.id ? ' gk-active' : ''),
        title: preset.label,
        onclick: () => { iconMode = preset.id; iconFile = null; renderAll(); },
      }, [preset.kind === 'logo' ? el('img', { src: 'img/logo.png' }) : icon(preset.icon, { size: 20 })]));
    }
    const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const cropped = await openImageCropper(file, 1, { title: 'Ajustar ícone do servidor', outputWidth: 400 });
      if (!cropped) return;
      iconFile = cropped;
      iconMode = 'custom';
      renderAll();
    });
    grid.appendChild(el('button', {
      type: 'button', class: 'gk-server-icon-option gk-server-icon-option-add' + (iconMode === 'custom' ? ' gk-active' : ''),
      title: 'Enviar imagem', onclick: () => fileInput.click(),
    }, [iconMode === 'custom' && iconFile ? el('img', { src: URL.createObjectURL(iconFile) }) : icon('plus', { size: 18 })]));
    iconField.appendChild(grid);
    iconField.appendChild(fileInput);
    wrap.appendChild(iconField);

    wrap.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: close }, 'Cancelar'),
      el('button', {
        class: 'gk-btn gk-btn-primary',
        onclick: () => { if (!name.trim()) { toast('Dá um nome pro servidor primeiro.', 'danger'); return; } step = 2; renderAll(); },
      }, ['Próximo ', icon('chevronLeft', { size: 14, className: 'gk-icon-flip' })]),
    ]));
    setTimeout(() => nameInput.focus(), 0);
    return wrap;
  }

  // ---------- Etapa 2: estrutura inicial + privacidade ----------
  function buildStep2() {
    const wrap = el('div', {});
    wrap.appendChild(el('h2', {}, 'Configurações'));
    wrap.appendChild(el('p', { class: 'gk-modal-sub' }, 'Estrutura inicial de canais e quem pode entrar. Tudo isso dá pra mudar depois.'));

    const tplField = el('div', { class: 'gk-field' }, [el('label', {}, 'Estrutura inicial de canais')]);
    const tplPicker = el('div', { class: 'gk-type-picker gk-template-picker' });
    for (const [key, tpl] of Object.entries(SERVER_TEMPLATES)) {
      tplPicker.appendChild(el('button', {
        type: 'button', class: 'gk-type-option' + (chosenTemplate === key ? ' gk-active' : ''),
        onclick: () => { chosenTemplate = key; renderAll(); },
      }, [
        el('span', { class: 'gk-type-icon' }, [icon(tpl.icon, { size: 18 })]),
        el('div', {}, [el('div', { class: 'gk-type-name' }, tpl.label), el('div', { class: 'gk-type-desc' }, tpl.desc)]),
      ]));
    }
    tplField.appendChild(tplPicker);
    wrap.appendChild(tplField);

    const visPublicBtn = el('button', {
      type: 'button', class: 'gk-type-option gk-visibility-option' + (visibility === 'public' ? ' gk-active' : ''),
      onclick: () => { visibility = 'public'; renderAll(); },
    }, [el('span', { class: 'gk-type-icon' }, [icon('tray', { size: 16 })]),
      el('div', {}, [el('div', { class: 'gk-type-name' }, 'Público'), el('div', { class: 'gk-type-desc' }, 'Aparece em Comunidades — qualquer pessoa encontra e entra.')])]);
    const visPrivateBtn = el('button', {
      type: 'button', class: 'gk-type-option gk-visibility-option' + (visibility === 'private' ? ' gk-active' : ''),
      onclick: () => { visibility = 'private'; renderAll(); },
    }, [el('span', { class: 'gk-type-icon' }, [icon('lock', { size: 16 })]),
      el('div', {}, [el('div', { class: 'gk-type-name' }, 'Privado'), el('div', { class: 'gk-type-desc' }, 'Só entra quem tiver um convite.')])]);
    wrap.appendChild(el('div', { class: 'gk-field' }, [
      el('label', {}, 'Quem pode entrar'),
      el('div', { class: 'gk-type-picker gk-visibility-picker' }, [visPublicBtn, visPrivateBtn]),
    ]));

    wrap.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => { step = 1; renderAll(); } }, [icon('chevronLeft', { size: 14 }), ' Voltar']),
      el('button', { class: 'gk-btn gk-btn-primary', onclick: () => { step = 3; renderAll(); } }, 'Próximo'),
    ]));
    return wrap;
  }

  // ---------- Etapa 3: revisar e criar ----------
  function buildStep3() {
    const wrap = el('div', {});
    wrap.appendChild(el('h2', {}, 'Finalizar'));
    wrap.appendChild(el('p', { class: 'gk-modal-sub' }, 'Confira antes de criar — dá pra editar qualquer coisa depois nas configurações do servidor.'));

    const tpl = SERVER_TEMPLATES[chosenTemplate] || SERVER_TEMPLATES.custom;
    const totalChannels = tpl.categories.reduce((n, c) => n + c.channels.length, 0);
    wrap.appendChild(el('div', { class: 'gk-wizard-summary' }, [
      el('div', { class: 'gk-wizard-summary-row' }, [el('span', {}, 'Nome'), el('b', {}, name || '—')]),
      el('div', { class: 'gk-wizard-summary-row' }, [el('span', {}, 'Descrição'), el('b', {}, description.trim() || 'Sem descrição')]),
      el('div', { class: 'gk-wizard-summary-row' }, [el('span', {}, 'Estrutura'), el('b', {}, `${tpl.label} (${totalChannels} canais)`)]),
      el('div', { class: 'gk-wizard-summary-row' }, [el('span', {}, 'Privacidade'), el('b', {}, visibility === 'public' ? 'Público' : 'Privado')]),
    ]));
    wrap.appendChild(el('div', { class: 'gk-hint' }, 'Só você começa como dono — dá pra promover outros membros a administrador depois, no painel Membros.'));

    const createBtn = el('button', { class: 'gk-btn gk-btn-primary' }, [icon('check', { size: 14 }), ' Criar servidor']);
    createBtn.addEventListener('click', async () => {
      createBtn.disabled = true;
      const original = createBtn.innerHTML;
      try {
        let iconUrl = '';
        if (iconMode === 'custom' && iconFile) {
          createBtn.textContent = 'Enviando ícone...';
          const uploaded = await uploadToCloudinary(iconFile, `server-icons/${auth.currentUser.uid}`);
          iconUrl = uploaded.url;
        }
        createBtn.textContent = 'Criando servidor...';
        const id = await createServer(name.trim(), description, iconUrl, '', chosenTemplate, visibility);
        close();
        selectServer(id);
      } catch (err) {
        toast(err.message || 'Não foi possível criar o servidor.', 'danger');
        createBtn.disabled = false;
        createBtn.innerHTML = original;
      }
    });
    wrap.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => { step = 2; renderAll(); } }, [icon('chevronLeft', { size: 14 }), ' Voltar']),
      createBtn,
    ]));
    return wrap;
  }

  // ---------- Coluna 3: preview ao vivo ----------
  function buildPreview() {
    const tpl = SERVER_TEMPLATES[chosenTemplate] || SERVER_TEMPLATES.custom;
    const iconEl = iconMode === 'custom' && iconFile
      ? el('img', { src: URL.createObjectURL(iconFile) })
      : iconMode === 'brand'
        ? el('img', { src: 'img/logo.png' })
        : el('div', { class: 'gk-wizard-preview-icon-glyph' }, [icon(ICON_PRESETS.find((p) => p.id === iconMode)?.icon || 'sparkles', { size: 24 })]);

    const chanList = el('div', { class: 'gk-wizard-preview-channels' });
    for (const cat of tpl.categories) {
      chanList.appendChild(el('div', { class: 'gk-wizard-preview-cat' }, cat.name));
      for (const ch of cat.channels) {
        chanList.appendChild(el('div', { class: 'gk-wizard-preview-chan' }, [
          icon(ch.type === 'voice' ? 'speaker' : 'chatBubble', { size: 13 }), ' ', ch.name,
        ]));
      }
    }

    return el('div', { class: 'gk-wizard-preview' }, [
      el('div', { class: 'gk-wizard-preview-label' }, 'Prévia'),
      el('div', { class: 'gk-wizard-preview-card' }, [
        el('div', { class: 'gk-wizard-preview-icon' }, [iconEl]),
        el('div', { class: 'gk-wizard-preview-name' }, name.trim() || 'Seu servidor'),
        el('div', { class: 'gk-wizard-preview-sub' }, [
          el('span', { class: 'gk-status-dot-inline', 'data-status': 'online' }), ' Online • 1 membro',
        ]),
        description.trim() ? el('div', { class: 'gk-wizard-preview-desc' }, description) : null,
        visibility === 'public' ? el('div', { class: 'gk-wizard-preview-badge' }, [icon('tray', { size: 11 }), ' Público']) : null,
      ]),
      chanList,
    ]);
  }
}

export function openJoinServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const codeInput = el('input', {
    type: 'text', placeholder: 'Código do convite (ex: 7F3KQ2LM)',
    autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
  });
  const errorBox = el('div', { class: 'gk-error', style: 'display:none;' });
  const joinBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Entrar');
  const submit = async () => {
    if (joinBtn.disabled) return;
    errorBox.style.display = 'none';
    joinBtn.disabled = true; joinBtn.textContent = 'Entrando…';
    try {
      const id = await joinServerByInviteCode(codeInput.value);
      closeGenericModal();
      selectServer(id);
    } catch (err) {
      errorBox.textContent = err.message || 'Não foi possível entrar com este convite.';
      errorBox.style.display = 'block';
      joinBtn.disabled = false; joinBtn.textContent = 'Entrar';
    }
  };
  joinBtn.addEventListener('click', submit);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  modal.appendChild(el('h2', {}, 'Entrar em um servidor'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Código de convite'), codeInput, errorBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: closeGenericModal }, 'Cancelar'),
    joinBtn,
  ]));
  overlay.classList.add('gk-open');
  setTimeout(() => codeInput.focus(), 50);
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
