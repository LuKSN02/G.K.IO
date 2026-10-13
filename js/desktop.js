// ============================================================
// G.K.IO — Integração com o app desktop (Electron)
// Só faz algo quando window.gkioDesktop existe (preload.js); no navegador
// e no APK tudo aqui é no-op.
// ============================================================
import { getHotkeyPrefs } from './prefs.js';
import { toggleMute, toggleDeafen, setMicEnabled, hasActiveCall } from './calls.js';

const d = () => window.gkioDesktop;

// Registra os atalhos globais no processo principal a partir das prefs.
export async function syncShortcuts() {
  if (!d()) return null;
  const p = getHotkeyPrefs();
  try { return await d().setShortcuts({ mute: p.mute, deafen: p.deafen, ptt: p.ptt, pttEnabled: p.pttEnabled }); } catch (e) { return null; }
}

export function initDesktopIntegration() {
  if (!d()) return;
  document.documentElement.setAttribute('data-desktop', d().platform);

  // Comandos vindos da bandeja / atalhos globais.
  d().onCommand((c) => {
    if (!hasActiveCall()) return;
    if (c === 'toggle-mute') toggleMute();
    else if (c === 'toggle-deafen') toggleDeafen();
  });
  d().onPtt((down) => { if (getHotkeyPrefs().pttEnabled && hasActiveCall()) setMicEnabled(down); });

  // Estado da bandeja: não lidas + mutado/ensurdecido.
  const tray = { unread: 0, muted: false, deafened: false, inCall: false };
  let t = null;
  const push = () => { clearTimeout(t); t = setTimeout(() => { tray.inCall = hasActiveCall(); d().setTrayState({ ...tray }); }, 150); };

  window.addEventListener('gkio-mic-state', (e) => { tray.muted = !!e.detail.muted; push(); });
  window.addEventListener('gkio-deafen-state', (e) => { tray.deafened = !!e.detail.deafened; push(); });

  // Conta conversas não lidas direto do DOM (a sidebar já marca .gk-unread).
  const countUnread = () => { tray.unread = document.querySelectorAll('.gk-dm-row.gk-unread, .gk-channel.gk-unread').length; push(); };
  new MutationObserver(countUnread).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  countUnread();

  // Registra os atalhos globais assim que o app sobe e quando as prefs mudam.
  syncShortcuts();
  window.addEventListener('storage', (e) => { if (e.key === 'gkio-hotkey-prefs') syncShortcuts(); });
  window.addEventListener('gkio-hotkeys-changed', syncShortcuts);
}
