// Configuração do app desktop (inspirada no config.rs do Dorion): um JSON
// simples em userData, com defaults e merge raso.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  trayEnabled: true,        // ícone na bandeja
  closeToTray: true,        // fechar a janela só esconde (precisa de trayEnabled)
  startMinimized: false,    // abre direto na bandeja
  openOnStartup: false,     // iniciar com o sistema
  globalShortcuts: true,    // mutar/ensurdecer/PTT mesmo com o app em segundo plano
  gameActivity: true,       // mostrar "Jogando X" (detecção de processos)
  customGames: [],          // [{ exe, name }] além da lista embutida
  blur: 'none',             // none | acrylic | mica | tabbed | vibrancy | transparent
  autoUpdate: true,         // checar e baixar atualizações em segundo plano
  streamerMode: 'auto',     // auto (detecta OBS etc.) | on | off
  hardwareAccel: true,      // desligar ajuda em PCs com driver de vídeo problemático (reinicia)
  startMaximized: false,
  autoClearCache: false,    // limpa o cache (não o login) toda vez que abre
  proxy: '',                // ex.: http://127.0.0.1:8080 ou socks5://host:1080
  remoteUrl: '',            // se preenchido, carrega essa URL em vez do servidor local embutido
  window: { width: 1280, height: 800, x: undefined, y: undefined, maximized: false },
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'desktop-config.json');

function get() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch (e) { cache = { ...DEFAULTS }; }
  return cache;
}
function set(patch) {
  cache = { ...get(), ...patch };
  try { fs.writeFileSync(file(), JSON.stringify(cache, null, 2)); } catch (e) { /* disco só leitura: segue em memória */ }
  return cache;
}
module.exports = { get, set, DEFAULTS };
