// ============================================================
// G.K.IO — Amigos e Mensagens Diretas (DMs)
// ============================================================
import {
  auth, db, usersCol, userDoc, friendshipsCol, dmsCol, dmDoc,
  collection, doc, addDoc, setDoc, updateDoc, getDoc, getDocs,
  query, where, onSnapshot, serverTimestamp,
} from './db.js';
import { state, el, toast, fallbackAvatar, cleanupListener, normalizeUsername } from './state.js';
import { selectDm } from './chat.js';
import { joinDmCall } from './calls.js';

let unsubFriendships = null;
let unsubDms = null;

export function listenFriendsAndDms() {
  const uid = auth.currentUser.uid;

  if (unsubFriendships) unsubFriendships();
  const fq = query(friendshipsCol(), where('userIds', 'array-contains', uid));
  unsubFriendships = onSnapshot(fq, async (snap) => {
    const accepted = [];
    const incoming = [];
    for (const d of snap.docs) {
      const data = d.data();
      const otherId = data.userIds.find((x) => x !== uid);
      const otherSnap = await getDoc(userDoc(otherId));
      if (!otherSnap.exists()) continue;
      const other = { uid: otherId, ...otherSnap.data() };
      if (data.status === 'accepted') accepted.push(other);
      else if (data.status === 'pending' && data.requesterId !== uid) incoming.push({ ...other, friendshipId: d.id });
    }
    state.friends.clear();
    accepted.forEach((f) => state.friends.set(f.uid, f));
    // Guarda os pedidos pendentes no estado global — assim o listener de
    // DMs (abaixo) também enxerga a lista correta quando re-renderiza o
    // sidebar, em vez de apagá-la com um array vazio.
    state.incomingFriendRequests = incoming;
    renderDmSidebar();
  });

  if (unsubDms) unsubDms();
  const dq = query(dmsCol(), where('participantIds', 'array-contains', uid));
  unsubDms = onSnapshot(dq, async (snap) => {
    const dms = [];
    for (const d of snap.docs) {
      const data = d.data();
      const otherId = data.participantIds.find((x) => x !== uid);
      const otherSnap = otherId ? await getDoc(userDoc(otherId)) : null;
      dms.push({ id: d.id, ...data, other: otherSnap && otherSnap.exists() ? { uid: otherId, ...otherSnap.data() } : null });
    }
    dms.sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));
    state.dms.clear();
    dms.forEach((dm) => state.dms.set(dm.id, dm));
    renderDmSidebar();
  });
}

function renderFriendRequests(incoming) {
  const box = document.getElementById('gk-friend-requests');
  box.innerHTML = '';
  if (incoming.length === 0) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.appendChild(el('div', { class: 'gk-category-label' }, `Pedidos de amizade — ${incoming.length}`));
  for (const req of incoming) {
    box.appendChild(el('div', { class: 'gk-dm-row' }, [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': 'offline', 'data-frame': req.frameStyle || 'none' }, [el('img', { src: req.avatarUrl || fallbackAvatar(req.username) })]),
      el('div', { class: 'gk-name' }, req.displayName || req.username),
      el('div', { style: 'margin-left:auto;display:flex;gap:4px;' }, [
        el('button', { class: 'gk-btn gk-btn-primary', style: 'padding:5px 9px;font-size:12px;', onclick: () => acceptFriendRequest(req.friendshipId) }, '✓'),
        el('button', { class: 'gk-btn gk-btn-danger', style: 'padding:5px 9px;font-size:12px;', onclick: () => declineFriendRequest(req.friendshipId) }, '✕'),
      ]),
    ]));
  }
}

