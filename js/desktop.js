// ============================================================
// G.K.IO — Integração com o app desktop (Electron)
// Só faz algo quando window.gkioDesktop existe (preload.js); no navegador
// e no APK tudo aqui é no-op.
// ============================================================
import { getHotkeyPrefs } from './prefs.js';
import { auth, userDoc, updateDoc } from './db.js';
import { state, toast } from './state.js';
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
  initDesktopFeatures();
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

// ---------- Jogo em execução (RPC) ----------
let lastGame = null;
export async function pushActivity() {
  if (!auth.currentUser) return;
  const activity = lastGame ? { name: String(lastGame.name).slice(0, 64), startedAt: lastGame.startedAt || Date.now() } : null;
  if ((state.user?.activity?.name || null) === (activity?.name || null)) return;
  try {
    await updateDoc(userDoc(auth.currentUser.uid), { activity });
    if (state.user) state.user.activity = activity;
  } catch (e) { /* regras ainda sem o campo 'activity'? publique o firestore.rules novo */ }
}

// Efeito de janela: só marca o <html>; o CSS cuida do resto.
export function applyBlurAttr(effect) {
  if (effect && effect !== 'none') document.documentElement.setAttribute('data-blur', effect);
  else document.documentElement.removeAttribute('data-blur');
}

export function applyStreamerAttr(on) {
  if (on) document.documentElement.setAttribute('data-streamer', '1');
  else document.documentElement.removeAttribute('data-streamer');
}

export async function initDesktopFeatures() {
  if (!d()) return;
  try { applyStreamerAttr(await d().getStreamerMode()); } catch (e) { /* noop */ }
  d().onStreamer((on) => { applyStreamerAttr(on); toast(on ? 'Modo streamer ligado — dados sensíveis ocultos.' : 'Modo streamer desligado.'); });
  try { const cfg = await d().getConfig(); applyBlurAttr(cfg.blur); } catch (e) { /* noop */ }
  try { lastGame = await d().getCurrentGame(); } catch (e) { /* noop */ }
  d().onGame((g) => { lastGame = g; pushActivity(); });
  // Aviso discreto quando uma atualização termina de baixar.
  d().onUpdate((st) => { if (st.state === 'ready') toast(`Atualização ${st.version} pronta — instale em Configurações > Aparência > App desktop.`); });
}
