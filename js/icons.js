// ============================================================
// G.K.IO — Ícones (SVG inline, estilo "Discord": traço grosso,
// pontas arredondadas). Substituem os emojis usados como ícone de
// UI (botões, abas, ações, badges) em todo o app.
//
// NÃO inclui a paleta de emojis nativos do seletor (EMOJI_CATEGORIES,
// em emoji.js) — aqueles continuam emoji unicode de verdade, pois são
// o conteúdo que a pessoa escolhe para inserir na mensagem, não um
// ícone de interface.
//
// Uso:
//   import { icon, iconHtml } from './icons.js';
//   el('button', {}, [icon('close')])              // -> nó <span><svg>...
//   el('button', { html: iconHtml('close') + 'x' }) // -> string crua
// ============================================================
import { el } from './state.js';

// Cada entrada: { path: <conteúdo interno do <svg>>, fill: true|false }
// fill:true  -> ícone "sólido" (fill="currentColor", sem stroke)
// fill:false (padrão) -> ícone de traço (stroke="currentColor", grosso, arredondado)
const ICONS = {
  close:        { path: '<path d="M6 6l12 12M18 6L6 18"/>' },
  minus:        { path: '<path d="M5 12h14"/>' },
  check:        { path: '<path d="M5 12.5l4.5 4.5L19 7"/>' },
  plus:         { path: '<path d="M12 5v14M5 12h14"/>' },
  chevronDown:  { path: '<path d="M5 9l7 7 7-7"/>' },
  chevronLeft:  { path: '<path d="M15 5l-7 7 7 7"/>' },
  externalLink: { path: '<path d="M14 4h6v6M20 4L10 14M9 6H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4"/>' },
  expand:       { path: '<path d="M4 14v6h6M20 10V4h-6M14 10l6-6M4 20l6-6"/>' },

  power:        { path: '<path d="M12 3v8M18.4 6.6a9 9 0 11-12.8 0"/>' },
  menu:         { path: '<path d="M4 7h16M4 12h16M4 17h16"/>' },
  settings:     { path: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>' },
  wrench:       { path: '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2-2z"/>' },

  mic:          { path: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8"/>' },
  micOff:       { path: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8"/><path d="M3 3l18 18"/>' },
  camera:       { path: '<path d="M4 8a2 2 0 012-2h1.2l1-1.6A2 2 0 0110 3.5h4a2 2 0 011.8 1.1L16.8 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"/><circle cx="12" cy="13" r="3.2"/>' },
  videoCall:    { path: '<rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="M16 10l6-4v12l-6-4z"/>' },
  screenShare:  { path: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' },
  phoneCall:    { path: '<path d="M6.6 10.2c1.5 3 4.2 5.7 7.2 7.2l2.4-2.4c.3-.3.7-.4 1-.3 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C11.6 21 3 12.4 3 2.7c0-.6.4-1 1-1h3.7c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.3 1L6.6 10.2z"/>', fill: true },
  phoneEnd:     { path: '<path d="M6.6 10.2c1.5 3 4.2 5.7 7.2 7.2l2.4-2.4c.3-.3.7-.4 1-.3 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C11.6 21 3 12.4 3 2.7c0-.6.4-1 1-1h3.7c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.3 1L6.6 10.2z" transform="rotate(135 12 12)"/>', fill: true },

  attach:       { path: '<path d="M8 12.5l6.5-6.5a3 3 0 114.2 4.2L10.4 18.5a5 5 0 11-7-7L12 3"/>' },
  key:          { path: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 4l3 3M13 7l2 2"/>' },
  send:         { path: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>', fill: true },
  emojiSmile:   { path: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10.2h.01M15.5 10.2h.01M8 14.5c1 1.3 2.4 2 4 2s3-.7 4-2"/>' },

  personPlus:   { path: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0111 0"/><path d="M18 8v6M15 11h6"/>' },
  members:      { path: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0111 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.7 13a4.2 4.2 0 015.8 4"/>' },
  user:         { path: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/>' },
  block:        { path: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>' },

  starFilled:   { path: '<path d="M12 2.5l2.9 6 6.6.8-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6-4.8-4.6 6.6-.8z"/>', fill: true },
  starOutline:  { path: '<path d="M12 2.5l2.9 6 6.6.8-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6-4.8-4.6 6.6-.8z"/>' },
  speaker:      { path: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 9a4 4 0 010 6M19 6a8 8 0 010 12"/>' },
  edit:         { path: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/>' },
  shield:       { path: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>' },
  lock:         { path: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>' },
  link:         { path: '<path d="M9 15l6-6M8 12l-2 2a4 4 0 105.6 5.6l2-2M16 12l2-2a4 4 0 10-5.6-5.6l-2 2"/>' },
  snowflake:    { path: '<path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17M12 2l-2 2M12 2l2 2M12 22l-2-2M12 22l2-2M4.2 7l2.7.4M4.2 7l.4 2.7M19.8 17l-2.7-.4M19.8 17l-.4-2.7M19.8 7l-2.7.4M19.8 7l-.4 2.7M4.2 17l2.7-.4M4.2 17l.4-2.7"/>' },

  diamond:      { path: '<path d="M12 2.5l4.5 6h-9l4.5-6zM3.2 8.5h17.6L12 21.5 3.2 8.5z"/>', fill: true },
  sun:          { path: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/>' },
  moon:         { path: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>', fill: true },
  palette:      { path: '<path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2H17a4 4 0 004-4c0-4.4-4-7.5-9-7.5z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="9.7" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/><circle cx="16.7" cy="10.5" r="1"/>' },
  bell:         { path: '<path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 004 0"/>' },
  bolt:         { path: '<path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>', fill: true },
  trophy:       { path: '<path d="M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M7 5H3v2a4 4 0 004 4M17 5h4v2a4 4 0 01-4 4"/><path d="M9 20h6M12 15v5"/>' },
  crown:        { path: '<path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8z"/>', fill: true },
  flask:        { path: '<path d="M9 3h6M10 3v6l-5.3 9.3A1.8 1.8 0 006.3 21h11.4a1.8 1.8 0 001.6-2.7L14 9V3"/>' },

  chatBubble:   { path: '<path d="M21 11.5a8.5 8.5 0 01-8.5 8.5c-1.2 0-2.3-.2-3.4-.7L4 21l1.8-4.8A8.5 8.5 0 1121 11.5z"/>' },
  tray:         { path: '<path d="M3 8l9-5 9 5v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/><path d="M3 8l9 5 9-5"/>' },
  sparkles:     { path: '<path d="M12 2l1.8 4.9L19 8.7l-4.9 1.8L12 15.4l-1.8-4.9L5 8.7l4.9-1.8L12 2zM19 15l.9 2.5 2.6.9-2.6.9-.9 2.5-.9-2.5-2.6-.9 2.6-.9z"/>', fill: true },
  gamepad:      { path: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/>' },
  book:         { path: '<path d="M4 5a2 2 0 012-2h6v16H6a2 2 0 00-2 2V5z"/><path d="M20 5a2 2 0 00-2-2h-6v16h6a2 2 0 012 2V5z"/>' },
  clapperboard: { path: '<path d="M3 9l1.4-4.4L18 6l-.9 3H3z"/><rect x="3" y="9" width="18" height="11" rx="1.5"/>' },

  instagram:    { path: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1"/>' },
  x:            { path: '<path d="M5 5l14 14M19 5L5 19"/>' },
  github:       { path: '<path d="M12 2a10 10 0 00-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.3-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.6 0 0 .8-.3 2.8 1a9.6 9.6 0 015 0c2-1.3 2.8-1 2.8-1 .5 1.3.2 2.4.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A10 10 0 0012 2z"/>', fill: true },
  youtube:      { path: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l6 3-6 3V9z" fill="var(--gk-surface)"/>' },
  twitch:       { path: '<path d="M4 3l-1 4v12h5v3l3-3h4l5-5V3H4z"/><path d="M14 7v5M9 7v5"/>' },
  discord:      { path: '<path d="M6 8.5C6 6 8 4 12 4s6 2 6 4.5c0 3.5-1 8.5-6 11-5-2.5-6-7.5-6-11z"/><circle cx="9.5" cy="10" r="1.1"/><circle cx="14.5" cy="10" r="1.1"/>' },
  tiktok:       { path: '<path d="M14 3v10.5a3.5 3.5 0 11-3.5-3.5c.3 0 .7 0 1 .1V7.5c-.3 0-.7-.1-1-.1A6 6 0 1016.5 13V8.8A6.5 6.5 0 0021 10V7a4 4 0 01-4-4h-3z"/>' },

  dot:          { path: '<circle cx="12" cy="12" r="7"/>', fill: true },
};

// Retorna só o markup interno (para usar dentro de outro <svg>/template).
function innerPath(name) {
  const def = ICONS[name];
  return def ? def.path : '';
}

// Retorna a string completa do <svg> — útil para `el(tag, { html })`
// ou para embutir dentro do texto de outro elemento.
export function iconHtml(name, { size = 18 } = {}) {
  const def = ICONS[name];
  if (!def) return '';
  const attrs = def.fill
    ? `fill="currentColor" stroke="none"`
    : `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="gk-icon" width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${innerPath(name)}</svg>`;
}

// Retorna um nó DOM pronto para usar como filho em `el(...)`.
export function icon(name, { size = 18, className = '' } = {}) {
  return el('span', { class: ('gk-icon-wrap ' + className).trim(), html: iconHtml(name, { size }) });
}
