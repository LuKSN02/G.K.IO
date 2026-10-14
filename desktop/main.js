// ============================================================
// G.K.IO Desktop — processo principal (Electron)
// Recursos inspirados no Dorion: bandeja com estados, fechar para a
// bandeja, iniciar minimizado, iniciar com o sistema, instância única,
// atalhos globais (mutar/ensurdecer/PTT) e janela que lembra posição.
// ============================================================
const { app, BrowserWindow, ipcMain, globalShortcut, shell, session, desktopCapturer, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
// --- Perfis: cada perfil tem sua própria pasta de dados (login, cache, config),
// então dá para abrir contas diferentes lado a lado. Precisa vir ANTES de
// qualquer leitura de config/userData.
const profileArg = (process.argv.find((a) => a.startsWith('--profile=')) || '').slice(10).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
if (profileArg) app.setPath('userData', path.join(app.getPath('appData'), 'G.K.IO', 'profiles', profileArg));
const PROFILES_FILE = path.join(app.getPath('appData'), 'G.K.IO', 'profiles.json');
function readProfiles() { try { const j = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); return Array.isArray(j.profiles) ? j.profiles : []; } catch (e) { return []; } }
function writeProfiles(list) { try { fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true }); fs.writeFileSync(PROFILES_FILE, JSON.stringify({ profiles: list })); } catch (e) { /* noop */ } }
// Porta estável por perfil => origem estável => cada perfil mantém seu login.
function portFor(name) { if (!name) return 47831; let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 400; return 47832 + h; }

const config = require('./lib/config');
const logger = require('./lib/log');
const streamer = require('./lib/streamer');
const tray = require('./lib/tray');
const ptt = require('./lib/ptt');
const { start: startServer } = require('./lib/static-server');
const { toAccelerator } = require('./lib/accelerator');
const games = require('./lib/games');
const blur = require('./lib/blur');
const updater = require('./lib/updater');

let win = null;
let quitting = false;
let origin = null;
let httpServer = null;
const state = { unread: 0, muted: false, deafened: false, inCall: false };
let shortcutMap = {};

const startHidden = process.argv.includes('--hidden');
const safeMode = process.argv.includes('--safe');
if (!config.get().hardwareAccel) app.disableHardwareAcceleration();
process.on('uncaughtException', (e) => logger.log('uncaughtException', e));
process.on('unhandledRejection', (e) => logger.log('unhandledRejection', e instanceof Error ? e : String(e)));

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => showWindow());
}

