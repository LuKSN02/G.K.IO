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
import { uploadToCloudinary } from './cloudinary.js';

let unsubServers = null;
let unsubCategories = null;
let unsubChannels = null;
let unsubMembers = null;
// Guarda o último snapshot de categorias/canais renderizado, para poder
// re-renderizar a sidebar (mostrar/esconder "Novo canal") quando o cargo
// do usuário atual mudar, sem esperar um novo snapshot de canais.
let lastCategories = [];
let lastChannels = [];

// ---------- Criar / entrar em servidor ----------
export async function createServer(name, description = '', iconUrl = '', bannerUrl = '') {
  const uid = auth.currentUser.uid;
  const ref = await addDoc(serversCol(), {
    name: name.trim() || 'Novo Servidor',
    description: (description || '').trim(),
    iconUrl: iconUrl || '',
    bannerUrl: bannerUrl || '',
    ownerId: uid,
    memberIds: [uid],
    createdAt: serverTimestamp(),
  });
  // Quem cria o servidor nasce com o cargo 'owner' — só ele (ou quem ele
  // promover a 'admin') pode criar/editar/excluir canais e categorias.
  await setDoc(memberDoc(ref.id, uid), { nickname: null, role: 'owner', joinedAt: serverTimestamp() });
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
  // Quem entra por convite começa como 'member' comum — sem permissão para
  // criar canais, a menos que o dono promova depois (ver setMemberRole).
  await setDoc(memberDoc(serverId, uid), { nickname: null, role: 'member', joinedAt: serverTimestamp() });
  await updateDoc(inviteDoc(code), { uses: (snap.data().uses || 0) + 1 });
  const serverSnap = await getDoc(serverDoc(serverId));
  toast(`Você entrou em "${serverSnap.data().name}".`);
  return serverId;
}

// ---------- Cargos / permissões ----------
// Promove ou rebaixa um membro entre 'admin' e 'member'. Só o dono pode
// chamar isso na prática (a regra do Firestore também garante isso do
// lado do servidor — ver firestore.rules).
export async function setMemberRole(serverId, targetUid, role) {
  await updateDoc(memberDoc(serverId, targetUid), { role });
  toast(role === 'admin' ? 'Membro promovido a administrador.' : 'Cargo de administrador removido.');
}

export function canManageChannels(serverId) {
  const server = state.servers.get(serverId);
  const uid = auth.currentUser?.uid;
  if (!server || !uid) return false;
  if (server.ownerId === uid) return true;
  const member = state.serverMembersCache.get(serverId)?.get(uid);
  return member?.role === 'admin';
}

export function isServerOwner(serverId) {
  const server = state.servers.get(serverId);
  return !!server && server.ownerId === auth.currentUser?.uid;
}

// ---------- Configurações de servidor: visão geral ----------
export async function updateServerInfo(serverId, { name, description, iconUrl, bannerUrl }) {
  const patch = {};
  if (name !== undefined) patch.name = name.trim() || 'Servidor sem nome';
  if (description !== undefined) patch.description = (description || '').trim();
  if (iconUrl !== undefined) patch.iconUrl = iconUrl || '';
  if (bannerUrl !== undefined) patch.bannerUrl = bannerUrl || '';
  await updateDoc(serverDoc(serverId), patch);
  toast('Servidor atualizado.');
}

export async function deleteServerPermanently(serverId) {
  // Exclui o documento do servidor — categorias, canais e mensagens ficam
  // órfãos (o Firestore não faz cascade), mas ficam inacessíveis, já que
  // as regras exigem checar memberIds no doc do servidor pra liberar
  // leitura/escrita das subcoleções. Consistente com o restante do MVP.
  await deleteDoc(serverDoc(serverId));
  toast('Servidor excluído.');
}

export async function leaveServer(serverId) {
  const uid = auth.currentUser.uid;
  await deleteDoc(memberDoc(serverId, uid)).catch(() => {});
  await updateDoc(serverDoc(serverId), { memberIds: state.servers.get(serverId).memberIds.filter((id) => id !== uid) });
  toast('Você saiu do servidor.');
}

export async function kickMember(serverId, targetUid) {
  const server = state.servers.get(serverId);
  await updateDoc(serverDoc(serverId), { memberIds: (server.memberIds || []).filter((id) => id !== targetUid) });
  await deleteDoc(memberDoc(serverId, targetUid)).catch(() => {});
  toast('Membro removido do servidor.');
}

// ---------- Configurações de servidor: categorias e canais ----------
export async function createCategory(serverId, name) {
  const existing = await getDocs(query(categoriesCol(serverId)));
  await addDoc(categoriesCol(serverId), { name: name.trim() || 'Nova categoria', position: existing.size });
}

