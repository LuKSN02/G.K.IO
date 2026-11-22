// ============================================================
// Início — seções dinâmicas (conversas recentes, amigos online, servidores)
// Só lê o estado que o app já mantém; não cria listeners novos.
// ============================================================
import { state, effectiveStatus, fallbackAvatar, escapeHtml } from './state.js';
import { openDmFromState, isGroupDm } from './dms.js';
import { selectServer } from './servers.js';

const view = document.getElementById('gk-home-view');
const inner = view && view.querySelector('.gk-home-view-inner');
let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.className = 'gk-home-extras';
  inner.appendChild(host);
  return host;
}

function tsMs(t) { return t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0); }

function dmName(dm) {
  if (isGroupDm(dm)) return dm.name || 'Grupo';
  return dm.other?.displayName || dm.other?.username || 'Conversa';
}
function dmAvatar(dm) {
  const n = dmName(dm);
  return (!isGroupDm(dm) && dm.other?.avatarUrl) || dm.iconUrl || fallbackAvatar(n);
}

function section(title, count, bodyHtml) {
  return `<section class="gk-home-sec"><h3>${title}${count ? `<em>${count}</em>` : ''}</h3>${bodyHtml}</section>`;
}

function render() {
  if (!inner || view.style.display === 'none') return;
  const h = ensureHost();
  const parts = [];

  const dms = [...state.dms.values()]
    .filter((d) => tsMs(d.lastMessageAt) > 0)
    .sort((a, b) => tsMs(b.lastMessageAt) - tsMs(a.lastMessageAt))
    .slice(0, 4);
  if (dms.length) {
    parts.push(section('Conversas recentes', '', `<div class="gk-home-list">${dms.map((d) => `
      <button class="gk-home-item" data-dm="${escapeHtml(d.id)}">
        <img src="${escapeHtml(dmAvatar(d))}" alt="">
        <span><b>${escapeHtml(dmName(d))}</b><small>${escapeHtml(d.lastMessagePreview || 'Abrir conversa')}</small></span>
      </button>`).join('')}</div>`));
  }

  const online = [...state.friends.values()].filter((f) => effectiveStatus(f) !== 'offline');
  if (online.length) {
    parts.push(section('Amigos online', online.length, `<div class="gk-home-chips">${online.slice(0, 12).map((f) => `
      <button class="gk-home-chip" data-friend="${escapeHtml(f.uid)}" title="${escapeHtml(f.displayName || f.username || '')}">
        <span class="gk-home-ava"><img src="${escapeHtml(f.avatarUrl || fallbackAvatar(f.displayName || f.username || 'GK'))}" alt=""><i></i></span>
        <small>${escapeHtml(f.displayName || f.username || '')}</small>
      </button>`).join('')}</div>`));
  }

  const servers = [...state.servers.entries()];
  if (servers.length) {
    parts.push(section('Seus servidores', servers.length, `<div class="gk-home-chips">${servers.slice(0, 12).map(([id, s]) => `
      <button class="gk-home-chip" data-server="${escapeHtml(id)}" title="${escapeHtml(s.name || '')}">
        <span class="gk-home-ava gk-home-ava-sq"><img src="${escapeHtml(s.iconUrl || fallbackAvatar(s.name || 'S'))}" alt=""></span>
        <small>${escapeHtml(s.name || '')}</small>
      </button>`).join('')}</div>`));
  }

  const html = parts.join('');
  if (h.dataset.sig !== html) { h.innerHTML = html; h.dataset.sig = html; }
}

if (view && inner) {
  inner.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dm],[data-friend],[data-server]');
    if (!b) return;
    if (b.dataset.dm) {
      const dm = state.dms.get(b.dataset.dm);
      if (dm) { document.getElementById('gk-home-go-messages')?.click(); setTimeout(() => openDmFromState(dm), 0); }
    } else if (b.dataset.friend) {
      const dm = [...state.dms.values()].find((d) => !isGroupDm(d) && d.other?.uid === b.dataset.friend);
      if (dm) { document.getElementById('gk-home-go-messages')?.click(); setTimeout(() => openDmFromState(dm), 0); }
      else document.getElementById('gk-home-go-friends')?.click();
    } else if (b.dataset.server) {
      selectServer(b.dataset.server);
    }
  });
  new MutationObserver(render).observe(view, { attributes: true, attributeFilter: ['style'] });
  setInterval(render, 15000);
  render();
}
