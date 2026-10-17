// ============================================================
// G.K.IO — Configurações de servidor
// Painel próprio (mesmo padrão visual das Configurações de usuário),
// com seções de Visão geral, Canais, Membros e Convites — visibilidade
// e edição condicionadas ao cargo de quem está olhando.
// ============================================================
import { auth } from './db.js';
import { state, el, toast, fallbackAvatar, effectiveStatus } from './state.js';
import { uploadToCloudinary } from './cloudinary.js';
import {
  canManageChannels, canManageServerInfo, canKickMembers, canManageRoles,
  isServerOwner, getCategoriesAndChannels,
  updateServerInfo, deleteServerPermanently, leaveServer, kickMember, setMemberRole,
  createCategory, renameCategory, deleteCategory, renameChannel, deleteChannel, setChannelNsfw, setChannelSlowmode,
  listServerInvites, revokeInvite, inviteStatus, saveWelcomeSettings, renderWelcomeText, DEFAULT_WELCOME,
  createInvite, openCreateChannelModal, openChannelPermissionsModal,
  PERMISSION_CATALOG, ROLE_COLOR_SWATCHES, getRoles, createRole, updateRole, deleteRole, assignRoleToMember,
  onServerDataChange,
} from './servers.js';
import { openProfileCard } from './profile.js';
import { icon } from './icons.js';
import { confirmDangerAction } from './dialogs.js';
import { openModerateModal, canModerateTarget, isTimedOut, getTimeoutUntilMs, listBans, unbanMember } from './moderation.js';
import { loadAuditLog, describeAudit } from './audit.js';
import { formatLong } from './message-utils.js';

let activeSection = 'geral';
let currentServerId = null;

function sections(serverId) {
  const list = [];
  if (canManageServerInfo(serverId)) list.push({ id: 'geral', label: 'Visão geral', icon: 'snowflake' });
  if (canManageChannels(serverId)) list.push({ id: 'canais', label: 'Canais', icon: '#', isText: true });
  if (canManageRoles(serverId)) list.push({ id: 'cargos', label: 'Cargos', icon: 'shield' });
  list.push({ id: 'membros', label: 'Membros', icon: 'members' });
  if (canKickMembers(serverId) || canManageChannels(serverId) || canManageServerInfo(serverId)) {
    list.push({ id: 'moderacao', label: 'Moderação', icon: 'block' });
  }
  list.push({ id: 'convites', label: 'Convites', icon: 'link' });
  if (canManageServerInfo(serverId)) list.push({ id: 'boasvindas', label: 'Boas-vindas', icon: 'emojiSmile' });
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
  onServerDataChange((serverId) => { if (serverId === currentServerId) scheduleRefresh(); });
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
    }, [el('span', { class: 'gk-settings-nav-icon' }, s.isText ? s.icon : [icon(s.icon, { size: 16 })]), el('span', {}, s.label)]));
  }
}

function renderSection() {
  const content = document.getElementById('gk-server-settings-content');
  content.innerHTML = '';
  if (activeSection === 'geral') return renderGeralSection(content);
  if (activeSection === 'canais') return renderCanaisSection(content);
  if (activeSection === 'cargos') return renderCargosSection(content);
  if (activeSection === 'membros') return renderMembrosSection(content);
  if (activeSection === 'moderacao') return renderModeracaoSection(content);
  if (activeSection === 'boasvindas') return renderBoasVindasSection(content);
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
          { confirmLabel: 'Excluir servidor' },
        ),
      }, 'Excluir servidor'),
    ]));
  }
}

// ============================================================
// Helpers visuais das configurações
// ============================================================
function iconBtn(iconName, title, onclick, { danger = false, size = 14 } = {}) {
  return el('button', {
    class: 'gk-sv-iconbtn' + (danger ? ' gk-danger' : ''), type: 'button',
    title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(e); },
  }, [icon(iconName, { size })]);
}

// Campo "fantasma": parece texto até passar o mouse/focar. Salva ao dar Enter
// ou ao sair do campo; Esc desfaz.
function ghostInput(value, { onCommit, cls = '', maxlength = '60' } = {}) {
  let saved = value;
  const input = el('input', { type: 'text', value, maxlength, class: 'gk-sv-ghost ' + cls, spellcheck: 'false' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = saved; input.blur(); }
  });
  input.addEventListener('blur', async () => {
    const v = input.value.trim();
    if (!v) { input.value = saved; return; }
    if (v === saved) return;
    try { await onCommit(v); saved = v; input.value = v; }
    catch (err) { input.value = saved; toast(err.message || 'Não foi possível salvar.', 'danger'); }
  });
  return input;
}