function webRoot() { return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..'); }

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function toggleWindow() { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow(); }
function sendCommand(c) { if (win && !win.isDestroyed()) win.webContents.send('gkio:command', c); }

const actions = {
  open: showWindow, toggle: toggleWindow,
  command: sendCommand,
  reload: () => win && win.webContents.reloadIgnoringCache(),
  restart: () => { quitting = true; app.relaunch(); app.quit(); },
  safe: () => { quitting = true; app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--safe').concat('--safe') }); app.quit(); },
  quit: () => { quitting = true; app.quit(); },
};

function applyTray() {
  const cfg = config.get();
  if (cfg.trayEnabled) { if (!tray.exists()) tray.create(actions, state); else tray.update(actions, state); }
  else tray.destroy();
}
function applyBadge() {
  app.setBadgeCount(state.unread); // macOS/Linux (Unity)
  if (process.platform === 'win32' && win) win.setTitle(state.unread > 0 ? `(${state.unread}) G.K.IO` : 'G.K.IO');
}
function sendToWeb(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function streamerOn() {
  const m = config.get().streamerMode;
  return m === 'on' || (m === 'auto' && streamer.isActive());
}
function applyStreamer() {
  streamer.stop();
  if (config.get().streamerMode === 'auto') streamer.start(() => sendToWeb('gkio:streamer', streamerOn()));
  sendToWeb('gkio:streamer', streamerOn());
}
function applyProxy() {
  const p = config.get().proxy;
  session.defaultSession.setProxy(p ? { proxyRules: p } : { mode: 'system' }).catch((e) => logger.log('proxy', e));
}
async function clearCache() {
  const ses = session.defaultSession;
  await ses.clearCache();
  // Não mexe em localStorage/IndexedDB — senão você perderia o login.
  await ses.clearStorageData({ storages: ['cachestorage', 'shadercache', 'serviceworkers'] });
}
function applyGameScanner() {
  const cfg = config.get();
  if (!cfg.gameActivity) { if (games.stop()) sendToWeb('gkio:game', null); return; }
  games.start(() => config.get().customGames, (g) => sendToWeb('gkio:game', g));
}
function applyLoginItem() {
  if (!app.isPackaged) return; // em dev, registrar o electron.exe cru no startup seria um erro
  const cfg = config.get();
  app.setLoginItemSettings({ openAtLogin: !!cfg.openOnStartup, args: cfg.startMinimized ? ['--hidden'] : [] });
}

function applyShortcuts() {
  globalShortcut.unregisterAll();
  ptt.setBinding(null, () => {});
  if (!config.get().globalShortcuts) return { mute: false, deafen: false, ptt: false };
  const result = {};
  for (const [name, cmd] of [['mute', 'toggle-mute'], ['deafen', 'toggle-deafen']]) {
    const acc = toAccelerator(shortcutMap[name]);
    result[name] = !!acc && (() => { try { return globalShortcut.register(acc, () => sendCommand(cmd)); } catch (e) { return false; } })();
  }
  if (shortcutMap.pttEnabled && shortcutMap.ptt) {
    const r = ptt.setBinding(shortcutMap.ptt, (down) => { if (win && !win.isDestroyed()) win.webContents.send('gkio:ptt', down); });
    result.ptt = !!r.active;
  } else result.ptt = false;
  return result;
}

async function createWindow() {
  const cfg = config.get();
  const w = cfg.window || {};
  win = new BrowserWindow({
    width: w.width || 1280, height: w.height || 800, x: w.x, y: w.y, minWidth: 420, minHeight: 600,
    show: false, backgroundColor: '#0b1020', title: profileArg ? `G.K.IO (${profileArg})` : 'G.K.IO',
    icon: path.join(__dirname, '..', 'img', 'favicon-512.png'),
    autoHideMenuBar: true,
    ...blur.windowOptions(cfg.blur),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // chamadas continuam fluindo com a janela escondida
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (w.maximized || cfg.startMaximized) win.maximize();
  blur.apply(win, cfg.blur);

  win.once('ready-to-show', () => {
    const hidden = (startHidden || cfg.startMinimized) && cfg.trayEnabled;
    if (!hidden) win.show();
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    config.set({ window: { ...(maximized ? config.get().window : win.getBounds()), maximized } });
  };
  win.on('resize', saveBounds); win.on('move', saveBounds);

  win.on('close', (e) => {
    saveBounds();
    const c = config.get();
    if (!quitting && c.trayEnabled && c.closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  // Links externos abrem no navegador; navegação fica restrita à origem do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (origin && !url.startsWith(origin)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // Atalhos de desenvolvedor/recarregar (o menu padrão está oculto).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    else if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  await win.loadURL(origin + '/index.html' + (safeMode ? '?safe=1' : ''));
}

function setupPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm));

  // getDisplayMedia() (compartilhar tela) não funciona no Electron sem isto:
  // mostramos um menu com as telas/janelas e devolvemos a escolhida.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return callback({});
      let done = false;
      const pick = (src) => { if (done) return; done = true; callback(src ? { video: src, audio: process.platform === 'win32' ? 'loopback' : undefined } : {}); };
      const m = Menu.buildFromTemplate([
        { label: 'Compartilhar qual tela/janela?', enabled: false }, { type: 'separator' },
        ...sources.slice(0, 15).map((s) => ({ label: s.name.slice(0, 60), click: () => pick(s) })),
        { type: 'separator' }, { label: 'Cancelar', click: () => pick(null) },
      ]);
      m.popup({ window: win, callback: () => setTimeout(() => pick(null), 100) });
    } catch (e) { callback({}); }
  }, { useSystemPicker: true });
}

function setupIpc() {
  ipcMain.handle('cfg:get', () => { const { window: _w, ...rest } = config.get(); return { ...rest, packaged: app.isPackaged, version: app.getVersion(), blurOptions: blur.available(), builtinGames: games.builtinCount, profile: profileArg || '', streamerActive: streamerOn(), dataPath: app.getPath('userData') }; });
  ipcMain.handle('cfg:set', (_e, patch) => {
    const bools = ['startMaximized', 'hardwareAccel', 'autoClearCache', 'trayEnabled', 'closeToTray', 'startMinimized', 'openOnStartup', 'globalShortcuts', 'gameActivity', 'autoUpdate'];
    const clean = {};
    for (const k of bools) if (k in (patch || {})) clean[k] = !!patch[k];
    if ('remoteUrl' in (patch || {})) clean.remoteUrl = String(patch.remoteUrl || '');
    if ('streamerMode' in (patch || {}) && ['auto', 'on', 'off'].includes(patch.streamerMode)) clean.streamerMode = patch.streamerMode;
    if ('proxy' in (patch || {})) { const p = String(patch.proxy || '').trim().slice(0, 200); if (!p || /^(https?|socks[45]?):\/\/[^\s]+$/i.test(p)) clean.proxy = p; }
    if ('blur' in (patch || {}) && blur.available().includes(patch.blur)) clean.blur = patch.blur;
    if (Array.isArray(patch?.customGames)) {
      clean.customGames = patch.customGames.slice(0, 50)
        .map((g) => ({ exe: String(g?.exe || '').trim().slice(0, 80), name: String(g?.name || '').trim().slice(0, 64) }))
        .filter((g) => g.exe && g.name);
    }
    config.set(clean);
    applyTray(); applyLoginItem();
    if ('globalShortcuts' in clean) applyShortcuts();
    if ('gameActivity' in clean || 'customGames' in clean) applyGameScanner();
    if ('streamerMode' in clean) applyStreamer();
    if ('proxy' in clean) applyProxy();
    let needsRestart = 'hardwareAccel' in clean;
    if ('blur' in clean && !blur.apply(win, clean.blur)) needsRestart = true;
    const { window: _w, ...rest } = config.get();
    return { ...rest, needsRestart };
  });
  ipcMain.on('tray:state', (_e, s) => {
    state.unread = Math.max(0, Number(s?.unread) || 0);
    state.muted = !!s?.muted; state.deafened = !!s?.deafened; state.inCall = !!s?.inCall;
    tray.update(actions, state); applyBadge();
  });
  ipcMain.handle('shortcuts:set', (_e, map) => { shortcutMap = map || {}; return applyShortcuts(); });
  ipcMain.on('window:show', showWindow);
  ipcMain.handle('streamer:current', () => streamerOn());
  ipcMain.handle('cache:clear', async () => { await clearCache(); return true; });
  ipcMain.on('app:openData', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('app:openLogs', () => shell.openPath(path.join(app.getPath('userData'), 'logs')));
  ipcMain.on('app:safeMode', actions.safe);
  ipcMain.handle('net:fetchText', async (_e, url) => {
    if (!/^https:\/\//i.test(String(url))) throw new Error('Só URLs https:// são aceitas.');
    const r = await net.fetch(String(url), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('Servidor respondeu ' + r.status);
    const text = await r.text();
    if (text.length > 512 * 1024) throw new Error('Arquivo grande demais (máx. 512 KB).');
    return text;
  });
  ipcMain.handle('profiles:list', () => ({ current: profileArg, profiles: readProfiles() }));
  ipcMain.handle('profiles:open', (_e, name) => {
    const isDefault = name === 'default';
    const n = isDefault ? '' : String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    if (!isDefault && !n) throw new Error('Nome inválido (use letras, números, - e _).');
    if (n) { const list = readProfiles(); if (!list.includes(n)) writeProfiles([...list, n]); }
    spawn(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), ...(n ? [`--profile=${n}`] : [])], { detached: true, stdio: 'ignore' }).unref();
    return true;
  });
  ipcMain.handle('profiles:remove', (_e, name) => { writeProfiles(readProfiles().filter((p) => p !== name)); return true; });
  ipcMain.handle('game:current', () => games.getCurrent());
  ipcMain.handle('update:status', () => updater.getStatus());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.on('update:install', () => { quitting = true; updater.installNow(); });
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  logger.init(); logger.log('start', app.getVersion(), process.platform, profileArg || 'default', safeMode ? 'safe' : '');
  const cfg = config.get();
  applyProxy();
  if (cfg.autoClearCache) await clearCache().catch((e) => logger.log('clearCache', e));
  if (cfg.remoteUrl) { origin = cfg.remoteUrl.replace(/\/+$/, ''); }
  else {
    const { server, port } = await startServer(webRoot(), portFor(profileArg));
    httpServer = server; origin = `http://localhost:${port}`;
  }
  setupPermissions(); setupIpc();
  await createWindow();
  applyTray(); applyLoginItem(); applyGameScanner(); applyStreamer();
  if (updater.init((st) => sendToWeb('gkio:update', st)) && config.get().autoUpdate) {
    setTimeout(() => updater.check(), 8000);
    setInterval(() => { if (config.get().autoUpdate) updater.check(); }, 4 * 60 * 60 * 1000);
  }
  app.on('activate', () => { if (!win) createWindow(); else showWindow(); });
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { games.stop(); streamer.stop(); globalShortcut.unregisterAll(); ptt.setBinding(null, () => {}); if (httpServer) httpServer.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (quitting || !config.get().trayEnabled)) app.quit(); });
