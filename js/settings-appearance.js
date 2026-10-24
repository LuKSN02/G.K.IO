// ============================================================
// G.K.IO — Configurações: cartões de aparência e seção Acessibilidade
// A lógica (e o armazenamento) vive em js/appearance.js; aqui só a interface.
// ============================================================
import { el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import {
  getAppearance, setAppearance, resetAppearance, DEFAULTS, UI_FONTS, SURFACES,
  CHAT_FONT_MIN, CHAT_FONT_MAX,
} from './appearance.js';
import { getThemePrefs, setCustomAccent, resolvedMode } from './theme.js';
import { isHex, contrastRatio, ensureWhiteTextContrast } from './color-utils.js';

const normalizeHex = (v) => { const t = String(v || '').trim(); const h = t.startsWith('#') ? t : '#' + t; return isHex(h) ? h.toUpperCase() : ''; };

function card(title, children) {
  return el('div', { class: 'gk-settings-card' }, [el('div', { class: 'gk-settings-card-title' }, title), ...children]);
}
function hint(text) { return el('div', { class: 'gk-hint', style: 'margin:0 0 10px;' }, text); }

function toggleRow(label, checked, onChange, sub = '') {
  const row = el('div', { class: 'gk-toggle-row' });
  const toggle = el('div', {
    class: 'gk-toggle' + (checked ? ' gk-on' : ''), role: 'switch', tabindex: '0',
    'aria-checked': String(!!checked), 'aria-label': label,
  });
  const flip = () => {
    const next = !toggle.classList.contains('gk-on');
    toggle.classList.toggle('gk-on', next);
    toggle.setAttribute('aria-checked', String(next));
    onChange(next);
  };
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  row.appendChild(el('span', {}, sub ? [label, el('br'), el('small', { class: 'gk-hint' }, sub)] : label));
  row.appendChild(toggle);
  return row;
}

function sliderRow({ min, max, step, value, format, onInput, label }) {
  const out = el('span', { class: 'gk-ap-value' }, format(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); onInput(Number(input.value)); });
  return { row: el('div', { class: 'gk-ap-row' }, [input, out]), input, out };
}

function segmented(options, current, onPick) {
  const wrap = el('div', { class: 'gk-ap-seg', role: 'radiogroup' });
  for (const [value, label] of options) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'gk-on' : '' }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('gk-on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('gk-on'); b.setAttribute('aria-checked', 'true');
      onPick(value);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

// ---------- Cor de destaque livre ----------
export function buildCustomAccentCard(rerender) {
  const theme = getThemePrefs();
  const start = normalizeHex(theme.customAccent) || '#6C63F5';
  const picker = el('input', { type: 'color', value: start, 'aria-label': 'Escolher cor de destaque' });
  const text = el('input', { type: 'text', value: start, maxlength: '7', spellcheck: 'false', 'aria-label': 'Código da cor em hexadecimal' });
  const warn = el('div', { class: 'gk-ap-warn', style: 'display:none;' });

  const apply = (hex) => {
    const clean = normalizeHex(hex);
    if (!clean) return false;
    const readable = ensureWhiteTextContrast(clean);
    warn.style.display = readable !== clean ? 'block' : 'none';
    if (readable !== clean) warn.textContent = `Essa cor é clara demais para texto branco (contraste ${contrastRatio(clean, '#FFFFFF').toFixed(1)}:1). Usei uma versão mais escura para os botões ficarem legíveis.`;
    setCustomAccent(clean);
    return true;
  };
  picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); apply(picker.value); });
  picker.addEventListener('change', () => rerender());
  text.addEventListener('change', () => {
    const clean = normalizeHex(text.value);
    if (!clean) { toast('Código de cor inválido. Use algo como #FF5D8F.', 'danger'); text.value = picker.value.toUpperCase(); return; }
    picker.value = clean.toLowerCase(); text.value = clean; apply(clean); rerender();
  });

  return card('Cor de destaque livre', [
    hint('Escolha qualquer cor — ela vale para botões, links, brilho e seleções neste dispositivo.'),
    el('div', { class: 'gk-ap-color' }, [picker, text,
      el('button', { type: 'button', class: 'gk-btn gk-btn-ghost', onclick: () => { text.value = '#6C63F5'; picker.value = '#6c63f5'; apply('#6C63F5'); rerender(); } }, 'Voltar ao padrão (Cosmic Violet)'),
    ]),
    warn,
  ]);
}

// ---------- Leitura: fonte, densidade, cantos, hora ----------
const RADIUS_OPTIONS = [['sharp', 'Retos'], ['default', 'Padrão'], ['round', 'Arredondados']];

