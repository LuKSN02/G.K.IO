// ============================================================
// G.K.IO — Bootstrap da aplicação
// ============================================================
import { initAuthListener, onAuthReady, wireAuthForm, logoutUser, setPresence } from './auth.js';
import { state, fallbackAvatar } from './state.js';
import { listenUserServers, openCreateServerModal, openJoinServerModal } from './servers.js';
import { openServerSettingsModal, wireServerSettingsModal } from './server-settings.js';
import { listenFriendsAndDms, goToDmsView, openAddFriendModal, wireFriendsHome } from './dms.js';
import { wireComposer, sendAttachmentMessage } from './chat.js';
import { refreshMiniProfile } from './profile.js';
import { wireCallBar, listenIncomingCalls } from './calls.js';
import { openSettingsModal, wireSettingsModal } from './settings.js';
import { initEmojiPicker, listenCustomEmojis } from './emoji.js';
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
wireStaticUI();
wireMobileNav();
initEmojiPicker({
  textarea: document.getElementById('gk-composer-input'),
  triggerBtn: document.getElementById('gk-emoji-btn'),
  onSendGif: (url, title) => sendAttachmentMessage(url, 'gif', title),
});
initAuthListener();

onAuthReady(() => {
  refreshMiniProfile();
  listenUserServers();
  listenFriendsAndDms();
  listenIncomingCalls();
  listenCustomEmojis();
  goToDmsView();
});

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
  // servidor, canal, DM ou "Mensagens diretas".
  navDrawer.addEventListener('click', (e) => {
    if (e.target.closest('.gk-channel, .gk-dm-row, .gk-rail-item:not(.gk-add), #gk-dm-rail-item')) {
      closeAllDrawers();
    }
  });

  // Se a tela crescer para o layout desktop, garante que nenhuma
  // gaveta fique "aberta" escondida atrás do layout normal.
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeAllDrawers();
  });
}
