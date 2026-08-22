// ============================================================
// G.K.IO — Indicador de "digitando..."
// Cada pessoa grava um doc efêmero (id = o próprio uid) na subcoleção
// de digitação do canal/DM aberto no momento, renovado a cada tecla e
// removido ao parar de digitar, enviar a mensagem ou trocar de conversa.
// Quem está com essa conversa aberta escuta a subcoleção inteira e
// mostra "Fulano está digitando..." no lugar do subtítulo do topbar.
//
// Limitação conhecida do MVP: se a aba fechar de forma abrupta (sem
// disparar handlers), o doc de "digitando" pode ficar órfão até alguém
// escrever de novo e sobrescrevê-lo — por isso quem lê sempre confere
// `updatedAt` contra TYPING_TTL_MS antes de considerar válido.
// ============================================================
import {
  auth, typingDoc, dmTypingDoc, typingCol, dmTypingCol,
  setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from './db.js';
import { state, cleanupListener } from './state.js';

const TYPING_TTL_MS = 4000;    // se não renovado, o client considera expirado
const TYPING_RESEND_MS = 2500; // intervalo mínimo entre escritas ao digitar

let debounceStopTimer = null;
let lastSentAt = 0;
let currentTypingRef = null; // doc que "eu" ocupo agora, para apagar ao sair/enviar

function activeTypingRef() {
  if (state.currentChannelId && state.currentServerId) {
    return typingDoc(state.currentServerId, state.currentChannelId, auth.currentUser.uid);
  }
  if (state.currentDmId) return dmTypingDoc(state.currentDmId, auth.currentUser.uid);
  return null;
}

// Chamada a cada tecla digitada no composer (ver wireComposer em chat.js).
export function notifyTyping() {
  const ref = activeTypingRef();
  if (!ref || !auth.currentUser) return;

  clearTimeout(debounceStopTimer);
  debounceStopTimer = setTimeout(stopTyping, TYPING_TTL_MS);

  const now = Date.now();
  if (now - lastSentAt < TYPING_RESEND_MS && currentTypingRef === ref) return; // evita escrever a cada tecla
  lastSentAt = now;
  currentTypingRef = ref;
  setDoc(ref, {
    name: state.user?.displayName || state.user?.username || 'Alguém',
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

// Chamada ao enviar a mensagem, trocar de conversa, ou sair da tela de chat.
export function stopTyping() {
  clearTimeout(debounceStopTimer);
  const ref = currentTypingRef;
  currentTypingRef = null;
  lastSentAt = 0;
  if (ref) deleteDoc(ref).catch(() => {});
}

// Passa a escutar quem está digitando na conversa que acabou de ser
// aberta. `onChange(names)` recebe a lista de nomes (excluindo a própria
// pessoa) — chamada por selectChannel/selectDm em chat.js.
export function listenTyping({ serverId, channelId, dmId }, onChange) {
  cleanupListener('typing');
  const colRef = dmId ? dmTypingCol(dmId) : typingCol(serverId, channelId);
  const unsub = onSnapshot(colRef, (snap) => {
    const now = Date.now();
    const names = [];
    snap.forEach((d) => {
      if (d.id === auth.currentUser?.uid) return; // não mostra a si mesmo
      const data = d.data();
      const ts = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0;
      if (now - ts < TYPING_TTL_MS + 2000) names.push(data.name || 'Alguém'); // margem pro delay de rede
    });
    onChange(names);
  });
  state.unsubscribers.typing = () => unsub && unsub();
}
