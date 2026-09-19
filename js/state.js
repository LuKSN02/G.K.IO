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
  incomingFriendRequests: [], // pedidos de amizade pendentes recebidos, resolvidos com dados do outro usuário
  unsubscribers: {           // listeners ativos que precisam ser desligados ao trocar de canal/dm
    messages: null,
    channels: null,
    categories: null,
    members: null,
    voicePresence: null,
    roles: null,
    typing: null,       // quem está digitando na conversa aberta agora (ver js/typing.js)
    readStates: null,   // estado de "não lidas" do usuário logado (ver js/unread.js)
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
  // Toda <img> criada pelo app carrega "sob demanda" por padrão (o
  // navegador só busca quando ela está perto de entrar na tela) e decodifica
  // fora da thread principal — evita que listas longas de avatares/anexos
  // (mensagens, membros, DMs) travem o scroll baixando tudo de uma vez.
  // Uma chamada específica ainda pode sobrescrever passando loading/decoding.
  if (tag === 'img') {
    if (opts.loading === undefined) opts.loading = 'lazy';
    if (opts.decoding === undefined) opts.decoding = 'async';
  }
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

// O app só sabia dizer "offline" através do evento beforeunload — que
// praticamente nunca dispara quando alguém só fecha o app pelo Android
// (a tela é derrubada pelo sistema, sem passar por nenhum evento de saída
// da página), então statusPresence ficava "online" pra sempre depois da
// primeira sessão. Em vez de confiar cegamente nesse campo, todo lugar
// que mostra presença passa por aqui: se o último sinal de vida
// (lastActiveAt, atualizado a cada minuto em auth.js enquanto o app está
// em primeiro plano) está velho demais, trata como offline mesmo que o
// campo ainda diga "online".
const PRESENCE_STALE_MS = 3 * 60 * 1000;

export function effectiveStatus(user) {
  if (!user) return 'offline';
  const raw = user.statusPresence || 'offline';
  if (raw === 'offline') return 'offline';
  const lastMs = user.lastActiveAt?.toMillis ? user.lastActiveAt.toMillis() : null;
  // Sem carimbo NENHUM (conta antiga, de antes desse campo existir, ou que
  // nunca mais logou com este código) conta como velho demais, não como
  // "sem informação, então confia". Só um lastActiveAt de verdade recente
  // prova atividade — e quem está online agora com o código novo sempre
  // tem um (setPresence/heartbeat gravam na hora do login).
  if (!lastMs || (Date.now() - lastMs) > PRESENCE_STALE_MS) return 'offline';
  return raw;
}

export function genInviteCode(len = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Normalização única de nome de usuário — usada tanto no cadastro
// (auth.js) quanto na busca de amigo por username (dms.js), para
// que "João Silva", "joao silva" e "joao-silva" sempre resolvam
// para o mesmo valor salvo no Firestore.
export function normalizeUsername(raw = '') {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, '-')                              // espaços -> hífen
    .replace(/[^a-z0-9_-]/g, '');                       // só caracteres seguros
}
