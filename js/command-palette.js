// ============================================================
// Busca rápida (Ctrl+K / ⌘K): pula para conversas, servidores, canais e
// amigos digitando o nome. Reaproveita a lógica de js/search.js.
// ============================================================
import { state } from './state.js';
import { buildResults, goToResult } from './search.js';

let overlay = null, listEl = null, input = null, flat = [], idx = 0;

const tsMs = (t) => (t && t.toMillis ? t.toMillis() : 0);

function recentGroups() {
  const groups = [];
  const dms = [...state.dms.values()].filter((d) => d.other).sort((a, b) => tsMs(b.lastMessageAt) - tsMs(a.lastMessageAt)).slice(0, 5)
    .map((dm) => ({ kind: 'dm', id: dm.id, title: dm.other.displayName || dm.other.username, subtitle: 'Mensagem direta', avatarUrl: dm.other.avatarUrl || null, other: dm.other }));
  if (dms.length) groups.push({ label: 'Conversas recentes', items: dms });
  const servers = [...state.servers.values()].slice(0, 5)
    .map((s) => ({ kind: 'server', id: s.id, title: s.name || 'Servidor', subtitle: 'Servidor', iconUrl: s.iconUrl || null }));
  if (servers.length) groups.push({ label: 'Servidores', items: servers });
  return groups;
}

function close() { overlay?.remove(); overlay = null; }

function paintSel() {
  listEl.querySelectorAll('.gk-cp-row').forEach((r, i) => r.classList.toggle('gk-sel', i === idx));
  listEl.querySelector('.gk-sel')?.scrollIntoView({ block: 'nearest' });
}

function render() {
  const term = input.value.trim();
  const groups = (term ? buildResults(term) : recentGroups()) || [];
  listEl.innerHTML = ''; flat = []; idx = 0;
  if (!groups.length) {
    const e = document.createElement('div'); e.className = 'gk-cp-empty';
    e.textContent = term ? `Nada encontrado para "${term}".` : 'Digite para buscar conversas, servidores e canais.';
    listEl.appendChild(e); return;
  }
  for (const g of groups) {
    const h = document.createElement('div'); h.className = 'gk-cp-group'; h.textContent = g.label; listEl.appendChild(h);
    for (const item of g.items) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'gk-cp-row';
      const av = document.createElement('span'); av.className = 'gk-cp-av';
      const src = item.avatarUrl || item.iconUrl;
      if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; av.appendChild(im); }
      else av.textContent = item.kind === 'channel' ? '#' : (item.kind === 'message' ? '“' : (item.title || '?').slice(0, 2).toUpperCase());
      const info = document.createElement('span'); info.className = 'gk-cp-info';
      const t = document.createElement('b'); t.textContent = item.title;
      const s = document.createElement('small'); s.textContent = item.subtitle;
      info.append(t, s); row.append(av, info);
      const go = () => { close(); goToResult(item); };
      row.addEventListener('click', go);
      row.addEventListener('mousemove', () => { idx = flat.indexOf(row); paintSel(); });
      row.__go = go; flat.push(row); listEl.appendChild(row);
    }
  }
  paintSel();
}

function open() {
  if (overlay) { close(); return; }
  overlay = document.createElement('div'); overlay.className = 'gk-cp-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Busca rápida');
  const box = document.createElement('div'); box.className = 'gk-cp-box';
  input = document.createElement('input'); input.className = 'gk-cp-input'; input.type = 'text';
  input.placeholder = 'Ir para… conversa, servidor, canal ou amigo'; input.autocomplete = 'off'; input.spellcheck = false;
  listEl = document.createElement('div'); listEl.className = 'gk-cp-list';
  const foot = document.createElement('div'); foot.className = 'gk-cp-foot'; foot.textContent = '↑↓ navegar · Enter abrir · Esc fechar';
  box.append(input, listEl, foot); overlay.appendChild(box); document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) { idx = (idx + 1) % flat.length; paintSel(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { idx = (idx - 1 + flat.length) % flat.length; paintSel(); } }
    else if (e.key === 'Enter') { e.preventDefault(); flat[idx]?.__go(); }
  });
  render(); input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); open(); }
}, true);
// Clicar na barra de busca do topo também abre a busca rápida (a antiga só achava amigos).
document.addEventListener('focusin', (e) => {
  if (e.target?.id === 'gk-global-search' && state.user) { e.target.blur(); open(); }
});
