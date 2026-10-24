// ============================================================
// G.K.IO — Aparência e acessibilidade (preferências locais)
// Tudo fica no localStorage deste aparelho e vira atributos data-* no <html>
// (os estilos estão em css/features.css) — não mexe no Firebase.
// Sem dependências: pode ser importado por state.js, theme.js e settings.
// ============================================================
const KEY = 'gkio-appearance';

export const CHAT_FONT_MIN = 12;
export const CHAT_FONT_MAX = 22;
export const CHAT_FONT_DEFAULT = 14.5;

export const DEFAULTS = {
  chatFontSize: CHAT_FONT_DEFAULT, // px do texto das mensagens
  uiFont: 'default',               // default | system | serif | mono | readable
  density: 'cozy',                 // cozy | compact
  radius: 'default',               // sharp | default | round
  surface: 'default',              // default | amoled | graphite | midnight (só no tema escuro)
  timeFormat: '24h',               // 24h | 12h
  reduceMotion: 'system',          // system | on | off
  contrast: 'normal',              // normal | high
  colorblind: false,               // cores de status amigáveis a daltonismo
  underlineLinks: false,
  strongFocus: false,
};

export const UI_FONTS = {
  default: 'Padrão (Inter)',
  system: 'Fonte do sistema',
  serif: 'Com serifa',
  mono: 'Monoespaçada',
  readable: 'Alta legibilidade (Atkinson)',
};
export const SURFACES = {
  default: 'Padrão',
  amoled: 'AMOLED (preto)',
  graphite: 'Grafite',
  midnight: 'Meia-noite',
};

const ENUMS = {
  uiFont: Object.keys(UI_FONTS),
  density: ['cozy', 'compact'],
  radius: ['sharp', 'default', 'round'],
  surface: Object.keys(SURFACES),
  timeFormat: ['24h', '12h'],
  reduceMotion: ['system', 'on', 'off'],
  contrast: ['normal', 'high'],
};

// Valida/limpa um objeto vindo do storage (ou de um patch): valores inválidos voltam ao padrão.
export function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(raw[k])) out[k] = raw[k];
  }
  const size = Number(raw.chatFontSize);
  if (Number.isFinite(size)) out.chatFontSize = Math.min(CHAT_FONT_MAX, Math.max(CHAT_FONT_MIN, Math.round(size * 2) / 2));
  for (const k of ['colorblind', 'underlineLinks', 'strongFocus']) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

function read() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return { ...DEFAULTS }; }
}
let prefs = read();

export function getAppearance() { return { ...prefs }; }

export function setAppearance(patch) {
  prefs = sanitize({ ...prefs, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* storage indisponível */ }
  applyAppearance();
  return getAppearance();
}
export function resetAppearance() {
  prefs = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
  applyAppearance();
}

// Hora das mensagens: usado por state.js (formatTime).
export function hour12() { return prefs.timeFormat === '12h'; }

// Fonte "Atkinson Hyperlegible" só é baixada se alguém escolher.
let readableFontLoaded = false;
function ensureReadableFont() {
  if (readableFontLoaded || typeof document === 'undefined') return;
  readableFontLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap';
  document.head.appendChild(link);
}

export function applyAppearance() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const set = (name, on, value) => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
  root.style.setProperty('--gk-chat-font-size', prefs.chatFontSize + 'px');
  set('data-ui-font', prefs.uiFont !== 'default', prefs.uiFont);
  set('data-density', prefs.density !== 'cozy', prefs.density);
  set('data-radius', prefs.radius !== 'default', prefs.radius);
  set('data-surface', prefs.surface !== 'default', prefs.surface);
  set('data-motion', prefs.reduceMotion !== 'system', prefs.reduceMotion === 'on' ? 'reduce' : 'full');
  set('data-contrast', prefs.contrast === 'high', 'high');
  set('data-colorblind', prefs.colorblind, 'true');
  set('data-underline-links', prefs.underlineLinks, 'true');
  set('data-strong-focus', prefs.strongFocus, 'true');
  if (prefs.uiFont === 'readable') ensureReadableFont();
}

// ---------- Leitores de tela ----------
// Botões só com ícone costumam ter `title` mas não `aria-label`: copia um para o outro,
// inclusive nos que o app cria depois. A lista de mensagens vira uma região "ao vivo" educada.
function labelButtons(root) {
  root.querySelectorAll?.('button[title]:not([aria-label]), [role="button"][title]:not([aria-label]), a[title]:not([aria-label])').forEach((n) => {
    const t = n.getAttribute('title');
    if (t) n.setAttribute('aria-label', t);
  });
}
export function initAccessibility() {
  if (typeof document === 'undefined' || initAccessibility._done) return;
  initAccessibility._done = true;
  const messages = document.getElementById('gk-messages');
  if (messages) { messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite'); messages.setAttribute('aria-label', 'Mensagens da conversa'); }
  labelButtons(document);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; labelButtons(document); });
  }).observe(document.body, { childList: true, subtree: true });
}

applyAppearance();
