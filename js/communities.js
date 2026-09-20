// ============================================================
// G.K.IO — "Comunidades": descobrir e entrar em servidores públicos
// ============================================================
// Um servidor só aparece aqui se o dono marcou "Público" ao criar (ver
// o passo de visibilidade em openCreateServerModal, servers.js) — os já
// existentes de antes dessa opção existir ficam de fora até serem
// editados, o que é o comportamento esperado, não um bug.
// ============================================================
import { serversCol, query, where, onSnapshot, auth } from './db.js';
import { state, el, cleanupListener, toast } from './state.js';
import { icon } from './icons.js';
import { selectServer, joinServerAsMember } from './servers.js';
import { hideFriendsHome } from './dms.js';

let unsubCommunities = null;
let lastCommunities = [];
let searchTerm = '';

export function goToCommunitiesView() {
  hideFriendsHome();
  document.getElementById('gk-home-view').style.display = 'none';
  document.getElementById('gk-files-view').style.display = 'none';
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-video-call-btn').style.display = 'none';
  document.getElementById('gk-server-picker-add').style.display = 'none';
  document.getElementById('gk-topbar-title').textContent = 'Comunidades';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  document.getElementById('gk-sidebar-header-title').textContent = 'Comunidades';
  document.getElementById('gk-sidebar-body').innerHTML = '';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-communities')?.classList.add('gk-active');

  searchTerm = '';
  document.getElementById('gk-communities-view').style.display = 'flex';
  listenCommunities();
}

export function hideCommunitiesView() {
  const el = document.getElementById('gk-communities-view');
  if (el) el.style.display = 'none';
}

function listenCommunities() {
  cleanupListener('_communities');
  const q = query(serversCol(), where('visibility', '==', 'public'));
  unsubCommunities = onSnapshot(q, (snap) => {
    lastCommunities = [];
    snap.forEach((d) => lastCommunities.push({ id: d.id, ...d.data() }));
    lastCommunities.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderCommunities();
  }, () => { /* silencioso — view fica vazia se as regras ainda não foram publicadas */ });
  state.unsubscribers._communities = () => unsubCommunities && unsubCommunities();
}

function renderCommunities() {
  const main = document.getElementById('gk-communities-view');
  if (!main || main.style.display === 'none') return;
  main.innerHTML = '';

  main.appendChild(el('div', { class: 'gk-communities-header' }, [
    el('h2', {}, 'Comunidades públicas'),
    el('input', {
      type: 'text', class: 'gk-communities-search', placeholder: 'Buscar por nome...',
      value: searchTerm,
      oninput: (e) => { searchTerm = e.target.value; renderCommunityList(); },
    }),
  ]));
  main.appendChild(el('div', { class: 'gk-communities-grid', id: 'gk-communities-grid' }));
  renderCommunityList();
}

function renderCommunityList() {
  const grid = document.getElementById('gk-communities-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const term = searchTerm.trim().toLowerCase();
  const list = term ? lastCommunities.filter((s) => (s.name || '').toLowerCase().includes(term)) : lastCommunities;

  if (!list.length) {
    grid.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('tray', { size: 32 })]),
      el('div', {}, lastCommunities.length ? 'Nenhuma comunidade com esse nome.' : 'Nenhuma comunidade pública ainda. Crie um servidor e marque "Público" pra ele aparecer aqui.'),
    ]));
    return;
  }

  for (const server of list) {
    const alreadyIn = (server.memberIds || []).includes(auth.currentUser?.uid);
    grid.appendChild(el('div', { class: 'gk-community-card' }, [
      el('div', { class: 'gk-avatar gk-sz-56' }, [
        server.iconUrl
          ? el('img', { src: server.iconUrl })
          : el('div', { class: 'gk-server-picker-fallback' }, (server.name || '?').slice(0, 2).toUpperCase()),
      ]),
      el('div', { class: 'gk-community-name' }, server.name || 'Servidor'),
      el('div', { class: 'gk-community-desc' }, server.description || 'Sem descrição.'),
      el('div', { class: 'gk-community-sub' }, `${(server.memberIds || []).length} membro(s)`),
      alreadyIn
        ? el('button', { class: 'gk-btn gk-btn-ghost gk-btn-block', onclick: () => selectServer(server.id) }, 'Abrir')
        : el('button', {
            class: 'gk-btn gk-btn-primary gk-btn-block',
            onclick: async (e) => {
              e.target.disabled = true;
              e.target.classList.add('gk-btn-loading');
              try {
                await joinServerAsMember(server.id);
                toast(`Você entrou em "${server.name}".`);
                selectServer(server.id);
              } catch (err) {
                toast('Não foi possível entrar nessa comunidade.', 'danger');
                e.target.disabled = false;
                e.target.classList.remove('gk-btn-loading');
              }
            },
          }, 'Entrar'),
    ]));
  }
}
