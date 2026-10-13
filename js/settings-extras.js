// ============================================================
// G.K.IO — Cartões de configurações trazidos do Dorion
// Zoom, atalhos de voz, presença automática e Temas & Plugins.
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { getHotkeyPrefs, setHotkeyPrefs, getIdlePrefs, setIdlePrefs } from './prefs.js';
import { getZoomPrefs, setZoom, setZoomHotkeys, isElectron, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from './zoom.js';
import { recordCombo } from './hotkeys.js';
import { syncShortcuts } from './desktop.js';
import {
  isSafeMode, listThemes, listPlugins, addTheme, setThemeEnabled, removeTheme,
  addPlugin, setPluginEnabled, removePlugin,
} from './extensions.js';

function toggleRow(label, checked, onChange, hint) {
  const row = el('div', { class: 'gk-toggle-row' });
  const toggle = el('div', { class: 'gk-toggle' + (checked ? ' gk-on' : '') });
  toggle.addEventListener('click', () => {
    const next = !toggle.classList.contains('gk-on');
    toggle.classList.toggle('gk-on', next);
    onChange(next);
  });
  row.appendChild(el('span', {}, hint ? [label, el('small', { class: 'gk-ext-hint' }, hint)] : label));
  row.appendChild(toggle);
  return row;
}
const card = (title, children) => el('div', { class: 'gk-settings-card' }, [el('div', { class: 'gk-settings-card-title' }, title), ...[].concat(children)]);

// ---------- Zoom (Aparência) ----------
export function buildZoomCard() {
  const prefs = getZoomPrefs();
  const label = el('span', { class: 'gk-ext-zoom-value' }, Math.round(prefs.level * 100) + '%');
  const slider = el('input', { type: 'range', class: 'gk-ext-zoom-slider', min: ZOOM_MIN * 100, max: ZOOM_MAX * 100, step: ZOOM_STEP * 100, value: Math.round(prefs.level * 100) });
  const sync = () => { const z = getZoomPrefs().level; slider.value = Math.round(z * 100); label.textContent = Math.round(z * 100) + '%'; };
  slider.addEventListener('input', () => { setZoom(slider.value / 100); label.textContent = slider.value + '%'; });
  window.addEventListener('gkio-zoom-change', sync);
  const reset = el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => { setZoom(1); sync(); } }, 'Redefinir');
  const rows = [el('div', { class: 'gk-ext-zoom-row' }, [slider, label, reset])];
  if (isElectron()) {
    rows.push(el('div', { class: 'gk-hint gk-ext-note' }, 'Atalhos ativos: Ctrl + / Ctrl − / Ctrl 0 e Ctrl + roda do mouse.'));
  } else {
    rows.push(toggleRow('Atalhos Ctrl + / − / 0 e Ctrl + scroll', prefs.hotkeys, (v) => setZoomHotkeys(v), 'Substitui o zoom do navegador'));
  }
  return card('Zoom da interface', rows);
}

