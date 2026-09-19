// ============================================================
// G.K.IO — Busca global (barra do topbar)
//
// Escopo, de propósito, é só o que já está carregado no client em
// memória (state.js) — sem novas queries no Firestore:
//   · Servidores dos quais a pessoa é membro (state.servers)
//   · Canais do servidor ABERTO no momento (getCategoriesAndChannels());
//     buscar canais de servidores fechados exigiria carregar os canais
//     de todos eles de uma vez, o que não acontece hoje.
//   · Amigos (state.friends)
//   · Conversas diretas já existentes (state.dms)
// Clicar num resultado navega direto pra lá, igual um "ir para".
// ============================================================
import { state, effectiveStatus } from './state.js';
import { icon } from './icons.js';
import { selectServer, getCategoriesAndChannels, canSendInChannel } from './servers.js';
import { selectChannel, selectDm } from './chat.js';
import { openOrCreateDm, goToDmsView } from './dms.js';

const MAX_PER_GROUP = 5;

function norm(str = '') {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matches(term, ...fields) {
  return fields.some((f) => f && norm(f).includes(term));
}

function buildResults(rawTerm) {
  const term = norm(rawTerm.trim());
  if (!term) return null;

  const groups = [];

  // ---- Servidores ----
  const servers = [...state.servers.values()]
    .filter((s) => matches(term, s.name))
    .slice(0, MAX_PER_GROUP)
    .map((s) => ({
      kind: 'server',
      id: s.id,
      title: s.name || 'Servidor',
      subtitle: 'Servidor',
      iconUrl: s.iconUrl || null,
    }));
  if (servers.length) groups.push({ label: 'Servidores', items: servers });

  // ---- Canais do servidor aberto agora ----
  if (state.currentServerId) {
    const { channels } = getCategoriesAndChannels();
    const chMatches = (channels || [])
      .filter((c) => matches(term, c.name))
      .slice(0, MAX_PER_GROUP)
      .map((c) => ({
        kind: 'channel',
        serverId: state.currentServerId,
        id: c.id,
        title: c.name,
        subtitle: `Canal em ${state.servers.get(state.currentServerId)?.name || 'servidor'}`,
        channel: c,
      }));
    if (chMatches.length) groups.push({ label: 'Canais neste servidor', items: chMatches });
  }

  // ---- Amigos ----
  const friends = [...state.friends.values()]
    .filter((f) => matches(term, f.displayName, f.username))
    .slice(0, MAX_PER_GROUP)
    .map((f) => ({
      kind: 'friend',
      id: f.uid,
      title: f.displayName || f.username,
      subtitle: `@${f.username || '—'} · ${statusLabel(effectiveStatus(f))}`,
      avatarUrl: f.avatarUrl || null,
    }));
  if (friends.length) groups.push({ label: 'Amigos', items: friends });

  // ---- Conversas diretas já existentes ----
  const dms = [...state.dms.values()]
    .filter((dm) => dm.other && matches(term, dm.other.displayName, dm.other.username))
    .slice(0, MAX_PER_GROUP)
    .map((dm) => ({
      kind: 'dm',
      id: dm.id,
      title: dm.other.displayName || dm.other.username,
      subtitle: `Mensagem direta · ${statusLabel(effectiveStatus(dm.other))}`,
      avatarUrl: dm.other.avatarUrl || null,
      other: dm.other,
    }));
  if (dms.length) groups.push({ label: 'Conversas', items: dms });

  return groups;
}

function statusLabel(status) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[status] || 'Offline';
}

function renderResults(groups, rawTerm) {
  const box = document.getElementById('gk-global-search-results');
  box.innerHTML = '';

  if (groups === null) { box.classList.remove('gk-open'); return; }

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'gk-global-search-empty';
    empty.textContent = `Nada encontrado para "${rawTerm.trim()}".`;
    box.appendChild(empty);
    box.classList.add('gk-open');
    return;
  }

  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'gk-global-search-group';
    const label = document.createElement('div');
    label.className = 'gk-global-search-group-label';
    label.textContent = group.label;
    groupEl.appendChild(label);

    for (const item of group.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gk-global-search-item';

      const avatar = document.createElement('span');
      avatar.className = 'gk-global-search-item-avatar';
      if (item.kind === 'server' || item.kind === 'channel') {
        avatar.classList.add('gk-global-search-item-avatar-square');
        if (item.iconUrl) {
          const img = document.createElement('img');
          img.src = item.iconUrl;
          avatar.appendChild(img);
        } else {
          avatar.appendChild(item.kind === 'channel' ? icon('chatBubble', { size: 15 }) : document.createTextNode((item.title || '?').slice(0, 2).toUpperCase()));
        }
      } else if (item.avatarUrl) {
        const img = document.createElement('img');
        img.src = item.avatarUrl;
        avatar.appendChild(img);
      } else {
        avatar.appendChild(document.createTextNode((item.title || '?').slice(0, 2).toUpperCase()));
      }

      const info = document.createElement('span');
      info.className = 'gk-global-search-item-info';
      const title = document.createElement('span');
      title.className = 'gk-global-search-item-title';
      title.textContent = item.title;
      const subtitle = document.createElement('span');
      subtitle.className = 'gk-global-search-item-subtitle';
      subtitle.textContent = item.subtitle;
      info.appendChild(title);
      info.appendChild(subtitle);

      row.appendChild(avatar);
      row.appendChild(info);
      row.addEventListener('click', () => {
        goToResult(item);
        closeResults();
      });
      groupEl.appendChild(row);
    }
    box.appendChild(groupEl);
  }

  box.classList.add('gk-open');
}

function goToResult(item) {
  if (item.kind === 'server') {
    selectServer(item.id);
  } else if (item.kind === 'channel') {
    selectServer(item.serverId);
    selectChannel(item.serverId, item.id, item.channel.name, !canSendInChannel(item.serverId, item.channel));
  } else if (item.kind === 'friend') {
    goToDmsView();
    openOrCreateDm(item.id);
  } else if (item.kind === 'dm') {
    goToDmsView();
    const otherStatus = statusLabel(effectiveStatus(item.other));
    selectDm(item.id, item.title, otherStatus, item.other.uid);
  }
}

function closeResults() {
  const box = document.getElementById('gk-global-search-results');
  box.classList.remove('gk-open');
  box.innerHTML = '';
}

export function wireGlobalSearch() {
  const wrap = document.getElementById('gk-global-search');
  const input = document.getElementById('gk-global-search-input');
  const searchIcon = document.querySelector('#gk-global-search .gk-global-search-icon');
  if (!wrap || !input) return;

  // Em telas estreitas o campo começa fechado (só o ícone visível) —
  // ver a media query de mobile em app.css. Tocar no ícone abre o
  // campo por cima do topbar; tocar fora fecha de novo (se vazio).
  searchIcon?.addEventListener('click', () => {
    if (window.innerWidth > 900) return;
    wrap.classList.toggle('gk-mobile-open');
    if (wrap.classList.contains('gk-mobile-open')) input.focus();
  });

  input.addEventListener('input', () => {
    renderResults(buildResults(input.value), input.value);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) renderResults(buildResults(input.value), input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); closeResults(); }
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      closeResults();
      if (!input.value.trim()) wrap.classList.remove('gk-mobile-open');
    }
  });
}
