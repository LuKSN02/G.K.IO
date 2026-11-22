// ============================================================
// G.K.IO — Menu de clique direito (servidores e conversas diretas)
// Um único componente + um ouvinte global; os itens reaproveitam as
// funções que o app já tem (nada de lógica nova de dados aqui).
// No celular abre com toque longo.
// ============================================================
import { state, toast } from './state.js';
import { auth, getDocs, query, channelsCol, categoriesCol } from './db.js';
import { icon } from './icons.js';
import { effectiveLevel, setLevel, closeDm } from './notify-prefs.js';
import { markConversationRead } from './unread.js';
import { confirmDialog } from './dialogs.js';
import { openProfileCard } from './profile.js';
import { isBlocked, toggleBlock } from './blocks.js';
import { openInviteFriendsModal, sendServerInvite } from './server-invite.js';
import { openServerSettingsModal } from './server-settings.js';
import { openEventsModal } from './server-extras.js';
import { openStatsModal, openReactionRolesModal, canConfigReactionRoles } from './server-tools.js';
import { addReminder, openTimersList } from './reminders.js';
import { translateMessage } from './translate.js';
import { saveMessage, openSavedModal } from './saved-messages.js';
import { openLeaderboard } from './xp.js';
import { exportConversation } from './export-chat.js';
import { TTL_OPTIONS, setDmTtl, dmTtl } from './ephemeral.js';
import { userMenuItems } from './user-menu.js';
import { openGroupInfoModal } from './groups.js';
import { openSheet, isMobileView } from './sheet.js';
import { startDmCall } from './calls.js';
import { toggleReaction, getLoadedMessages } from './chat.js';
import { openDmFromState, removeFriend, goToDmsView } from './dms.js';
import {
  leaveServer, isServerOwner, canManageChannels, openCreateChannelModal, openCreateCategoryModal, createCategory, selectServer,
} from './servers.js';

let menuEl = null;

export function closeContextMenu() { if (menuEl?._close) menuEl._close(); else menuEl?.remove(); menuEl = null; }

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(String(text)); toast(okMsg); }
  catch { toast('Não foi possível copiar.', 'danger'); }
}

/** items: { label, hint, icon, danger, disabled, checked(bool|undefined), onClick, submenu:[...] } | { sep:true } */
function buildList(items, level = 0) {
  const list = document.createElement('div');
  list.className = 'gk-cm' + (level ? ' gk-cm-sub' : '');
  list.setAttribute('role', 'menu');
  for (const it of items.filter(Boolean)) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'gk-cm-sep'; list.appendChild(s); continue; }
    if (it.emojis) {
      const strip = document.createElement('div'); strip.className = 'gk-cm-emojis';
      for (const em of it.emojis) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gk-cm-emoji'; b.textContent = em;
        b.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); it.onPick(em); });
        strip.appendChild(b);
      }
      list.appendChild(strip); continue;
    }
    if (it.slider) {
      const box = document.createElement('div'); box.className = 'gk-cm-slider';
      const lab = document.createElement('div'); lab.className = 'gk-cm-slider-label'; lab.textContent = it.slider.label;
      const r = document.createElement('input'); r.type = 'range'; r.min = String(it.slider.min); r.max = String(it.slider.max); r.step = '5'; r.value = String(it.slider.value);
      const val = document.createElement('span'); val.className = 'gk-cm-slider-val'; val.textContent = r.value + '%';
      r.addEventListener('input', () => { val.textContent = r.value + '%'; it.slider.onInput(Number(r.value)); });
      r.addEventListener('click', (e) => e.stopPropagation());
      const top = document.createElement('div'); top.className = 'gk-cm-slider-top'; top.append(lab, val);
      box.append(top, r); list.appendChild(box); continue;
    }
    const row = document.createElement('div');
    row.className = 'gk-cm-item' + (it.danger ? ' gk-danger' : '') + (it.disabled ? ' gk-disabled' : '');
    row.setAttribute('role', 'menuitem');
    const main = document.createElement('div'); main.className = 'gk-cm-main';
    const label = document.createElement('span'); label.className = 'gk-cm-label'; label.textContent = it.label;
    main.appendChild(label);
    if (it.hint) { const h = document.createElement('span'); h.className = 'gk-cm-hint'; h.textContent = it.hint; main.appendChild(h); }
    row.appendChild(main);
    if (it.checked !== undefined) {
      const c = document.createElement('span'); c.className = 'gk-cm-check' + (it.checked ? ' gk-on' : '');
      if (it.checked) c.appendChild(icon('check', { size: 12 }));
      row.appendChild(c);
    }
    if (it.submenu) {
      const ch = document.createElement('span'); ch.className = 'gk-cm-chev'; ch.appendChild(icon('chevronDown', { size: 14 })); row.appendChild(ch);
      let sub = null;
      const open = () => {
        if (sub) return;
        sub = buildList(it.submenu, level + 1);
        document.body.appendChild(sub);
        const r = row.getBoundingClientRect(); const w = sub.offsetWidth; const h = sub.offsetHeight;
        let left = r.right + 4; if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 4);
        sub.style.left = left + 'px'; sub.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - h - 8)) + 'px';
        sub._owner = list;
      };
      const shut = () => { sub?.remove(); sub = null; };
      row.addEventListener('mouseenter', open);
      row.addEventListener('click', (e) => { e.stopPropagation(); sub ? shut() : open(); });
      list.addEventListener('mouseleave', (e) => { if (!sub || !sub.contains(e.relatedTarget)) shut(); });
      list._shut = shut;
      row.addEventListener('mouseleave', (e) => { if (sub && !sub.contains(e.relatedTarget) && !list.contains(e.relatedTarget)) shut(); });
    } else if (!it.disabled) {
      row.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); Promise.resolve(it.onClick?.()).catch((err) => toast(err?.message || 'Algo deu errado.', 'danger')); });
    }
    list.appendChild(row);
  }
  return list;
}

