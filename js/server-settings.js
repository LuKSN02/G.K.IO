// ============================================================
// G.K.IO — Configurações de servidor
// Painel próprio (mesmo padrão visual das Configurações de usuário),
// com seções de Visão geral, Canais, Membros e Convites — visibilidade
// e edição condicionadas ao cargo de quem está olhando.
// ============================================================
import { auth } from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { uploadToCloudinary } from './cloudinary.js';
import {
  canManageChannels, canIManageMembers, isServerOwner, getCategoriesAndChannels,
  updateServerInfo, deleteServerPermanently, leaveServer, kickMember, setMemberRole,
  createCategory, renameCategory, deleteCategory, renameChannel, deleteChannel,
  createInvite, openCreateChannelModal,
} from './servers.js';
import { openProfileCard } from './profile.js';

let activeSection = 'geral';
let currentServerId = null;

function sections(serverId) {
  const canManage = canManageChannels(serverId);
  const list = [];
  if (canManage) list.push({ id: 'geral', label: 'Visão geral', icon: '🧊' });
  if (canManage) list.push({ id: 'canais', label: 'Canais', icon: '#' });
  list.push({ id: 'membros', label: 'Membros', icon: '👥' });
  list.push({ id: 'convites', label: 'Convites', icon: '🔗' });
  return list;
}

export function openServerSettingsModal(serverId) {
  currentServerId = serverId;
  const available = sections(serverId);
  activeSection = available.some((s) => s.id === activeSection) ? activeSection : available[0].id;
  document.getElementById('gk-server-settings-overlay').classList.add('gk-open');
  renderNav();
  renderSection();
}

function closeServerSettingsModal() {
  document.getElementById('gk-server-settings-overlay').classList.remove('gk-open');
}

export function wireServerSettingsModal() {
  document.getElementById('gk-server-settings-close').addEventListener('click', closeServerSettingsModal);
  document.getElementById('gk-server-settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'gk-server-settings-overlay') closeServerSettingsModal();
  });
}

function renderNav() {
  const nav = document.getElementById('gk-server-settings-nav');
  const server = state.servers.get(currentServerId);
  nav.innerHTML = '';
  nav.appendChild(el('div', { class: 'gk-settings-nav-title' }, server?.name || 'Servidor'));
  for (const s of sections(currentServerId)) {
    nav.appendChild(el('div', {
      class: 'gk-settings-nav-item' + (activeSection === s.id ? ' gk-active' : ''),
      onclick: () => { activeSection = s.id; renderNav(); renderSection(); },
    }, [el('span', { class: 'gk-settings-nav-icon' }, s.icon), el('span', {}, s.label)]));
  }
}

function renderSection() {
  const content = document.getElementById('gk-server-settings-content');
  content.innerHTML = '';
  if (activeSection === 'geral') return renderGeralSection(content);
  if (activeSection === 'canais') return renderCanaisSection(content);
  if (activeSection === 'membros') return renderMembrosSection(content);
  if (activeSection === 'convites') return renderConvitesSection(content);
}

function sectionHeader(title, sub) {
  return el('div', { class: 'gk-settings-section-header' }, [
    el('h2', {}, title),
    el('p', { class: 'gk-modal-sub' }, sub),
  ]);
}

