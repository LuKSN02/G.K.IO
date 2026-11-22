// ============================================================
// Janela "Atalhos do teclado" — abre com Ctrl+/ (ou Cmd+/) ou "?" fora de campos de texto.
// Autônoma: cria o próprio overlay, não depende dos modais do app.
// ============================================================
import { getHotkeyPrefs } from './prefs.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl';

function groups() {
  let hk = {};
  try { hk = getHotkeyPrefs() || {}; } catch (e) { /* noop */ }
  const voice = [];
  if (hk.mute) voice.push([hk.mute, 'Mutar / desmutar o microfone']);
  if (hk.deafen) voice.push([hk.deafen, 'Ensurdecer / reativar o som']);
  if (hk.ptt && hk.pttEnabled) voice.push([hk.ptt, 'Apertar para falar (segure)']);
  return [
    ['Geral', [
      [`${MOD}+K`, 'Busca rápida (conversas, servidores, canais)'],
      [`${MOD}+/`, 'Abrir esta janela de atalhos'],
      ['Esc', 'Fechar janelas e menus'],
      ['Clique direito', 'Menu de contexto (mensagens, servidores, conversas)'],
    ]],
    ['Conversa', [
      ['Enter', 'Enviar mensagem'],
      ['Shift+Enter', 'Quebrar linha'],
      ['Arrastar p/ esquerda', 'Responder (no celular)'],
      ['Segurar', 'Abrir menu de contexto (no celular)'],
    ]],
    ...(voice.length ? [['Voz (definidos em Configurações)', voice]] : [['Voz', [['—', 'Defina atalhos de mutar/ensurdecer em Configurações']]]]),
  ];
}

let overlay = null;
function close() { if (overlay) { overlay.remove(); overlay = null; } }

function open() {
  if (overlay) { close(); return; }
  overlay = document.createElement('div');
  overlay.className = 'gk-sc-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Atalhos do teclado');
  const card = document.createElement('div');
  card.className = 'gk-sc-card';
  const h = document.createElement('h2');
  h.textContent = 'Atalhos do teclado';
  card.appendChild(h);
  for (const [title, rows] of groups()) {
    const sec = document.createElement('section');
    const t = document.createElement('h3'); t.textContent = title; sec.appendChild(t);
    for (const [keys, what] of rows) {
      const r = document.createElement('div'); r.className = 'gk-sc-row';
      const k = document.createElement('span'); k.className = 'gk-sc-keys';
      String(keys).split('+').forEach((p) => { const kb = document.createElement('kbd'); kb.textContent = p; k.appendChild(kb); });
      const w = document.createElement('span'); w.textContent = what;
      r.append(w, k); sec.appendChild(r);
    }
    card.appendChild(sec);
  }
  const x = document.createElement('button');
  x.className = 'gk-btn gk-btn-ghost gk-sc-close'; x.type = 'button'; x.textContent = 'Fechar';
  x.addEventListener('click', close);
  card.appendChild(x);
  overlay.appendChild(card);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  x.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay) { e.stopPropagation(); close(); return; }
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if ((e.key === '/' && (e.ctrlKey || e.metaKey)) || (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault(); open();
  }
}, true);
