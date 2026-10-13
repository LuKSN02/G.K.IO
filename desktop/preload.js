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
  showWindow: () => ipcRenderer.send('window:show'),
  // cb('toggle-mute' | 'toggle-deafen')
  onCommand: (cb) => { const f = (_e, c) => cb(c); ipcRenderer.on('gkio:command', f); return () => ipcRenderer.removeListener('gkio:command', f); },
  // cb(true|false) — tecla de push-to-talk global apertada/solta
  onPtt: (cb) => { const f = (_e, v) => cb(!!v); ipcRenderer.on('gkio:ptt', f); return () => ipcRenderer.removeListener('gkio:ptt', f); },
});