// ---------- Atalhos de voz (Áudio & Vídeo) ----------
export function buildHotkeysCard() {
  const card_ = el('div', { class: 'gk-settings-card' });
  const render = () => {
    card_.innerHTML = '';
    const prefs = getHotkeyPrefs();
    card_.appendChild(el('div', { class: 'gk-settings-card-title' }, 'Atalhos de voz'));
    const keyRow = (labelText, field) => {
      const btn = el('button', { class: 'gk-btn gk-btn-ghost gk-ext-key' + (prefs[field] ? '' : ' gk-empty') }, prefs[field] || 'Não definido');
      btn.addEventListener('click', () => {
        btn.textContent = 'Pressione as teclas… (Esc cancela, ⌫ limpa)';
        btn.classList.add('gk-recording');
        recordCombo((combo) => {
          if (combo !== undefined) setHotkeyPrefs({ [field]: combo });
          render();
        });
      });
      return el('div', { class: 'gk-toggle-row' }, [el('span', {}, labelText), btn]);
    };
    card_.appendChild(keyRow('Mutar / desmutar microfone', 'mute'));
    card_.appendChild(keyRow('Ensurdecer / desensurdecer', 'deafen'));
    card_.appendChild(keyRow('Tecla de push-to-talk', 'ptt'));
    card_.appendChild(toggleRow('Usar push-to-talk', prefs.pttEnabled && !!prefs.ptt, (v) => {
      if (v && !getHotkeyPrefs().ptt) { toast('Defina uma tecla de push-to-talk primeiro.', 'danger'); render(); return; }
      setHotkeyPrefs({ pttEnabled: v });
    }, 'Microfone só abre enquanto a tecla está pressionada'));
    card_.appendChild(el('div', { class: 'gk-hint gk-ext-note' }, window.gkioDesktop
      ? 'No app desktop os atalhos de mutar/ensurdecer funcionam globalmente (mesmo com o app em segundo plano) se "Atalhos globais" estiver ligado.'
      : 'Os atalhos funcionam com a janela do G.K.IO em foco e durante uma chamada.'));
    if (window.gkioDesktop) syncShortcuts().then((r) => {
      if (!r) return;
      const bad = ['mute', 'deafen'].filter((k) => prefs[k] && r[k] === false);
      if (bad.length) card_.appendChild(el('div', { class: 'gk-ext-item-error gk-ext-note' }, 'Não foi possível registrar o atalho global de: ' + bad.map((k) => (k === 'mute' ? 'mutar' : 'ensurdecer')).join(', ') + ' (já em uso por outro programa?).'));
      if (prefs.pttEnabled && r.ptt === false) card_.appendChild(el('div', { class: 'gk-hint gk-ext-note' }, 'Push-to-talk global indisponível (instale a dependência uiohook-napi); funciona só com a janela em foco.'));
    });
  };
  render();
  return card_;
}

// ---------- Presença automática (Notificações) ----------
export function buildIdleCard() {
  const prefs = getIdlePrefs();
  const select = el('select', { class: 'gk-select gk-ext-idle-select' }, [5, 10, 15, 30, 60].map((m) =>
    el('option', { value: String(m), ...(m === prefs.minutes ? { selected: 'selected' } : {}) }, m + ' min')));
  select.addEventListener('change', () => setIdlePrefs({ minutes: Number(select.value) }));
  return card('Presença automática', [
    toggleRow('Ficar "Ausente" quando eu estiver inativo', prefs.enabled, (v) => setIdlePrefs({ enabled: v }), 'Volta para Online assim que você mexer no app'),
    el('div', { class: 'gk-toggle-row' }, [el('span', {}, 'Tempo de inatividade'), select]),
  ]);
}

// ---------- Temas & Plugins ----------
function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsText(file);
  });
}

function itemRow(item, { onToggle, onRemove, kind }) {
  return el('div', { class: 'gk-ext-item' }, [
    el('div', { class: 'gk-ext-item-main' }, [
      el('div', { class: 'gk-ext-item-name' }, item.name),
      item.error ? el('div', { class: 'gk-ext-item-error' }, 'Erro: ' + item.error) : null,
    ]),
    el('div', { class: 'gk-toggle' + (item.enabled ? ' gk-on' : ''), onclick: (e) => { const t = e.currentTarget; const n = !t.classList.contains('gk-on'); t.classList.toggle('gk-on', n); onToggle(n); } }),
    el('button', { class: 'gk-btn gk-btn-ghost gk-ext-remove', title: 'Remover ' + kind, onclick: onRemove }, [icon('trash', { size: 14 })]),
  ]);
}

function buildAdder({ kind, accept, placeholder, onAdd }) {
  const name = el('input', { type: 'text', placeholder: `Nome do ${kind}` });
  const text = el('textarea', { class: 'gk-mono', placeholder, spellcheck: 'false' });
  const file = el('input', { type: 'file', accept, style: 'display:none;' });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try { text.value = await readFile(f); if (!name.value) name.value = f.name.replace(/\.[^.]+$/, ''); } catch (e) { toast(e.message, 'danger'); }
    file.value = '';
  });
  const add = el('button', { class: 'gk-btn gk-btn-primary' }, 'Adicionar');
  add.addEventListener('click', async () => {
    try { await onAdd(name.value, text.value); name.value = ''; text.value = ''; } catch (e) { toast(e.message, 'danger'); }
  });
  return el('div', { class: 'gk-ext-adder' }, [
    el('div', { class: 'gk-field' }, [name]),
    el('div', { class: 'gk-field' }, [text]),
    el('div', { class: 'gk-ext-adder-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => file.click() }, [icon('attach', { size: 14 }), ' Importar arquivo']),
      file, add,
    ]),
  ]);
}