// ============================================================
// Seção: Visão geral (nome, descrição, ícone, banner, excluir servidor)
// ============================================================
function renderGeralSection(content) {
  const serverId = currentServerId;
  const server = state.servers.get(serverId);
  content.appendChild(sectionHeader('Visão geral', 'Nome, descrição e identidade visual do servidor.'));

  let pendingIcon = null;
  let pendingBanner = null;

  const bannerPreview = el('div', {
    class: 'gk-settings-banner',
    style: server.bannerUrl ? `background-image:url(${server.bannerUrl})` : '',
  }, server.bannerUrl ? [] : ['Clique para escolher um banner']);
  const bannerInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  bannerPreview.addEventListener('click', () => bannerInput.click());
  bannerInput.addEventListener('change', () => {
    const file = bannerInput.files[0];
    if (!file) return;
    pendingBanner = file;
    bannerPreview.textContent = '';
    bannerPreview.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
  });

  const iconPreview = server.iconUrl
    ? el('img', { src: server.iconUrl })
    : el('span', {}, (server.name || '?').slice(0, 2).toUpperCase());
  const iconInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const iconWrap = el('div', { class: 'gk-server-icon-picker gk-server-icon-picker-sm', onclick: () => iconInput.click() }, [iconPreview]);
  iconInput.addEventListener('change', () => {
    const file = iconInput.files[0];
    if (!file) return;
    pendingIcon = file;
    iconWrap.innerHTML = '';
    iconWrap.appendChild(el('img', { src: URL.createObjectURL(file) }));
  });

  const nameInput = el('input', { type: 'text', value: server.name || '', maxlength: '60' });
  const descInput = el('textarea', { maxlength: '200', placeholder: 'Do que se trata o servidor?' }, server.description || '');

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    bannerPreview, bannerInput,
    el('div', { class: 'gk-settings-identity-row' }, [
      iconWrap, iconInput,
      el('div', { class: 'gk-hint' }, 'Ícone do servidor'),
    ]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do servidor'), nameInput]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Descrição'), descInput]),
  ]));

  const saveBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Salvar alterações');
  content.appendChild(el('div', { class: 'gk-settings-save-row' }, [saveBtn]));
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const original = saveBtn.textContent;
    saveBtn.textContent = 'Salvando...';
    try {
      let iconUrl = server.iconUrl;
      let bannerUrl = server.bannerUrl;
      if (pendingIcon) { saveBtn.textContent = 'Enviando ícone...'; ({ url: iconUrl } = await uploadToCloudinary(pendingIcon, `server-icons/${auth.currentUser.uid}`)); }
      if (pendingBanner) { saveBtn.textContent = 'Enviando banner...'; ({ url: bannerUrl } = await uploadToCloudinary(pendingBanner, `server-banners/${auth.currentUser.uid}`)); }
      await updateServerInfo(serverId, { name: nameInput.value, description: descInput.value, iconUrl, bannerUrl });
      document.getElementById('gk-sidebar-header-title').textContent = nameInput.value.trim() || server.name;
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.', 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = original;
    }
  });

  if (isServerOwner(serverId)) {
    content.appendChild(el('div', { class: 'gk-settings-card gk-danger-zone' }, [
      el('div', { class: 'gk-settings-card-title' }, 'Zona de risco'),
      el('div', { class: 'gk-hint', style: 'margin-bottom:10px;' }, 'Excluir o servidor é permanente — todos os canais e mensagens deixam de ser acessíveis.'),
      el('button', {
        class: 'gk-btn gk-btn-danger', type: 'button',
        onclick: () => confirmDangerAction(
          'Excluir servidor',
          `Tem certeza que quer excluir "${server.name}"? Essa ação não pode ser desfeita.`,
          async () => { await deleteServerPermanently(serverId); closeServerSettingsModal(); location.reload(); },
        ),
      }, 'Excluir servidor'),
    ]));
  }
}

// ============================================================
// Seção: Canais (categorias + canais, criar/renomear/excluir)
// ============================================================
function renderCanaisSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Canais', 'Organize categorias e canais de texto e voz.'));

  const { categories, channels } = getCategoriesAndChannels();

  for (const cat of categories) {
    const catChannels = channels.filter((c) => c.categoryId === cat.id);
    const catNameInput = el('input', { type: 'text', value: cat.name, class: 'gk-mono' });
    const card = el('div', { class: 'gk-settings-card' });

    card.appendChild(el('div', { class: 'gk-field-row', style: 'margin-bottom:12px;' }, [
      catNameInput,
      el('button', {
        class: 'gk-btn gk-btn-ghost', type: 'button', style: 'padding:8px 12px;',
        onclick: () => renameCategory(serverId, cat.id, catNameInput.value).then(() => toast('Categoria renomeada.')),
      }, '✎'),
      el('button', {
        class: 'gk-btn gk-btn-danger', type: 'button', style: 'padding:8px 12px;',
        onclick: () => deleteCategory(serverId, cat.id).then(() => toast('Categoria excluída.')).catch((err) => toast(err.message, 'danger')),
      }, '✕'),
    ]));

    for (const ch of catChannels) {
      const chNameInput = el('input', { type: 'text', value: ch.name, class: 'gk-mono' });
      card.appendChild(el('div', { class: 'gk-channel-manage-row' }, [
        el('span', { class: 'gk-channel-icon', html: ch.type === 'text' ? '#' : '&#128266;' }),
        chNameInput,
        el('button', {
          class: 'gk-btn gk-btn-ghost', type: 'button', style: 'padding:6px 10px;',
          onclick: () => renameChannel(serverId, ch.id, chNameInput.value).then(() => toast('Canal renomeado.')),
        }, '✎'),
        el('button', {
          class: 'gk-btn gk-btn-danger', type: 'button', style: 'padding:6px 10px;',
          onclick: () => confirmDangerAction('Excluir canal', `Excluir #${ch.name}? As mensagens desse canal deixam de ser acessíveis.`, () => deleteChannel(serverId, ch.id)),
        }, '✕'),
      ]));
    }
    content.appendChild(card);
  }

  const newCatInput = el('input', { type: 'text', placeholder: 'Nome da nova categoria' });
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Nova categoria'),
    el('div', { class: 'gk-field-row' }, [
      newCatInput,
      el('button', {
        class: 'gk-btn gk-btn-primary', type: 'button',
        onclick: async () => {
          if (!newCatInput.value.trim()) return;
          await createCategory(serverId, newCatInput.value);
          newCatInput.value = '';
          toast('Categoria criada.');
        },
      }, 'Criar'),
    ]),
  ]));

  content.appendChild(el('button', {
    class: 'gk-btn gk-btn-ghost gk-btn-block', type: 'button',
    onclick: () => openCreateChannelModal(serverId, categories),
  }, '+ Novo canal'));
}

