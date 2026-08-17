// ============================================================
// G.K.IO — Servidores, categorias e canais (estilo Discord)
// ============================================================
import {
  db, auth, serversCol, serverDoc, categoriesCol, channelsCol, channelDoc,
  membersCol, memberDoc, invitesCol, inviteDoc, userDoc,
  doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion,
} from './db.js';
import { state, el, toast, cleanupListener, fallbackAvatar, genInviteCode } from './state.js';
import { selectChannel } from './chat.js';
import { openProfileCard } from './profile.js';
import { joinVoiceChannel } from './calls.js';

let unsubServers = null;
let unsubCategories = null;
let unsubChannels = null;
let unsubMembers = null;

// ---------- Criar / entrar em servidor ----------
export async function createServer(name) {
  const uid = auth.currentUser.uid;
  const ref = await addDoc(serversCol(), {
    name: name.trim() || 'Novo Servidor',
    iconUrl: '',
    ownerId: uid,
    memberIds: [uid],
    createdAt: serverTimestamp(),
  });
  await setDoc(memberDoc(ref.id, uid), { nickname: null, joinedAt: serverTimestamp() });
  // Categoria e canal padrão, para o servidor não nascer vazio
  const catRef = await addDoc(categoriesCol(ref.id), { name: 'Geral', position: 0 });
  await addDoc(channelsCol(ref.id), { name: 'geral', type: 'text', categoryId: catRef.id, position: 0 });
  await addDoc(channelsCol(ref.id), { name: 'Sala de Voz', type: 'voice', categoryId: catRef.id, position: 1 });
  toast(`Servidor "${name}" criado.`);
  return ref.id;
}

export async function createInvite(serverId) {
  const code = genInviteCode();
  await setDoc(inviteDoc(code), {
    serverId, createdBy: auth.currentUser.uid, uses: 0, maxUses: null, createdAt: serverTimestamp(),
  });
  return code;
}

export async function joinServerByInviteCode(code) {
  code = code.trim().toUpperCase();
  const snap = await getDoc(inviteDoc(code));
  if (!snap.exists()) throw new Error('Convite inválido ou expirado.');
  const { serverId } = snap.data();
  const uid = auth.currentUser.uid;
  await updateDoc(serverDoc(serverId), { memberIds: arrayUnion(uid) });
  await setDoc(memberDoc(serverId, uid), { nickname: null, joinedAt: serverTimestamp() });
  await updateDoc(inviteDoc(code), { uses: (snap.data().uses || 0) + 1 });
  const serverSnap = await getDoc(serverDoc(serverId));
  toast(`Você entrou em "${serverSnap.data().name}".`);
  return serverId;
}

// ---------- Rail de servidores ----------
export function listenUserServers() {
  cleanupListener('_servers');
  const uid = auth.currentUser.uid;
  const q = query(serversCol(), where('memberIds', 'array-contains', uid));
  unsubServers = onSnapshot(q, (snap) => {
    state.servers.clear();
    snap.forEach((d) => state.servers.set(d.id, { id: d.id, ...d.data() }));
    renderRail();
  });
  state.unsubscribers._servers = () => unsubServers && unsubServers();
}

function renderRail() {
  const rail = document.getElementById('gk-rail-servers');
  rail.innerHTML = '';
  for (const server of state.servers.values()) {
    const item = el('div', {
      class: 'gk-rail-item' + (state.currentServerId === server.id ? ' gk-active' : ''),
      title: server.name,
      onclick: () => selectServer(server.id),
    }, [
      el('div', { class: 'gk-rail-pill' }),
      server.iconUrl
        ? el('img', { src: server.iconUrl })
        : document.createTextNode((server.name || '?').slice(0, 2).toUpperCase()),
    ]);
    rail.appendChild(item);
  }
}

// ---------- Selecionar servidor ----------
export function selectServer(serverId) {
  state.currentView = 'server';
  state.currentServerId = serverId;
  state.currentChannelId = null;
  document.getElementById('gk-dm-rail-item')?.classList.remove('gk-active');
  renderRail();
  listenCategoriesAndChannels(serverId);
  listenMembers(serverId);
  document.getElementById('gk-sidebar-header-title').textContent = state.servers.get(serverId)?.name || 'Servidor';
  document.getElementById('gk-members').style.display = 'block';
  document.getElementById('gk-server-settings-btn').style.display = 'inline-flex';
  document.getElementById('gk-members-toggle-btn').style.display = 'inline-flex';
}

function listenCategoriesAndChannels(serverId) {
  cleanupListener('categories');
  cleanupListener('channels');
  const catQ = query(categoriesCol(serverId), orderBy('position'));
  unsubCategories = onSnapshot(catQ, (catSnap) => {
    const categories = [];
    catSnap.forEach((d) => categories.push({ id: d.id, ...d.data() }));
    const chQ = query(channelsCol(serverId), orderBy('position'));
    unsubChannels = onSnapshot(chQ, (chSnap) => {
      const channels = [];
      chSnap.forEach((d) => channels.push({ id: d.id, ...d.data() }));
      renderServerSidebar(serverId, categories, channels);
      if (!state.currentChannelId) {
        const firstText = channels.find((c) => c.type === 'text');
        if (firstText) selectChannel(serverId, firstText.id, firstText.name);
      }
    });
    state.unsubscribers.channels = () => unsubChannels && unsubChannels();
  });
  state.unsubscribers.categories = () => unsubCategories && unsubCategories();
}

