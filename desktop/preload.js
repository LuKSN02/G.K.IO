// Ponte segura entre o app web do G.K.IO e o processo principal do Electron.
// O site só enxerga `window.gkioDesktop` — nada de Node direto.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gkioDesktop', {
  isDesktop: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  setConfig: (patch) => ipcRenderer.invoke('cfg:set', patch),
  setTrayState: (state) => ipcRenderer.send('tray:state', state),
  setShortcuts: (map) => ipcRenderer.invoke('shortcuts:set', map),
  getCurrentGame: () => ipcRenderer.invoke('game:current'),
  // cb({ name, startedAt } | null) — jogo detectado em execução
  onGame: (cb) => { const f = (_e, g) => cb(g); ipcRenderer.on('gkio:game', f); return () => ipcRenderer.removeListener('gkio:game', f); },
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  // cb({ state: 'checking'|'downloading'|'ready'|'none'|'error', version?, percent?, message? })
  onUpdate: (cb) => { const f = (_e, s) => cb(s); ipcRenderer.on('gkio:update', f); return () => ipcRenderer.removeListener('gkio:update', f); },
  getStreamerMode: () => ipcRenderer.invoke('streamer:current'),
  onStreamer: (cb) => { const f = (_e, v) => cb(!!v); ipcRenderer.on('gkio:streamer', f); return () => ipcRenderer.removeListener('gkio:streamer', f); },
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openDataFolder: () => ipcRenderer.send('app:openData'),
  openLogsFolder: () => ipcRenderer.send('app:openLogs'),
  restartInSafeMode: () => ipcRenderer.send('app:safeMode'),
  fetchText: (url) => ipcRenderer.invoke('net:fetchText', url),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  openProfile: (name) => ipcRenderer.invoke('profiles:open', name),
  removeProfile: (name) => ipcRenderer.invoke('profiles:remove', name),
  showWindow: () => ipcRenderer.send('window:show'),
  // cb('toggle-mute' | 'toggle-deafen')
  onCommand: (cb) => { const f = (_e, c) => cb(c); ipcRenderer.on('gkio:command', f); return () => ipcRenderer.removeListener('gkio:command', f); },
  // cb(true|false) — tecla de push-to-talk global apertada/solta
  onPtt: (cb) => { const f = (_e, v) => cb(!!v); ipcRenderer.on('gkio:ptt', f); return () => ipcRenderer.removeListener('gkio:ptt', f); },
});
