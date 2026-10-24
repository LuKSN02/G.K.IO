// ============================================================
// G.K.IO — Cores: conversões e derivação do "accent" a partir de uma cor livre.
// Funções puras, sem DOM (testáveis em Node). Usadas por theme.js.
// ============================================================

export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
export function hslToRgb(h, s, l) {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// Luminância relativa (WCAG) e razão de contraste entre duas cores.
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const la = luminance(a); const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Escurece a cor até o texto branco (botões primários) ficar legível sobre ela.
export function ensureWhiteTextContrast(hex, min = 3.2) {
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  let out = hex.toUpperCase();
  let guard = 0;
  while (contrastRatio(out, '#FFFFFF') < min && l > 0.15 && guard++ < 60) {
    l -= 0.015;
    out = rgbToHex(...hslToRgb(h, s, l));
  }
  return out;
}

const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

// { accent, strong, soft, glow } no mesmo formato das paletas de theme.js.
export function deriveAccent(hex, mode = 'dark') {
  const accent = ensureWhiteTextContrast(hex);
  const [h, s, l] = rgbToHsl(...hexToRgb(accent));
  const dark = mode === 'dark';
  const strong = rgbToHex(...hslToRgb(h, s, dark ? Math.min(0.8, l + 0.1) : Math.max(0.15, l - 0.12)));
  return { accent, strong, soft: rgba(accent, dark ? 0.16 : 0.12), glow: rgba(accent, dark ? 0.45 : 0.25) };
}
