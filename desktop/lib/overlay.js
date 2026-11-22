// Sobreposição estilo Discord: janela transparente, sempre por cima, que o clique atravessa,
// colada na extrema esquerda da tela. Não injeta nada no jogo (só desenha uma janela por cima),
// então funciona com jogos em janela/"sem bordas"; tela cheia exclusiva não deixa nada por cima.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let win = null, mode = 'game', gameOn = false, hasContent = false, lastState = null, loaded = false;

function bounds() { const wa = screen.getPrimaryDisplay().workArea; return { x: wa.x, y: wa.y, width: 320, height: wa.height }; }

function ensure() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    ...bounds(), show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, '..', 'overlay', 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* noop */ }
  loaded = false;
  win.webContents.once('did-finish-load', () => { loaded = true; if (lastState) win.webContents.send('overlay:state', lastState); });
  win.loadFile(path.join(__dirname, '..', 'overlay', 'overlay.html'));
  win.on('closed', () => { win = null; loaded = false; });
  return win;
}

function evaluate() {
  const want = mode !== 'off' && (mode === 'always' || gameOn) && hasContent;
  if (want) { const w = ensure(); w.setBounds(bounds()); if (!w.isVisible()) w.showInactive(); w.setAlwaysOnTop(true, 'screen-saver'); }
  else if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

function setMode(m) { mode = ['game', 'always', 'off'].includes(m) ? m : 'game'; evaluate(); }
function setGame(g) { gameOn = !!g; evaluate(); }
function setState(s) {
  lastState = s && typeof s === 'object' ? s : null;
  if (mode === 'off') return;
  // Cria a janela só quando há algo a mostrar; o conteúdo avisa de volta (overlay:content).
  const has = !!(lastState && lastState.snapshot && lastState.snapshot.members && lastState.snapshot.members.length);
  if (has && !win) ensure();
  if (win && !win.isDestroyed() && loaded) win.webContents.send('overlay:state', lastState);
  if (!has && !win) { hasContent = false; evaluate(); }
}
function toast(t) {
  if (mode === 'off' || !(mode === 'always' || gameOn) || !t) return;
  const w = ensure();
  const clean = { title: String(t.title || '').slice(0, 80), body: String(t.body || '').slice(0, 200), icon: String(t.icon || '').slice(0, 500) };
  const send = () => w.webContents.send('overlay:toast', clean);
  hasContent = true; evaluate();
  if (loaded) send(); else w.webContents.once('did-finish-load', send);
}
function setHasContent(v) { hasContent = !!v; evaluate(); }
function destroy() { if (win && !win.isDestroyed()) win.destroy(); win = null; }
module.exports = { setMode, setGame, setState, toast, setHasContent, destroy };
