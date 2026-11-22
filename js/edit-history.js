// ============================================================
// G.K.IO — Histórico de edição de mensagens
// Ao editar, o texto anterior é guardado em `editHistory` (até 5 versões). Aparece ao clicar em
// "(editado)" — para o autor e para quem modera mensagens. Observação: o campo é gravado na
// própria mensagem, então tecnicamente quem lê a conversa pelo console do navegador também o vê.
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';
import { formatTime } from './state.js';

export const HISTORY_MAX = 5;
export function nextHistory(msg) {
  const prev = Array.isArray(msg?.editHistory) ? msg.editHistory : [];
  return [...prev, { c: String(msg?.content || '').slice(0, 2000), t: Date.now() }].slice(-HISTORY_MAX);
}

export function openEditHistory(msg) {
  const hist = Array.isArray(msg.editHistory) ? msg.editHistory : [];
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal(); modal.innerHTML = '';
  const close = () => overlay.classList.remove('gk-open');
  const rows = [{ c: msg.content, t: null, now: true }, ...[...hist].reverse()];
  modal.append(
    el('div', { class: 'gk-modal-icon-header' }, [el('div', { class: 'gk-modal-icon' }, [icon('edit', { size: 22 })]),
      el('div', {}, [el('h2', {}, 'Histórico de edição'), el('p', { class: 'gk-modal-sub' }, hist.length ? `${hist.length} versão(ões) anterior(es)` : 'Sem versões anteriores guardadas.')])]),
    el('div', { class: 'gk-edithist-list' }, rows.map((r) => el('div', { class: 'gk-edithist-item' + (r.now ? ' gk-now' : '') }, [
      el('small', {}, r.now ? 'Versão atual' : new Date(r.t).toLocaleString('pt-BR')),
      el('div', { class: 'gk-edithist-text' }, r.c || '(vazio)'),
    ]))),
    el('div', { class: 'gk-poll-footer-actions' }, [el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: close }, 'Fechar')]),
  );
  overlay.classList.add('gk-open');
}
export { formatTime };
