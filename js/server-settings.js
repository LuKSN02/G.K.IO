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
  canManageChannels, canManageServerInfo, canKickMembers, canManageRoles,
  isServerOwner, getCategoriesAndChannels,
  updateServerInfo, deleteServerPermanently, leaveServer, kickMember, setMemberRole,
  createCategory, renameCategory, deleteCategory, renameChannel, deleteChannel,
  createInvite, openCreateChannelModal, openChannelPermissionsModal,
  PERMISSION_CATALOG, ROLE_COLOR_SWATCHES, getRoles, createRole, updateRole, deleteRole, assignRoleToMember,
} from './servers.js';
import { openProfileCard } from './profile.js';

let activeSection = 'geral';
let currentServerId = null;

function sections(serverId) {
  const list = [];
  if (canManageServerInfo(serverId)) list.push({ id: 'geral', label: 'Visão geral', icon: '🧊' });
  if (canManageChannels(serverId)) list.push({ id: 'canais', label: 'Canais', icon: '#' });
  if (canManageRoles(serverId)) list.push({ id: 'cargos', label: 'Cargos', icon: '🎭' });
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
  if (activeSection === 'cargos') return renderCargosSection(content);
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
          class: 'gk-btn gk-btn-ghost', type: 'button', style: 'padding:6px 10px;', title: 'Permissões do canal (por cargo)',
          onclick: () => openChannelPermissionsModal(serverId, ch),
        }, '🔒'),
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
// Seção: Cargos (roles personalizados com permissões granulares)
// ============================================================
function renderCargosSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Cargos', 'Crie cargos com um conjunto próprio de permissões e atribua a membros na aba Membros.'));

  const roles = getRoles();
  const cache = state.serverMembersCache.get(serverId) || new Map();

  if (roles.length === 0) {
    content.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nenhum cargo criado ainda.'));
  }

  for (const role of roles) {
    const memberCount = [...cache.values()].filter((m) => (m.roleIds || []).includes(role.id)).length;
    content.appendChild(renderRoleCard(serverId, role, memberCount));
  }

  content.appendChild(renderRoleCard(serverId, null, 0));
}

