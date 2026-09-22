// ============================================================
// G.K.IO — Topbar global (busca rápida, notificações, atalhos, perfil)
// ============================================================
// A "busca" aqui é um filtro rápido sobre o que o app já tem carregado
// (amigos, DMs abertas, servidores) — não é uma busca de texto dentro
// do histórico de mensagens, que exigiria um índice de busca de verdade
// (Algolia ou similar) e é um projeto à parte.
// ============================================================
import { state, el, fallbackAvatar, effectiveStatus } from './state.js';
import { icon } from './icons.js';
import { resolvedMode, setThemeMode } from './theme.js';
import { openAddFriendModal, goToDmsView, openDmById, acceptFriendRequest, declineFriendRequest } from './dms.js';
import { selectServer } from './servers.js';

export function wireGlobalTopbar() {
  document.getElementById('gk-topbar-theme-btn').addEventListener('click', () => {
    setThemeMode(resolvedMode() === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('gk-topbar-add-friend-btn').addEventListener('click', openAddFriendModal);
  wireProfileMenu();
  wireNotifBell();
  wireGlobalSearch();
}

// ---------- Menu suspenso do perfil (status / configurações / sair) ----------
// Substituiu a barra inferior da sidebar, que duplicava exatamente essas
// mesmas ações — agora moram só aqui, junto do chip de perfil no topo.
function wireProfileMenu() {
  const chip = document.getElementById('gk-topbar-profile-chip');
  const menu = document.getElementById('gk-profile-menu');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('gk-notif-panel').classList.remove('gk-open'); // só um popover aberto por vez
    menu.classList.toggle('gk-open');
  });
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('gk-open') && !menu.contains(e.target) && !chip.contains(e.target)) {
      menu.classList.remove('gk-open');
    }
  });
}
export function closeProfileMenu() {
  document.getElementById('gk-profile-menu')?.classList.remove('gk-open');
}

// ---------- Chip de perfil no topo ----------
// Espelha o mesmo estado que refreshMiniProfile() (profile.js) já
// mantém — chamado de lá também, pra nunca ficar dessincronizado.
export function refreshTopbarProfile() {
  if (!state.user) return;
  document.getElementById('gk-topbar-profile-avatar').src = state.user.avatarUrl || fallbackAvatar(state.user.username);
  document.getElementById('gk-topbar-profile-avatar-wrap').setAttribute('data-status', state.user.statusPresence || 'online');
  document.getElementById('gk-topbar-profile-avatar-wrap').setAttribute('data-frame', state.user.frameStyle || 'none');
  document.getElementById('gk-topbar-profile-name').textContent = state.user.displayName || state.user.username;
  document.getElementById('gk-topbar-profile-status').textContent = statusLabelShort(state.user.statusPresence);
  document.getElementById('gk-topbar-profile-dot').setAttribute('data-status', state.user.statusPresence || 'online');
  const current = state.user.statusPresence || 'online';
  for (const id of ['online', 'idle', 'dnd']) {
    document.getElementById(`gk-status-${id}`)?.classList.toggle('gk-active', id === current);
  }
}
function statusLabelShort(s) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[s] || 'Online';
}

// ---------- Sino de notificações (pedidos de amizade pendentes) ----------
function wireNotifBell() {
  const btn = document.getElementById('gk-notif-btn');
  const panel = document.getElementById('gk-notif-panel');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('gk-open')) { panel.classList.remove('gk-open'); return; }
    renderNotifPanel();
    panel.classList.add('gk-open');
  });
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('gk-open') && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      panel.classList.remove('gk-open');
    }
  });
}

// Chamado pelo mesmo lugar que já atualiza o badge da rail (refreshPendingBadge
// em dms.js), pra manter a bolinha vermelha do sino em sincronia.
export function refreshNotifDot() {
  const dot = document.getElementById('gk-notif-dot');
  if (!dot) return;
  const count = (state.incomingFriendRequests || []).length;
  dot.style.display = count > 0 ? 'block' : 'none';
  const panel = document.getElementById('gk-notif-panel');
  if (panel && panel.classList.contains('gk-open')) renderNotifPanel();
}

