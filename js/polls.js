// ============================================================
// G.K.IO — Enquetes
// Mensagem com `poll: { question, options:[{id,text}], multi }`.
// Os votos ficam em `votes: { [optionId]: [uid, ...] }` (igual às reações) e o
// autor pode encerrar (`pollClosed: true`). Regras: ver isValidVoteUpdate /
// isValidPollClose em firestore.rules.
// ctx (montado em chat.js): getMessageRef, postPayload
// ============================================================
import { auth, updateDoc, arrayUnion, arrayRemove } from './db.js';
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

export function openPollModal(ctx) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  const close = () => overlay.classList.remove('gk-open');
  modal.innerHTML = '';

  const QUESTION_MAX = 200;
  const question = el('input', { type: 'text', class: 'gk-sv-input', id: 'gk-poll-question', maxlength: String(QUESTION_MAX), placeholder: 'Qual é a sua pergunta?', autocomplete: 'off' });
  const questionCount = el('span', { class: 'gk-poll-counter' }, `0/${QUESTION_MAX}`);
  const optionsBox = el('div', { class: 'gk-poll-edit-options' });
  const optionsCount = el('span', { class: 'gk-poll-counter' });
  const addBtn = el('button', { class: 'gk-btn gk-btn-ghost gk-poll-add', type: 'button' });
  const hint = el('span', { class: 'gk-poll-hint', id: 'gk-poll-hint' });
  const createBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', id: 'gk-poll-create' }, 'Criar enquete');

  // interruptor "várias respostas" (mesmo componente das configurações)
  const multi = el('div', { class: 'gk-toggle', id: 'gk-poll-multi', role: 'switch', tabindex: '0', 'aria-checked': 'false' });
  const setMulti = (on) => { multi.classList.toggle('gk-on', on); multi.setAttribute('aria-checked', String(on)); refresh(); };
  const toggleMulti = () => setMulti(!multi.classList.contains('gk-on'));
  const multiRow = el('div', { class: 'gk-poll-switch-row', onclick: toggleMulti }, [
    el('span', {}, [el('strong', {}, 'Permitir várias respostas'), el('small', {}, 'Cada pessoa pode marcar mais de uma opção.')]),
    multi,
  ]);
  multi.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggleMulti(); } });

  const rows = [];
  const filledOptions = () => [...new Set(rows.map((r) => r.input.value.trim()).filter(Boolean))];
  const isValid = () => question.value.trim().length > 0 && filledOptions().length >= MIN_OPTIONS;

  function refresh() {
    questionCount.textContent = `${question.value.length}/${QUESTION_MAX}`;
    rows.forEach((r, i) => {
      r.badge.textContent = String(i + 1);
      r.input.placeholder = `Opção ${i + 1}`;
      r.remove.disabled = rows.length <= MIN_OPTIONS; // fica no lugar (esmaecido) para as linhas não "pularem"
    });
    optionsCount.textContent = `${rows.length}/${MAX_OPTIONS}`;
    addBtn.disabled = rows.length >= MAX_OPTIONS;
    addBtn.replaceChildren(icon('plus', { size: 14 }), ' Adicionar opção');
    const valid = isValid();
    createBtn.disabled = !valid;
    hint.textContent = valid
      ? `${filledOptions().length} opções · ${multi.classList.contains('gk-on') ? 'múltipla' : 'única'}`
      : 'Escreva a pergunta e pelo menos 2 opções.';
    hint.classList.toggle('gk-ok', valid);
  }

  const submit = async () => {
    if (!isValid()) return;
    const q = question.value.trim();
    const options = filledOptions();
    createBtn.disabled = true;
    const ok = await ctx.postPayload({
      content: '',
      poll: { question: q, options: options.map((text, i) => ({ id: `o${i + 1}`, text })), multi: multi.classList.contains('gk-on') },
      votes: {},
    }, { preview: `📊 Enquete: ${q}` });
    if (ok) close(); else refresh();
  };

  const addOption = () => {
    if (rows.length >= MAX_OPTIONS) return null;
    const badge = el('span', { class: 'gk-poll-badge' });
    const input = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '80', autocomplete: 'off' });
    const remove = el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Remover opção', 'aria-label': 'Remover opção' }, [icon('close', { size: 14 })]);
    const row = el('div', { class: 'gk-poll-edit-row' }, [badge, input, remove]);
    const entry = { badge, input, remove, row };
    remove.addEventListener('click', () => {
      if (rows.length <= MIN_OPTIONS) return;
      const i = rows.indexOf(entry);
      rows.splice(i, 1); row.remove(); refresh();
      (rows[Math.max(0, i - 1)] || rows[0]).input.focus();
    });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { submit(); return; }
      const i = rows.indexOf(entry);
      if (rows[i + 1]) rows[i + 1].input.focus();
      else if (input.value.trim()) { const next = addOption(); if (next) next.focus(); }
    });
    rows.push(entry); optionsBox.appendChild(row); refresh();
    return input;
  };
  addBtn.addEventListener('click', () => { const i = addOption(); if (i) i.focus(); });
  question.addEventListener('input', refresh);
  question.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) submit(); else rows[0]?.input.focus(); }
  });
  createBtn.addEventListener('click', submit);
  addOption(); addOption();

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, [icon('poll', { size: 22 })]),
    el('div', {}, [el('h2', {}, 'Criar enquete'), el('p', { class: 'gk-modal-sub' }, 'Todo mundo da conversa pode votar.')]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [
    el('div', { class: 'gk-poll-label' }, [el('label', { for: 'gk-poll-question' }, 'Pergunta'), questionCount]),
    question,
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [
    el('div', { class: 'gk-poll-label' }, [el('label', {}, 'Opções'), optionsCount]),
    optionsBox,
    addBtn,
  ]));
  modal.appendChild(multiRow);
  modal.appendChild(el('div', { class: 'gk-poll-footer' }, [
    hint,
    el('div', { class: 'gk-poll-footer-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar'),
      createBtn,
    ]),
  ]));
  refresh();
  overlay.classList.add('gk-open');
  question.focus();
}

