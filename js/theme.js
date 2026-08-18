// ============================================================
// G.K.IO — Sistema de temas dinâmicos
// Dois eixos independentes:
//   - mode:   'light' | 'dark' | 'auto' (segue prefers-color-scheme)
//   - accent: uma das paletas em ACCENTS
// Resolvido para data-theme no <html> + variáveis CSS no :root.
// Um script inline no <head> do index.html replica essa lógica de
// forma síncrona para evitar o "flash" de tema antes do JS carregar.
// ============================================================

import { state } from './state.js';

const STORAGE_KEY = 'gkio-theme-prefs';

export const ACCENTS = {
  teal:    { name: 'Glacial Teal', accent: '#1F6F78', strong: '#16545C', soft: 'rgba(31,111,120,0.12)',  glow: 'rgba(31,111,120,0.25)' },
  indigo:  { name: 'Índigo',       accent: '#4C5FD5', strong: '#3945A8', soft: 'rgba(76,95,213,0.12)',   glow: 'rgba(76,95,213,0.25)' },
  rose:    { name: 'Rosé',         accent: '#C24868', strong: '#9C3550', soft: 'rgba(194,72,104,0.12)',  glow: 'rgba(194,72,104,0.25)' },
  amber:   { name: 'Âmbar',        accent: '#B9812E', strong: '#8F6221', soft: 'rgba(185,129,46,0.12)',  glow: 'rgba(185,129,46,0.25)' },
  emerald: { name: 'Esmeralda',    accent: '#22916A', strong: '#186F51', soft: 'rgba(34,145,106,0.12)',  glow: 'rgba(34,145,106,0.25)' },
  violet:  { name: 'Violeta',      accent: '#7C4FC2', strong: '#5F3A98', soft: 'rgba(124,79,194,0.12)',  glow: 'rgba(124,79,194,0.25)' },
};

// Paletas exclusivas de assinantes G.K.IO Prime — mesmas variáveis, só
// liberadas condicionalmente em setAccent() e na UI de Configurações.
export const PREMIUM_ACCENTS = {
  obsidian: { name: 'Obsidiana Prime', accent: '#1C2733', strong: '#0F161D', soft: 'rgba(28,39,51,0.14)',  glow: 'rgba(28,39,51,0.3)' },
  aurora:   { name: 'Aurora Prime',    accent: '#1FA7C9', strong: '#146E85', soft: 'rgba(31,167,201,0.14)', glow: 'rgba(31,167,201,0.3)' },
};

const ALL_ACCENTS = { ...ACCENTS, ...PREMIUM_ACCENTS };

const DEFAULTS = { mode: 'light', accent: 'teal' };

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch (e) { return { ...DEFAULTS }; }
}
function savePrefs() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* storage indisponível */ }
}

export function getThemePrefs() { return { ...prefs }; }

export function resolvedMode() {
  return prefs.mode === 'auto' ? (mediaQuery.matches ? 'dark' : 'light') : prefs.mode;
}

export function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedMode());
  const a = ALL_ACCENTS[prefs.accent] || ACCENTS.teal;
  const root = document.documentElement.style;
  root.setProperty('--gk-accent', a.accent);
  root.setProperty('--gk-accent-strong', a.strong);
  root.setProperty('--gk-accent-soft', a.soft);
  root.setProperty('--gk-accent-glow', a.glow);
}

export function setThemeMode(mode) {
  prefs.mode = mode;
  savePrefs();
  applyTheme();
}

export function setAccent(key) {
  if (!ALL_ACCENTS[key]) return;
  // Proteção extra no client (a regra de verdade é o próprio backend não
  // ter como validar isso — aqui é só pra não deixar a UI mentir).
  if (PREMIUM_ACCENTS[key] && (!state.user || state.user.role !== 'prime')) return;
  prefs.accent = key;
  savePrefs();
  applyTheme();
}

mediaQuery.addEventListener('change', () => { if (prefs.mode === 'auto') applyTheme(); });

// Garante consistência assim que o módulo é importado (o script inline
// do <head> já cobre o 1º paint; isto sincroniza o estado do módulo).
applyTheme();