function renderNotifPanel() {
  const panel = document.getElementById('gk-notif-panel');
  panel.innerHTML = '';
  const requests = state.incomingFriendRequests || [];
  if (!requests.length) {
    panel.appendChild(el('div', { class: 'gk-notif-row-sub', style: 'padding:16px 8px; text-align:center;' }, 'Nenhuma notificação nova.'));
    return;
  }
  panel.appendChild(el('div', { class: 'gk-notif-panel-title' }, 'Pedidos de amizade'));
  for (const req of requests) {
    panel.appendChild(el('div', { class: 'gk-notif-row' }, [
      el('div', { class: 'gk-avatar gk-sz-32' }, [el('img', { src: req.avatarUrl || fallbackAvatar(req.displayName || req.username) })]),
      el('div', {}, [
        el('div', { class: 'gk-notif-row-name' }, req.displayName || req.username),
        el('div', { class: 'gk-notif-row-sub' }, 'Quer ser seu amigo'),
      ]),
      el('div', { class: 'gk-notif-row-actions' }, [
        el('button', { class: 'gk-friend-action-btn gk-friend-action-accept', title: 'Aceitar', onclick: () => { acceptFriendRequest(req.friendshipId); renderNotifPanel(); } }, [icon('check', { size: 14 })]),
        el('button', { class: 'gk-friend-action-btn gk-friend-action-decline', title: 'Recusar', onclick: () => { declineFriendRequest(req.friendshipId); renderNotifPanel(); } }, [icon('close', { size: 14 })]),
      ]),
    ]));
  }
}

// ---------- Busca rápida ----------
function wireGlobalSearch() {
  const input = document.getElementById('gk-global-search');
  const results = document.getElementById('gk-global-search-results');
  input.addEventListener('input', () => renderSearchResults(input.value.trim()));
  input.addEventListener('focus', () => { if (input.value.trim()) renderSearchResults(input.value.trim()); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.gk-topbar-global-search-wrap')) results.classList.remove('gk-open');
  });
}

function renderSearchResults(term) {
  const results = document.getElementById('gk-global-search-results');
  if (!term) { results.classList.remove('gk-open'); results.innerHTML = ''; return; }
  const q = term.toLowerCase();
  results.innerHTML = '';

  const friends = [...state.friends.values()].filter((f) => (f.displayName || f.username || '').toLowerCase().includes(q));
  const servers = [...state.servers.values()].filter((s) => (s.name || '').toLowerCase().includes(q));

  if (!friends.length && !servers.length) {
    results.appendChild(el('div', { class: 'gk-global-search-empty' }, `Nada encontrado pra "${term}".`));
    results.classList.add('gk-open');
    return;
  }

  if (friends.length) {
    results.appendChild(el('div', { class: 'gk-global-search-group-label' }, 'Amigos'));
    for (const f of friends.slice(0, 6)) {
      results.appendChild(el('div', {
        class: 'gk-global-search-row',
        onclick: () => {
          const dm = [...state.dms.values()].find((d) => d.other?.uid === f.uid);
          goToDmsView();
          if (dm) openDmById(dm.id);
          closeSearch();
        },
      }, [
        el('div', { class: 'gk-avatar gk-sz-32', 'data-status': effectiveStatus(f) }, [el('img', { src: f.avatarUrl || fallbackAvatar(f.username) })]),
        el('span', { class: 'gk-global-search-row-name' }, f.displayName || f.username),
      ]));
    }
  }
  if (servers.length) {
    results.appendChild(el('div', { class: 'gk-global-search-group-label' }, 'Servidores'));
    for (const s of servers.slice(0, 6)) {
      results.appendChild(el('div', {
        class: 'gk-global-search-row',
        onclick: () => { selectServer(s.id); closeSearch(); },
      }, [
        el('div', { class: 'gk-avatar gk-sz-32' }, [
          s.iconUrl ? el('img', { src: s.iconUrl }) : el('div', { class: 'gk-server-picker-fallback' }, (s.name || '?').slice(0, 2).toUpperCase()),
        ]),
        el('span', { class: 'gk-global-search-row-name' }, s.name),
      ]));
    }
  }
  results.classList.add('gk-open');
}

function closeSearch() {
  document.getElementById('gk-global-search').value = '';
  document.getElementById('gk-global-search-results').classList.remove('gk-open');
}
