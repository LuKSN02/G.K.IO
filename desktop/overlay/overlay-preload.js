// Ponte mínima para a janela da sobreposição (só recebe dados; não consegue mandar comandos).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gkioOverlay', {
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onToast: (cb) => ipcRenderer.on('overlay:toast', (_e, t) => cb(t)),
  hasContent: (v) => ipcRenderer.send('overlay:content', !!v),
});
