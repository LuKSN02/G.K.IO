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

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

export function openPollModal(ctx) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  const close = () => overlay.classList.remove('gk-open');

  modal.innerHTML = '';
  const question = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '200', placeholder: 'Qual é a sua pergunta?' });
  const optionsBox = el('div', { class: 'gk-poll-edit-options' });
  const addBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button' }, [icon('plus', { size: 14 }), ' Adicionar opção']);
  const multi = el('input', { type: 'checkbox' });
  const createBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Criar enquete');

  const rows = [];
  const refreshRows = () => {
    rows.forEach((r, i) => {
      r.input.placeholder = `Opção ${i + 1}`;
      r.remove.style.visibility = rows.length > MIN_OPTIONS ? 'visible' : 'hidden';
    });
    addBtn.disabled = rows.length >= MAX_OPTIONS;
  };
  const addOption = () => {
    if (rows.length >= MAX_OPTIONS) return;
    const input = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '80' });
    const remove = el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Remover opção', 'aria-label': 'Remover opção' }, [icon('close', { size: 14 })]);
    const row = el('div', { class: 'gk-poll-edit-row' }, [input, remove]);
    const entry = { input, remove, row };
    remove.addEventListener('click', () => {
      if (rows.length <= MIN_OPTIONS) return;
      rows.splice(rows.indexOf(entry), 1); row.remove(); refreshRows();
    });
    rows.push(entry); optionsBox.appendChild(row); refreshRows();
    return input;
  };
  addBtn.addEventListener('click', () => addOption().focus());
  addOption(); addOption();

  createBtn.addEventListener('click', async () => {
    const q = question.value.trim();
    const options = [...new Set(rows.map((r) => r.input.value.trim()).filter(Boolean))];
    if (!q) { toast('Escreva a pergunta da enquete.', 'danger'); question.focus(); return; }
    if (options.length < MIN_OPTIONS) { toast('Coloque pelo menos 2 opções diferentes.', 'danger'); return; }
    createBtn.disabled = true;
    const ok = await ctx.postPayload({
      content: '',
      poll: { question: q, options: options.map((text, i) => ({ id: `o${i + 1}`, text })), multi: multi.checked },
      votes: {},
    }, { preview: `📊 Enquete: ${q}` });
    createBtn.disabled = false;
    if (ok) close();
  });

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, [icon('poll', { size: 22 })]),
    el('div', {}, [el('h2', {}, 'Criar enquete'), el('p', { class: 'gk-modal-sub' }, 'Todo mundo da conversa pode votar.')]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Pergunta'), question]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Opções'), optionsBox, addBtn]));
  modal.appendChild(el('label', { class: 'gk-nsfw-option' }, [multi, el('span', {}, [el('strong', {}, 'Permitir várias respostas'), el('small', {}, 'Cada pessoa pode marcar mais de uma opção.')])]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar'),
    createBtn,
  ]));
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