function renderDmSidebar() {
  if (state.currentView !== 'dms') return;
  const body = document.getElementById('gk-sidebar-body');
  body.innerHTML = '';
  body.appendChild(el('div', { id: 'gk-friend-requests' }));
  body.appendChild(el('div', { class: 'gk-category-label', style: 'margin-top:6px;' }, 'Conversas'));
  for (const dm of state.dms.values()) {
    if (!dm.other) continue;
    const row = el('div', {
      class: 'gk-dm-row' + (state.currentDmId === dm.id ? ' gk-active' : ''),
      'data-id': dm.id,
      onclick: () => selectDm(dm.id, dm.other.displayName || dm.other.username, statusLabel(dm.other.statusPresence)),
    }, [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': dm.other.statusPresence || 'offline', 'data-frame': dm.other.frameStyle || 'none' }, [
        el('img', { src: dm.other.avatarUrl || fallbackAvatar(dm.other.username) }),
      ]),
      el('div', {}, [
        el('div', { class: 'gk-name' }, dm.other.displayName || dm.other.username),
      ]),
    ]);
    body.appendChild(row);
  }
  // Usa o cache em state (populado pelo listener de friendships) em vez de
  // um array vazio "chumbado" — é isso que fazia a aba de pedidos de
  // amizade sumir sempre que o listener de DMs re-renderizava o sidebar.
  renderFriendRequests(state.incomingFriendRequests || []);
}

function statusLabel(s) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[s] || 'Offline';
}

export async function sendFriendRequestByUsername(username) {
  username = normalizeUsername(username);
  if (!username) throw new Error('Digite um nome de usuário válido.');
  const uid = auth.currentUser.uid;
  const q = query(usersCol(), where('username', '==', username));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error('Usuário não encontrado.');
  const target = snap.docs[0];
  if (target.id === uid) throw new Error('Você não pode adicionar a si mesmo.');

  const existingQ = query(friendshipsCol(), where('userIds', 'array-contains', uid));
  const existingSnap = await getDocs(existingQ);
  const already = existingSnap.docs.some((d) => d.data().userIds.includes(target.id));
  if (already) throw new Error('Vocês já são amigos ou há um pedido pendente.');

  await addDoc(friendshipsCol(), {
    userIds: [uid, target.id],
    requesterId: uid,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

async function acceptFriendRequest(friendshipId) {
  await updateDoc(doc(db, 'friendships', friendshipId), { status: 'accepted' });
  toast('Pedido de amizade aceito.');
}
async function declineFriendRequest(friendshipId) {
  await updateDoc(doc(db, 'friendships', friendshipId), { status: 'declined' });
}

export async function openOrCreateDm(otherUid) {
  const uid = auth.currentUser.uid;
  const existing = [...state.dms.values()].find((dm) => dm.other && dm.other.uid === otherUid);
  if (existing) {
    selectDm(existing.id, existing.other.displayName || existing.other.username, statusLabel(existing.other.statusPresence));
    return;
  }
  const ref = await addDoc(dmsCol(), {
    participantIds: [uid, otherUid],
    isGroup: false,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
  });
  const otherSnap = await getDoc(userDoc(otherUid));
  selectDm(ref.id, otherSnap.data().displayName || otherSnap.data().username, statusLabel(otherSnap.data().statusPresence));
}

export function goToDmsView() {
  state.currentView = 'dms';
  state.currentServerId = null;
  state.currentChannelId = null;
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-sidebar-header-title').textContent = 'Mensagens diretas';
  document.getElementById('gk-topbar-title').textContent = 'Selecione uma conversa';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  renderDmSidebar();
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-dm-rail-item').classList.add('gk-active');
}

export function openAddFriendModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const input = el('input', { type: 'text', placeholder: 'nome-de-usuario' });
  const errorBox = el('div', { class: 'gk-error', style: 'display:none;' });
  modal.appendChild(el('h2', {}, 'Adicionar amigo'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome de usuário'), input, errorBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        try {
          await sendFriendRequestByUsername(input.value);
          toast('Pedido de amizade enviado.');
          overlay.classList.remove('gk-open');
        } catch (err) {
          errorBox.textContent = err.message;
          errorBox.style.display = 'block';
        }
      },
    }, 'Enviar pedido'),
  ]));
  overlay.classList.add('gk-open');
}