export async function renameCategory(serverId, catId, name) {
  await updateDoc(doc(db, 'servers', serverId, 'categories', catId), { name: name.trim() || 'Categoria' });
}

export async function deleteCategory(serverId, catId) {
  const hasChannels = lastChannels.some((c) => c.categoryId === catId);
  if (hasChannels) throw new Error('Mova ou exclua os canais desta categoria antes de excluí-la.');
  await deleteDoc(doc(db, 'servers', serverId, 'categories', catId));
}

export async function renameChannel(serverId, channelId, name) {
  await updateDoc(channelDoc(serverId, channelId), { name: name.trim().toLowerCase().replace(/\s+/g, '-') || 'canal' });
}

export async function deleteChannel(serverId, channelId) {
  await deleteDoc(channelDoc(serverId, channelId));
  if (state.currentChannelId === channelId) state.currentChannelId = null;
  toast('Canal excluído.');
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
      lastCategories = categories;
      lastChannels = channels;
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
  // Só quem pode gerenciar canais (dono ou admin) vê o botão de criar.
  // Membros comuns enxergam a lista normalmente, sem essa opção.
  if (canManageChannels(serverId)) {
    const addBtn = el('div', {
      class: 'gk-channel', style: 'color:var(--gk-accent);font-weight:600;margin-top:6px;',
      onclick: () => openCreateChannelModal(serverId, categories),
    }, [el('span', { class: 'gk-channel-icon', html: '&#43;' }), el('span', {}, 'Novo canal')]);
    body.appendChild(addBtn);
  }
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
    renderMembersPanel(cache, serverId);
    // Um cargo pode ter mudado (ex: alguém virou admin) — re-renderiza a
    // sidebar de canais para atualizar a visibilidade do "Novo canal".
    if (state.currentServerId === serverId) renderServerSidebar(serverId, lastCategories, lastChannels);
  });
  state.unsubscribers.members = () => unsubMembers && unsubMembers();
}

function renderMembersPanel(cache, serverId) {
  const panel = document.getElementById('gk-members');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'gk-members-label' }, `Membros — ${cache.size}`));
  const isOwner = canIManageMembers(serverId);
  for (const m of cache.values()) {
    const role = m.role || 'member';
    const roleLabel = role === 'owner' ? 'Dono' : role === 'admin' ? 'Admin' : null;

    const nameLine = el('div', { class: 'gk-name' }, [
      document.createTextNode(m.nickname || m.user.displayName || m.user.username),
    ]);
    if (roleLabel) nameLine.appendChild(el('span', { class: `gk-role-badge gk-role-${role}` }, roleLabel));

    const rowChildren = [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': m.user.statusPresence || 'offline' }, [
        el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) }),
      ]),
      el('div', {}, [nameLine]),
    ];

    // Só o dono vê o botão de promover/rebaixar, e nunca para si mesmo ou para outro dono.
    if (isOwner && role !== 'owner' && m.uid !== auth.currentUser?.uid) {
      rowChildren.push(el('button', {
        class: 'gk-member-role-btn',
        title: role === 'admin' ? 'Remover cargo de administrador' : 'Tornar administrador (pode criar canais)',
        onclick: (e) => { e.stopPropagation(); setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin'); },
      }, role === 'admin' ? '★' : '☆'));
    }

    const row = el('div', { class: 'gk-member-row', onclick: () => openProfileCard(m.uid) }, rowChildren);
    panel.appendChild(row);
  }
}

export function canIManageMembers(serverId) {
  const server = state.servers.get(serverId);
  return !!server && server.ownerId === auth.currentUser?.uid;
}

