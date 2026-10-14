// ============================================================
// G.K.IO — Camada de compatibilidade com temas do Discord
//
// No BetterDiscord/Vencord os temas funcionam porque o app É o Discord:
// o CSS mira as classes e variáveis do próprio Discord. Aqui o G.K.IO
// "se apresenta" como Discord para esses temas:
//
//   1. <html> ganha .theme-dark / .theme-light e <body> ganha #app-mount
//   2. as áreas principais do app ganham os nomes de classe do Discord
//      (sidebar_c48ade, container__26baa, ...) — ver ALIASES
//   3. variáveis do Discord ganham valores padrão e as variáveis --gk-*
//      do app passam a ler as do tema (cores, bordas, fonte, accent)
//
// Só liga quando existe ao menos um tema marcado como "Discord"
// (ver extensions.js). Temas nativos (--gk-*) não são afetados.
//
// Limite honesto: os temas do Discord são escritos para a árvore de
// elementos do Discord (que muda a cada atualização deles). Aqui cobrimos
// as áreas grandes — fundos, barras, listas, botões, campos, menus,
// fonte e accent. Detalhes que dependem da estrutura exata do Discord
// (pílulas nos servidores, mensagens em "balões", ícones por máscara SVG)
// não têm equivalente. Para ampliar a cobertura, basta acrescentar linhas
// em ALIASES.
// ============================================================

const STYLE_ID = 'gk-discord-compat';
const ROOT = document.documentElement;

const TEXT_INPUT = ':not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="hidden"])';

// [seletor no G.K.IO, classes do Discord a acrescentar, seletor a excluir (opcional)]
export const ALIASES = [
  ['#gk-app', 'app_de4237'],
  // cabeçalhos: barra global, cabeçalho da sidebar e da conversa (altura/borda iguais)
  ['.gk-topbar-global, .gk-topbar, .gk-sidebar-header', 'container__26baa'],
  ['.gk-rail', 'scroller_ef3116'],
  ['.gk-sidebar', 'sidebar_c48ade'],
  ['.gk-sidebar-body', 'scroller__629e4'],
  ['.gk-main', 'chatContent_f75fb0'],
  ['.gk-composer-box', 'channelTextArea_f75fb0'],
  ['.gk-members', 'container_c8ffbb membersWrap_c8ffbb'],
  ['.gk-server-menu, .gk-profile-menu, .gk-notif-panel', 'menu__088f7'],
  // botões
  ['.gk-btn', 'button__201d5 lookFilled__201d5'],
  ['.gk-btn-primary', 'colorBrand__201d5'],
  ['.gk-btn-ghost', 'colorPrimary__201d5'],
  ['.gk-btn-danger', 'colorRed__201d5'],
  // campos de texto (os que têm ícone dentro ficam de fora para não sobrepor o ícone)
  [
    `.gk-field input${TEXT_INPUT}, .gk-modal input${TEXT_INPUT}, .gk-modal textarea`,
    'input-2g-os5',
    '.gk-field-icon-input > input, .gk-msg-edit-textarea',
  ],
];