// Atualiza a tela sozinha quando canais/cargos/membros mudam (ver
// onServerDataChange em servers.js). Não mexe em Visão geral/Convites (têm
// formulários em edição) e não redesenha enquanto a pessoa digita.
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const overlay = document.getElementById('gk-server-settings-overlay');
    if (!overlay?.classList.contains('gk-open')) return;
    if (!['canais', 'cargos', 'membros'].includes(activeSection)) return;
    const content = document.getElementById('gk-server-settings-content');
    const a = document.activeElement;
    if (a && content.contains(a) && a.matches('input[type="text"], input[type="search"], textarea')) return;
    const scroll = content.scrollTop;
    renderSection();
    content.scrollTop = scroll;
  }, 80);
}

// ============================================================
// Seção: Canais
// ============================================================
function nsfwPill(serverId, ch) {
  let on = !!ch.nsfw;
  const btn = el('button', { type: 'button', class: 'gk-sv-pill gk-sv-nsfw' }, 'NSFW');
  const paint = () => {
    btn.classList.toggle('gk-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Canal marcado como NSFW (+18). Clique para desmarcar.' : 'Marcar este canal como NSFW (+18)';
  };
  paint();
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      await setChannelNsfw(serverId, ch.id, !on);
      on = !on; paint();
      toast(on ? 'Canal marcado como NSFW.' : 'Canal não é mais NSFW.');
    } catch (err) {
      toast('Não foi possível alterar: ' + (err.message || err), 'danger');
    } finally { btn.disabled = false; }
  });
  return btn;
}

const SLOWMODE_OPTIONS = [[0, 'off'], [5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [900, '15 min'], [3600, '1 h']];

// Modo lento: tempo mínimo entre duas mensagens da mesma pessoa no canal.
function slowmodeSelect(serverId, ch) {
  const current = Number(ch.slowmodeSeconds) || 0;
  const options = SLOWMODE_OPTIONS.some(([v]) => v === current) ? SLOWMODE_OPTIONS : [...SLOWMODE_OPTIONS, [current, `${current} s`]];
  const select = el('select', {
    class: 'gk-sv-select gk-sv-slowmode' + (current ? ' gk-on' : ''),
    title: 'Modo lento: tempo mínimo entre duas mensagens da mesma pessoa neste canal (quem gerencia canais é isento)',
    'aria-label': 'Modo lento',
  }, options.map(([v, label]) => el('option', { value: String(v) }, `Lento: ${label}`)));
  select.value = String(current);
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', async () => {
    const seconds = Number(select.value);
    select.disabled = true;
    try {
      await setChannelSlowmode(serverId, ch.id, seconds);
      select.classList.toggle('gk-on', seconds > 0);
      toast(seconds ? `Modo lento de ${select.selectedOptions[0].textContent.replace('Lento: ', '')} ativado.` : 'Modo lento desativado.');
    } catch (err) {
      select.value = String(Number(ch.slowmodeSeconds) || 0);
      toast('Não foi possível alterar o modo lento: ' + (err.message || err), 'danger');
    } finally { select.disabled = false; }
  });
  return select;
}

function renderCanaisSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Canais', 'Organize categorias e canais de texto e voz. Clique em um nome para renomear.'));

  const { categories, channels } = getCategoriesAndChannels();

  const newCatInput = el('input', { type: 'text', class: 'gk-sv-input', placeholder: 'Nome da nova categoria', maxlength: '40' });
  const createCat = async () => {
    if (!newCatInput.value.trim()) return;
    try { await createCategory(serverId, newCatInput.value); newCatInput.value = ''; toast('Categoria criada.'); }
    catch (err) { toast(err.message || 'Não foi possível criar a categoria.', 'danger'); }
  };
  newCatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createCat(); } });
  content.appendChild(el('div', { class: 'gk-sv-toolbar' }, [
    newCatInput,
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: createCat }, [icon('plus', { size: 14 }), ' Categoria']),
    el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => openCreateChannelModal(serverId, categories) }, [icon('plus', { size: 14 }), ' Canal']),
  ]));

  if (categories.length === 0) {
    content.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nenhuma categoria ainda. Crie uma acima para começar.'));
  }

  for (const cat of categories) {
    const catChannels = channels.filter((c) => c.categoryId === cat.id);
    const card = el('div', { class: 'gk-sv-card' });

    card.appendChild(el('div', { class: 'gk-sv-card-head' }, [
      ghostInput(cat.name, {
        cls: 'gk-sv-cat-name', maxlength: '40',
        onCommit: async (v) => { await renameCategory(serverId, cat.id, v); toast('Categoria renomeada.'); },
      }),
      el('span', { class: 'gk-sv-count' }, `${catChannels.length} ${catChannels.length === 1 ? 'canal' : 'canais'}`),
      iconBtn('trash', 'Excluir categoria', () => confirmDangerAction(
        'Excluir categoria', `Excluir a categoria "${cat.name}"?`,
        async () => { await deleteCategory(serverId, cat.id); toast('Categoria excluída.'); },
        { confirmLabel: 'Excluir categoria' },
      ), { danger: true }),
    ]));

    for (const ch of catChannels) {
      const isText = ch.type === 'text';
      const row = el('div', { class: 'gk-sv-row' }, [
        el('span', { class: 'gk-sv-row-icon' }, isText ? '#' : [icon('speaker', { size: 14 })]),
        ghostInput(ch.name, {
          cls: 'gk-sv-ch-name',
          onCommit: async (v) => { await renameChannel(serverId, ch.id, v); toast('Canal renomeado.'); },
        }),
      ]);
      if (isText) row.appendChild(slowmodeSelect(serverId, ch));
      if (isText) row.appendChild(nsfwPill(serverId, ch));
      row.appendChild(iconBtn('lock', 'Permissões do canal (por cargo)', () => openChannelPermissionsModal(serverId, ch)));
      row.appendChild(iconBtn('trash', 'Excluir canal', () => confirmDangerAction(
        'Excluir canal', `Excluir o canal "#${ch.name}"? As mensagens desse canal deixam de ser acessíveis.`,
        () => deleteChannel(serverId, ch.id),
        { confirmLabel: 'Excluir canal' },
      ), { danger: true }));
      card.appendChild(row);
    }
    if (catChannels.length === 0) card.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhum canal nesta categoria.'));
    content.appendChild(card);
  }
}

// ============================================================
// Seção: Cargos (roles personalizados com permissões granulares)
// ============================================================
const expandedRoles = new Set();   // cargos com o cartão aberto (sobrevive ao redesenho)
let newRoleOpen = false;
let pendingScrollRole = null;

function renderCargosSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Cargos', 'Crie cargos com cor e permissões e escolha quem os recebe. Abra um cargo para atribuí-lo aos membros.'));

  const roles = getRoles();
  const members = [...(state.serverMembersCache.get(serverId) || new Map()).values()];

  if (roles.length === 0) {
    content.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nenhum cargo criado ainda.'));
  }
  for (const role of roles) content.appendChild(renderRoleCard(serverId, role, members));
  content.appendChild(renderRoleCard(serverId, null, members));
}

