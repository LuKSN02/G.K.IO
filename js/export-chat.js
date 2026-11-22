// ============================================================
// G.K.IO — Exportar conversa (.txt) e lista de amigos (.json)
// Baixa até 2000 mensagens mais recentes da conversa aberta (leituras do Firestore: 1 por mensagem).
// ============================================================
import { getDocs, query, orderBy, limit, startAfter, channelMessagesCol, dmMessagesCol } from './db.js';
import { state, toast } from './state.js';
import { messagePreview } from './message-utils.js';

const MAX = 2000, PAGE = 500;

function download(name, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const when = (m) => (m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('pt-BR') : '—');

async function fetchAll(col) {
  const out = []; let cursor = null;
  while (out.length < MAX) {
    const snap = await getDocs(cursor ? query(col, orderBy('createdAt', 'desc'), startAfter(cursor), limit(PAGE)) : query(col, orderBy('createdAt', 'desc'), limit(PAGE)));
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out.reverse();
}

export async function exportConversation({ dmId, serverId, channelId, title }) {
  toast('Exportando… pode levar alguns segundos.');
  try {
    const msgs = await fetchAll(dmId ? dmMessagesCol(dmId) : channelMessagesCol(serverId, channelId));
    if (!msgs.length) return toast('Nada para exportar.');
    const lines = msgs.map((m) => {
      const extra = [m.attachmentUrl ? `[anexo: ${m.attachmentName || m.attachmentUrl}]` : '', m.poll ? `[enquete: ${m.poll.question}]` : ''].filter(Boolean).join(' ');
      return `[${when(m)}] ${m.authorName || m.authorId}: ${(m.content || '').replace(/\n/g, '\n    ')} ${extra}`.trimEnd();
    });
    download(`gkio-${(title || 'conversa').replace(/[^\w-]+/g, '_')}-${stamp()}.txt`, `G.K.IO — ${title || 'conversa'}\nExportado em ${new Date().toLocaleString('pt-BR')} · ${msgs.length} mensagens\n\n${lines.join('\n')}\n`);
    toast(`${msgs.length} mensagens exportadas.`);
  } catch (e) { toast('Não foi possível exportar esta conversa.', 'danger'); }
}
export const exportCurrent = () => (state.currentDmId
  ? exportConversation({ dmId: state.currentDmId, title: state.dms.get(state.currentDmId)?.other?.displayName || 'dm' })
  : exportConversation({ serverId: state.currentServerId, channelId: state.currentChannelId, title: 'canal' }));

export function exportFriends() {
  const list = [...state.friends.values()].map((u) => ({ username: u.username || '', name: u.displayName || '', tag: u.tag || '' }));
  if (!list.length) return toast('Você ainda não tem amigos na lista.');
  download(`gkio-amigos-${stamp()}.json`, JSON.stringify(list, null, 2), 'application/json');
  toast(`${list.length} amigos exportados.`);
}
export { messagePreview };