// ---------- CSS de compatibilidade ----------
// Fica ANTES dos temas do usuário no <head>, então o tema sempre vence.
// Os padrões usam :where() (especificidade zero) pelo mesmo motivo.
const COMPAT_CSS = `
/* 1) Valores padrão das variáveis do Discord (paleta escura "2020") */
:where(:root) {
  --font-primary: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-code: 'IBM Plex Mono', Consolas, monospace;
  --saturation-factor: 1;
  --white-500: #fff; --white-500-hsl: 0 0% 100%; --black-500-hsl: 0 0% 0%;
  --brand-experiment: #5865f2; --brand-500: var(--brand-experiment);
  --red: #ed4245; --green: #3ba55d; --yellow: #faa61a;
}
:where(html.theme-dark) {
  --primary-200: #b9bbbe; --primary-230: #dcddde; --primary-400: #8e9297;
  --primary-500: #4f545c; --primary-600: #36393f; --primary-630: #2f3136;
  --primary-660: #292b2f; --primary-700: #202225; --primary-800: #18191c;
  --primary-700-hsl: 220 7% 13%; --primary-900-hsl: 210 4% 4%;
  --neutral-1: #fff; --neutral-5: #f2f3f5; --neutral-9: #dbdee1; --neutral-16: #b5bac1; --neutral-22: #949ba4;
  --neutral-80: #313338; --neutral-84: #2b2d31; --neutral-87: #232428; --neutral-89: #1e1f22;
  --neutral-95: #111214; --neutral-96: #0d0e10; --neutral-98: #050506; --neutral-100: #000;
  --background-primary: var(--primary-600); --background-secondary: var(--primary-630);
  --background-secondary-alt: var(--primary-660); --background-tertiary: var(--primary-700);
  --background-floating: var(--primary-800); --background-accent: var(--primary-500);
  --background-modifier-hover: rgba(79,84,92,.16); --background-modifier-active: rgba(79,84,92,.24);
  --background-modifier-selected: rgba(79,84,92,.32); --background-modifier-accent: rgba(255,255,255,.06);
  --chat-background-default: var(--background-primary);
  --text-normal: #dcddde; --text-default: #dcddde; --text-muted: #72767d;
  --header-primary: #fff; --header-secondary: #b9bbbe;
  --interactive-normal: #b9bbbe; --interactive-hover: #dcddde; --interactive-active: #fff; --interactive-muted: #4f545c;
  --channels-default: #8e9297; --text-link: #00b0f4;
}
:where(html.theme-light) {
  --primary-500: #747f8d; --primary-600: #fff; --primary-630: #f2f3f5; --primary-660: #ebedef; --primary-700: #e3e5e8; --primary-800: #fff;
  --primary-700-hsl: 210 9% 90%; --primary-900-hsl: 210 4% 4%;
  --neutral-1: #060607; --neutral-5: #2e3338; --neutral-9: #4f5660; --neutral-16: #4f5660; --neutral-22: #747f8d;
  --background-primary: #fff; --background-secondary: #f2f3f5; --background-secondary-alt: #ebedef;
  --background-tertiary: #e3e5e8; --background-floating: #fff; --background-accent: #747f8d;
  --background-modifier-hover: rgba(116,127,141,.08); --background-modifier-active: rgba(116,127,141,.12);
  --background-modifier-selected: rgba(116,127,141,.16); --background-modifier-accent: rgba(6,6,7,.08);
  --chat-background-default: var(--background-primary);
  --text-normal: #2e3338; --text-default: #2e3338; --text-muted: #747f8d;
  --header-primary: #060607; --header-secondary: #4f5660;
  --interactive-normal: #4f5660; --interactive-hover: #2e3338; --interactive-active: #060607; --interactive-muted: #c7ccd1;
  --channels-default: #6a7480; --text-link: #0068e0;
}

/* 2) Ponte: as variáveis --gk-* do app leem as do tema.
      Cada var(--a, var(--b)) tenta primeiro o nome usado por temas "próprios"
      (ex.: Fluent) e cai para o nome padrão do Discord (ex.: OldCord).
      !important no accent porque o theme.js grava o accent inline no <html>. */
:root.gk-discord-theme[data-theme] {
  --gk-bg: var(--bg-alt, var(--chat-background-default, var(--background-primary)));
  --gk-surface: var(--bg-alt, var(--background-secondary));
  --gk-surface-sunken: var(--bg-interactive, var(--background-tertiary));
  --gk-surface-raised: var(--bg-content, var(--background-secondary-alt));
  --gk-rail: var(--bg-main, var(--background-tertiary));

  --gk-gray-100: var(--border-mid, var(--background-modifier-accent));
  --gk-gray-200: var(--border-high, var(--background-modifier-selected));
  --gk-gray-300: var(--bg-highest, var(--background-accent));
  --gk-gray-400: var(--text-quaternary, var(--text-muted));
  --gk-gray-500: var(--text-tertiary, var(--text-muted));
  --gk-gray-600: var(--text-secondary, var(--header-secondary));
  --gk-gray-700: var(--text-primary, var(--interactive-hover));
  --gk-gray-800: var(--text-primary, var(--text-normal));
  --gk-gray-900: var(--text-primary, var(--header-primary));

  --gk-accent: var(--accent, var(--brand-experiment)) !important;
  --gk-accent-strong: color-mix(in srgb, var(--gk-accent) 70%, #fff) !important;
  --gk-accent-soft: color-mix(in srgb, var(--gk-accent) 18%, transparent) !important;
  --gk-accent-glow: color-mix(in srgb, var(--gk-accent) 40%, transparent) !important;
  --gk-brand-start: var(--gk-accent);
  --gk-brand-end: var(--gk-accent);

  --gk-danger: var(--red);
  --gk-danger-soft: color-mix(in srgb, var(--red) 16%, transparent);
  --gk-status-online: var(--green);
  --gk-status-idle: var(--yellow);
  --gk-status-dnd: var(--red);
  --gk-status-offline: var(--text-muted);

  --gk-font-display: var(--font-primary);
  --gk-font-body: var(--font-primary);
  --gk-font-mono: var(--font-code);

  --gk-radius-sm: var(--rounded, 4px);
  --gk-radius-md: var(--btn-radius, var(--rounded, 6px));
  --gk-radius-lg: var(--rounded-high, 8px);
  --gk-radius-xl: var(--rounded-high, 12px);

  --gk-sidebar-w: var(--channels-width, 268px);
  --gk-members-w: var(--members-width, var(--custom-member-list-width, 232px));

  --gk-frost-pattern: none;
  --gk-shadow-glow: none;
}
:root.gk-discord-theme[data-theme="light"] {
  --gk-accent-strong: color-mix(in srgb, var(--gk-accent) 75%, #000) !important;
}

/* 3) Ajustes para o visual "chapado" do Discord */
html.gk-discord-theme .gk-btn-primary { color: var(--accent-text, #fff); }
html.gk-discord-theme .gk-btn-primary::after { display: none; }
html.gk-discord-theme .gk-channel.gk-active::before,
html.gk-discord-theme .gk-dm-row.gk-active::before { animation: none; box-shadow: none; background: var(--gk-accent); }
html.gk-discord-theme .gk-rail-item.gk-rail-nav-item.gk-active .gk-rail-nav-icon { filter: none; }
`;