export function renderExtensionsSection(content, sectionHeader) {
  content.appendChild(sectionHeader('Temas & Plugins', 'Personalize o G.K.IO com CSS e JavaScript próprios.', 'sparkles'));
  if (isSafeMode()) {
    content.appendChild(el('div', { class: 'gk-ext-banner' }, 'Modo seguro ativo (?safe=1): temas e plugins não estão sendo carregados.'));
  }
  const rerender = () => { content.innerHTML = ''; renderExtensionsSection(content, sectionHeader); };

  // Temas
  const themeList = listThemes().map((t) => itemRow(t, {
    kind: 'tema',
    onToggle: (v) => setThemeEnabled(t.id, v),
    onRemove: () => { removeTheme(t.id); rerender(); },
  }));
  content.appendChild(card('Temas (CSS)', [
    themeList.length ? el('div', { class: 'gk-ext-list' }, themeList) : el('div', { class: 'gk-hint gk-ext-note' }, 'Nenhum tema instalado. Cole um CSS abaixo — dica: sobrescreva as variáveis --gk-* em :root.'),
    buildAdder({
      kind: 'tema', accept: '.css,text/css', placeholder: ':root { --gk-accent: #ff5d8f; }\n@import url("https://...");',
      onAdd: (n, css) => { addTheme(n, css); rerender(); },
    }),
  ]));

  // Plugins
  const pluginList = listPlugins().map((p) => itemRow(p, {
    kind: 'plugin',
    onToggle: async (v) => { await setPluginEnabled(p.id, v); rerender(); },
    onRemove: () => { removePlugin(p.id); rerender(); },
  }));
  content.appendChild(card('Plugins (JavaScript)', [
    el('div', { class: 'gk-ext-banner gk-warn' }, 'Plugins rodam com acesso total à sua conta no G.K.IO. Instale apenas código em que você confia.'),
    pluginList.length ? el('div', { class: 'gk-ext-list' }, pluginList) : el('div', { class: 'gk-hint gk-ext-note' }, 'Nenhum plugin instalado. O código recebe o objeto `gkio` (toast, addStyle, onCleanup, storage).'),
    buildAdder({
      kind: 'plugin', accept: '.js,text/javascript', placeholder: "gkio.toast('Olá do plugin!');",
      onAdd: async (n, code) => { await addPlugin(n, code); rerender(); },
    }),
  ]));
}

// ---------- App desktop (só aparece dentro do Electron) ----------
export async function buildDesktopCard() {
  const d = window.gkioDesktop;
  if (!d) return null;
  const cfg = await d.getConfig();
  const set = (k) => (v) => d.setConfig({ [k]: v });
  return card('App desktop', [
    toggleRow('Ícone na bandeja do sistema', cfg.trayEnabled, set('trayEnabled')),
    toggleRow('Fechar a janela minimiza para a bandeja', cfg.closeToTray, set('closeToTray'), 'Requer o ícone na bandeja'),
    toggleRow('Iniciar minimizado na bandeja', cfg.startMinimized, set('startMinimized')),
    toggleRow('Iniciar com o sistema', cfg.openOnStartup, set('openOnStartup'), cfg.packaged ? null : 'Só no app instalado'),
    toggleRow('Atalhos globais de voz', cfg.globalShortcuts, async (v) => { await d.setConfig({ globalShortcuts: v }); syncShortcuts(); }, 'Mutar/ensurdecer/PTT com o app em segundo plano'),
    el('div', { class: 'gk-hint gk-ext-note' }, 'G.K.IO Desktop v' + cfg.version),
  ]);
}