function renderServerSidebar(serverId, categories, channels) {
  const body = document.getElementById('gk-sidebar-body');
  body.innerHTML = '';
  for (const cat of categories) {
    const catChannels = channels.filter((c) => c.categoryId === cat.id);
    const list = el('div', { class: 'gk-channel-list' });
    for (const ch of catChannels) {
      const isActive = state.currentChannelId === ch.id;
      const row = el('div', {
        class: 'gk-channel' + (isActive ? ' gk-active' : ''),
        onclick: () => ch.type === 'text'
          ? selectChannel(serverId, ch.id, ch.name)
          : joinVoiceChannel(serverId, ch.id, ch.name),
      }, [
        el('span', { class: 'gk-channel-icon', html: ch.type === 'text' ? '#' : '&#128266;' }),
        el('span', {}, ch.name),
      ]);
      list.appendChild(row);
      if (ch.type === 'voice') {
        const membersBox = el('div', { class: 'gk-voice-members', id: `gk-voice-members-${ch.id}` });
        list.appendChild(membersBox);
      }
    }
    const catNode = el('div', { class: 'gk-category' }, [
      el('div', {
        class: 'gk-category-label',
        onclick: (e) => e.currentTarget.parentElement.classList.toggle('gk-collapsed'),
      }, [el('span', { class: 'gk-chevron' }, '▾'), el('span', {}, cat.name)]),
      list,
    ]);
    body.appendChild(catNode);
  }
  const addBtn = el('div', {
    class: 'gk-channel', style: 'color:var(--gk-accent);font-weight:600;margin-top:6px;',
    onclick: () => openCreateChannelModal(serverId, categories),
  }, [el('span', { class: 'gk-channel-icon', html: '&#43;' }), el('span', {}, 'Novo canal')]);
  body.appendChild(addBtn);
}

function listenMembers(serverId) {
  cleanupListener('members');
  unsubMembers = onSnapshot(membersCol(serverId), async (snap) => {
    const cache = new Map();
    for (const d of snap.docs) {
      const userSnap = await getDoc(userDoc(d.id));
      if (userSnap.exists()) cache.set(d.id, { uid: d.id, ...d.data(), user: userSnap.data() });
    }
    state.serverMembersCache.set(serverId, cache);
    renderMembersPanel(cache);
  });
  state.unsubscribers.members = () => unsubMembers && unsubMembers();
}

function renderMembersPanel(cache) {
  const panel = document.getElementById('gk-members');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'gk-members-label' }, `Membros — ${cache.size}`));
  for (const m of cache.values()) {
    const row = el('div', { class: 'gk-member-row', onclick: () => openProfileCard(m.uid) }, [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': m.user.statusPresence || 'offline' }, [
        el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) }),
      ]),
      el('div', {}, [
        el('div', { class: 'gk-name' }, m.nickname || m.user.displayName || m.user.username),
      ]),
    ]);
    panel.appendChild(row);
  }
}

// ---------- Criação de categoria / canal ----------
function openCreateChannelModal(serverId, categories) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const nameInput = el('input', { type: 'text', placeholder: 'ex: anúncios' });
  const typeSelect = el('select', { class: 'gk-select' }, [
    el('option', { value: 'text' }, 'Canal de texto'),
    el('option', { value: 'voice' }, 'Canal de voz'),
  ]);
  const catSelect = el('select', { class: 'gk-select' },
    categories.map((c) => el('option', { value: c.id }, c.name)));

  modal.appendChild(el('h2', {}, 'Criar canal'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do canal'), nameInput]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Tipo'), typeSelect]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Categoria'), catSelect]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        if (!nameInput.value.trim()) return;
        const chQ = query(channelsCol(serverId));
        const existing = await getDocs(chQ);
        await addDoc(channelsCol(serverId), {
          name: nameInput.value.trim(),
          type: typeSelect.value,
          categoryId: catSelect.value,
          position: existing.size,
        });
        closeGenericModal();
      },
    }, 'Criar'),
  ]));
  overlay.classList.add('gk-open');
}

function closeGenericModal() {
  document.getElementById('gk-generic-modal-overlay').classList.remove('gk-open');
}

export function openCreateServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const nameInput = el('input', { type: 'text', placeholder: 'Nome do servidor' });
  modal.appendChild(el('h2', {}, 'Criar servidor'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Um espaço para sua comunidade, com canais de texto e voz.'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome'), nameInput]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        if (!nameInput.value.trim()) return;
        const id = await createServer(nameInput.value.trim());
        closeGenericModal();
        selectServer(id);
      },
    }, 'Criar servidor'),
  ]));
  overlay.classList.add('gk-open');
}

export function openJoinServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  const codeInput = el('input', { type: 'text', placeholder: 'Código do convite (ex: 7F3KQ2LM)' });
  const errorBox = el('div', { class: 'gk-error', style: 'display:none;' });
  modal.appendChild(el('h2', {}, 'Entrar em um servidor'));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Código de convite'), codeInput, errorBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: async () => {
        try {
          const id = await joinServerByInviteCode(codeInput.value);
          closeGenericModal();
          selectServer(id);
        } catch (err) {
          errorBox.textContent = err.message;
          errorBox.style.display = 'block';
        }
      },
    }, 'Entrar'),
  ]));
  overlay.classList.add('gk-open');
}

export async function openServerInviteModal(serverId) {
  const code = await createInvite(serverId);
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Convidar para o servidor'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Compartilhe este código. Qualquer pessoa com ele pode entrar.'));
  const codeBox = el('input', { type: 'text', value: code, readonly: 'true', class: 'gk-mono' });
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Código'), codeBox]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Fechar'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: () => { navigator.clipboard.writeText(code); toast('Código copiado.'); },
    }, 'Copiar'),
  ]));
  overlay.classList.add('gk-open');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gk-generic-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'gk-generic-modal-overlay') closeGenericModal();
  });
});