// ============================================================
// Seção: Membros
// ============================================================
function renderMembrosSection(content) {
  const serverId = currentServerId;
  const server = state.servers.get(serverId);
  content.appendChild(sectionHeader('Membros', `${server.memberIds?.length || 0} pessoas neste servidor.`));

  const cache = state.serverMembersCache.get(serverId) || new Map();
  const iOwn = isServerOwner(serverId);
  const myUid = auth.currentUser?.uid;

  const list = el('div', { class: 'gk-settings-card', style: 'padding:8px;' });
  for (const m of cache.values()) {
    const role = m.role || 'member';
    const roleLabel = role === 'owner' ? 'Dono' : role === 'admin' ? 'Admin' : null;
    const nameLine = el('div', { class: 'gk-name' }, [document.createTextNode(m.nickname || m.user.displayName || m.user.username)]);
    if (roleLabel) nameLine.appendChild(el('span', { class: `gk-role-badge gk-role-${role}` }, roleLabel));

    const actions = [];
    if (iOwn && role !== 'owner' && m.uid !== myUid) {
      actions.push(el('button', {
        class: 'gk-member-role-btn', title: role === 'admin' ? 'Remover cargo de admin' : 'Tornar admin',
        onclick: (e) => { e.stopPropagation(); setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin'); },
      }, role === 'admin' ? '★' : '☆'));
      actions.push(el('button', {
        class: 'gk-member-role-btn', title: 'Expulsar do servidor',
        onclick: (e) => {
          e.stopPropagation();
          confirmDangerAction('Expulsar membro', `Remover ${m.user.displayName || m.user.username} deste servidor?`, () => kickMember(serverId, m.uid));
        },
      }, '⛔'));
    }

    list.appendChild(el('div', { class: 'gk-member-row', onclick: () => openProfileCard(m.uid) }, [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': m.user.statusPresence || 'offline' }, [el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) })]),
      el('div', { style: 'flex:1;min-width:0;' }, [nameLine]),
      ...actions,
    ]));
  }
  content.appendChild(list);

  if (!iOwn) {
    content.appendChild(el('div', { class: 'gk-settings-card gk-danger-zone' }, [
      el('div', { class: 'gk-settings-card-title' }, 'Sair do servidor'),
      el('button', {
        class: 'gk-btn gk-btn-danger', type: 'button',
        onclick: () => confirmDangerAction('Sair do servidor', `Sair de "${server.name}"? Você pode entrar de novo com um convite.`, async () => { await leaveServer(serverId); closeServerSettingsModal(); location.reload(); }),
      }, 'Sair do servidor'),
    ]));
  }
}

// ============================================================
// Seção: Convites
// ============================================================
function renderConvitesSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Convites', 'Gere um código para outras pessoas entrarem no servidor.'));

  const codeBox = el('input', { type: 'text', readonly: 'true', class: 'gk-mono', placeholder: 'Clique em "Gerar" abaixo' });
  const genBtn = el('button', {
    class: 'gk-btn gk-btn-primary', type: 'button',
    onclick: async () => {
      genBtn.disabled = true;
      const code = await createInvite(serverId);
      codeBox.value = code;
      genBtn.disabled = false;
    },
  }, 'Gerar novo código');
  const copyBtn = el('button', {
    class: 'gk-btn gk-btn-ghost', type: 'button',
    onclick: () => { if (!codeBox.value) return; navigator.clipboard.writeText(codeBox.value); toast('Código copiado.'); },
  }, 'Copiar');

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-field' }, [el('label', {}, 'Código de convite'), codeBox]),
    el('div', { style: 'display:flex;gap:8px;' }, [genBtn, copyBtn]),
    el('div', { class: 'gk-hint', style: 'margin-top:10px;' }, 'Cada clique em "Gerar" cria um código novo, sem limite de usos.'),
  ]));
}

// ============================================================
// Confirmação para ações destrutivas — reaproveita o modal genérico.
// ============================================================
function confirmDangerAction(title, message, onConfirm) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, title));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, message));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-danger',
      onclick: async () => {
        overlay.classList.remove('gk-open');
        try { await onConfirm(); } catch (err) { toast(err.message || 'Não foi possível concluir a ação.', 'danger'); }
      },
    }, 'Confirmar'),
  ]));
  overlay.classList.add('gk-open');
}
