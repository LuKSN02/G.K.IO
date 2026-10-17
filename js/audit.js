// ============================================================
// G.K.IO — Log de auditoria do servidor
// Cada ação de moderação/gestão grava uma entrada em
// servers/{id}/auditLog (só cria e lê — nunca edita nem apaga; ver
// firestore.rules). Registrar NUNCA bloqueia a ação em si: se falhar
// (ex.: regras ainda não publicadas), só avisa no console.
// ============================================================
import { auth, db, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from './db.js';
import { state } from './state.js';

const auditCol = (serverId) => collection(db, 'servers', serverId, 'auditLog');

export async function logAudit(serverId, type, { targetId = null, targetName = null, details = {} } = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid || !serverId) return;
  try {
    await addDoc(auditCol(serverId), {
      type,
      actorId: uid,
      actorName: state.user?.displayName || state.user?.username || 'Alguém',
      targetId,
      targetName,
      details,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[audit] não consegui registrar', type, err.code || err.message);
  }
}

export async function loadAuditLog(serverId, max = 100) {
  const snap = await getDocs(query(auditCol(serverId), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const secs = (n) => (n >= 3600 ? `${n / 3600} h` : n >= 60 ? `${n / 60} min` : `${n} s`);

// Entrada -> { icon, text } para a lista.
export function describeAudit(e) {
  const a = e.actorName || 'Alguém';
  const t = e.targetName || 'um membro';
  const d = e.details || {};
  switch (e.type) {
    case 'member.kick': return { icon: 'block', text: `${a} expulsou ${t}` };
    case 'member.ban': return { icon: 'block', text: `${a} baniu ${t}${d.reason ? ` — motivo: ${d.reason}` : ''}` };
    case 'member.unban': return { icon: 'check', text: `${a} desbaniu ${t}` };
    case 'member.timeout': return { icon: 'clock', text: `${a} deu castigo a ${t} por ${d.label || secs(d.seconds || 0)}` };
    case 'member.timeout.clear': return { icon: 'clock', text: `${a} removeu o castigo de ${t}` };
    case 'member.admin': return { icon: 'shield', text: d.admin ? `${a} promoveu ${t} a administrador` : `${a} removeu ${t} de administrador` };
    case 'role.create': return { icon: 'shield', text: `${a} criou o cargo "${d.name}"` };
    case 'role.update': return { icon: 'shield', text: `${a} editou o cargo "${d.name}"` };
    case 'role.delete': return { icon: 'shield', text: `${a} excluiu o cargo "${d.name}"` };
    case 'role.assign': return { icon: 'shield', text: `${a} deu o cargo "${d.name}" a ${t}` };
    case 'role.remove': return { icon: 'shield', text: `${a} tirou o cargo "${d.name}" de ${t}` };
    case 'channel.create': return { icon: 'plus', text: `${a} criou o canal #${d.name}` };
    case 'channel.delete': return { icon: 'trash', text: `${a} excluiu o canal #${d.name}` };
    case 'channel.rename': return { icon: 'edit', text: `${a} renomeou #${d.from} para #${d.to}` };
    case 'channel.nsfw': return { icon: 'lock', text: d.nsfw ? `${a} marcou #${d.name} como NSFW` : `${a} desmarcou #${d.name} como NSFW` };
    case 'channel.slowmode': return { icon: 'clock', text: d.seconds ? `${a} ativou o modo lento de ${secs(d.seconds)} em #${d.name}` : `${a} desativou o modo lento em #${d.name}` };
    case 'category.create': return { icon: 'plus', text: `${a} criou a categoria "${d.name}"` };
    case 'category.delete': return { icon: 'trash', text: `${a} excluiu a categoria "${d.name}"` };
    case 'invite.create': return { icon: 'link', text: `${a} criou um convite${d.maxUses ? ` (até ${d.maxUses} usos)` : ''}${d.seconds ? ` válido por ${secs(d.seconds)}` : ''}` };
    case 'invite.revoke': return { icon: 'link', text: `${a} revogou o convite ${d.code}` };
    case 'server.welcome': return { icon: 'edit', text: `${a} atualizou as boas-vindas${d.enabled ? ' (ativadas)' : ' (desativadas)'}${d.autoRole ? ` e o cargo automático "${d.autoRole}"` : ''}` };
    case 'server.visibility': return { icon: 'lock', text: d.visibility === 'public' ? `${a} tornou o servidor público` : `${a} tornou o servidor privado (só entra com convite)` };
    case 'message.delete': return { icon: 'trash', text: `${a} apagou uma mensagem de ${t} em #${d.channelName}${d.preview ? `: "${d.preview}"` : ''}` };
    default: return { icon: 'edit', text: `${a} fez uma ação (${e.type})` };
  }
}
