// ============================================================
// G.K.IO — Zoom da interface (porta do zoom.ts do Dorion)
// Slider em Configurações > Aparência. Os atalhos Ctrl + / Ctrl − / Ctrl 0
// e Ctrl+scroll só são interceptados no app desktop (Electron) ou se o
// usuário ligar a opção — num navegador comum eles continuam sendo o
// zoom nativo do navegador.
// ============================================================
const KEY = 'gkio-zoom-prefs';
export const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.1;
const defaults = { level: 1, hotkeys: false };
let prefs = read();

function read() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...defaults }; }
}
function write() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ } }
const clamp = (v) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));

export const isElectron = () => /Electron\//.test(navigator.userAgent);
export function getZoomPrefs() { return { ...prefs, hotkeysActive: isElectron() || prefs.hotkeys }; }

export function applyZoom() {
  const z = clamp(prefs.level);
  const root = document.documentElement;
  root.style.setProperty('--gk-zoom', String(z));
  root.style.zoom = z === 1 ? '' : String(z);
}
export function setZoom(level) { prefs.level = clamp(level); write(); applyZoom(); return prefs.level; }
export function setZoomHotkeys(on) { prefs.hotkeys = !!on; write(); }

export function initZoom() {
  applyZoom();
  document.addEventListener('keydown', (e) => {
    if (!getZoomPrefs().hotkeysActive || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const plus = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
    const minus = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-';
    const reset = e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0';
    if (!plus && !minus && !reset) return;
    e.preventDefault();
    setZoom(reset ? 1 : prefs.level + (plus ? ZOOM_STEP : -ZOOM_STEP));
    window.dispatchEvent(new CustomEvent('gkio-zoom-change'));
  });
  document.addEventListener('wheel', (e) => {
    if (!getZoomPrefs().hotkeysActive || !(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
    e.preventDefault();
    setZoom(prefs.level + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    window.dispatchEvent(new CustomEvent('gkio-zoom-change'));
  }, { passive: false });
}
