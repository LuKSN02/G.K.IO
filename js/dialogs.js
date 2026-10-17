// ============================================================
// G.K.IO — Diálogos compartilhados
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';

// O #gk-generic-modal é UM elemento só, reaproveitado por todos os diálogos. Alguns (o cartão de
// perfil, o assistente de criar servidor) trocam a classe/atributos dele para mudar o visual — e
// se ninguém desfaz, o diálogo seguinte nasce com o estilo errado (sem espaçamento, largura de
// 392px do perfil, borda de Prime...). Daqui sai sempre o "estado limpo".
export function resetGenericModal() {
  const modal = document.getElementById('gk-generic-modal');
  if (!modal) return null;
  modal.className = 'gk-modal';
  modal.removeAttribute('data-prime');
  return modal;
}

// Volta ao estado limpo sempre que o diálogo fecha, por qualquer caminho (botão, clique fora, Esc).
export function wireGenericModalReset() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  if (!overlay) return;
  new MutationObserver(() => {
    if (!overlay.classList.contains('gk-open')) resetGenericModal();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

// Diálogo de confirmação. O que estiver entre aspas na mensagem vira negrito.
//   tone 'danger' (padrão): ação destrutiva — ícone vermelho, botão vermelho, foco em "Cancelar"
//   tone 'accent': ação normal (ex.: entrar na sala de voz) — destaque na cor do app, foco no botão
//   note: aviso opcional numa caixa destacada (ex.: "sua chamada atual será encerrada")
// Esc ou "Cancelar" fecham.
export function confirmDialog({ title, message, note = null, onConfirm, confirmLabel = 'Confirmar', iconName = 'trash', tone = 'danger' }) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  modal.innerHTML = '';

  const sub = el('p', { class: 'gk-modal-sub' });
  for (const part of String(message).split(/("[^"]+")/)) {
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
    class: 'gk-btn gk-confirm-btn', type: 'button', id: 'gk-confirm-ok',
    onclick: async () => {
      close();
      try { await onConfirm(); } catch (err) { toast(err.message || 'Não foi possível concluir a ação.', 'danger'); }
    },
  }, [icon(iconName, { size: 15 }), ' ' + confirmLabel]);

  modal.appendChild(el('div', { class: 'gk-confirm' + (tone === 'accent' ? ' gk-accent' : '') }, [
    el('div', { class: 'gk-confirm-icon' }, [icon(iconName, { size: 24 })]),
    el('h2', {}, title),
    sub,
    note ? el('div', { class: 'gk-confirm-note' }, [icon('info', { size: 15 }), el('span', {}, note)]) : null,
    el('div', { class: 'gk-modal-actions' }, [cancelBtn, confirmBtn]),
  ]));
  overlay.classList.add('gk-open');
  document.addEventListener('keydown', onKey, true);
  (tone === 'accent' ? confirmBtn : cancelBtn).focus();
}

// Confirmação de ação destrutiva (excluir, expulsar, banir, sair...).
// opts: { confirmLabel, iconName } — assinatura antiga, usada por vários módulos.
export function confirmDangerAction(title, message, onConfirm, opts = {}) {
  confirmDialog({ title, message, onConfirm, ...opts, tone: 'danger' });
}
