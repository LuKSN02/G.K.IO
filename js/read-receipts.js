// "Visto" nas DMs 1:1. Cada pessoa grava directMessages/{dm}.readAt.{uid}; quem desliga em
// Configurações > Privacidade não grava nem mostra o "Visto".
import { auth, db, doc, onSnapshot, updateDoc, serverTimestamp } from './db.js';
import { state, el } from './state.js';
import { getLoadedMessages } from './chat.js';

let watched = null; let unsub = null; let otherUid = null; let otherRead = 0; let isGroup = false; let myWritten = 0;
const hidden = () => !!state.user?.privacy?.hideReadReceipts;
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);

function paint() {
  document.querySelectorAll('.gk-read-tag').forEach((n) => n.remove());
  if (!watched || isGroup || hidden() || !auth.currentUser) return;
  const msgs = getLoadedMessages();
  const mine = [...msgs].reverse().find((m) => m.authorId === auth.currentUser.uid);
  if (!mine) return;
  const row = document.querySelector(`#gk-messages .gk-msg-row[data-msg-id="${CSS.escape(mine.id)}"]`);
  if (!row) return;
  if (otherRead && otherRead >= ms(mine.createdAt)) row.appendChild(el('div', { class: 'gk-read-tag' }, '✓✓ Visto'));
}

function watch(id) {
  unsub?.(); unsub = null; watched = id; otherUid = null; otherRead = 0; isGroup = false; myWritten = 0;
  if (!id) return;
  unsub = onSnapshot(doc(db, 'directMessages', id), (s) => {
    const d = s.data() || {};
    isGroup = !!d.isGroup;
    otherUid = (d.participantIds || []).find((u) => u !== auth.currentUser?.uid) || null;
    otherRead = otherUid ? ms(d.readAt?.[otherUid]) : 0;
    paint();
  }, () => {});
}

async function maybeWrite() {
  if (!watched || isGroup || hidden() || document.visibilityState !== 'visible' || !auth.currentUser) return;
  const me = auth.currentUser.uid;
  const last = [...getLoadedMessages()].reverse().find((m) => m.authorId !== me);
  const t = last ? ms(last.createdAt) : 0;
  if (!t || t <= myWritten) return;
  myWritten = Date.now();
  try { await updateDoc(doc(db, 'directMessages', watched), { [`readAt.${me}`]: serverTimestamp() }); } catch { /* não é crítico */ }
}

setInterval(() => {
  const id = state.currentDmId || null;
  if (id !== watched) watch(id);
  maybeWrite();
}, 1500);
let t = null;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 150); }).observe(document.body, { childList: true, subtree: true });