export function buildReadingCard() {
  const ap = getAppearance();

  const preview = el('div', { class: 'gk-ap-preview', 'aria-hidden': 'true' }, [
    el('div', { class: 'gk-msg-group' }, [
      el('div', { class: 'gk-avatar gk-sz-40' }, [el('img', { src: fallbackAvatar('GK'), alt: '' })]),
      el('div', { class: 'gk-msg-body' }, [
        el('div', { class: 'gk-msg-head' }, [el('span', { class: 'gk-author' }, 'G.K.IO'), el('span', { class: 'gk-time' }, '14:32')]),
        el('div', { class: 'gk-msg-row' }, [el('div', { class: 'gk-msg-line' }, 'Assim as mensagens aparecem no chat. A raposa marrom rápida pula sobre o cão preguiçoso.')]),
        el('div', { class: 'gk-msg-row' }, [el('div', { class: 'gk-msg-line' }, 'Uma segunda mensagem seguida, para ver o espaçamento.')]),
      ]),
    ]),
  ]);

  const fontSize = sliderRow({
    min: CHAT_FONT_MIN, max: CHAT_FONT_MAX, step: 0.5, value: ap.chatFontSize, label: 'Tamanho da fonte do chat',
    format: (v) => v + ' px', onInput: (v) => setAppearance({ chatFontSize: v }),
  });
  const family = el('select', { class: 'gk-ap-select', 'aria-label': 'Fonte do app' },
    Object.entries(UI_FONTS).map(([id, label]) => el('option', { value: id, selected: id === ap.uiFont ? 'true' : null }, label)));
  family.addEventListener('change', () => setAppearance({ uiFont: family.value }));

  const card_ = card('Leitura e layout', [
    preview,
    el('div', { class: 'gk-ap-subtitle' }, 'Tamanho da fonte do chat'),
    fontSize.row,
    el('div', { class: 'gk-ap-subtitle' }, 'Fonte do app'),
    el('div', { class: 'gk-ap-row' }, [family]),
    el('div', { class: 'gk-ap-subtitle' }, 'Densidade das mensagens'),
    el('div', { class: 'gk-ap-row' }, [segmented([['cozy', 'Confortável'], ['compact', 'Compacto']], ap.density, (v) => setAppearance({ density: v }))]),
    el('div', { class: 'gk-ap-subtitle' }, 'Arredondamento dos cantos'),
    el('div', { class: 'gk-ap-row' }, [segmented(RADIUS_OPTIONS, ap.radius, (v) => setAppearance({ radius: v }))]),
    el('div', { class: 'gk-ap-subtitle' }, 'Formato da hora'),
    el('div', { class: 'gk-ap-row' }, [segmented([['24h', '24 horas'], ['12h', '12 horas (AM/PM)']], ap.timeFormat, (v) => setAppearance({ timeFormat: v }))]),
  ]);
  return card_;
}

// ---------- Fundo do app (só no tema escuro) ----------
export function buildSurfaceCard() {
  const ap = getAppearance();
  const dark = resolvedMode() === 'dark';
  return card('Fundo do app', [
    hint(dark
      ? 'Muda o tom das superfícies escuras. “AMOLED” usa preto puro e economiza bateria em telas OLED.'
      : 'Estes fundos só valem no tema escuro. Troque o modo de exibição para Escuro para ver o efeito.'),
    el('div', { class: 'gk-ap-row' }, [segmented(Object.entries(SURFACES), ap.surface, (v) => setAppearance({ surface: v }))]),
  ]);
}

// ---------- Seção: Acessibilidade ----------
export function renderAccessibilitySection(content, sectionHeader) {
  content.appendChild(sectionHeader('Acessibilidade', 'Ajustes de movimento, contraste, cor e teclado — salvos neste dispositivo.', 'settings'));
  const ap = getAppearance();

  const motion = segmented(
    [['system', 'Seguir o sistema'], ['on', 'Reduzir'], ['off', 'Manter']],
    ap.reduceMotion, (v) => setAppearance({ reduceMotion: v }),
  );
  content.appendChild(card('Movimento', [
    hint('“Reduzir” desliga transições e animações do app (splash, entrada de mensagens, brilhos). “Seguir o sistema” respeita a preferência do seu sistema operacional.'),
    el('div', { class: 'gk-ap-row' }, [motion]),
  ]));

  content.appendChild(card('Visão', [
    toggleRow('Alto contraste', ap.contrast === 'high', (v) => setAppearance({ contrast: v ? 'high' : 'normal' }), 'Texto e bordas mais fortes; também reforça o foco do teclado.'),
    toggleRow('Sublinhar links', ap.underlineLinks, (v) => setAppearance({ underlineLinks: v }), 'Links ficam sublinhados em todo o app, não só pela cor.'),
    toggleRow('Cores de status para daltônicos', ap.colorblind, (v) => setAppearance({ colorblind: v }), 'Online azul, ausente laranja, não perturbe magenta.'),
  ]));

  content.appendChild(card('Teclado', [
    toggleRow('Contorno de foco reforçado', ap.strongFocus || ap.contrast === 'high', (v) => setAppearance({ strongFocus: v }), 'Mostra um contorno grosso no item selecionado ao navegar com Tab.'),
    el('div', { class: 'gk-hint', style: 'margin-top:8px;' }, 'Atalho útil: Ctrl+F abre a busca de mensagens na conversa aberta.'),
  ]));

  content.appendChild(card('Tamanho do texto', [
    hint('O tamanho da fonte do chat, a fonte e a densidade ficam em Aparência > Leitura e layout. O zoom geral da interface fica em Aparência > Zoom.'),
  ]));

  content.appendChild(el('div', { class: 'gk-settings-save-row' }, [
    el('button', {
      type: 'button', class: 'gk-btn gk-btn-ghost',
      onclick: () => { resetAppearance(); toast('Aparência e acessibilidade restauradas ao padrão.'); content.innerHTML = ''; renderAccessibilitySection(content, sectionHeader); },
    }, [icon('close', { size: 14 }), ' Restaurar tudo ao padrão']),
  ]));
}
