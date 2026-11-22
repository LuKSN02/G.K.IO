// ============================================================
// G.K.IO — Lista de tarefas (checklist) compartilhada no chat
// Mensagem com `checklist: { title, items:[{id,text}] }` e `checks: { [itemId]: uid }`.
// Qualquer pessoa da conversa marca/desmarca (regra isValidCheckUpdate: só o campo `checks`).
// ctx (montado em chat.js): getMessageRef, postPayload
// ============================================================
import { auth, updateDoc, deleteField } from './db.js';
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';

const MAX_ITEMS = 15;

export function parseItems(text) {
  return [...new Set(String(text || '').split('\n').map((l) => l.replace(/^[-*•\[\]\sx]+/i, '').trim()).filter(Boolean))].slice(0, MAX_ITEMS).map((t, i) => ({ id: `t${i + 1}`, text: t.slice(0, 120) }));
}

export function openChecklistModal(ctx) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal(); modal.innerHTML = '';
  const close = () => overlay.classList.remove('gk-open');
  const title = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '80', placeholder: 'Título (ex.: Compras do fim de semana)', 'aria-label': 'Título' });
  const items = el('textarea', { class: 'gk-sv-input gk-sv-textarea', rows: '6', placeholder: 'Um item por linha…', 'aria-label': 'Itens' });
  const go = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
    const list = parseItems(items.value); const t = title.value.trim();
    if (!t || !list.length) return toast('Dê um título e escreva pelo menos um item.', 'danger');
    go.disabled = true;
    const ok = await ctx.postPayload({ content: '', checklist: { title: t, items: list }, checks: {} }, { preview: `☑️ Lista: ${t}` });
    if (ok) close(); else go.disabled = false;
  } }, 'Criar lista');
  modal.append(
    el('div', { class: 'gk-modal-icon-header' }, [el('div', { class: 'gk-modal-icon' }, [icon('check', { size: 22 })]),
      el('div', {}, [el('h2', {}, 'Lista de tarefas'), el('p', { class: 'gk-modal-sub' }, `Todo mundo da conversa pode marcar. Até ${MAX_ITEMS} itens.`)])]),
    el('div', { class: 'gk-field' }, [title]), el('div', { class: 'gk-field' }, [items]),
    el('div', { class: 'gk-poll-footer-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar'), go]),
  );
  overlay.classList.add('gk-open'); title.focus();
}

async function toggle(msg, itemId, ctx) {
  const me = auth.currentUser?.uid; const ref = ctx.getMessageRef(msg.id); if (!me || !ref) return;
  const done = !!(msg.checks || {})[itemId];
  try { await updateDoc(ref, { [`checks.${itemId}`]: done ? deleteField() : me }); }
  catch (e) { toast('Não foi possível atualizar a lista.', 'danger'); }
}

export function buildChecklistCard(msg, ctx) {
  const c = msg.checklist; const checks = msg.checks || {};
  const doneN = c.items.filter((i) => checks[i.id]).length;
  return el('div', { class: 'gk-checklist' }, [
    el('div', { class: 'gk-poll-head' }, [icon('check', { size: 16 }), el('span', { class: 'gk-poll-question' }, c.title)]),
    el('div', { class: 'gk-poll-sub' }, `${doneN} de ${c.items.length} concluídas`),
    ...c.items.map((i) => el('label', { class: 'gk-check-item' + (checks[i.id] ? ' gk-done' : '') }, [
      el('input', { type: 'checkbox', checked: checks[i.id] ? 'checked' : undefined, onchange: () => toggle(msg, i.id, ctx) }),
      el('span', {}, i.text),
    ])),
  ]);
}