// ---------- Estado ----------
let enabled = false;
let observer = null;
let themeObserver = null;
let ownsBodyId = false;
let scheduled = false;
const pending = new Set();

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = COMPAT_CSS;
  }
  // sempre antes do primeiro tema do usuário (o tema precisa vencer em empates)
  const firstUserTheme = document.head.querySelector('[data-gk-user-theme]');
  if (firstUserTheme) {
    if (style.nextSibling !== firstUserTheme || style.parentNode !== document.head) document.head.insertBefore(style, firstUserTheme);
  } else if (!style.parentNode) {
    document.head.appendChild(style);
  }
}

function syncModeClasses() {
  const light = ROOT.getAttribute('data-theme') === 'light';
  ROOT.classList.toggle('theme-light', light);
  ROOT.classList.toggle('theme-dark', !light);
}

function aliasIn(scope, rule, remove) {
  const [selector, classes, exclude] = rule;
  const names = classes.split(' ');
  const hits = [];
  if (scope.nodeType === 1 && scope.matches(selector)) hits.push(scope);
  scope.querySelectorAll(selector).forEach((n) => hits.push(n));
  hits.forEach((n) => {
    if (exclude && n.matches(exclude)) return;
    if (remove) n.classList.remove(...names); else n.classList.add(...names);
  });
}

function applyAliases(scope = document, remove = false) {
  ALIASES.forEach((rule) => { try { aliasIn(scope, rule, remove); } catch (e) { /* seletor inválido não derruba o resto */ } });
}

function flush() {
  scheduled = false;
  if (!enabled) { pending.clear(); return; }
  const nodes = [...pending];
  pending.clear();
  nodes.forEach((n) => { if (n.isConnected) applyAliases(n); });
}

function startObservers() {
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.add(n); });
    if (pending.size && !scheduled) { scheduled = true; requestAnimationFrame(flush); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  themeObserver = new MutationObserver(syncModeClasses);
  themeObserver.observe(ROOT, { attributes: true, attributeFilter: ['data-theme'] });
}

function stopObservers() {
  observer?.disconnect(); observer = null;
  themeObserver?.disconnect(); themeObserver = null;
  pending.clear();
}

/** Liga/desliga a camada. Seguro de chamar várias vezes. */
export function setDiscordCompat(on) {
  if (on) {
    ensureStyle(); // reordena se um tema novo entrou antes do estilo
    if (enabled) return;
    enabled = true;
    syncModeClasses();
    ROOT.classList.add('gk-discord-theme');
    if (!document.body.id) { document.body.id = 'app-mount'; ownsBodyId = true; }
    applyAliases();
    startObservers();
  } else {
    if (!enabled) return;
    enabled = false;
    stopObservers();
    applyAliases(document, true);
    ROOT.classList.remove('gk-discord-theme', 'theme-dark', 'theme-light');
    if (ownsBodyId && document.body.id === 'app-mount') document.body.removeAttribute('id');
    ownsBodyId = false;
    document.getElementById(STYLE_ID)?.remove();
  }
}

export function isDiscordCompatOn() { return enabled; }

/**
 * Heurística: este CSS foi escrito para o Discord?
 * CSS que já usa --gk-* / .gk-* é nativo do G.K.IO e nunca entra no modo Discord.
 */
export function looksLikeDiscordTheme(css) {
  if (/--gk-|\.gk-|#gk-/.test(css)) return false;
  return /discord|betterdiscord|vencord|#app-mount|\.theme-(dark|light)\b|@authorId|@invite|\b[a-zA-Z]+_[0-9a-f]{6}\b/i.test(css);
}
