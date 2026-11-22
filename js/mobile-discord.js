// ============================================================
// G.K.IO — Layout de celular no estilo do Discord (≤ 900px)
//  · #gk-mrail   → faixa lateral: Mensagens, servidores, criar servidor e Comunidades
//  · #gk-m-sub   → linha de ações sob o título da lista (buscar / adicionar amigos / convidar…)
//  · #gk-muser   → barra de usuário flutuante embaixo (avatar, nome, status e sino)
//  · "⋯" no chat → pins, notificações e vídeo (que não cabem no cabeçalho estreito)
//  · caixa de texto em "pílula" (o CSS está em css/mobile.css)
// Nada disso aparece em telas grandes. Os botões antigos continuam existindo (ficam escondidos)
// e são acionados por .click(), então a lógica do app não muda.
// ============================================================
import { state, el, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { selectServer, openCreateServerModal } from './servers.js';
import { openCreateGroupModal } from './groups.js';
import { openFriendsPage } from './mobile-nav.js';

const MQ = window.matchMedia('(max-width: 900px)');
const $ = (id) => document.getElementById(id);
const click = (id) => $(id)?.click();
const initials = (n) => (n || '?').slice(0, 2).toUpperCase();

let railSig = '';
let userSig = '';

// ---------------- Faixa de servidores ----------------
function paintRail() {
  const rail = $('gk-mrail'); if (!rail) return;
  const badge = $('gk-dm-rail-badge')?.textContent?.trim() || '';
  const servers = [...state.servers.values()];
  const sig = [state.currentView, state.currentServerId, badge, servers.map((s) => `${s.id}:${s.iconUrl || ''}:${s.name || ''}`).join(',')].join('|');
  if (sig === railSig) return; railSig = sig;
  rail.replaceChildren();
  const dmActive = state.currentView === 'dms' || state.currentView === 'server-picker';
  rail.appendChild(el('button', { class: 'gk-mrail-btn gk-mrail-dm' + (dmActive ? ' gk-active' : ''), type: 'button', 'aria-label': 'Mensagens', onclick: () => click('gk-dm-rail-item') }, [
    icon('chatBubble', { size: 24 }), badge && badge !== '0' ? el('span', { class: 'gk-mrail-badge' }, badge) : null,
  ]));
  rail.appendChild(el('div', { class: 'gk-mrail-sep' }));
  for (const s of servers) {
    const on = state.currentView === 'server' && state.currentServerId === s.id;
    rail.appendChild(el('button', { class: 'gk-mrail-btn gk-mrail-srv' + (on ? ' gk-active' : ''), type: 'button', title: s.name || 'Servidor', 'aria-label': s.name || 'Servidor', 'data-server-id': s.id, onclick: () => selectServer(s.id) }, [
      s.iconUrl ? el('img', { src: s.iconUrl, alt: '' }) : el('span', {}, initials(s.name)),
    ]));
  }
  rail.appendChild(el('button', { class: 'gk-mrail-btn gk-mrail-add', type: 'button', 'aria-label': 'Criar servidor', onclick: () => openCreateServerModal() }, [icon('plus', { size: 22 })]));
  rail.appendChild(el('button', { class: 'gk-mrail-btn gk-mrail-explore', type: 'button', 'aria-label': 'Comunidades', onclick: () => click('gk-nav-communities') }, [icon('tray', { size: 22 })]));
}

// ---------------- Barra de usuário ----------------
function userSheet() {
  const set = (id) => () => click(id);
  openSheet([
    { label: 'Amigos', icon: 'members', onClick: () => { click('gk-dm-rail-item'); setTimeout(openFriendsPage, 50); } },
    { label: 'Início', icon: 'sparkles', onClick: set('gk-nav-home') },
    { label: 'Arquivos', icon: 'attach', onClick: set('gk-nav-files') },
    { label: 'Comunidades', icon: 'tray', onClick: set('gk-nav-communities') },
    { sep: true },
    { label: 'Online', icon: 'dot', onClick: set('gk-status-online') },
    { label: 'Ausente', icon: 'moon', onClick: set('gk-status-idle') },
    { label: 'Não perturbe', icon: 'bellOff', onClick: set('gk-status-dnd') },
    { sep: true },
    { label: 'Configurações', icon: 'settings', onClick: set('gk-nav-settings') },
    { label: 'Sair', icon: 'power', danger: true, onClick: set('gk-logout-btn') },
  ], { title: state.user?.displayName || state.user?.username || 'Você' });
}
function paintUser() {
  const bar = $('gk-muser'); if (!bar) return;
  const u = state.user; if (!u) return;
  const status = $('gk-topbar-profile-status')?.textContent || '';
  const dot = $('gk-notif-dot'); const hasNotif = !!dot && dot.style.display !== 'none';
  const sig = [u.avatarUrl, u.displayName, u.username, status, hasNotif].join('|');
  if (sig === userSig) return; userSig = sig;
  bar.replaceChildren(
    el('button', { class: 'gk-muser-main', type: 'button', 'aria-label': 'Seu perfil e atalhos', onclick: userSheet }, [
      el('span', { class: 'gk-muser-av' }, [el('img', { src: u.avatarUrl || fallbackAvatar(u.username), alt: '' }), el('i', { class: 'gk-muser-dot', 'data-status': status.toLowerCase() })]),
      el('span', { class: 'gk-muser-text' }, [el('b', {}, u.displayName || u.username || ''), el('small', {}, status || 'Disponível')]),
      icon('chevronDown', { size: 16 }),
    ]),
    el('button', { class: 'gk-muser-bell', type: 'button', 'aria-label': 'Notificações', onclick: (e) => { e.stopPropagation(); click('gk-notif-btn'); } }, [icon('bell', { size: 20 }), hasNotif ? el('i', { class: 'gk-muser-ping' }) : null]),
  );
}

// ---------------- Linha de ações sob o título ----------------
let filterTerm = '';
function applyFilter() {
  const t = filterTerm.trim().toLowerCase();
  document.querySelectorAll('#gk-sidebar-body .gk-dm-row, #gk-sidebar-body .gk-channel, #gk-sidebar-body .gk-server-picker-row').forEach((r) => { r.style.display = !t || r.textContent.toLowerCase().includes(t) ? '' : 'none'; });
}
function buildSub() {
  const sidebar = document.querySelector('.gk-sidebar'); const header = document.querySelector('.gk-sidebar-header');
  if (!sidebar || !header || $('gk-m-sub')) return;
  const input = el('input', { type: 'search', class: 'gk-m-sub-input', placeholder: 'Buscar…', 'aria-label': 'Buscar na lista' });
  input.addEventListener('input', () => { filterTerm = input.value; applyFilter(); });
  const searchRow = el('div', { class: 'gk-m-sub-search' }, [icon('search', { size: 18 }), input, el('button', { type: 'button', class: 'gk-m-sub-x', 'aria-label': 'Fechar busca', onclick: () => { filterTerm = ''; input.value = ''; applyFilter(); sub.classList.remove('gk-searching'); } }, [icon('close', { size: 16 })])]);
  const openSearch = () => { sub.classList.add('gk-searching'); input.focus(); };
  const sub = el('div', { id: 'gk-m-sub', class: 'gk-m-sub' }, [
    el('div', { class: 'gk-m-sub-row gk-m-sub-dm' }, [
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-icon', 'aria-label': 'Buscar', onclick: openSearch }, [icon('search', { size: 20 })]),
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-grow', onclick: () => click('gk-add-friend-btn') }, [icon('personPlus', { size: 18 }), ' Adicionar amigos']),
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-icon gk-m-sub-accent', 'aria-label': 'Novo grupo', onclick: () => openCreateGroupModal() }, [icon('plus', { size: 20 })]),
    ]),
    el('div', { class: 'gk-m-sub-row gk-m-sub-server' }, [
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-grow gk-m-sub-left', onclick: openSearch }, [icon('search', { size: 18 }), ' Buscar']),
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-icon', 'aria-label': 'Convidar pessoas', onclick: () => click('gk-invite-btn') }, [icon('personPlus', { size: 20 })]),
      el('button', { type: 'button', class: 'gk-m-sub-pill gk-m-sub-icon', 'aria-label': 'Eventos do servidor', onclick: () => click('gk-server-events-btn') }, [icon('clock', { size: 20 })]),
    ]),
    searchRow,
  ]);
  header.after(sub);
  // Tocar no nome do servidor abre o mesmo menu do toque longo (configurações, convidar, ranking…)
  $('gk-sidebar-header-title')?.addEventListener('click', () => {
    if (state.currentView !== 'server') return;
    const t = $('gk-sidebar-header-title'); const r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom }));
  });
  new MutationObserver(() => { if (filterTerm) applyFilter(); }).observe($('gk-sidebar-body'), { childList: true });
}

