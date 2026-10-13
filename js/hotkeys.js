// ============================================================
// G.K.IO — Atalhos de voz (mutar, ensurdecer, push-to-talk)
// Inspirado no sistema de hotkeys do Dorion. Limite da web: os atalhos
// só funcionam com a janela do G.K.IO em foco (atalho global, com o app
// em segundo plano, exige o shell nativo — ver globalShortcut no Electron).
// ============================================================
import { getHotkeyPrefs } from './prefs.js';
import { toggleMute, toggleDeafen, setMicEnabled, hasActiveCall } from './calls.js';

const MOD_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

function keyName(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
// "Ctrl+Shift+M" a partir de um KeyboardEvent (null se só modificadores)
export function comboFromEvent(e) {
  if (MOD_CODES.has(e.code)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(keyName(e.code));
  return parts.join('+');
}
const keyOf = (combo) => combo.split('+').pop();
const hasMods = (combo) => /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);

function isTyping(e) {
  const t = e.target;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

// Captura a próxima combinação digitada (usado pelos botões de atalho em
// Configurações). Esc cancela, Backspace limpa.
let recording = null;
export function recordCombo(cb) {
  recording = cb;
}

let pttHeld = false;
async function pttSet(on) {
  if (pttHeld === on) return;
  pttHeld = on;
  await setMicEnabled(on);
}

export function initHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (recording) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { const cb = recording; recording = null; cb(undefined); return; }
      if (e.key === 'Backspace') { const cb = recording; recording = null; cb(''); return; }
      const combo = comboFromEvent(e);
      if (combo) { const cb = recording; recording = null; cb(combo); }
      return;
    }
    if (e.repeat) return;
    const prefs = getHotkeyPrefs();
    const combo = comboFromEvent(e);
    if (!combo) return;

    if (prefs.ptt && prefs.pttEnabled && combo === prefs.ptt && hasActiveCall()) {
      if (!hasMods(combo) && isTyping(e)) return; // não rouba a tecla enquanto escreve
      e.preventDefault();
      pttSet(true);
      return;
    }
    if (prefs.mute && combo === prefs.mute && hasActiveCall()) { e.preventDefault(); toggleMute(); }
    else if (prefs.deafen && combo === prefs.deafen && hasActiveCall()) { e.preventDefault(); toggleDeafen(); }
  }, true);

  // Soltar a tecla (ou uma das teclas do combo) encerra o push-to-talk.
  document.addEventListener('keyup', (e) => {
    const prefs = getHotkeyPrefs();
    if (pttHeld && prefs.ptt && keyName(e.code) === keyOf(prefs.ptt)) pttSet(false);
  }, true);
  window.addEventListener('blur', () => { if (pttHeld) pttSet(false); });
}
