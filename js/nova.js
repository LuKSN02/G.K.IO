// G.K.IO "Nova" — Etapa 1. Só reorganiza o DOM do cabeçalho do chat:
// os botões secundários (buscar, fixadas, notificações, vídeo) vão para um
// menu "mais". Os elementos e IDs são os mesmos, então nenhum handler muda.
import { state } from './state.js';
import { icon } from './icons.js';
import { onServerDataChange } from './servers.js';

const MOVE = ['gk-msg-search-btn', 'gk-pins-btn', 'gk-conv-notif-btn', 'gk-video-call-btn'];

function setup() {
  const bar = document.querySelector('.gk-main > .gk-topbar');
  if (!bar || bar.querySelector('.gk-nova-more')) return !!bar;
  const btns = MOVE.map(id => document.getElementById(id)).filter(Boolean);
  if (!btns.length) return false;

  const wrap = document.createElement('span');
  wrap.className = 'gk-nova-more';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gk-icon-btn';
  toggle.id = 'gk-nova-more-btn';
  toggle.title = 'Mais opções (buscar, fixadas, notificações, vídeo)';
  toggle.setAttribute('aria-label', 'Mais opções');
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  const pop = document.createElement('div');
  pop.className = 'gk-nova-more-pop';
  wrap.append(toggle, pop);

  for (const b of btns) {
    b.setAttribute('data-label', b.getAttribute('title') || '');
    pop.appendChild(b);
  }
  const anchor = document.getElementById('gk-members-toggle-btn');
  bar.insertBefore(wrap, anchor || null);

  const close = () => { wrap.classList.remove('gk-open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle('gk-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  // fecha depois do clique no item (o handler do próprio botão roda antes)
  pop.addEventListener('click', () => setTimeout(close, 0));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return true;
}

if (!setup()) {
  const iv = setInterval(() => { if (setup()) clearInterval(iv); }, 400);
  setTimeout(() => clearInterval(iv), 15000);
}

// ---------- Banner do servidor no topo da lista de canais (estilo Discord) ----------
function applyServerBanner() {
  const hdr = document.querySelector('.gk-sidebar-header');
  if (!hdr) return;
  const sid = state.currentServerId;
  const sv = sid ? state.servers.get(sid) : null;
  const url = sv && sv.bannerUrl;
  // Só mostra o banner quando a aba "Servidores" está de fato em um servidor.
  // Comunidades, Arquivos, DMs e Início reaproveitam o mesmo cabeçalho, mas
  // não mexem em state.currentServerId — por isso olhamos a aba ativa.
  const onServerTab = state.currentView === 'server'
    && !!document.getElementById('gk-nav-servers')?.classList.contains('gk-active');
  hdr.classList.toggle('gk-on-server', onServerTab && !!sid);
  if (onServerTab && url && /^https?:\/\//i.test(url)) {
    hdr.style.setProperty('--gk-sv-banner', 'url("' + url.replace(/"/g, '%22') + '")');
    hdr.classList.add('gk-has-banner');
  } else {
    hdr.style.removeProperty('--gk-sv-banner');
    hdr.classList.remove('gk-has-banner');
  }
}
function watchBanner() {
  const title = document.getElementById('gk-sidebar-header-title');
  const body = document.getElementById('gk-sidebar-body');
  if (!title) return false;
  const mo = new MutationObserver(applyServerBanner);
  mo.observe(title, { childList: true, characterData: true, subtree: true });
  if (body) mo.observe(body, { childList: true });
  // troca de aba na barra lateral esquerda (a classe gk-active muda)
  const rail = document.getElementById('gk-nav-servers')?.parentElement;
  if (rail) mo.observe(rail, { attributes: true, attributeFilter: ['class'], subtree: true });
  try { onServerDataChange(applyServerBanner); } catch {}
  applyServerBanner();
  return true;
}
if (!watchBanner()) {
  const iv2 = setInterval(() => { if (watchBanner()) clearInterval(iv2); }, 400);
  setTimeout(() => clearInterval(iv2), 15000);
}

// ---------- Olhinho nas senhas: ver/ocultar o que foi digitado ----------
function addPasswordToggle(input) {
  if (input.dataset.gkPw) return;
  input.dataset.gkPw = '1';
  let host = input.parentElement;
  if (!host || !host.classList.contains('gk-field-icon-input')) {
    const wrap = document.createElement('span');
    wrap.className = 'gk-pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    host = wrap;
  }
  host.classList.add('gk-has-pw-toggle');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gk-pw-toggle';
  btn.tabIndex = -1;
  const paint = (shown) => {
    btn.replaceChildren(icon(shown ? 'eyeOff' : 'eye', { size: 18 }));
    btn.title = shown ? 'Ocultar senha' : 'Mostrar senha';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(shown));
  };
  paint(false);
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco do campo
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    paint(show);
    try { input.focus({ preventScroll: true }); const n = input.value.length; input.setSelectionRange(n, n); } catch {}
  });
  host.appendChild(btn);
}
function scanPasswords() { document.querySelectorAll('input[type="password"]:not([data-gk-pw])').forEach(addPasswordToggle); }
let pwQueued = false;
new MutationObserver(() => {
  if (pwQueued) return; pwQueued = true;
  requestAnimationFrame(() => { pwQueued = false; scanPasswords(); });
}).observe(document.body, { childList: true, subtree: true });
scanPasswords();
