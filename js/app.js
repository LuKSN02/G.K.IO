// ============================================================
// G.K.IO — Bootstrap da aplicação
// ============================================================
import { initAuthListener, onAuthReady, wireAuthForm, logoutUser, setPresence } from './auth.js';
import { state, fallbackAvatar } from './state.js';
import { listenUserServers, openCreateServerModal, openJoinServerModal, selectServer, goToServerPickerView } from './servers.js';
import { openServerSettingsModal, wireServerSettingsModal } from './server-settings.js';
import { listenFriendsAndDms, goToDmsView, openAddFriendModal, wireFriendsHome, openDmById, hideFriendsHome, showFriendsHome } from './dms.js';
import { wireComposer, sendAttachmentMessage } from './chat.js';
import { refreshMiniProfile } from './profile.js';
import { wireCallBar, listenIncomingCalls } from './calls.js';
import { openSettingsModal, wireSettingsModal } from './settings.js';
import { initEmojiPicker, listenCustomEmojis } from './emoji.js';
import { listenReadStates } from './unread.js';
import { initPushNotifications, onPushNotificationTap } from './push.js';
import { goToFilesView, hideFilesView } from './files.js';
import { goToCommunitiesView, hideCommunitiesView } from './communities.js';
import { wireGlobalTopbar } from './topbar.js';
import './theme.js'; // aplica o tema salvo assim que o app carrega

// O #gk-server-menu nasce dentro de .gk-rail no HTML, mas .gk-rail tem
// overflow-y:auto — isso corta (clipa) elementos position:fixed
// descendentes, mesmo posicionados fora da área visível da rail (é um
// comportamento padrão do navegador, não um bug do CSS). Movendo o menu
// para ser filho direto do <body> ele escapa desse corte; a posição
// continua sendo calculada normalmente em wireStaticUI() abaixo.
document.body.appendChild(document.getElementById('gk-server-menu'));

wireAuthForm();
wireComposer();
wireCallBar();
wireSettingsModal();
wireServerSettingsModal();
wireFriendsHome();
wireGlobalTopbar();
wireStaticUI();
wireMobileNav();
initEmojiPicker({
  textarea: document.getElementById('gk-composer-input'),
  triggerBtn: document.getElementById('gk-emoji-btn'),
  onSendGif: (url, title) => sendAttachmentMessage(url, 'gif', title),
});
initAuthListener();

onPushNotificationTap((data) => {
  if (data.type === 'dm' && data.dmId) openDmById(data.dmId);
  else if (data.type === 'channel' && data.serverId) selectServer(data.serverId); // abre o servidor; escolher o canal exato ainda é manual
});

onAuthReady(() => {
  refreshMiniProfile();
  listenUserServers();
  listenFriendsAndDms();
  listenIncomingCalls();
  listenCustomEmojis();
  listenReadStates();
  goToHomeView();
  initPushNotifications();
});

// ============================================================
// Seção "Início" — painel de boas-vindas simples. Só existe pra dar um
// lugar de pouso neutro; não inventa nenhum dado, só atalhos pro que já
// existe (Mensagens/Amigos/Servidores).
// ============================================================
function goToHomeView() {
  hideFriendsHome();
  hideFilesView();
  hideCommunitiesView();
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-friends-home').style.display = 'none';
  document.getElementById('gk-home-view').style.display = 'flex';
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-video-call-btn').style.display = 'none';
  document.getElementById('gk-server-picker-add').style.display = 'none';
  document.getElementById('gk-topbar-title').textContent = 'Início';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  document.getElementById('gk-sidebar-header-title').textContent = 'Mensagens diretas';
  const name = state.user?.displayName || state.user?.username;
  document.getElementById('gk-home-greeting').textContent = name ? `Olá, ${name}!` : 'Olá!';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-home').classList.add('gk-active');
}

// "Amigos" reaproveita a view de DMs (mesma sidebar, mesma tela de
// amigos) — só muda qual item do rail fica em destaque, já que aqui a
// intenção de navegação é "gerenciar amigos", não "abrir uma conversa".
function goToFriendsView() {
  goToDmsView();
  showFriendsHome();
  hideFilesView();
  hideCommunitiesView();
  document.getElementById('gk-home-view').style.display = 'none';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-friends').classList.add('gk-active');
}