async function votePoll(msg, optionId, ctx) {
  const uid = auth.currentUser?.uid;
  const ref = ctx.getMessageRef(msg.id);
  if (!uid || !ref) return;
  const votes = msg.votes || {};
  const already = (votes[optionId] || []).includes(uid);
  const patch = {};
  if (msg.poll.multi) {
    patch[`votes.${optionId}`] = already ? arrayRemove(uid) : arrayUnion(uid);
  } else {
    // escolha única: tira o voto das outras opções e (re)marca só esta
    for (const o of msg.poll.options) {
      patch[`votes.${o.id}`] = (o.id === optionId && !already) ? arrayUnion(uid) : arrayRemove(uid);
    }
  }
  try { await updateDoc(ref, patch); } catch (err) { toast('Não foi possível registrar o voto.', 'danger'); }
}

async function closePoll(msg, ctx) {
  const ref = ctx.getMessageRef(msg.id);
  if (!ref) return;
  try { await updateDoc(ref, { pollClosed: true }); toast('Enquete encerrada.'); }
  catch (err) { toast('Não foi possível encerrar a enquete.', 'danger'); }
}

export function buildPollCard(msg, ctx) {
  const poll = msg.poll;
  const votes = msg.votes || {};
  const uid = auth.currentUser?.uid;
  const closed = !!msg.pollClosed;

  const voters = new Set();
  for (const o of poll.options) (Array.isArray(votes[o.id]) ? votes[o.id] : []).forEach((u) => voters.add(u));
  const total = voters.size;

  const card = el('div', { class: 'gk-poll' + (closed ? ' gk-closed' : '') });
  card.appendChild(el('div', { class: 'gk-poll-head' }, [icon('poll', { size: 16 }), el('span', { class: 'gk-poll-question' }, poll.question)]));
  card.appendChild(el('div', { class: 'gk-poll-sub' }, closed ? 'Enquete encerrada' : poll.multi ? 'Escolha uma ou mais opções' : 'Escolha uma opção'));

  for (const o of poll.options) {
    const list = Array.isArray(votes[o.id]) ? votes[o.id] : [];
    const mine = list.includes(uid);
    const pct = total ? Math.round((list.length / total) * 100) : 0;
    card.appendChild(el('button', {
      class: 'gk-poll-opt' + (mine ? ' gk-mine' : ''), type: 'button', 'data-opt': o.id,
      disabled: closed ? 'true' : undefined,
      onclick: () => votePoll(msg, o.id, ctx),
    }, [
      el('span', { class: 'gk-poll-fill', style: `width:${pct}%;` }),
      el('span', { class: 'gk-poll-check' }, mine ? [icon('check', { size: 14 })] : []),
      el('span', { class: 'gk-poll-text' }, o.text),
      el('span', { class: 'gk-poll-count' }, `${list.length} · ${pct}%`),
    ]));
  }

  const footer = [el('span', {}, `${total} ${total === 1 ? 'voto' : 'votos'}`)];
  if (!closed && msg.authorId === uid) {
    footer.push(el('button', { class: 'gk-poll-close', type: 'button', onclick: () => closePoll(msg, ctx) }, 'Encerrar enquete'));
  }
  card.appendChild(el('div', { class: 'gk-poll-foot' }, footer));
  return card;
}
