// ============================================================
// G.K.IO — Estado global em memória + utilitários compartilhados
// ============================================================

export const state = {
  user: null,          // { uid, username, displayName, avatarUrl, bannerUrl, bio, statusPresence }
  currentView: 'dms',  // 'dms' | 'server'
  currentServerId: null,
  currentChannelId: null,
  currentDmId: null,
  servers: new Map(),        // serverId -> server data
  serverMembersCache: new Map(), // serverId -> Map(uid -> memberData+userData)
  dms: new Map(),            // dmId -> dm data (com participantes resolvidos)
  friends: new Map(),        // uid -> user data
  unsubscribers: {           // listeners ativos que precisam ser desligados ao trocar de canal/dm
    messages: null,
    channels: null,
    categories: null,
    members: null,
    voicePresence: null,
  },
  activeCall: null, // { kind: 'dm'|'voiceChannel', id, pc, localStream, remoteStreams: Map }
};

export function cleanupListener(key) {
  if (state.unsubscribers[key]) {
    try { state.unsubscribers[key](); } catch (e) { /* noop */ }
    state.unsubscribers[key] = null;
  }
}

export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

export function initials(name = '?') {
  return name.trim().slice(0, 2).toUpperCase();
}

export function fallbackAvatar(seed = 'GK') {
  // Avatar SVG gerado localmente (sem depender de serviço externo) — fundo cinza claro + iniciais.
  const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
    <rect width='96' height='96' fill='hsl(${hue},18%,88%)'/>
    <text x='50%' y='54%' font-family='Space Grotesk, sans-serif' font-size='34' font-weight='700'
      fill='hsl(${hue},25%,38%)' text-anchor='middle' dominant-baseline='middle'>${escapeHtml(initials(seed))}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function toast(msg, kind = 'default') {
  const stack = document.getElementById('gk-toast-stack');
  if (!stack) return;
  const node = el('div', { class: `gk-toast ${kind === 'danger' ? 'gk-danger' : ''}` }, msg);
  stack.appendChild(node);
  requestAnimationFrame(() => node.classList.add('gk-show'));
  setTimeout(() => {
    node.classList.remove('gk-show');
    setTimeout(() => node.remove(), 200);
  }, 3200);
}

export function genInviteCode(len = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
