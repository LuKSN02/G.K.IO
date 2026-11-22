// ============================================================
// G.K.IO — Pré-visualizar anexos (PDF, texto, código, JSON, CSV) sem baixar
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';

const TEXT_EXT = /\.(txt|md|json|csv|log|js|mjs|ts|py|html|css|xml|yml|yaml|ini|java|c|cpp|cs|go|rs|sh|sql|lua)$/i;
const MAX_TEXT = 200_000;
export const previewKind = (att) => {
  const n = att?.name || att?.url || '';
  if (/\.pdf(\?|$)/i.test(n)) return 'pdf';
  if (TEXT_EXT.test(n.split('?')[0])) return 'text';
  return null;
};

export function openFilePreview(att) {
  const kind = previewKind(att); if (!kind) return;
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal(); modal.innerHTML = ''; modal.classList.add('gk-modal-wide');
  const close = () => { overlay.classList.remove('gk-open'); modal.classList.remove('gk-modal-wide'); };
  const body = el('div', { class: 'gk-preview-body' }, el('div', { class: 'gk-hint' }, 'Carregando…'));
  modal.append(
    el('div', { class: 'gk-modal-icon-header' }, [el('div', { class: 'gk-modal-icon' }, [icon('attach', { size: 22 })]),
      el('div', {}, [el('h2', {}, att.name || 'Arquivo'), el('p', { class: 'gk-modal-sub' }, 'Pré-visualização')])]),
    body,
    el('div', { class: 'gk-poll-footer-actions' }, [
      el('a', { class: 'gk-btn gk-btn-ghost', href: att.url, target: '_blank', rel: 'noopener', 'data-gk-trusted': '1' }, 'Abrir / baixar'),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: close }, 'Fechar'),
    ]),
  );
  overlay.classList.add('gk-open');
  const fail = () => body.replaceChildren(el('div', { class: 'gk-hint' }, 'Não foi possível pré-visualizar aqui. Use "Abrir / baixar".'));
  if (kind === 'pdf') { body.replaceChildren(el('iframe', { class: 'gk-preview-frame', src: att.url, title: att.name || 'PDF' })); return; }
  fetch(att.url).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => {
    const cut = t.length > MAX_TEXT;
    body.replaceChildren(el('pre', { class: 'gk-preview-text' }, cut ? t.slice(0, MAX_TEXT) + '\n\n… (arquivo grande, mostrando o começo)' : t));
  }).catch(fail);
}
