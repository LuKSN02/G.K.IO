// ============================================================
// G.K.IO — Integração com o app desktop (Electron)
// Só faz algo quando window.gkioDesktop existe (preload.js); no navegador
// e no APK tudo aqui é no-op.
// ============================================================
import { getHotkeyPrefs } from './prefs.js';
import { auth, userDoc, updateDoc } from './db.js';
import { state, toast } from './state.js';
import { initTabBadge } from './tab-badge.js';
import { toggleMute, toggleDeafen, setMicEnabled, hasActiveCall, overlaySnapshot } from './calls.js';

const d = () => window.gkioDesktop;

// Registra os atalhos globais no processo principal a partir das prefs.
export async function syncShortcuts() {
  if (!d()) return null;
  const p = getHotkeyPrefs();
  try { return await d().setShortcuts({ mute: p.mute, deafen: p.deafen, ptt: p.ptt, pttEnabled: p.pttEnabled }); } catch (e) { return null; }
}

// ---------- Links gkio://invite|server|dm/<id> ----------
async function openDeepLink(url) {
  const m = /^gkio:\/\/(invite|server|dm)\/([\w-]{3,64})\/?$/.exec(String(url || ''));
  if (!m) return;
  for (let i = 0; i < 60 && !(auth.currentUser && state.user); i++) await new Promise((r) => setTimeout(r, 1000)); // espera o login
  if (!auth.currentUser) return;
  const [, kind, id] = m;
  try {
    const { selectServer, joinServerByInviteCode } = await import('./servers.js');
    if (kind === 'server') { if (state.servers.has(id)) selectServer(id); else toast('Você não está nesse servidor.'); }
    else if (kind === 'invite') { const sid = await joinServerByInviteCode(id); if (sid) selectServer(sid); }
    else { const { openDmById } = await import('./dms.js'); await openDmById(id); }
  } catch (e) { toast('Não foi possível abrir o link: ' + (e?.message || 'erro')); }
}

// Ao voltar depois de um tempo fora, resume quantas conversas têm novidades.
function initAwaySummary() {
  let hiddenAt = 0;
  const back = () => {
    if (!hiddenAt || Date.now() - hiddenAt < 30 * 60000) { hiddenAt = 0; return; }
    hiddenAt = 0;
    setTimeout(() => {
      const n = document.querySelectorAll('.gk-dm-row.gk-unread, .gk-channel.gk-unread').length;
      if (n > 0) toast(`Enquanto você estava fora: ${n} ${n === 1 ? 'conversa com novidades' : 'conversas com novidades'}.`);
    }, 2500); // dá tempo de as mensagens novas chegarem
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = hiddenAt || Date.now(); else back(); });
  window.addEventListener('blur', () => { hiddenAt = hiddenAt || Date.now(); });
  window.addEventListener('focus', back);
}

// ---------- Sobreposição (janela por cima do jogo) ----------
function initOverlayFeed() {
  if (!d() || !d().setOverlay) return;
  const o = { speaking: [], selfMuted: false, selfDeaf: false };
  let t = null;
  const push = () => { clearTimeout(t); t = setTimeout(() => { try { d().setOverlay({ snapshot: overlaySnapshot(), speaking: o.speaking, selfMuted: o.selfMuted, selfDeaf: o.selfDeaf }); } catch (e) { /* noop */ } }, 80); };
  window.addEventListener('gkio-speaking', (e) => { o.speaking = e.detail?.ids || []; push(); });
  window.addEventListener('gkio-mic-state', (e) => { o.selfMuted = !!e.detail?.muted; push(); });
  window.addEventListener('gkio-deafen-state', (e) => { o.selfDeaf = !!e.detail?.deafened; push(); });
  window.addEventListener('gkio-voice-joined', push);
  window.addEventListener('gkio-call-ended', () => { o.speaking = []; push(); });
  setInterval(() => { if (hasActiveCall()) push(); }, 2500); // pega entradas/saídas e quem mutou
}

export function initDesktopIntegration() {
  initAwaySummary();
  initTabBadge();
  if (!d()) return;
  initDesktopFeatures();
  initOverlayFeed();
  try { d().takeDeepLink?.().then((u) => u && openDeepLink(u)); d().onDeepLink?.(openDeepLink); } catch (e) { /* noop */ }
  document.documentElement.setAttribute('data-desktop', d().platform);

  // Comandos vindos da bandeja / atalhos globais.
  d().onCommand((c) => {
    if (!hasActiveCall()) return;
    if (c === 'toggle-mute') toggleMute();
    else if (c === 'toggle-deafen') toggleDeafen();
  });
  d().onPtt((down) => { if (getHotkeyPrefs().pttEnabled && hasActiveCall()) setMicEnabled(down); });

  // Estado da bandeja: não lidas + mutado/ensurdecido.
  const tray = { unread: 0, muted: false, deafened: false, inCall: false, away: false };
  let t = null;
  const push = () => { clearTimeout(t); t = setTimeout(() => { tray.inCall = hasActiveCall(); tray.away = state.user?.statusPresence === 'idle'; d().setTrayState({ ...tray }); }, 150); };

  window.addEventListener('gkio-mic-state', (e) => { tray.muted = !!e.detail.muted; push(); });
  window.addEventListener('gkio-deafen-state', (e) => { tray.deafened = !!e.detail.deafened; push(); });

  // Conta conversas não lidas direto do DOM (a sidebar já marca .gk-unread).
  const countUnread = () => { tray.unread = document.querySelectorAll('.gk-dm-row.gk-unread, .gk-channel.gk-unread').length; push(); };
  new MutationObserver(countUnread).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  countUnread();
  setInterval(() => { if ((state.user?.statusPresence === 'idle') !== tray.away || hasActiveCall() !== tray.inCall) push(); }, 3000);

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
  // Depois de atualizar: avisa a versão nova e mostra o começo das notas da Release (se achar).
  try {
    const cfg = await d().getConfig();
    let prev = null; try { prev = localStorage.getItem('gkio-desktop-last-ver'); localStorage.setItem('gkio-desktop-last-ver', cfg.version); } catch (e) { /* noop */ }
    if (prev && cfg.version && prev !== cfg.version && cfg.packaged) {
      let note = '';
      try {
        const j = JSON.parse(await d().fetchText(`https://api.github.com/repos/luksn02/G.K.IO/releases/tags/v${cfg.version}`));
        note = String(j.body || '').replace(/[#*`>\r]/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ').slice(0, 220);
      } catch (e) { /* sem notas */ }
      toast(`G.K.IO Desktop atualizado para ${cfg.version}${note ? ' — ' + note : '.'}`);
    }
  } catch (e) { /* noop */ }
  // Aviso discreto quando uma atualização termina de baixar.
  d().onUpdate((st) => { if (st.state === 'ready') toast(`Atualização ${st.version} pronta — instale em Configurações > Aparência > App desktop.`); });
}