// ---------------- "⋯" no cabeçalho do chat ----------------
function buildMore() {
  const topbar = document.querySelector('.gk-topbar'); if (!topbar || $('gk-m-more-btn')) return;
  const search = el('button', { id: 'gk-m-search-btn', class: 'gk-icon-btn gk-m-more-btn', type: 'button', 'aria-label': 'Buscar mensagens', onclick: () => click('gk-msg-search-btn') }, [icon('search', { size: 22 })]);
  const btn = el('button', { id: 'gk-m-more-btn', class: 'gk-icon-btn gk-m-more-btn', type: 'button', 'aria-label': 'Mais opções', onclick: () => {
    const shown = (id) => { const b = $(id); return b && b.style.display !== 'none'; };
    const items = [
      shown('gk-pins-btn') ? { label: 'Mensagens fixadas', icon: 'pin', onClick: () => click('gk-pins-btn') } : null,
      shown('gk-conv-notif-btn') ? { label: 'Notificações da conversa', icon: 'bell', onClick: () => click('gk-conv-notif-btn') } : null,
      shown('gk-video-call-btn') ? { label: 'Chamada de vídeo', icon: 'videoCall', onClick: () => click('gk-video-call-btn') } : null,
    ].filter(Boolean);
    if (items.length) openSheet(items);
  } }, [icon('more', { size: 22 })]);
  topbar.append(search, btn);
}

// ---------------- Caixa de texto em pílula ----------------
function wrapComposer() {
  const box = document.querySelector('.gk-composer-box'); const ta = $('gk-composer-input');
  if (!box || !ta || box.querySelector('.gk-m-pill')) return;
  const pill = el('div', { class: 'gk-m-pill' });
  ta.before(pill);
  const extra = [...box.children].filter((c) => c.tagName === 'BUTTON' && !['gk-attach-btn', 'gk-send-btn'].includes(c.id)); // enquete, voz, emoji e o que outros módulos acrescentarem
  pill.append(ta, ...extra);
}

function tick() {
  if (!MQ.matches) return;
  paintRail(); paintUser();
}

export function initMobileDiscord() {
  const body = document.querySelector('.gk-app-body'); if (!body) return;
  if (!$('gk-mrail')) body.prepend(el('nav', { id: 'gk-mrail', class: 'gk-mrail', 'aria-label': 'Servidores' }));
  if (!$('gk-muser')) document.body.appendChild(el('div', { id: 'gk-muser', class: 'gk-muser' }));
  buildSub(); buildMore(); wrapComposer();
  setInterval(tick, 400); tick();
}