function wireStaticUI() {
  document.getElementById('gk-add-server-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('gk-server-menu');
    const isOpen = menu.classList.contains('gk-open-inline');
    if (isOpen) {
      menu.classList.remove('gk-open-inline');
      return;
    }
    const btnRect = e.currentTarget.getBoundingClientRect();
    menu.style.left = `${btnRect.right + 12}px`;
    menu.style.top = `${btnRect.top}px`;
    menu.classList.add('gk-open-inline');
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('gk-server-menu');
    if (menu.classList.contains('gk-open-inline') && !menu.contains(e.target) && e.target.id !== 'gk-add-server-btn') {
      menu.classList.remove('gk-open-inline');
    }
  });
  document.getElementById('gk-create-server-btn').addEventListener('click', openCreateServerModal);
  document.getElementById('gk-join-server-btn').addEventListener('click', openJoinServerModal);
  document.getElementById('gk-dm-rail-item').addEventListener('click', goToDmsView);
  document.getElementById('gk-nav-home').addEventListener('click', goToHomeView);
  document.getElementById('gk-nav-friends').addEventListener('click', goToFriendsView);
  document.getElementById('gk-nav-servers').addEventListener('click', goToServerPickerView);
  document.getElementById('gk-nav-communities').addEventListener('click', goToCommunitiesView);
  document.getElementById('gk-nav-files').addEventListener('click', goToFilesView);
  document.getElementById('gk-nav-settings').addEventListener('click', (e) => { e.stopPropagation(); openSettingsModal('perfil'); });
  document.getElementById('gk-home-go-messages').addEventListener('click', goToDmsView);
  document.getElementById('gk-home-go-friends').addEventListener('click', goToFriendsView);
  document.getElementById('gk-home-go-servers').addEventListener('click', goToServerPickerView);
  document.getElementById('gk-add-friend-btn').addEventListener('click', openAddFriendModal);
  document.getElementById('gk-mini-profile').addEventListener('click', () => openSettingsModal('perfil'));
  document.getElementById('gk-settings-btn').addEventListener('click', (e) => { e.stopPropagation(); openSettingsModal('perfil'); });
  document.getElementById('gk-logout-btn').addEventListener('click', (e) => { e.stopPropagation(); logoutUser(); });
  document.getElementById('gk-server-settings-btn').addEventListener('click', () => {
    if (state.currentServerId) openServerSettingsModal(state.currentServerId);
  });

  document.getElementById('gk-status-online').addEventListener('click', (e) => { e.stopPropagation(); setStatusAndClose('online'); });
  document.getElementById('gk-status-idle').addEventListener('click', (e) => { e.stopPropagation(); setStatusAndClose('idle'); });
  document.getElementById('gk-status-dnd').addEventListener('click', (e) => { e.stopPropagation(); setStatusAndClose('dnd'); });

  document.getElementById('gk-generic-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'gk-generic-modal-overlay') e.target.classList.remove('gk-open');
  });
}

async function setStatusAndClose(status) {
  await setPresence(status);
  refreshMiniProfile();
}

// ============================================================
// Navegação mobile — a gaveta de rail+sidebar (canais/DMs) e o
// painel de membros viram "drawers" deslizantes em telas de
// smartphone, abertos pelos botões ☰ e 👥 no topbar.
// ============================================================
function wireMobileNav() {
  const navDrawer = document.getElementById('gk-nav-drawer');
  const membersPanel = document.getElementById('gk-members');
  const backdrop = document.getElementById('gk-mobile-backdrop');
  const menuBtn = document.getElementById('gk-mobile-menu-btn');
  const membersBtn = document.getElementById('gk-members-toggle-btn');

  function closeAllDrawers() {
    navDrawer.classList.remove('gk-open');
    membersPanel.classList.remove('gk-open');
    backdrop.classList.remove('gk-open');
  }
  function toggleDrawer(drawerEl) {
    const willOpen = !drawerEl.classList.contains('gk-open');
    closeAllDrawers();
    if (willOpen) { drawerEl.classList.add('gk-open'); backdrop.classList.add('gk-open'); }
  }

  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer(navDrawer); });
  membersBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer(membersPanel); });
  backdrop.addEventListener('click', closeAllDrawers);

  // Fecha a gaveta de navegação automaticamente ao escolher um
  // servidor, canal, DM ou seção do rail — EXCETO "Servidor", que
  // primeiro precisa mostrar a lista nomeada ali dentro da própria
  // gaveta antes de fechar (fechar de cara esconderia a lista sem
  // dar tempo de escolher nada).
  navDrawer.addEventListener('click', (e) => {
    if (e.target.closest('#gk-nav-servers')) return;
    if (e.target.closest('.gk-channel, .gk-dm-row, .gk-server-picker-row, .gk-rail-item, #gk-dm-rail-item')) {
      closeAllDrawers();
    }
  });

  // Se a tela crescer para o layout desktop, garante que nenhuma
  // gaveta fique "aberta" escondida atrás do layout normal.
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeAllDrawers();
  });
}
