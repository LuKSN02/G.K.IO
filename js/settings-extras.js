// ============================================================
// G.K.IO — Cartões de configurações trazidos do Dorion
// Zoom, atalhos de voz, presença automática e Temas & Plugins.
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { getHotkeyPrefs, setHotkeyPrefs, getIdlePrefs, setIdlePrefs } from './prefs.js';
import { getZoomPrefs, setZoom, setZoomHotkeys, isElectron, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from './zoom.js';
import { recordCombo } from './hotkeys.js';
import { syncShortcuts, applyBlurAttr, applyStreamerAttr } from './desktop.js';
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
  const urlBtn = el('button', { class: 'gk-btn gk-btn-ghost', onclick: async () => {
    const url = (prompt('URL do arquivo (https://…):') || '').trim();
    if (!url) return;
    try {
      const txt = window.gkioDesktop?.fetchText ? await window.gkioDesktop.fetchText(url)
        : await fetch(url).then((r) => { if (!r.ok) throw new Error('Servidor respondeu ' + r.status); return r.text(); });
      text.value = txt;
      if (!name.value) name.value = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, '');
    } catch (e) { toast('Não foi possível baixar: ' + (e.message || e), 'danger'); }
  } }, [icon('link', { size: 14 }), ' Importar de URL']);
  const add = el('button', { class: 'gk-btn gk-btn-primary' }, 'Adicionar');
  add.addEventListener('click', async () => {
    try { await onAdd(name.value, text.value); name.value = ''; text.value = ''; } catch (e) { toast(e.message, 'danger'); }
  });
  return el('div', { class: 'gk-ext-adder' }, [
    el('div', { class: 'gk-field' }, [name]),
    el('div', { class: 'gk-field' }, [text]),
    el('div', { class: 'gk-ext-adder-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => file.click() }, [icon('attach', { size: 14 }), ' Importar arquivo']),
      urlBtn, file, add,
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
const BLUR_LABELS = { none: 'Desligado', acrylic: 'Acrílico', mica: 'Mica', tabbed: 'Mica (abas)', vibrancy: 'Vibrancy (macOS)', transparent: 'Transparente' };
const UPDATE_TEXT = (s) => ({
  idle: 'Nenhuma verificação ainda.', checking: 'Verificando atualizações…', none: 'Você está na versão mais recente.',
  downloading: `Baixando ${s.version || 'atualização'}… ${s.percent ?? 0}%`, ready: `Versão ${s.version} baixada e pronta para instalar.`,
  error: 'Não foi possível verificar: ' + (s.message || 'erro desconhecido'), dev: 'Atualizações só funcionam no app instalado.', unavailable: 'Atualizador indisponível nesta versão.',
}[s.state] || '');

export async function buildDesktopCard() {
  const d = window.gkioDesktop;
  if (!d) return null;
  const cfg = await d.getConfig();
  const set = (k) => (v) => d.setConfig({ [k]: v });

  // --- Efeito de janela ---
  const blurSel = el('select', { class: 'gk-select gk-ext-idle-select' }, cfg.blurOptions.map((o) =>
    el('option', { value: o, ...(o === cfg.blur ? { selected: 'selected' } : {}) }, BLUR_LABELS[o] || o)));
  const blurNote = el('div', { class: 'gk-hint gk-ext-note', style: 'display:none;' }, 'Reinicie o app para aplicar a transparência.');
  blurSel.addEventListener('change', async () => {
    const r = await d.setConfig({ blur: blurSel.value });
    applyBlurAttr(blurSel.value);
    blurNote.style.display = r.needsRestart ? 'block' : 'none';
  });

  // --- Jogos personalizados ---
  const gamesBox = el('div', { class: 'gk-ext-games' });
  let custom = cfg.customGames || [];
  const renderGames = () => {
    gamesBox.innerHTML = '';
    custom.forEach((g, i) => gamesBox.appendChild(el('div', { class: 'gk-ext-item' }, [
      el('div', { class: 'gk-ext-item-main' }, [el('div', { class: 'gk-ext-item-name' }, g.name), el('div', { class: 'gk-hint' }, g.exe)]),
      el('button', { class: 'gk-btn gk-btn-ghost gk-ext-remove', title: 'Remover', onclick: async () => { custom = custom.filter((_, j) => j !== i); await d.setConfig({ customGames: custom }); renderGames(); } }, [icon('trash', { size: 14 })]),
    ])));
  };
  renderGames();
  const exeIn = el('input', { type: 'text', placeholder: 'programa.exe' });
  const nameIn = el('input', { type: 'text', placeholder: 'Nome do jogo' });
  const addBtn = el('button', { class: 'gk-btn gk-btn-primary', onclick: async () => {
    if (!exeIn.value.trim() || !nameIn.value.trim()) return toast('Preencha o executável e o nome.', 'danger');
    custom = [...custom, { exe: exeIn.value.trim(), name: nameIn.value.trim() }];
    await d.setConfig({ customGames: custom }); exeIn.value = ''; nameIn.value = ''; renderGames();
  } }, 'Adicionar');

  // --- Atualizações ---
  const upd = el('div', { class: 'gk-update-status' }, UPDATE_TEXT(await d.getUpdateStatus()));
  const installBtn = el('button', { class: 'gk-btn gk-btn-primary', style: 'display:none;', onclick: () => d.installUpdate() }, 'Instalar e reiniciar');
  const showUpd = (st) => { upd.textContent = UPDATE_TEXT(st); installBtn.style.display = st.state === 'ready' ? '' : 'none'; };
  showUpd(await d.getUpdateStatus());
  d.onUpdate(showUpd);
  const checkBtn = el('button', { class: 'gk-btn gk-btn-ghost', onclick: async () => showUpd(await d.checkForUpdates()) }, 'Verificar atualizações');

  // --- Modo streamer ---
  const stSel = el('select', { class: 'gk-select gk-ext-idle-select' }, [['auto', 'Automático (detecta OBS)'], ['on', 'Sempre ligado'], ['off', 'Desligado']].map(([v, l]) =>
    el('option', { value: v, ...(v === cfg.streamerMode ? { selected: 'selected' } : {}) }, l)));
  stSel.addEventListener('change', async () => { await d.setConfig({ streamerMode: stSel.value }); applyStreamerAttr(await d.getStreamerMode()); });

  // --- Proxy ---
  const proxyIn = el('input', { type: 'text', placeholder: 'http://127.0.0.1:8080  (vazio = sistema)', value: cfg.proxy || '' });
  const proxyBtn = el('button', { class: 'gk-btn gk-btn-ghost', onclick: async () => {
    const r = await d.setConfig({ proxy: proxyIn.value.trim() });
    if ((r.proxy || '') !== proxyIn.value.trim()) toast('Proxy inválido. Use http://, https:// ou socks5://', 'danger'); else toast('Proxy aplicado.');
  } }, 'Aplicar');

  // --- Perfis ---
  const profBox = el('div', { class: 'gk-ext-games' });
  const profIn = el('input', { type: 'text', placeholder: 'nome-do-perfil' });
  const renderProfiles = async () => {
    const { current, profiles } = await d.listProfiles();
    profBox.innerHTML = '';
    const row = (label, name, removable) => el('div', { class: 'gk-ext-item' }, [
      el('div', { class: 'gk-ext-item-main' }, [el('div', { class: 'gk-ext-item-name' }, label + (name === current ? ' (esta janela)' : ''))]),
      name === current ? null : el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => d.openProfile(name || 'default').catch((e) => toast(e.message, 'danger')) }, 'Abrir'),
      removable && name !== current ? el('button', { class: 'gk-btn gk-btn-ghost gk-ext-remove', title: 'Esquecer perfil', onclick: async () => { await d.removeProfile(name); renderProfiles(); } }, [icon('trash', { size: 14 })]) : null,
    ]);
    profBox.appendChild(row('Padrão', current ? 'default' : '', false));
    profiles.forEach((p) => profBox.appendChild(row(p, p, true)));
  };
  renderProfiles();
  const profBtn = el('button', { class: 'gk-btn gk-btn-primary', onclick: async () => {
    try { await d.openProfile(profIn.value); profIn.value = ''; renderProfiles(); } catch (e) { toast(e.message, 'danger'); }
  } }, 'Criar e abrir');

  return el('div', {}, [
    card('Perfis (várias contas)', [
      el('div', { class: 'gk-hint gk-ext-note' }, 'Cada perfil tem login, cache e configurações próprios e abre numa janela separada.' + (cfg.profile ? ' Perfil atual: ' + cfg.profile + '.' : '')),
      profBox,
      el('div', { class: 'gk-ext-games-add' }, [profIn, profBtn]),
    ]),
    card('Privacidade e rede', [
      el('div', { class: 'gk-toggle-row' }, [el('span', {}, ['Modo streamer', el('small', { class: 'gk-ext-hint' }, 'Oculta e-mails e códigos de convite; sem prévia em notificações')]), stSel]),
      el('div', { class: 'gk-field', style: 'margin-top:10px;' }, [el('label', {}, 'Proxy'), el('div', { class: 'gk-ext-games-add' }, [proxyIn, proxyBtn])]),
    ]),
    card('Desempenho e manutenção', [
      toggleRow('Iniciar maximizado', cfg.startMaximized, set('startMaximized')),
      toggleRow('Aceleração de hardware', cfg.hardwareAccel, async (v) => { await d.setConfig({ hardwareAccel: v }); toast('Reinicie o app para aplicar.'); }, 'Desligue se houver tela preta/travadas (reinicia)'),
      toggleRow('Limpar o cache ao abrir', cfg.autoClearCache, set('autoClearCache'), 'Não apaga seu login'),
      el('div', { class: 'gk-ext-adder-actions', style: 'margin-top:10px;justify-content:flex-start;' }, [
        el('button', { class: 'gk-btn gk-btn-ghost', onclick: async () => { await d.clearCache(); toast('Cache limpo.'); } }, 'Limpar cache agora'),
        el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => d.openDataFolder() }, 'Abrir pasta de dados'),
        el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => d.openLogsFolder() }, 'Abrir logs'),
        el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => d.restartInSafeMode() }, 'Reiniciar em modo seguro'),
      ]),
    ]),
    card('App desktop', [
      toggleRow('Ícone na bandeja do sistema', cfg.trayEnabled, set('trayEnabled')),
      toggleRow('Fechar a janela minimiza para a bandeja', cfg.closeToTray, set('closeToTray'), 'Requer o ícone na bandeja'),
      toggleRow('Iniciar minimizado na bandeja', cfg.startMinimized, set('startMinimized')),
      toggleRow('Iniciar com o sistema', cfg.openOnStartup, set('openOnStartup'), cfg.packaged ? null : 'Só no app instalado'),
      toggleRow('Atalhos globais de voz', cfg.globalShortcuts, async (v) => { await d.setConfig({ globalShortcuts: v }); syncShortcuts(); }, 'Mutar/ensurdecer/PTT com o app em segundo plano'),
      el('div', { class: 'gk-toggle-row' }, [el('span', {}, ['Efeito de janela', el('small', { class: 'gk-ext-hint' }, 'Deixa o fundo translúcido (Windows 11 / macOS)')]), blurSel]),
      blurNote,
    ]),
    card('Jogo em execução', [
      toggleRow('Mostrar o jogo que estou jogando', cfg.gameActivity, set('gameActivity'), `Detecta ${cfg.builtinGames} jogos conhecidos pelo nome do processo`),
      el('div', { class: 'gk-hint gk-ext-note' }, 'Jogos que não estão na lista:'),
      gamesBox,
      el('div', { class: 'gk-ext-games-add' }, [exeIn, nameIn, addBtn]),
    ]),
    card('Atualizações', [
      toggleRow('Baixar atualizações automaticamente', cfg.autoUpdate, set('autoUpdate')),
      upd,
      el('div', { class: 'gk-ext-adder-actions', style: 'margin-top:10px;' }, [checkBtn, installBtn]),
      el('div', { class: 'gk-hint gk-ext-note' }, 'G.K.IO Desktop v' + cfg.version),
    ]),
  ]);
}
