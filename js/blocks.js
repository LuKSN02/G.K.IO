// ============================================================
// G.K.IO — Bloquear usuários
// A lista fica em users/{meuUid}.blockedUids (vai com a conta, vale em todo
// aparelho). Efeitos:
//   · mensagens de quem você bloqueou ficam recolhidas ("Mensagem de usuário
//     bloqueado — mostrar") nos canais e DMs;
//   · sem som/notificação/push vindo dessa pessoa;
//   · você não consegue mandar nem receber DM dela (as regras do Firestore
//     barram o envio de quem foi bloqueado numa DM 1:1);
//   · a amizade é desfeita.
// ============================================================
import { auth, userDoc, updateDoc, arrayUnion, arrayRemove, friendshipsCol, query, where, getDocs, doc, db } from './db.js';
import { state, toast } from './state.js';

export const MAX_BLOCKED = 200; // mesmo limite das firestore.rules

const listeners = new Set();
export function onBlocksChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { listeners.forEach((cb) => { try { cb(); } catch (e) { console.warn('[blocks]', e); } }); }

export function blockedList() {
  return Array.isArray(state.user?.blockedUids) ? state.user.blockedUids : [];
}
export function isBlocked(uid) {
  return !!uid && blockedList().includes(uid);
}

// Mensagens de gente bloqueada que a pessoa escolheu "mostrar" nesta sessão.
const revealed = new Set();
export function isRevealed(msgId) { return revealed.has(msgId); }
export function revealMessage(msgId) { revealed.add(msgId); emit(); }

export async function blockUser(uid) {
  const me = auth.currentUser?.uid;
  if (!me || !uid) return;
  if (uid === me) throw new Error('Você não pode bloquear a si mesmo.');
  if (isBlocked(uid)) return;
  if (blockedList().length >= MAX_BLOCKED) throw new Error(`Você já bloqueou ${MAX_BLOCKED} pessoas (limite).`);
  await updateDoc(userDoc(me), { blockedUids: arrayUnion(uid) });
  state.user.blockedUids = [...blockedList(), uid];
  // Bloquear também desfaz a amizade / pedido pendente (as regras só deixam
  // "atualizar" a amizade, então ela é marcada como encerrada).
  try {
    const snap = await getDocs(query(friendshipsCol(), where('userIds', 'array-contains', me)));
    await Promise.all(snap.docs
      .filter((d) => d.data().userIds.includes(uid) && d.data().status !== 'declined')
      .map((d) => updateDoc(doc(db, 'friendships', d.id), { status: 'declined' })));
  } catch (e) { console.warn('[blocks] não consegui desfazer a amizade:', e.message); }
  emit();
}

export async function unblockUser(uid) {
  const me = auth.currentUser?.uid;
  if (!me || !uid || !isBlocked(uid)) return;
  await updateDoc(userDoc(me), { blockedUids: arrayRemove(uid) });
  state.user.blockedUids = blockedList().filter((x) => x !== uid);
  emit();
}

export async function toggleBlock(uid) {
  if (isBlocked(uid)) { await unblockUser(uid); toast('Usuário desbloqueado.'); return false; }
  await blockUser(uid);
  toast('Usuário bloqueado.');
  return true;
}