function renderRoleCard(serverId, role, members) {
  const isNew = !role;
  const open = isNew ? newRoleOpen : expandedRoles.has(role.id);
  const holders = isNew ? [] : members.filter((m) => (m.roleIds || []).includes(role.id));

  const nameInput = el('input', { type: 'text', class: 'gk-sv-input', value: role?.name || '', placeholder: 'Nome do cargo', maxlength: '40' });
  let selectedColor = role?.color || ROLE_COLOR_SWATCHES[0];

  const dot = el('span', { class: 'gk-role-dot', style: `background:${selectedColor};` });
  const swatchRow = el('div', { class: 'gk-role-swatch-row' });
  const paintSwatches = () => {
    swatchRow.innerHTML = '';
    dot.style.background = selectedColor;
    for (const color of ROLE_COLOR_SWATCHES) {
      swatchRow.appendChild(el('button', {
        type: 'button', class: 'gk-role-swatch' + (color === selectedColor ? ' gk-active' : ''),
        style: `background:${color};`, 'aria-label': color,
        onclick: () => { selectedColor = color; paintSwatches(); },
      }));
    }
  };
  paintSwatches();

  const permChecks = {};
  const permsBox = el('div', { class: 'gk-role-perms' });
  for (const perm of PERMISSION_CATALOG) {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = role?.permissions?.[perm.key] || false;
    permChecks[perm.key] = checkbox;
    permsBox.appendChild(el('label', { class: 'gk-role-perm-row' }, [
      checkbox,
      el('div', {}, [
        el('div', { class: 'gk-role-perm-label' }, perm.label),
        el('div', { class: 'gk-hint' }, perm.desc),
      ]),
    ]));
  }

  const readPerms = () => {
    const permissions = {};
    for (const perm of PERMISSION_CATALOG) permissions[perm.key] = permChecks[perm.key].checked;
    return permissions;
  };

  const saveBtn = el('button', {
    class: 'gk-btn gk-btn-primary', type: 'button',
    onclick: async () => {
      if (!nameInput.value.trim()) { toast('Dê um nome ao cargo.', 'danger'); return; }
      saveBtn.disabled = true;
      try {
        if (isNew) {
          const id = await createRole(serverId, { name: nameInput.value, color: selectedColor, permissions: readPerms() });
          newRoleOpen = false;
          expandedRoles.add(id);          // abre o cargo recém-criado para já atribuir aos membros
          pendingScrollRole = id;
          scheduleRefresh();
        } else {
          await updateRole(serverId, role.id, { name: nameInput.value, color: selectedColor, permissions: readPerms() });
        }
      } catch (err) {
        toast(err.message || 'Não foi possível salvar o cargo.', 'danger');
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, isNew ? 'Criar cargo' : 'Salvar alterações');

  // ----- cabeçalho (clique abre/fecha) -----
  const card = el('div', { class: 'gk-sv-card gk-sv-role' + (open ? ' gk-open' : '') + (isNew ? ' gk-new' : '') });
  const head = el('div', {
    class: 'gk-sv-role-head', role: 'button', tabindex: '0',
    onclick: () => {
      const nowOpen = !card.classList.contains('gk-open');
      card.classList.toggle('gk-open', nowOpen);
      if (isNew) newRoleOpen = nowOpen;
      else if (nowOpen) expandedRoles.add(role.id); else expandedRoles.delete(role.id);
    },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); } },
  }, [
    isNew ? el('span', { class: 'gk-sv-role-plus' }, [icon('plus', { size: 14 })]) : dot,
    el('div', { class: 'gk-sv-role-title' }, isNew ? 'Novo cargo' : (role.name || 'Cargo')),
    isNew ? null : el('span', { class: 'gk-sv-count' }, `${holders.length} ${holders.length === 1 ? 'membro' : 'membros'}`),
    el('span', { class: 'gk-sv-chevron' }, [icon('chevronDown', { size: 16 })]),
  ]);

  // ----- corpo -----
  const body = el('div', { class: 'gk-sv-role-body' }, [
    el('div', { class: 'gk-field' }, [el('label', {}, 'Nome'), nameInput]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Cor'), swatchRow]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Permissões'), permsBox]),
  ]);

  if (!isNew) {
    const filter = el('input', { type: 'search', class: 'gk-sv-input gk-sv-search', placeholder: 'Buscar membro…' });
    const list = el('div', { class: 'gk-sv-assign-list' });
    const rows = [];
    for (const m of members) {
      const displayName = m.nickname || m.user.displayName || m.user.username;
      const checkbox = el('input', { type: 'checkbox' });
      checkbox.checked = (m.roleIds || []).includes(role.id);
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try {
          await assignRoleToMember(serverId, m.uid, role.id, checkbox.checked);
          toast(checkbox.checked ? `Cargo atribuído a ${displayName}.` : `Cargo removido de ${displayName}.`);
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          toast(err.message || 'Não foi possível atualizar o cargo.', 'danger');
        } finally { checkbox.disabled = false; }
      });
      const row = el('label', { class: 'gk-sv-assign-row', 'data-name': displayName.toLowerCase() }, [
        el('div', { class: 'gk-avatar gk-sz-24' }, [el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) })]),
        el('span', { class: 'gk-sv-assign-name' }, displayName),
        m.role === 'owner' ? el('span', { class: 'gk-role-badge gk-role-owner' }, 'Dono') : null,
        checkbox,
      ]);
      rows.push(row);
      list.appendChild(row);
    }
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const r of rows) r.style.display = !q || r.dataset.name.includes(q) ? '' : 'none';
    });
    body.appendChild(el('div', { class: 'gk-field' }, [
      el('label', {}, 'Membros com este cargo'),
      members.length > 6 ? filter : null,
      members.length ? list : el('div', { class: 'gk-sv-empty' }, 'Nenhum membro carregado ainda.'),
    ]));
  }

  const footer = [];
  if (!isNew) {
    footer.push(el('button', {
      class: 'gk-btn gk-btn-danger', type: 'button',
      onclick: () => confirmDangerAction('Excluir cargo', `Excluir o cargo "${role.name}"? Ele será removido de todos os membros.`, async () => {
        expandedRoles.delete(role.id);
        await deleteRole(serverId, role.id);
      }, { confirmLabel: 'Excluir cargo' }),
    }, [icon('trash', { size: 14 }), ' Excluir cargo']));
  }
  footer.push(saveBtn);
  body.appendChild(el('div', { class: 'gk-sv-role-footer' }, footer));

  card.appendChild(head);
  card.appendChild(body);

  if (!isNew && pendingScrollRole === role.id) {
    pendingScrollRole = null;
    setTimeout(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  }
  return card;
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

  if (iCanManageRoles && roles.length === 0) {
    content.appendChild(el('div', { class: 'gk-sv-banner' }, [
      el('span', {}, 'Ainda não há cargos para atribuir. Crie um primeiro.'),
      el('button', {
        class: 'gk-btn gk-btn-primary', type: 'button',
        onclick: () => { activeSection = 'cargos'; newRoleOpen = true; renderNav(); renderSection(); },
      }, [icon('plus', { size: 14 }), ' Criar cargo']),
    ]));
  }

  const list = el('div', { class: 'gk-sv-card gk-sv-members' });
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

    if (isTimedOut(m)) {
      nameLine.appendChild(el('span', {
        class: 'gk-timeout-chip', title: `Em castigo — falta ${formatLong(getTimeoutUntilMs(m) - Date.now())}`,
      }, [icon('clock', { size: 11 }), ' Castigo']));
    }

    const actions = [];
    if (iCanManageRoles && roles.length > 0) {
      actions.push(el('button', {
        class: 'gk-sv-pill', type: 'button', title: 'Atribuir ou remover cargos deste membro',
        onclick: (e) => { e.stopPropagation(); openAssignRolesPopover(serverId, m, roles); },
      }, [icon('shield', { size: 13 }), ' Cargos']));
    }
    if (iOwn && role !== 'owner' && m.uid !== myUid) {
      actions.push(iconBtn(role === 'admin' ? 'starFilled' : 'starOutline',
        role === 'admin' ? 'Remover cargo de admin' : 'Tornar admin',
        () => setMemberRole(serverId, m.uid, role === 'admin' ? 'member' : 'admin')));
    }
    if (canModerateTarget(serverId, m)) {
      actions.push(el('button', {
        class: 'gk-sv-pill', type: 'button', title: 'Castigo, expulsar ou banir',
        onclick: (e) => { e.stopPropagation(); openModerateModal(serverId, m); },
      }, [icon('block', { size: 13 }), ' Moderar']));
    }

    list.appendChild(el('div', { class: 'gk-sv-member', onclick: () => openProfileCard(m.uid) }, [
      el('div', { class: 'gk-avatar gk-sz-32', 'data-status': effectiveStatus(m.user) }, [el('img', { src: m.user.avatarUrl || fallbackAvatar(m.user.username) })]),
      el('div', { class: 'gk-sv-member-main' }, [nameLine]),
      el('div', { class: 'gk-sv-member-actions' }, actions),
    ]));
  }
  content.appendChild(list);

  if (!iOwn) {
    content.appendChild(el('div', { class: 'gk-settings-card gk-danger-zone' }, [
      el('div', { class: 'gk-settings-card-title' }, 'Sair do servidor'),
      el('button', {
        class: 'gk-btn gk-btn-danger', type: 'button',
        onclick: () => confirmDangerAction('Sair do servidor', `Sair de "${server.name}"? Você pode entrar de novo com um convite.`, async () => { await leaveServer(serverId); closeServerSettingsModal(); location.reload(); }, { confirmLabel: 'Sair do servidor', iconName: 'power' }),
      }, 'Sair do servidor'),
    ]));
  }
}

