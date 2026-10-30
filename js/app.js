// ============================================================
// G.K.IO — Bootstrap da aplicação
// ============================================================
import { openEventsModal } from './server-extras.js';
import { initAuthListener, onAuthReady, wireAuthForm, logoutUser, setPresence } from './auth.js';
import { state, fallbackAvatar, cleanupListener } from './state.js';
import { stopTyping } from './typing.js';
import { listenUserServers, openCreateServerModal, openJoinServerModal, selectServer, goToServerPickerView } from './servers.js';
import { openServerSettingsModal, wireServerSettingsModal } from './server-settings.js';
import { listenFriendsAndDms, goToDmsView, openAddFriendModal, wireFriendsHome, openDmById, hideFriendsHome, showFriendsHome } from './dms.js';
import { wireComposer, sendAttachmentMessage, selectChannel } from './chat.js';
import { initMobileNav } from './mobile-nav.js';
import { checkForApkUpdate } from './app-update.js';
import { wireGenericModalReset } from './dialogs.js';
import { refreshMiniProfile } from './profile.js';
import { wireCallBar, listenIncomingCalls } from './calls.js';
import { openSettingsModal, wireSettingsModal } from './settings.js';
import { initEmojiPicker, listenCustomEmojis } from './emoji.js';
import { listenReadStates } from './unread.js';
import { initPushNotifications, onPushNotificationTap } from './push.js';
import { goToFilesView, hideFilesView } from './files.js';
import { goToCommunitiesView, hideCommunitiesView } from './communities.js';
import { wireGlobalTopbar, closeProfileMenu } from './topbar.js';
import { initExtensions } from './extensions.js';
import { initZoom } from './zoom.js';
import { initHotkeys } from './hotkeys.js';
import { initIdleDetection } from './idle.js';
import { initDesktopIntegration, pushActivity } from './desktop.js';
import './theme.js'; // aplica o tema salvo assim que o app carrega
import { initAccessibility } from './appearance.js';

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
wireGenericModalReset();
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
initZoom();
initAccessibility();
initHotkeys();
initExtensions();
initDesktopIntegration();
initMobileNav();

onPushNotificationTap((data) => {
  if (data.type === 'dm' && data.dmId) openDmById(data.dmId);
  else if (data.type === 'channel' && data.serverId) {
    selectServer(data.serverId);
    // Notificações de desktop trazem o canal; as de push (APK) só o servidor.
    if (data.channelId && data.channelName) selectChannel(data.serverId, data.channelId, data.channelName);
  }
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
  checkForApkUpdate();
  initIdleDetection();
  pushActivity();
});

// ============================================================
// Seção "Início" — painel de boas-vindas simples. Só existe pra dar um
// lugar de pouso neutro; não inventa nenhum dado, só atalhos pro que já
// existe (Mensagens/Amigos/Servidores).
// ============================================================
function goToHomeView() {
  // Sai de qualquer conversa aberta de verdade (listener de mensagens,
  // "digitando", estado) — antes ela continuava viva por trás da tela de
  // Início e era redesenhada por cima dela.
  stopTyping();
  cleanupListener('messages');
  cleanupListener('typing');
  state.currentView = 'home';
  state.currentServerId = null;
  state.currentChannelId = null;
  state.currentDmId = null;
  hideFriendsHome();
  hideFilesView();
  hideCommunitiesView();
  document.getElementById('gk-add-friend-btn').style.display = 'none';
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-friends-home').style.display = 'none';
  document.getElementById('gk-home-view').style.display = 'flex';
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  { const b = document.getElementById('gk-server-events-btn'); if (b) b.style.display = 'none'; }
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

// O Início não tem lista lateral: a coluna de DMs/canais some enquanto a
// tela de boas-vindas está visível e volta sozinha ao abrir qualquer outra
// seção. Observa o próprio #gk-home-view em vez de depender de cada tela
// lembrar de mostrar/esconder a sidebar.
function wireHomeSidebarToggle() {
  const homeView = document.getElementById('gk-home-view');
  const appBody = document.querySelector('.gk-app-body');
  const sync = () => appBody.classList.toggle('gk-home-mode', homeView.style.display === 'flex');
  new MutationObserver(sync).observe(homeView, { attributes: true, attributeFilter: ['style'] });
  sync();
}

function wireStaticUI() {
  wireHomeSidebarToggle();
  document.getElementById('gk-add-server-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('gk-server-menu');
    const isOpen = menu.classList.contains('gk-open-inline');
    if (isOpen) {
      menu.classList.remove('gk-open-inline');
      return;
    }
    const btnRect = e.currentTarget.getBoundingClientRect();
    // O botão fica no rodapé da sidebar: se o menu nascesse na altura do
    // topo do botão ele passaria da borda da tela e ficaria cortado. Mede
    // o menu (já está no layout, só invisível) e alinha ele pela base do
    // botão quando não couber, mantendo sempre uma margem da borda.
    const margin = 8;
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    let left = btnRect.right + 12;
    let top = btnRect.top;
    if (left + menuW > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - menuW - margin);
    if (top + menuH > window.innerHeight - margin) top = btnRect.bottom - menuH;
    top = Math.max(margin, Math.min(top, window.innerHeight - menuH - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.transformOrigin = top < btnRect.top ? 'bottom left' : 'top left';
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
  // Versão celular dos mesmos dois botões (ver .gk-server-picker-actions)
  document.getElementById('gk-m-create-server-btn')?.addEventListener('click', openCreateServerModal);
  document.getElementById('gk-m-join-server-btn')?.addEventListener('click', openJoinServerModal);
  document.getElementById('gk-dm-rail-item').addEventListener('click', goToDmsView);
  document.getElementById('gk-nav-home').addEventListener('click', goToHomeView);
  document.getElementById('gk-nav-servers').addEventListener('click', goToServerPickerView);
  document.getElementById('gk-nav-communities').addEventListener('click', goToCommunitiesView);
  document.getElementById('gk-nav-files').addEventListener('click', goToFilesView);
  document.getElementById('gk-nav-settings').addEventListener('click', (e) => { e.stopPropagation(); openSettingsModal('perfil'); });
  document.getElementById('gk-home-go-messages').addEventListener('click', goToDmsView);
  document.getElementById('gk-home-go-friends').addEventListener('click', goToDmsView);
  document.getElementById('gk-home-go-servers').addEventListener('click', goToServerPickerView);
  document.getElementById('gk-add-friend-btn').addEventListener('click', openAddFriendModal);
  document.getElementById('gk-settings-btn').addEventListener('click', (e) => { e.stopPropagation(); closeProfileMenu(); openSettingsModal('perfil'); });
  document.getElementById('gk-logout-btn').addEventListener('click', (e) => { e.stopPropagation(); closeProfileMenu(); logoutUser(); });
  document.getElementById('gk-server-events-btn')?.addEventListener('click', () => {
    if (state.currentServerId) openEventsModal(state.currentServerId);
  });
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
  closeProfileMenu();
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
