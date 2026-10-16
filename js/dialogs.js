// ============================================================
// G.K.IO — Diálogos compartilhados
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';

// Diálogo de confirmação para ações destrutivas (excluir cargo/canal/servidor,
// expulsar, sair...). O que estiver entre aspas na mensagem vira negrito.
// opts: { confirmLabel, iconName }. Esc ou "Cancelar" fecham; o foco começa
// em "Cancelar" para que um Enter distraído não confirme a exclusão.
export function confirmDangerAction(title, message, onConfirm, { confirmLabel = 'Confirmar', iconName = 'trash' } = {}) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  const sub = el('p', { class: 'gk-modal-sub' });
  for (const part of message.split(/("[^"]+")/)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('"') && part.endsWith('"')) sub.appendChild(el('strong', {}, part));
    else sub.appendChild(document.createTextNode(part));
  }

  const onKey = (e) => {
    if (!overlay.classList.contains('gk-open')) { document.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  const close = () => {
    overlay.classList.remove('gk-open');
    document.removeEventListener('keydown', onKey, true);
  };

  const cancelBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar');
  const confirmBtn = el('button', {
    class: 'gk-btn gk-confirm-btn', type: 'button',
    onclick: async () => {
      close();
      try { await onConfirm(); } catch (err) { toast(err.message || 'Não foi possível concluir a ação.', 'danger'); }
    },
  }, [icon(iconName, { size: 15 }), ' ' + confirmLabel]);

  modal.appendChild(el('div', { class: 'gk-confirm' }, [
    el('div', { class: 'gk-confirm-icon' }, [icon(iconName, { size: 24 })]),
    el('h2', {}, title),
    sub,
    el('div', { class: 'gk-modal-actions' }, [cancelBtn, confirmBtn]),
  ]));
  overlay.classList.add('gk-open');
  document.addEventListener('keydown', onKey, true);
  cancelBtn.focus();
}