// ============================================================
// Seção: Moderação (banidos + log de auditoria)
// ============================================================
function fmtDateTime(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : 0;
  if (!ms) return '';
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderModeracaoSection(content) {
  const serverId = currentServerId;
  content.appendChild(sectionHeader('Moderação', 'Quem está banido e o histórico das ações de quem modera o servidor.'));
  const stillHere = () => content.isConnected && activeSection === 'moderacao' && currentServerId === serverId;

  // ----- Banidos (só quem pode banir enxerga) -----
  if (canKickMembers(serverId)) {
    const bansBody = el('div', { id: 'gk-bans-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);
    content.appendChild(el('div', { class: 'gk-sv-card' }, [
      el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, [icon('block', { size: 14 }), ' Banidos'])]),
      bansBody,
    ]));
    const loadBans = async () => {
      let bans;
      try { bans = await listBans(serverId); }
      catch (err) { if (stillHere()) bansBody.replaceChildren(el('div', { class: 'gk-sv-empty' }, 'Não foi possível carregar os banidos.')); return; }
      if (!stillHere()) return;
      bansBody.innerHTML = '';
      if (!bans.length) { bansBody.appendChild(el('div', { class: 'gk-sv-empty' }, 'Ninguém foi banido deste servidor.')); return; }
      for (const ban of bans) {
        const unbanBtn = el('button', { class: 'gk-sv-pill', type: 'button', 'data-uid': ban.uid }, 'Desbanir');
        unbanBtn.addEventListener('click', async () => {
          unbanBtn.disabled = true;
          try { await unbanMember(serverId, ban); await loadBans(); }
          catch (err) { toast(err.message || 'Não foi possível desbanir.', 'danger'); unbanBtn.disabled = false; }
        });
        bansBody.appendChild(el('div', { class: 'gk-sv-row gk-ban-row' }, [
          el('div', { class: 'gk-avatar gk-sz-24' }, [el('img', { src: ban.avatarUrl || fallbackAvatar(ban.username || 'user') })]),
          el('div', { class: 'gk-ban-main' }, [
            el('b', {}, ban.displayName || ban.username || 'Usuário'),
            el('small', {}, `Banido por ${ban.bannedByName || 'um moderador'}${fmtDateTime(ban.createdAt) ? ' · ' + fmtDateTime(ban.createdAt) : ''}${ban.reason ? ' · ' + ban.reason : ''}`),
          ]),
          unbanBtn,
        ]));
      }
    };
    loadBans();
  }

  // ----- Log de auditoria -----
  const logBody = el('div', { id: 'gk-audit-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);
  const refreshBtn = el('button', { class: 'gk-sv-pill', type: 'button' }, 'Atualizar');
  content.appendChild(el('div', { class: 'gk-sv-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, [icon('edit', { size: 14 }), ' Log de auditoria']), refreshBtn]),
    logBody,
  ]));
  const loadLog = async () => {
    let entries;
    try { entries = await loadAuditLog(serverId, 100); }
    catch (err) { if (stillHere()) logBody.replaceChildren(el('div', { class: 'gk-sv-empty' }, 'Não foi possível carregar o log (as regras do Firestore já foram publicadas?).')); return; }
    if (!stillHere()) return;
    logBody.innerHTML = '';
    if (!entries.length) { logBody.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhuma ação registrada ainda.')); return; }
    for (const e of entries) {
      const d = describeAudit(e);
      logBody.appendChild(el('div', { class: 'gk-sv-row gk-audit-row' }, [
        el('span', { class: 'gk-sv-row-icon' }, [icon(d.icon, { size: 14 })]),
        el('span', { class: 'gk-audit-text' }, d.text),
        el('span', { class: 'gk-audit-time' }, fmtDateTime(e.createdAt)),
      ]));
    }
  };
  refreshBtn.addEventListener('click', loadLog);
  loadLog();
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
const INVITE_EXPIRY = [[1800, '30 minutos'], [3600, '1 hora'], [21600, '6 horas'], [43200, '12 horas'], [86400, '1 dia'], [604800, '7 dias'], [0, 'Nunca expira']];
const INVITE_USES = [[0, 'Sem limite'], [1, '1 uso'], [2, '2 usos'], [5, '5 usos'], [10, '10 usos'], [25, '25 usos'], [50, '50 usos'], [100, '100 usos']];

function copyText(text, okMsg) {
  navigator.clipboard.writeText(text).then(() => toast(okMsg), () => toast('Não consegui copiar.', 'danger'));
}

function renderConvitesSection(content) {
  const serverId = currentServerId;
  const me = auth.currentUser?.uid;
  const manage = canManageServerInfo(serverId);
  content.appendChild(sectionHeader('Convites', 'Gere códigos para outras pessoas entrarem. Defina por quanto tempo valem e quantas vezes podem ser usados.'));
  const stillHere = () => content.isConnected && activeSection === 'convites' && currentServerId === serverId;

  // ----- criar -----
  const expiry = el('select', { class: 'gk-sv-select', id: 'gk-invite-expiry' }, INVITE_EXPIRY.map(([v, l]) => el('option', { value: String(v) }, l)));
  expiry.value = '604800';
  const uses = el('select', { class: 'gk-sv-select', id: 'gk-invite-uses' }, INVITE_USES.map(([v, l]) => el('option', { value: String(v) }, l)));
  const created = el('div', { class: 'gk-invite-created', id: 'gk-invite-created', style: 'display:none;' });
  const createBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', id: 'gk-invite-create' }, [icon('plus', { size: 14 }), ' Criar convite']);

  const listBody = el('div', { id: 'gk-invites-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);

  const loadInvites = async () => {
    let invites;
    try { invites = (await listServerInvites(serverId)).filter((i) => manage || i.createdBy === me); }
    catch (err) { if (stillHere()) listBody.replaceChildren(el('div', { class: 'gk-sv-empty' }, 'Não foi possível carregar os convites.')); return; }
    if (!stillHere()) return;
    listBody.innerHTML = '';
    if (!invites.length) { listBody.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhum convite criado ainda.')); return; }
    const members = state.serverMembersCache.get(serverId);
    for (const inv of invites) {
      const st = inviteStatus(inv);
      const who = members?.get(inv.createdBy);
      const whoName = who ? (who.nickname || who.user?.displayName || who.user?.username) : 'alguém';
      const usesText = `${inv.uses || 0}${inv.maxUses ? '/' + inv.maxUses : ''} ${inv.maxUses === 1 ? 'uso' : 'usos'}`;
      const whenText = st.state === 'expired' ? 'expirado' : st.expiresInMs == null ? 'não expira' : `expira em ${formatLong(st.expiresInMs)}`;
      const actions = [el('button', { class: 'gk-sv-pill', type: 'button', onclick: () => copyText(inv.code, 'Código copiado.') }, 'Copiar')];
      if (inv.createdBy === me || manage) {
        const revoke = el('button', { class: 'gk-sv-pill', type: 'button', 'data-code': inv.code }, 'Revogar');
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try { await revokeInvite(serverId, inv.code); toast('Convite revogado.'); await loadInvites(); }
          catch (err) { toast(err.message || 'Não foi possível revogar.', 'danger'); revoke.disabled = false; }
        });
        actions.push(revoke);
      }
      listBody.appendChild(el('div', { class: 'gk-sv-row gk-invite-row' + (st.state !== 'active' ? ' gk-off' : '') }, [
        el('code', { class: 'gk-invite-code gk-sensitive' }, inv.code),
        el('div', { class: 'gk-invite-meta' }, [
          el('span', {}, `Criado por ${whoName} · ${usesText} · ${whenText}`),
          st.state === 'full' ? el('span', { class: 'gk-status-chip gk-bad' }, 'Esgotado') : null,
          st.state === 'expired' ? el('span', { class: 'gk-status-chip gk-bad' }, 'Expirado') : null,
        ]),
        el('div', { class: 'gk-invite-actions' }, actions),
      ]));
    }
  };

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const code = await createInvite(serverId, { expiresInSeconds: Number(expiry.value) || null, maxUses: Number(uses.value) || null });
      created.style.display = 'flex';
      created.replaceChildren(
        el('span', { class: 'gk-sv-note' }, 'Convite criado:'),
        el('code', { class: 'gk-invite-code gk-sensitive', id: 'gk-invite-new-code' }, code),
        el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => copyText(code, 'Código copiado.') }, 'Copiar'),
      );
      await loadInvites();
    } catch (err) {
      toast(err.message || 'Não foi possível criar o convite.', 'danger');
    } finally { createBtn.disabled = false; }
  });

  content.appendChild(el('div', { class: 'gk-sv-card gk-invite-form' }, [
    el('div', { class: 'gk-invite-fields' }, [
      el('label', {}, [el('span', {}, 'Validade'), expiry]),
      el('label', {}, [el('span', {}, 'Limite de usos'), uses]),
      createBtn,
    ]),
    created,
  ]));

  content.appendChild(el('div', { class: 'gk-sv-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, [icon('link', { size: 14 }), manage ? ' Convites do servidor' : ' Seus convites'])]),
    listBody,
  ]));
  content.appendChild(el('div', { class: 'gk-sv-note' },
    'Validade e limite são conferidos pelo app de quem entra. Quem entra por um convite que já expirou ou esgotou recebe um aviso.'));
  loadInvites();
}

