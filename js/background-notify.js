// ============================================================
// G.K.IO — Notificações de conversas que NÃO estão abertas
//
// O aviso de "mensagem nova" de chat.js só vale para a conversa aberta (é a
// única com listener de mensagens). Com o app na bandeja/em segundo plano,
// isso significava que quase nada notificava. Aqui observamos os "ponteiros"
// que o app já grava a cada mensagem (lastMessageAt / lastMessageAuthorId
// nas DMs e nos canais — os mesmos usados pelo indicador de não lida) e
// avisamos quando algo novo chega em qualquer DM ou canal de texto.
//
// Custo: 1 listener leve por servidor (só os docs de canais) + 1 leitura
// da última mensagem por aviso exibido.
// ============================================================
import { auth, onSnapshot, getDocs, query, orderBy, limit, channelsCol, channelMessagesCol } from './db.js';
import { state } from './state.js';
import { effectiveLevel, shouldAlert } from './notify-prefs.js';
import { playNotifSound, showDesktopNotification } from './prefs.js';
import { triggerNotificationTap } from './push.js';

const millisOf = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const me = () => auth.currentUser?.uid;

// ---------- DMs ----------
const dmSeen = new Map();
let dmSeeded = false;

// Chamada por dms.js toda vez que state.dms é atualizado.
export function checkDmsForNotifications() {
  const uid = me();
  if (!uid) return;
  for (const dm of state.dms.values()) {
    const t = millisOf(dm.lastMessageAt);
    const prev = dmSeen.get(dm.id) || 0;
    if (t <= prev) continue;
    dmSeen.set(dm.id, t);
    if (!dmSeeded) continue; // primeira carga: só registra, não avisa do passado
    if (!dm.lastMessageAuthorId || dm.lastMessageAuthorId === uid) continue;
    if (state.currentDmId === dm.id) continue; // a conversa aberta já tem o próprio aviso (chat.js)
    if (!shouldAlert(effectiveLevel({ dmId: dm.id }), false)) continue;
    const name = dm.other?.displayName || dm.other?.username || 'Nova mensagem';
    playNotifSound();
    showDesktopNotification(name, dm.lastMessagePreview || 'Enviou uma mensagem.', dm.other?.avatarUrl,
      () => triggerNotificationTap({ type: 'dm', dmId: dm.id }));
  }
  dmSeeded = true;
}

// ---------- Canais de todos os servidores ----------
const watchers = new Map();   // serverId -> { unsub, seeded, seen:Map }
let canViewChannel = null;    // registrado por servers.js (só confiável no servidor aberto)
export function registerChannelViewCheck(fn) { canViewChannel = fn; }

function visibleToMe(serverId, ch) {
  if (serverId === state.currentServerId && canViewChannel) {
    try { return canViewChannel(serverId, ch); } catch (e) { return false; }
  }
  // Servidor que não está aberto: cargos/permissões dele não estão carregados,
  // então só avisa de canais sem regras especiais (públicos).
  return !ch.overwrites || Object.keys(ch.overwrites).length === 0;
}

async function notifyChannel(serverId, ch, mentioned) {
  let author = 'Nova mensagem';
  let body = 'Enviou uma mensagem.';
  try {
    const snap = await getDocs(query(channelMessagesCol(serverId, ch.id), orderBy('createdAt', 'desc'), limit(1)));
    const m = snap.docs[0]?.data();
    if (m) {
      if (m.system) return;
      author = m.authorName || author;
      body = m.content || (m.fileUrl || m.attachment ? '📎 Anexo enviado' : body);
    }
  } catch (e) { /* sem a última mensagem: avisa de forma genérica */ }
  const serverName = state.servers.get(serverId)?.name;
  playNotifSound();
  showDesktopNotification(`${author} em #${ch.name}${serverName ? ' · ' + serverName : ''}`, body, undefined,
    () => triggerNotificationTap({ type: 'channel', serverId, channelId: ch.id, channelName: ch.name }));
}

function handleChannelSnapshot(serverId, w, snap) {
  const uid = me();
  snap.docChanges().forEach((chg) => {
    const ch = { id: chg.doc.id, ...chg.doc.data() };
    const t = millisOf(ch.lastMessageAt);
    const prev = w.seen.get(ch.id) || 0;
    if (t <= prev) return;
    w.seen.set(ch.id, t);
    if (!w.seeded || chg.type === 'removed') return;
    if (ch.type !== 'text') return;
    if (!ch.lastMessageAuthorId || ch.lastMessageAuthorId === uid) return;
    if (state.currentChannelId === ch.id) return; // conversa aberta: aviso fica com chat.js
    if (!visibleToMe(serverId, ch)) return;
    const mentioned = Array.isArray(ch.lastMentionedUids) && ch.lastMentionedUids.includes(uid);
    if (!shouldAlert(effectiveLevel({ serverId, channelId: ch.id }), mentioned)) return;
    notifyChannel(serverId, ch, mentioned);
  });
  w.seeded = true;
}

// Chamada por servers.js quando a lista de servidores do usuário muda.
export function syncServerWatchers() {
  for (const [id, w] of watchers) {
    if (!state.servers.has(id)) { w.unsub(); watchers.delete(id); }
  }
  for (const id of state.servers.keys()) {
    if (watchers.has(id)) continue;
    const w = { unsub: null, seeded: false, seen: new Map() };
    w.unsub = onSnapshot(channelsCol(id), (snap) => handleChannelSnapshot(id, w, snap), () => { /* sem permissão: ignora */ });
    watchers.set(id, w);
  }
}

export function stopBackgroundNotifications() {
  watchers.forEach((w) => w.unsub());
  watchers.clear();
  dmSeen.clear();
  dmSeeded = false;
}