function openMenu(x, y, items) {
  closeContextMenu();
  if (isMobileView()) {
    // Celular: folha inferior (estilo Discord) em vez de um menu flutuante
    const sh = openSheet(items, { onDone: () => { if (menuEl === sh.layer) menuEl = null; } });
    menuEl = sh.layer;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'gk-cm-layer';
  const list = buildList(items);
  wrap.appendChild(list);
  document.body.appendChild(wrap);
  menuEl = wrap;
  const w = list.offsetWidth, h = list.offsetHeight;
  list.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  list.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  // submenus são filhos do body: removemos junto com a camada
  const obs = new MutationObserver(() => { if (!wrap.isConnected) { document.querySelectorAll('.gk-cm-sub').forEach((n) => n.remove()); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

// ---------- Servidor ----------
function serverItems(serverId) {
  const sv = state.servers.get(serverId); if (!sv) return null;
  const level = effectiveLevel({ serverId });
  const isCurrent = state.currentServerId === serverId;
  const canManage = (() => { try { return isCurrent && canManageChannels(serverId); } catch { return false; } })();
  const setSv = async (v) => { await setLevel('servers', serverId, v); };
  const levels = [['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Nada']];
  return [
    { label: 'Marcar como lida', onClick: async () => {
      const snap = await getDocs(query(channelsCol(serverId)));
      await Promise.all(snap.docs.filter((d) => d.data().type !== 'voice').map((d) => markConversationRead(d.id)));
      toast('Servidor marcado como lido.');
    } },
    { sep: true },
    { label: 'Convidar para o servidor', onClick: () => openInviteFriendsModal(serverId) },
    { label: 'Ranking de atividade', onClick: () => openLeaderboard(serverId) },
    { sep: true },
    { label: level === 'none' ? 'Reativar notificações' : 'Silenciar servidor', onClick: () => setSv(level === 'none' ? 'all' : 'none') },
    { label: 'Config. de notificação', hint: levels.find((l) => l[0] === level)?.[1], submenu: levels.map(([v, t]) => ({ label: t, checked: level === v, onClick: () => setSv(v) })) },
    { sep: true },
    { label: 'Config. do servidor', onClick: () => openServerSettingsModal(serverId) },
    canManage ? { sep: true } : null,
    canManage ? { label: 'Criar canal', onClick: async () => {
      const snap = await getDocs(query(categoriesCol(serverId)));
      const cats = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.position || 0) - (b.position || 0));
      openCreateChannelModal(serverId, cats);
    } } : null,
    canManage ? { label: 'Criar categoria', onClick: async () => {
      openCreateCategoryModal(serverId);
    } } : null,
    { label: 'Eventos do servidor', onClick: () => openEventsModal(serverId) },
    { label: 'Estatísticas do servidor', onClick: () => openStatsModal(serverId) },
    { sep: true },
    { label: 'Abrir servidor', disabled: isCurrent && state.currentView === 'server', onClick: () => selectServer(serverId) },
    { label: 'Copiar ID do servidor', onClick: () => copy(serverId, 'ID copiado.') },
    isServerOwner(serverId) ? null : { sep: true },
    isServerOwner(serverId) ? null : { label: 'Sair do servidor', danger: true, onClick: () => confirmDialog({
      title: 'Sair do servidor', message: `Tem certeza que quer sair de "${sv.name || 'Servidor'}"?`, confirmLabel: 'Sair',
      onConfirm: async () => { await leaveServer(serverId); },
    }) },
  ];
}

// ---------- Conversa direta ----------
function dmItems(dmId) {
  const dm = state.dms.get(dmId); if (!dm) return null;
  const level = effectiveLevel({ dmId });
  const name = dm.other?.displayName || dm.other?.username || 'conversa';
  const closeItem = { label: 'Fechar conversa', hint: 'Some da lista até chegar mensagem nova', onClick: async () => {
    await closeDm(dmId);
    if (state.currentDmId === dmId) goToDmsView();
    toast('Conversa fechada.');
  } };
  const common = [
    { label: 'Marcar como lida', onClick: () => markConversationRead(dmId) },
    { label: 'Exportar conversa (.txt)', onClick: () => exportConversation({ dmId, title: name }) },
    dm.isGroup ? null : { label: 'Mensagens temporárias', submenu: TTL_OPTIONS.map(([t, s]) => ({ label: t, checked: dmTtl(dmId) === s, onClick: () => setDmTtl(dmId, s) })) },
    { sep: true },
  ];
  if (dm.isGroup) {
    return [...common,
      { label: 'Informações do grupo', onClick: () => openGroupInfoModal(dmId) },
      closeItem,
      { label: level === 'none' ? 'Reativar notificações' : 'Silenciar grupo', onClick: () => setLevel('dms', dmId, level === 'none' ? 'all' : 'none') },
      { sep: true },
      { label: 'Copiar ID do grupo', onClick: () => copy(dmId, 'ID copiado.') },
    ];
  }
  const uid = dm.other?.uid;
  const call = async (video) => {
    openDmFromState(dm);
    await new Promise((r) => setTimeout(r, 120));
    return startDmCall(video);
  };
  const servers = [...state.servers.values()];
  return [...common,
    { label: 'Perfil', onClick: () => openProfileCard(uid) },
    closeItem,
    { label: 'Iniciar chamada', onClick: () => call(false) },
    { label: 'Iniciar chamada de vídeo', onClick: () => call(true) },
    { sep: true },
    { label: 'Convidar para o servidor', disabled: !servers.length, submenu: servers.map((s) => ({ label: s.name || 'Servidor', onClick: async () => { await sendServerInvite(s.id, uid); toast(`Convite enviado para ${name}.`); } })) },
    { label: level === 'none' ? `Reativar @${dm.other.username || name}` : `Silenciar @${dm.other.username || name}`, onClick: () => setLevel('dms', dmId, level === 'none' ? 'all' : 'none') },
    { sep: true },
    state.friends.has(uid) ? { label: 'Desfazer amizade', onClick: () => confirmDialog({
      title: 'Desfazer amizade', message: `Remover "${name}" da sua lista de amigos?`, confirmLabel: 'Desfazer',
      onConfirm: async () => { await removeFriend(uid); toast('Amizade desfeita.'); },
    }) } : null,
    { label: isBlocked(uid) ? 'Desbloquear' : 'Bloquear', danger: !isBlocked(uid), onClick: () => toggleBlock(uid) },
    { sep: true },
    { label: 'Copiar ID do usuário', onClick: () => copy(uid, 'ID copiado.') },
  ];
}

// ---------- Mensagem ----------
const MSG_ORDER = ['Responder', 'Abrir tópico', 'Copiar texto', 'Fixar mensagem', 'Desafixar mensagem', 'Encaminhar mensagem', 'Marcar como não lida', 'Editar mensagem'];
const MSG_LABEL = { 'Reagir': 'Adicionar reação', 'Fixar mensagem': 'Fixar mensagem', 'Marcar como não lida': 'Marcar como não lida', 'Apagar mensagem (moderação)': 'Apagar mensagem' };
function messageItems(row) {
  const btns = [...row.querySelectorAll('.gk-msg-actions > .gk-msg-action-btn')].filter((b) => !b.classList.contains('gk-msg-action-more'));
  if (!btns.length) return null;
  const msg = getLoadedMessages().find((x) => x.id === row.dataset.msgId);
  const byTitle = new Map(btns.map((b) => [b.title, b]));
  const mk = (b, danger) => ({ label: MSG_LABEL[b.title] || b.title, danger, onClick: () => b.click() });
  const items = [];
  if (msg) items.push({ emojis: ['❤️', '🔥', '😂', '👍', '💯', '😮'], onPick: (em) => toggleReaction(msg, 'native:' + em) });
  const react = byTitle.get('Reagir');
  if (react) items.push({ label: 'Adicionar reação…', onClick: () => react.click() });
  const used = new Set(['Reagir']);
  const main = [];
  for (const t of MSG_ORDER) { const b = byTitle.get(t); if (b) { main.push(mk(b)); used.add(t); } }
  for (const b of btns) if (!used.has(b.title) && !b.classList.contains('gk-msg-action-danger')) { main.push(mk(b)); used.add(b.title); }
  if (main.length) items.push({ sep: true }, ...main);
  const danger = btns.filter((b) => b.classList.contains('gk-msg-action-danger'));
  if (danger.length) items.push({ sep: true }, ...danger.map((b) => mk(b, true)));
  if (msg?.id) {
    const H = 3600e3;
    items.push({ sep: true }, { label: 'Salvar mensagem', onClick: () => saveMessage(msg) }, { label: 'Mensagens salvas…', onClick: openSavedModal });
    if (msg.content) items.push({ label: 'Traduzir', onClick: () => translateMessage(msg) });
    items.push({ sep: true }, { label: 'Lembrar-me disso', submenu: [['Em 20 minutos', 20 * 60e3], ['Em 1 hora', H], ['Em 3 horas', 3 * H], ['Amanhã', 24 * H]].map(([t, ms]) => ({ label: t, onClick: () => addReminder(msg, ms) })).concat([{ label: 'Ver lembretes e agendadas', onClick: openTimersList }]) });
    if (state.currentServerId && state.currentChannelId && canConfigReactionRoles(state.currentServerId)) items.push({ label: 'Cargos por reação…', onClick: () => openReactionRolesModal(msg, toggleReaction) });
  }
  if (msg?.id) items.push({ sep: true }, { label: 'Copiar ID da mensagem', onClick: () => copy(msg.id, 'ID copiado.') });
  return items;
}

// ---------- Canal ----------
function channelItems(serverId, chId, type) {
  const sv = state.servers.get(serverId); if (!sv) return null;
  const canManage = (() => { try { return canManageChannels(serverId); } catch { return false; } })();
  const isText = type === 'text';
  const lvl = effectiveLevel({ serverId, channelId: chId });
  const levels = [['default', 'Padrão do servidor'], ['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Nada']];
  const set = (v) => setLevel('channels', chId, v);
  return [
    isText ? { label: 'Marcar como lida', onClick: () => markConversationRead(chId) } : null,
    isText ? { sep: true } : null,
    isText ? { label: lvl === 'none' ? 'Reativar canal' : 'Silenciar canal', onClick: () => set(lvl === 'none' ? 'default' : 'none') } : null,
    isText ? { label: 'Config. de notificação', submenu: levels.map(([v, t]) => ({ label: t, checked: lvl === v || (v === 'default' && lvl !== 'all' && lvl !== 'mentions' && lvl !== 'none'), onClick: () => set(v) })) } : null,
    isText ? { sep: true } : null,
    isText ? { label: 'Exportar conversa (.txt)', onClick: () => exportConversation({ serverId, channelId: chId, title: state.servers.get(serverId)?.name + '-canal' }) } : null,
    canManage ? { label: 'Editar canal', onClick: () => openServerSettingsModal(serverId) } : null,
    { label: 'Copiar ID do canal', onClick: () => copy(chId, 'ID copiado.') },
  ];
}

function itemsFor(target) {
  const chRow = target.closest('.gk-channel[data-channel-id]');
  if (chRow) return channelItems(chRow.dataset.chServer, chRow.dataset.channelId, chRow.dataset.chType);
  // Pessoa dentro de um servidor: lista de membros, avatar ou nome nas mensagens
  if (state.currentServerId && state.currentView === 'server') {
    const who = target.closest('.gk-member-row[data-member-uid]')?.dataset.memberUid || target.closest('.gk-avatar[data-author], .gk-author[data-author]')?.dataset.author;
    if (who) { const items = userMenuItems(state.currentServerId, who); if (items) return items; }
  }
  const msgRow = target.closest('.gk-msg-row[data-msg-id]');
  if (msgRow && !target.closest('a[href], .gk-msg-image-zoomable, video, audio')) return messageItems(msgRow);
  const dmRow = target.closest('.gk-dm-row[data-id]');
  if (dmRow) return dmItems(dmRow.dataset.id);
  const svRow = target.closest('[data-server-id]');
  if (svRow) return serverItems(svRow.dataset.serverId);
  if (target.closest('.gk-sidebar-header.gk-on-server') && state.currentServerId) return serverItems(state.currentServerId);
  return null;
}

function handle(e, x, y) {
  if (e.target.closest('input, textarea, [contenteditable="true"]')) return false;
  const items = itemsFor(e.target);
  if (!items) return false;
  e.preventDefault();
  openMenu(x, y, items);
  return true;
}

document.addEventListener('contextmenu', (e) => { handle(e, e.clientX, e.clientY); });
document.addEventListener('pointerdown', (e) => { if (menuEl && !e.target.closest('.gk-cm')) closeContextMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
window.addEventListener('resize', closeContextMenu);
window.addEventListener('blur', closeContextMenu);
document.addEventListener('scroll', (e) => { if (menuEl && !e.target.closest?.('.gk-cm')) closeContextMenu(); }, true);

// toque longo (celular)
let lp = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0]; if (!t || e.touches.length > 1) return;
  const tgt = e.target;
  clearTimeout(lp);
  lp = setTimeout(() => {
    const items = itemsFor(tgt);
    if (items) { navigator.vibrate?.(12); openMenu(t.clientX, t.clientY, items); }
  }, 520);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((ev) => document.addEventListener(ev, () => clearTimeout(lp), { passive: true }));

// ---------- Deslizar a mensagem para responder (celular) ----------
(() => {
  let row = null, x0 = 0, y0 = 0, dx = 0, locked = null;
  const reset = () => { if (row) { row.style.transition = 'transform .2s ease'; row.style.transform = ''; row.classList.remove('gk-swipe-ready'); const r = row; setTimeout(() => { r.style.transition = ''; }, 220); } row = null; };
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const r = e.target.closest('.gk-msg-row[data-msg-id]');
    if (!r || e.target.closest('input, textarea, button, a, video, audio')) return;
    row = r; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; locked = null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!row) return;
    const t = e.touches[0]; const mx = t.clientX - x0; const my = t.clientY - y0;
    if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) * 1.4 && mx < 0 ? 'x' : 'y';
    if (locked !== 'x') { if (locked === 'y') row = null; return; }
    dx = Math.max(-84, mx);
    row.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('gk-swipe-ready', dx <= -64);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (row && dx <= -64) {
      const btn = [...row.querySelectorAll('.gk-msg-actions > .gk-msg-action-btn')].find((b) => b.title === 'Responder');
      if (btn) { navigator.vibrate?.(10); btn.click(); }
    }
    reset();
  }, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
})();