function renderRoleCard(serverId, role, memberCount) {
  const isNew = !role;
  const nameInput = el('input', { type: 'text', value: role?.name || '', placeholder: 'Nome do cargo', maxlength: '40' });
  let selectedColor = role?.color || ROLE_COLOR_SWATCHES[0];

  const swatchRow = el('div', { class: 'gk-role-swatch-row' });
  const paintSwatches = () => {
    swatchRow.innerHTML = '';
    for (const color of ROLE_COLOR_SWATCHES) {
      swatchRow.appendChild(el('button', {
        type: 'button', class: 'gk-role-swatch' + (color === selectedColor ? ' gk-active' : ''),
        style: `background:${color};`,
        onclick: () => { selectedColor = color; paintSwatches(); },
      }));
    }
  };
  paintSwatches();

  const permChecks = {};
  const permsBox = el('div', { class: 'gk-role-perms' });
  for (const perm of PERMISSION_CATALOG) {
    const checked = role?.permissions?.[perm.key] || false;
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = checked;
    permChecks[perm.key] = checkbox;
    permsBox.appendChild(el('label', { class: 'gk-role-perm-row' }, [
      checkbox,
      el('div', {}, [
        el('div', { class: 'gk-role-perm-label' }, perm.label),
        el('div', { class: 'gk-hint' }, perm.desc),
      ]),
    ]));
  }

  const saveBtn = el('button', {
    class: 'gk-btn gk-btn-primary', type: 'button',
    onclick: async () => {
      if (!nameInput.value.trim()) { toast('Dê um nome ao cargo.', 'danger'); return; }
      const permissions = {};
      for (const perm of PERMISSION_CATALOG) permissions[perm.key] = permChecks[perm.key].checked;
      saveBtn.disabled = true;
      try {
        if (isNew) {
          await createRole(serverId, { name: nameInput.value, color: selectedColor });
          nameInput.value = '';
          paintSwatches();
          for (const perm of PERMISSION_CATALOG) permChecks[perm.key].checked = false;
        } else {
          await updateRole(serverId, role.id, { name: nameInput.value, color: selectedColor, permissions });
        }
      } catch (err) {
        toast(err.message || 'Não foi possível salvar o cargo.', 'danger');
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, isNew ? 'Criar cargo' : 'Salvar');

  const headerChildren = [
    el('span', { class: 'gk-role-dot', style: `background:${selectedColor};` }),
    el('div', { class: 'gk-settings-card-title', style: 'flex:1;' }, isNew ? 'Novo cargo' : (role.name || 'Cargo')),
  ];
  if (!isNew) {
    headerChildren.push(el('span', { class: 'gk-hint' }, `${memberCount} ${memberCount === 1 ? 'membro' : 'membros'}`));
    headerChildren.push(el('button', {
      class: 'gk-btn gk-btn-danger', type: 'button', style: 'padding:6px 10px;',
      onclick: () => confirmDangerAction('Excluir cargo', `Excluir o cargo "${role.name}"? Ele será removido de todos os membros.`, () => deleteRole(serverId, role.id)),
    }, '✕'));
  }

  return el('div', { class: 'gk-settings-card gk-role-card' }, [
    el('div', { class: 'gk-field-row', style: 'align-items:center;margin-bottom:10px;' }, headerChildren),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Nome'), nameInput]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Cor'), swatchRow]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Permissões'), permsBox]),
    el('div', { class: 'gk-settings-save-row' }, [saveBtn]),
  ]);
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
  const iCanKick = canKickMembers(serverId);
  const iCanManageRoles = canManageRoles(serverId);
  const myUid = auth.currentUser?.uid;
  const roles = getRoles();

  const list = el('div', { class: 'gk-settings-card', style: 'padding:8px;' });
  for (const m of cache.values()) {
    const role = m.role || 'member';
    const roleLabel = role === 'owner' ? 'Dono' : role === 'admin' ? 'Admin' : null;
    const nameLine = el('div', { class: 'gk-name' }, [document.createTextNode(m.nickname || m.user.displayName || m.user.username)]);
    if (roleLabel) nameLine.appendChild(el('span', { class: `gk-role-badge gk-role-${role}` }, roleLabel));
    for (const rid of m.roleIds || []) {
      const customRole = roles.find((r) => r.id === rid);
      if (!customRole) continue;
      nameLine.appendChild(el('span', {
        class: 'gk-role-chip',
        style: `background:${customRole.color}22;color:${customRole.color};border-color:${customRole.color}55;`,
      }, customRole.name));
    }

    const actions = [];
    if (iOwn && role !== 'owner' && m.uid !== myUid) {
      actions.push(el('button', {
        class: 'gk-member-role-btn', title: role === 'admin' ? 'Remover cargo de admin' : 'Tornar admin',
        onclick: (e) => { e.stopPropagation(); setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin'); },
      }, role === 'admin' ? '★' : '☆'));
    }
    if (iCanManageRoles && role !== 'owner' && roles.length > 0) {
      actions.push(el('button', {
        class: 'gk-member-role-btn', title: 'Atribuir cargos',
        onclick: (e) => { e.stopPropagation(); openAssignRolesPopover(serverId, m, roles); },
      }, '🎭'));
    }
    if (iCanKick && role !== 'owner' && m.uid !== myUid) {
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
// Popover: atribuir cargos a um membro (checkboxes, salva na hora)
// ============================================================
function openAssignRolesPopover(serverId, member, roles) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Atribuir cargos'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, member.nickname || member.user.displayName || member.user.username));

  const list = el('div', { class: 'gk-role-assign-list' });
  for (const role of roles) {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = (member.roleIds || []).includes(role.id);
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        await assignRoleToMember(serverId, member.uid, role.id, checkbox.checked);
      } catch (err) {
        checkbox.checked = !checkbox.checked;
        toast(err.message || 'Não foi possível atualizar o cargo.', 'danger');
      } finally {
        checkbox.disabled = false;
      }
    });
    list.appendChild(el('label', { class: 'gk-role-assign-row' }, [
      checkbox,
      el('span', { class: 'gk-role-dot', style: `background:${role.color};` }),
      el('span', {}, role.name),
    ]));
  }
  modal.appendChild(list);
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-primary gk-btn-block', onclick: () => overlay.classList.remove('gk-open') }, 'Concluído'),
  ]));
  overlay.classList.add('gk-open');
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
