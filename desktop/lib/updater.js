// Atualização automática via GitHub Releases (electron-updater).
// Só funciona no app instalado (empacotado) e nos alvos que suportam
// auto-update (NSIS no Windows, AppImage no Linux, dmg/zip no macOS —
// a versão "portable" do Windows não atualiza sozinha).
const { app } = require('electron');

let autoUpdater = null;
let send = () => {};
let status = { state: 'idle' };

function set(s) { status = s; send(s); }

function init(sendFn) {
  send = sendFn;
  if (!app.isPackaged) { status = { state: 'dev' }; return false; }
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { status = { state: 'unavailable' }; return false; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => set({ state: 'error', message: String((e && e.message) || e).slice(0, 200) }));
  return true;
}
function check() {
  if (!autoUpdater) return Promise.resolve(status);
  return autoUpdater.checkForUpdates().then(() => status).catch((e) => { set({ state: 'error', message: String(e.message || e).slice(0, 200) }); return status; });
}
function installNow() { if (autoUpdater && status.state === 'ready') autoUpdater.quitAndInstall(); }
module.exports = { init, check, installNow, getStatus: () => status };