// ============================================================
// Seção: Boas-vindas (mensagem ao entrar + cargo automático)
// ============================================================
function renderBoasVindasSection(content) {
  const serverId = currentServerId;
  const server = state.servers.get(serverId) || {};
  const welcome = server.welcome || {};
  const { channels } = getCategoriesAndChannels();
  const textChannels = channels.filter((c) => c.type === 'text');
  content.appendChild(sectionHeader('Boas-vindas', 'O que acontece quando alguém entra no servidor.'));

  // ----- mensagem -----
  const enabled = el('input', { type: 'checkbox', id: 'gk-welcome-enabled' });
  enabled.checked = !!welcome.enabled;
  const channelSel = el('select', { class: 'gk-sv-select gk-sv-select-wide', id: 'gk-welcome-channel' },
    textChannels.map((c) => el('option', { value: c.id }, `# ${c.name}`)));
  if (welcome.channelId && textChannels.some((c) => c.id === welcome.channelId)) channelSel.value = welcome.channelId;
  channelSel.disabled = textChannels.length === 0;
  const message = el('textarea', { class: 'gk-sv-input gk-sv-textarea', id: 'gk-welcome-message', maxlength: '300', rows: '3', placeholder: DEFAULT_WELCOME });
  message.value = welcome.message || '';
  const preview = el('div', { class: 'gk-welcome-preview', id: 'gk-welcome-preview' });
  const paint = () => {
    const me = state.user || {};
    preview.textContent = '👋 ' + renderWelcomeText(message.value.trim(), { usuario: me.displayName || me.username || 'Fulano', servidor: server.name || 'servidor' });
  };
  message.addEventListener('input', paint);
  paint();

  content.appendChild(el('div', { class: 'gk-sv-card gk-welcome-card' }, [
    el('label', { class: 'gk-nsfw-option' }, [enabled, el('span', {}, [
      el('strong', {}, 'Enviar mensagem de boas-vindas'),
      el('small', {}, 'Quando alguém entrar, aparece um aviso no canal escolhido.'),
    ])]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Canal'), channelSel]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Mensagem'), message,
      el('div', { class: 'gk-hint' }, 'Use {usuario} para o nome de quem entrou e {servidor} para o nome do servidor. Vazio = mensagem padrão.')]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Prévia'), preview]),
  ]));

  // ----- cargo automático -----
  const cosmetic = getRoles().filter((r) => !Object.values(r.permissions || {}).some(Boolean));
  const withPerms = getRoles().length - cosmetic.length;
  const roleSel = el('select', { class: 'gk-sv-select gk-sv-select-wide', id: 'gk-welcome-role' }, [
    el('option', { value: '' }, 'Nenhum'),
    ...cosmetic.map((r) => el('option', { value: r.id }, r.name)),
  ]);
  roleSel.value = cosmetic.some((r) => r.id === server.autoRoleId) ? server.autoRoleId : '';
  content.appendChild(el('div', { class: 'gk-sv-card gk-welcome-card' }, [
    el('div', { class: 'gk-field' }, [el('label', {}, 'Cargo automático'), roleSel,
      el('div', { class: 'gk-hint' }, 'Quem entrar já recebe este cargo. Só aparecem cargos sem permissões (como etiqueta/cor)'
        + (withPerms ? ` — ${withPerms} ${withPerms === 1 ? 'cargo com permissões fica' : 'cargos com permissões ficam'} de fora, para ninguém entrar com poderes.` : '.'))]),
  ]));

  const saveBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', id: 'gk-welcome-save' }, 'Salvar');
  saveBtn.addEventListener('click', async () => {
    if (enabled.checked && !channelSel.value) { toast('Escolha o canal das boas-vindas.', 'danger'); return; }
    saveBtn.disabled = true;
    try {
      await saveWelcomeSettings(serverId, { enabled: enabled.checked, channelId: channelSel.value, message: message.value, autoRoleId: roleSel.value });
      toast('Boas-vindas salvas.');
    } catch (err) {
      toast('Não foi possível salvar: ' + (err.message || err), 'danger');
    } finally { saveBtn.disabled = false; }
  });
  content.appendChild(el('div', { class: 'gk-sv-role-footer' }, [saveBtn]));
}

// ============================================================
// Confirmação para ações destrutivas — reaproveita o modal genérico.
// ============================================================
