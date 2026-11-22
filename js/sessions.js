// Aparelhos conectados: cada aparelho grava users/{uid}/sessions/{id}. "Encerrar" marca revokedAt e o
// aparelho, ao ver isso, sai da conta. É um controle cooperativo: para travar uma conta de verdade
// (token roubado), troque a senha.
import { auth, db, doc, collection, setDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, serverTimestamp, signOut } from './db.js';
import { state, el, toast } from './state.js';

const KEY = 'gkio-session-id';
let sid = null; try { sid = localStorage.getItem(KEY); } catch { /* noop */ }
if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24); try { localStorage.setItem(KEY, sid); } catch { /* noop */ } }
export const currentSessionId = () => sid;

export function describeDevice(ua = navigator.userAgent) {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const app = /Electron|GKIO/i.test(ua) ? ' (app)' : '';
  return `${br} · ${os}${app}`;
}
const ref = (uid, id) => doc(db, 'users', uid, 'sessions', id);
let started = null; let unsub = null; let timer = null;

async function start(uid) {
  if (started === uid) return; started = uid; unsub?.(); clearInterval(timer);
  try { await setDoc(ref(uid, sid), { device: describeDevice(), createdAt: serverTimestamp(), lastSeen: serverTimestamp(), revokedAt: null }, { merge: true }); } catch { return; }
  unsub = onSnapshot(ref(uid, sid), async (s) => {
    if (s.exists() && s.data().revokedAt) {
      toast('Esta sessão foi encerrada em outro aparelho.', 'danger');
      unsub?.(); try { await deleteDoc(ref(uid, sid)); } catch { /* noop */ }
      try { await signOut(auth); } finally { setTimeout(() => location.reload(), 600); }
    }
  }, () => {});
  // Alerta de login novo: outro aparelho registrou sessão depois que este começou a ouvir.
  let first = true; const t0 = Date.now();
  onSnapshot(collection(db, 'users', uid, 'sessions'), (snap) => {
    if (first) { first = false; return; }
    snap.docChanges().forEach((c) => {
      if (c.type !== 'added' || c.doc.id === sid) return;
      const x = c.doc.data(); const at = x.createdAt?.toMillis?.() || Date.now();
      if (at < t0 - 10000 || x.revokedAt) return;
      const msg = `Novo login na sua conta: ${x.device || 'outro aparelho'}.`;
      toast(`🔐 ${msg} Não foi você? Encerre em Configurações → Conta.`, 'danger');
      import('./prefs.js').then((p) => p.showDesktopNotification('Novo login na sua conta', `${x.device || 'Outro aparelho'} — não foi você? Encerre a sessão em Configurações.`, 'img/favicon-180.png')).catch(() => {});
    });
  }, () => {});
  timer = setInterval(() => updateDoc(ref(uid, sid), { lastSeen: serverTimestamp() }).catch(() => {}), 5 * 60000);
}
setInterval(() => { const u = auth.currentUser?.uid; if (u && state.user) start(u); else if (!u) { started = null; } }, 2000);

const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 2 ? 'agora' : m < 60 ? `${m} min atrás` : m < 1440 ? `${Math.round(m / 60)} h atrás` : `${Math.round(m / 1440)} d atrás`; };

export function buildSessionsCard() {
  const list = el('div', {});
  const uid = auth.currentUser?.uid;
  async function load() {
    list.replaceChildren(el('div', { class: 'gk-hint' }, 'Carregando…'));
    let docs = [];
    try { docs = (await getDocs(query(collection(db, 'users', uid, 'sessions'), orderBy('lastSeen', 'desc')))).docs; }
    catch { list.replaceChildren(el('div', { class: 'gk-hint' }, 'Não foi possível carregar (publicou o firestore.rules novo?).')); return; }
    const rows = docs.filter((d) => !d.data().revokedAt);
    if (!rows.length) { list.replaceChildren(el('div', { class: 'gk-hint' }, 'Nenhum aparelho registrado ainda.')); return; }
    list.replaceChildren(...rows.map((d) => {
      const x = d.data(); const me = d.id === sid;
      return el('div', { class: 'gk-session-row' }, [
        el('div', {}, [el('div', { class: 'gk-session-name' }, (x.device || 'Aparelho') + (me ? ' — este aparelho' : '')), el('small', {}, 'Última atividade: ' + (x.lastSeen?.toMillis ? ago(x.lastSeen.toMillis()) : '—'))]),
        me ? null : el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: async () => { try { await updateDoc(d.ref, { revokedAt: serverTimestamp() }); toast('Sessão encerrada.'); load(); } catch { toast('Não foi possível encerrar.', 'danger'); } } }, 'Encerrar'),
      ]);
    }));
  }
  load();
  return el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Aparelhos conectados'),
    list,
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', style: 'margin-top:10px', onclick: async () => {
      try {
        const snap = await getDocs(collection(db, 'users', uid, 'sessions'));
        await Promise.all(snap.docs.filter((d) => d.id !== sid && !d.data().revokedAt).map((d) => updateDoc(d.ref, { revokedAt: serverTimestamp() })));
        toast('Os outros aparelhos serão desconectados.'); load();
      } catch { toast('Não foi possível encerrar.', 'danger'); }
    } }, 'Sair de todos os outros aparelhos'),
    el('div', { class: 'gk-hint', style: 'margin-top:8px' }, 'Se achar que alguém tem acesso à sua conta, troque também a senha.'),
  ]);
}

/** Chamado no logout: apaga o registro deste aparelho. */
export async function endCurrentSession() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  try { await deleteDoc(ref(uid, sid)); } catch { /* noop */ }
  started = null;
}
