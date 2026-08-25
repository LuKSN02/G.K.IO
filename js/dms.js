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
import { stopTyping } from './typing.js';
import { isConversationUnread, onReadStatesChange } from './unread.js';
import { icon } from './icons.js';

// Sempre que o estado de leitura mudar (ex: outra aba marcou uma DM como
// lida), re-renderiza a lista pra atualizar os indicadores de não lida.
onReadStatesChange(() => renderDmSidebar());

let unsubFriendships = null;
let unsubDms = null;

// Aba ativa na tela "Amigos" — 'friends' (lista de amigos) ou 'pending' (pedidos recebidos).
let friendsHomeTab = 'friends';

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
    // Guarda os pedidos pendentes no estado global — assim tanto a tela
    // "Amigos" quanto o badge da rail enxergam a lista atualizada, mesmo
    // quando quem re-renderiza é o listener de DMs (abaixo).
    state.incomingFriendRequests = incoming;
    refreshPendingBadge();
    renderDmSidebar();
    renderFriendsHome();
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

// Badge vermelho no ícone da rail (Mensagens diretas), com a contagem de
// pedidos de amizade pendentes — visível mesmo fora da tela "Amigos".
function refreshPendingBadge() {
  const badge = document.getElementById('gk-dm-rail-badge');
  if (!badge) return;
  const count = (state.incomingFriendRequests || []).length;
  if (count === 0) { badge.style.display = 'none'; return; }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = 'flex';
}

function renderDmSidebar() {
  if (state.currentView !== 'dms') return;
  const body = document.getElementById('gk-sidebar-body');
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'gk-category-label' }, 'Conversas'));
  const dms = [...state.dms.values()].filter((dm) => dm.other);
  if (dms.length === 0) {
    body.appendChild(el('div', { class: 'gk-empty-state-sm' }, 'Nenhuma conversa ainda.'));
  }
  for (const dm of dms) {
    const isActive = state.currentDmId === dm.id;
    // A própria conversa aberta nunca mostra o indicador — ela já está
    // sendo marcada como lida em tempo real (ver markConversationRead em chat.js).
    const unread = !isActive && isConversationUnread(dm.id, dm.lastMessageAt, dm.lastMessageAuthorId);
    const row = el('div', {
      class: 'gk-dm-row' + (isActive ? ' gk-active' : '') + (unread ? ' gk-unread' : ''),
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
  stopTyping(); // saindo de qualquer conversa que estivesse aberta
  state.currentView = 'dms';
  state.currentServerId = null;
  state.currentChannelId = null;
  state.currentDmId = null;
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-sidebar-header-title').textContent = 'Mensagens diretas';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  renderDmSidebar();
  showFriendsHome();
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-dm-rail-item').classList.add('gk-active');
}

// ============================================================
// Tela "Amigos" — lista de amigos + pedidos de amizade, centralizada,
// no lugar do placeholder "Selecione uma conversa" (estilo Discord).
// ============================================================

export function showFriendsHome() {
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-friends-home').style.display = 'flex';
  document.getElementById('gk-topbar-title').textContent = 'Amigos';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  renderFriendsHome();
}

export function hideFriendsHome() {
  document.getElementById('gk-friends-home').style.display = 'none';
  document.getElementById('gk-messages').style.display = 'flex';
  document.getElementById('gk-composer').style.display = 'block';
}

function renderFriendsHome() {
  const homeEl = document.getElementById('gk-friends-home');
  if (!homeEl || homeEl.style.display === 'none') return; // não visível agora — evita trabalho à toa
  const list = document.getElementById('gk-friends-home-list');
  list.innerHTML = '';

  const pendingCount = (state.incomingFriendRequests || []).length;
  const badge = document.getElementById('gk-friends-pending-badge');
  if (pendingCount > 0) { badge.textContent = String(pendingCount); badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';

  if (friendsHomeTab === 'pending') {
    renderPendingTab(list);
  } else {
    renderFriendsTab(list);
  }
}

function renderFriendsTab(list) {
  const friends = [...state.friends.values()];
  list.appendChild(el('div', { class: 'gk-friends-list-label' }, `Amigos — ${friends.length}`));
  if (friends.length === 0) {
    list.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('snowflake', { size: 32 })]),
      el('div', {}, 'Você ainda não tem amigos por aqui. Que tal adicionar alguém?'),
    ]));
    return;
  }
  friends.sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
  for (const f of friends) {
    list.appendChild(el('div', { class: 'gk-friend-card' }, [
      el('div', { class: 'gk-avatar gk-sz-40', 'data-status': f.statusPresence || 'offline', 'data-frame': f.frameStyle || 'none' }, [
        el('img', { src: f.avatarUrl || fallbackAvatar(f.username) }),
      ]),
      el('div', { class: 'gk-friend-info', onclick: () => openOrCreateDm(f.uid) }, [
        el('div', { class: 'gk-friend-name' }, f.displayName || f.username),
        el('div', { class: 'gk-friend-sub' }, statusLabel(f.statusPresence)),
      ]),
      el('div', { class: 'gk-friend-actions' }, [
        el('button', { class: 'gk-friend-action-btn', title: 'Enviar mensagem', type: 'button', onclick: () => openOrCreateDm(f.uid) }, [icon('chatBubble', { size: 15 })]),
      ]),
    ]));
  }
}

function renderPendingTab(list) {
  const incoming = state.incomingFriendRequests || [];
  list.appendChild(el('div', { class: 'gk-friends-list-label' }, `Pedidos de amizade — ${incoming.length}`));
  if (incoming.length === 0) {
    list.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('tray', { size: 32 })]),
      el('div', {}, 'Nenhum pedido de amizade pendente.'),
    ]));
    return;
  }
  for (const req of incoming) {
    list.appendChild(el('div', { class: 'gk-friend-card' }, [
      el('div', { class: 'gk-avatar gk-sz-40', 'data-status': 'offline', 'data-frame': req.frameStyle || 'none' }, [
        el('img', { src: req.avatarUrl || fallbackAvatar(req.username) }),
      ]),
      el('div', { class: 'gk-friend-info' }, [
        el('div', { class: 'gk-friend-name' }, req.displayName || req.username),
        el('div', { class: 'gk-friend-sub' }, '@' + req.username),
      ]),
      el('div', { class: 'gk-friend-actions' }, [
        el('button', { class: 'gk-friend-action-btn gk-friend-action-accept', title: 'Aceitar', type: 'button', onclick: () => acceptFriendRequest(req.friendshipId) }, [icon('check', { size: 15 })]),
        el('button', { class: 'gk-friend-action-btn gk-friend-action-decline', title: 'Recusar', type: 'button', onclick: () => declineFriendRequest(req.friendshipId) }, [icon('close', { size: 15 })]),
      ]),
    ]));
  }
}

// Liga as abas ("Amigos" / "Pedidos") e o botão "+ Adicionar amigo" da
// tela home — chamada uma única vez no bootstrap (ver app.js).
export function wireFriendsHome() {
  document.getElementById('gk-friends-tab-friends').addEventListener('click', () => switchFriendsTab('friends'));
  document.getElementById('gk-friends-tab-pending').addEventListener('click', () => switchFriendsTab('pending'));
  document.getElementById('gk-friends-add-btn').addEventListener('click', openAddFriendModal);
}

function switchFriendsTab(tab) {
  friendsHomeTab = tab;
  document.getElementById('gk-friends-tab-friends').classList.toggle('gk-active', tab === 'friends');
  document.getElementById('gk-friends-tab-pending').classList.toggle('gk-active', tab === 'pending');
  renderFriendsHome();
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