// ---------- Criação de categoria / canal ----------
export function openCreateChannelModal(serverId, categories) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  let selectedType = 'text';

  // Campo de nome, com prefixo # (texto) ou 🔊 (voz) que acompanha o tipo escolhido.
  const nameInput = el('input', { type: 'text', placeholder: 'novo-canal', maxlength: '80' });
  const prefixEl = el('span', { class: 'gk-channel-name-prefix' }, '#');
  const nameWrap = el('div', { class: 'gk-channel-name-input-wrap' }, [prefixEl, nameInput]);

  // Normaliza o nome enquanto digita (minúsculas, sem espaço), como no Discord.
  nameInput.addEventListener('input', () => {
    const cursor = nameInput.selectionStart;
    const before = nameInput.value.length;
    nameInput.value = nameInput.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    nameInput.selectionStart = nameInput.selectionEnd = Math.max(0, cursor + (nameInput.value.length - before));
  });

  const textOption = el('button', { type: 'button', class: 'gk-type-option gk-active', onclick: () => selectType('text') }, [
    el('span', { class: 'gk-type-icon' }, '#'),
    el('div', {}, [el('div', { class: 'gk-type-name' }, 'Texto'), el('div', { class: 'gk-type-desc' }, 'Mensagens, imagens e GIFs')]),
  ]);
  const voiceOption = el('button', { type: 'button', class: 'gk-type-option', onclick: () => selectType('voice') }, [
    el('span', { class: 'gk-type-icon', html: '&#128266;' }),
    el('div', {}, [el('div', { class: 'gk-type-name' }, 'Voz'), el('div', { class: 'gk-type-desc' }, 'Conversa por áudio e vídeo')]),
  ]);

  function selectType(type) {
    selectedType = type;
    textOption.classList.toggle('gk-active', type === 'text');
    voiceOption.classList.toggle('gk-active', type === 'voice');
    prefixEl.innerHTML = type === 'text' ? '#' : '&#128266;';
  }

  const catSelect = el('select', { class: 'gk-select' },
    categories.map((c) => el('option', { value: c.id }, c.name)));

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, '#'),
    el('div', {}, [
      el('h2', {}, 'Criar canal'),
      el('p', { class: 'gk-modal-sub' }, 'Canais organizam as conversas do seu servidor.'),
    ]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do canal'), nameWrap]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Tipo'), el('div', { class: 'gk-type-picker' }, [textOption, voiceOption])]));
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
          type: selectedType,
          categoryId: catSelect.value,
          position: existing.size,
        });
        closeGenericModal();
      },
    }, 'Criar canal'),
  ]));
  overlay.classList.add('gk-open');
  nameInput.focus();
}

// Getter para o módulo de configurações de servidor reaproveitar o
// último snapshot de categorias/canais sem precisar de um listener próprio.
export function getCategoriesAndChannels() {
  return { categories: lastCategories, channels: lastChannels };
}

function closeGenericModal() {
  document.getElementById('gk-generic-modal-overlay').classList.remove('gk-open');
}

export function openCreateServerModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  let iconFile = null;

  // Ícone do servidor (opcional) — clique abre o seletor de arquivo,
  // preview local imediato via object URL, upload real só ao criar.
  const iconImg = el('img', { style: 'display:none;' });
  const iconPlaceholder = el('span', {}, '+');
  const iconInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const iconPicker = el('div', {
    class: 'gk-server-icon-picker', title: 'Ícone do servidor (opcional)',
    onclick: () => iconInput.click(),
  }, [iconImg, iconPlaceholder]);
  iconInput.addEventListener('change', () => {
    const file = iconInput.files[0];
    if (!file) return;
    iconFile = file;
    iconImg.src = URL.createObjectURL(file);
    iconImg.style.display = 'block';
    iconPlaceholder.style.display = 'none';
  });

  const nameInput = el('input', { type: 'text', placeholder: 'ex: Clã Fênix', maxlength: '60' });
  const descInput = el('textarea', { rows: '2', placeholder: 'Do que se trata o servidor? (opcional)', maxlength: '200' });

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, 'SV'),
    el('div', {}, [
      el('h2', {}, 'Criar servidor'),
      el('p', { class: 'gk-modal-sub' }, 'Um espaço para sua comunidade, com canais de texto e voz.'),
    ]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field', style: 'display:flex;justify-content:center;margin-bottom:18px;' }, [iconPicker, iconInput]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do servidor'), nameInput]));
  modal.appendChild(el('div', { class: 'gk-field' }, [
    el('label', {}, 'Descrição'), descInput,
    el('div', { class: 'gk-hint' }, 'Só você começa como dono — dá pra promover outros membros a administrador depois, no painel 👥 Membros.'),
  ]));

  const createBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Criar servidor');
  createBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim()) return;
    createBtn.disabled = true;
    const originalLabel = createBtn.textContent;
    try {
      let iconUrl = '';
      if (iconFile) {
        createBtn.textContent = 'Enviando ícone...';
        const uploaded = await uploadToCloudinary(iconFile, `server-icons/${auth.currentUser.uid}`);
        iconUrl = uploaded.url;
      }
      const id = await createServer(nameInput.value.trim(), descInput.value, iconUrl);
      closeGenericModal();
      selectServer(id);
    } catch (err) {
      toast(err.message || 'Não foi possível criar o servidor.', 'danger');
      createBtn.disabled = false;
      createBtn.textContent = originalLabel;
    }
  });

  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: closeGenericModal }, 'Cancelar'),
    createBtn,
  ]));
  overlay.classList.add('gk-open');
  nameInput.focus();
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
