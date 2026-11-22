// ============================================================
// G.K.IO — Mensagens temporárias (DMs)
// O tempo escolhido fica no doc da conversa (`ttl`, em segundos; 0 = desligado). Cada mensagem
// nova leva `expiresAt` (ms). Quem está com a conversa aberta deixa de ver as vencidas, e o
// aparelho do AUTOR apaga as que ele mesmo mandou (só o autor pode apagar numa DM).
// Limite honesto: se ninguém abrir a conversa depois do prazo, a mensagem continua no banco;
// e um cliente adulterado ainda poderia mostrá-la.
// ============================================================
import { auth, db, doc, updateDoc, deleteDoc } from './db.js';
import { state, toast } from './state.js';

export const TTL_OPTIONS = [['Desligado', 0], ['1 hora', 3600], ['24 horas', 86400], ['7 dias', 604800]];
export const dmTtl = (dmId = state.currentDmId) => Number(state.dms.get(dmId)?.ttl) || 0;
export const isExpired = (msg, now = Date.now()) => !!msg?.expiresAt && Number(msg.expiresAt) <= now;
export const filterExpired = (messages) => (state.currentDmId ? messages.filter((m) => !isExpired(m)) : messages);
/** Campos extras para a mensagem que vai ser enviada agora numa DM. */
export const ttlFields = () => { const s = state.currentDmId ? dmTtl() : 0; return s ? { expiresAt: Date.now() + s * 1000 } : {}; };

export async function setDmTtl(dmId, seconds) {
  try {
    await updateDoc(doc(db, 'directMessages', dmId), { ttl: seconds });
    const d = state.dms.get(dmId); if (d) d.ttl = seconds;
    toast(seconds ? `Mensagens temporárias: somem em ${TTL_OPTIONS.find((o) => o[1] === seconds)?.[0] || seconds + ' s'}. Vale para as mensagens novas.` : 'Mensagens temporárias desligadas.');
  } catch (e) { toast('Não foi possível mudar o tempo.', 'danger'); }
}

/** Chamado a cada ~30 s com as mensagens carregadas: esconde as vencidas e apaga as suas. */
export function sweepExpired(loaded) {
  if (!state.currentDmId) return;
  const me = auth.currentUser?.uid; const now = Date.now();
  for (const m of loaded) {
    if (!isExpired(m, now)) continue;
    document.querySelectorAll(`[data-msg-id="${m.id}"]`).forEach((n) => n.remove());
    if (m.authorId === me) deleteDoc(doc(db, 'directMessages', state.currentDmId, 'messages', m.id)).catch(() => {});
  }
}
