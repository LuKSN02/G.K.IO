// ============================================================
// G.K.IO — Estado de leitura (badge de "não lidas")
// Guarda, por conversa (canal ou DM), o instante em que a pessoa
// logada olhou por último para ela (readStates/{uid}_{conversationId}).
// dms.js e servers.js comparam isso com o lastMessageAt/lastMessageAuthorId
// de cada conversa (gravado por chat.js a cada mensagem enviada) para
// decidir se mostram o indicador de não lida na sidebar.
// ============================================================
import {
  auth, readStatesCol, readStateDoc, setDoc, query, where, onSnapshot, serverTimestamp,
} from './db.js';
import { state, cleanupListener } from './state.js';

const readAtByConversation = new Map(); // conversationId -> millis (última leitura)
const listeners = new Set();            // callbacks avisados quando o mapa muda

// dms.js/servers.js se inscrevem aqui pra saber quando re-renderizar a
// sidebar com os badges atualizados — evita import circular com chat.js.
export function onReadStatesChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() { listeners.forEach((cb) => { try { cb(); } catch (e) { /* noop */ } }); }

// Chamada uma vez no bootstrap (ver app.js), assim que o usuário loga.
export function listenReadStates() {
  cleanupListener('readStates');
  const uid = auth.currentUser.uid;
  const q = query(readStatesCol(), where('uid', '==', uid));
  const unsub = onSnapshot(q, (snap) => {
    readAtByConversation.clear();
    snap.forEach((d) => {
      const data = d.data();
      readAtByConversation.set(data.conversationId, data.lastReadAt?.toMillis ? data.lastReadAt.toMillis() : 0);
    });
    notify();
  });
  state.unsubscribers.readStates = () => unsub && unsub();
}

// Chamada por chat.js sempre que a pessoa abre ou está olhando uma
// conversa (canal ou DM) — grava/atualiza o timestamp de leitura dela.
export async function markConversationRead(conversationId) {
  if (!conversationId || !auth.currentUser) return;
  try {
    await setDoc(readStateDoc(auth.currentUser.uid, conversationId), {
      uid: auth.currentUser.uid,
      conversationId,
      lastReadAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) { /* não é crítico — pior caso, o badge de não lida demora a sumir */ }
}

// Usada pela sidebar (dms.js/servers.js) pra decidir se mostra o indicador.
export function isConversationUnread(conversationId, lastMessageAt, lastMessageAuthorId) {
  if (!lastMessageAt) return false;
  if (lastMessageAuthorId && lastMessageAuthorId === auth.currentUser?.uid) return false; // a própria última msg não conta
  const lastMsgMillis = lastMessageAt.toMillis ? lastMessageAt.toMillis() : lastMessageAt;
  const readMillis = readAtByConversation.get(conversationId) || 0;
  return lastMsgMillis > readMillis;
}
