// Push-to-talk GLOBAL (funciona com o app em segundo plano). O globalShortcut
// do Electron só dispara no "apertar", sem "soltar", então usamos o
// uiohook-napi (dependência opcional). Sem ele, o PTT continua funcionando
// com a janela em foco (atalho do próprio app web). Não funciona em Wayland.
let uio = null;
let started = false;
let listening = false;
let target = null; // keycode do uiohook
let held = false;
let emit = () => {};

function load() {
  if (uio !== null) return uio;
  try { uio = require('uiohook-napi'); } catch (e) { uio = false; }
  return uio;
}

function keycodeFor(combo) {
  const m = load();
  if (!m || !combo) return null;
  const key = combo.split('+').pop();
  const name = key === 'Space' ? 'Space' : key === 'Backquote' ? 'Backquote' : key;
  const code = m.UiohookKey[name];
  return typeof code === 'number' ? code : null;
}

function setBinding(combo, onChange) {
  emit = onChange;
  const m = load();
  target = keycodeFor(combo);
  if (!m) return { supported: false };
  if (target === null) { stop(); return { supported: true, active: false }; }
  if (!started) {
    if (!listening) {
      listening = true;
      m.uIOhook.on('keydown', (e) => { if (e.keycode === target && !held) { held = true; emit(true); } });
      m.uIOhook.on('keyup', (e) => { if (e.keycode === target && held) { held = false; emit(false); } });
    }
    try { m.uIOhook.start(); started = true; } catch (e) { return { supported: false }; }
  }
  return { supported: true, active: true };
}
function stop() {
  const m = load();
  if (m && started) { try { m.uIOhook.stop(); } catch (e) { /* noop */ } }
  started = false; held = false; target = null;
}
module.exports = { setBinding, stop };
