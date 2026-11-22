// ============================================================
// G.K.IO — Respostas rápidas com atalho
// Digite ";obrigado " (com espaço no fim) no campo de mensagem e o texto salvo entra no lugar.
// Ficam neste aparelho. Gerencie em Configurações → Conta → Respostas rápidas.
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';

const KEY = 'gkio-quick-replies';
export const listQuick = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { toast('Não foi possível salvar neste navegador.', 'danger'); } };
export const cleanName = (s) => String(s || '').toLowerCase().replace(/^;/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 20);

export function expandQuick(value, replies = listQuick()) {
  const m = /(^|\s);([a-z0-9_-]{1,20})[  ]$/.exec(value);
  if (!m || !(m[2] in replies)) return null;
  return value.slice(0, m.index + m[1].length) + replies[m[2]];
}

export function initQuickReplies() {
  const ta = document.getElementById('gk-composer-input'); if (!ta) return;
  ta.addEventListener('input', () => {
    const out = expandQuick(ta.value); if (out == null) return;
    ta.value = out; ta.setSelectionRange(out.length, out.length);
  });
}

export function buildQuickRepliesCard() {
  const list = el('div', { class: 'gk-quick-list' });
  const name = el('input', { type: 'text', placeholder: 'atalho (ex.: obrigado)', maxlength: '20', 'aria-label': 'Atalho' });
  const text = el('input', { type: 'text', placeholder: 'texto que será inserido', maxlength: '500', 'aria-label': 'Texto' });
  const render = () => {
    const all = listQuick(); const keys = Object.keys(all);
    list.replaceChildren(...(keys.length ? keys.map((k) => el('div', { class: 'gk-quick-row' }, [
      el('code', {}, ';' + k), el('span', { class: 'gk-quick-text' }, all[k]),
      el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Remover', 'aria-label': 'Remover', onclick: () => { const o = listQuick(); delete o[k]; save(o); render(); } }, [icon('trash', { size: 14 })]),
    ])) : [el('div', { class: 'gk-hint' }, 'Nenhuma resposta rápida ainda.')]));
  };
  const add = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => {
    const k = cleanName(name.value); const v = text.value.trim();
    if (!k || !v) return toast('Preencha o atalho e o texto.', 'danger');
    const o = listQuick(); if (Object.keys(o).length >= 30 && !(k in o)) return toast('Máximo de 30 respostas rápidas.', 'danger');
    o[k] = v; save(o); name.value = ''; text.value = ''; render(); toast(`Pronto! Digite ;${k} e um espaço no chat.`);
  } }, 'Adicionar');
  render();
  return el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Respostas rápidas'),
    el('div', { class: 'gk-hint' }, 'No chat, digite ;atalho e um espaço para inserir o texto.'),
    list, el('div', { class: 'gk-field-row', style: 'margin-top:8px' }, [name, text, add]),
  ]);
}
