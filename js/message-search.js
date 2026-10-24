// ============================================================
// G.K.IO — Buscar mensagens na conversa aberta
// O Firestore não tem busca de texto, então a busca é feita aqui no cliente:
//   1) nas mensagens já carregadas (as últimas 200 da conversa);
//   2) opcionalmente em páginas mais antigas, baixadas sob demanda (até
//      MAX_EXTRA_PAGES x PAGE_SIZE mensagens a mais) — cada página custa leituras.
// ctx (montado em chat.js): getMessagesCol, getLoadedMessages, jumpToMessage, getAuthors
// ============================================================
import { query, orderBy, limit, startAfter, getDocs } from './db.js';
import { el, toast, formatTime } from './state.js';
import { icon } from './icons.js';
import { messagePreview } from './message-utils.js';
import { resetGenericModal } from './dialogs.js';

const PAGE_SIZE = 200;
const MAX_EXTRA_PAGES = 5;
const MAX_RESULTS = 50;

import { norm, searchableText, hasAttachment, filterMessages, highlightSegments } from './search-core.js';
export { norm, searchableText, hasAttachment, filterMessages, highlightSegments };

// Texto com o termo destacado (DOM puro, sem innerHTML).
export function highlight(text, term) {
  const frag = document.createDocumentFragment();
  for (const seg of highlightSegments(text, term)) {
    frag.append(seg.match ? el('mark', { class: 'gk-search-mark' }, seg.text) : seg.text);
  }
  return frag;
}

export async function openMessageSearch(ctx) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  const close = () => overlay.classList.remove('gk-open');
  modal.innerHTML = '';
  modal.classList.add('gk-search-modal');

  let extra = [];            // mensagens mais antigas baixadas sob demanda
  let extraPages = 0;
  let exhausted = false;
  let loadingMore = false;

  const input = el('input', { type: 'text', class: 'gk-search-input', placeholder: 'Buscar nesta conversa…', autocomplete: 'off', maxlength: '100' });
  const authorSel = el('select', { class: 'gk-sv-select' }, [el('option', { value: '' }, 'De: qualquer pessoa')]);
  const attachChk = el('input', { type: 'checkbox', id: 'gk-search-attach' });
  const results = el('div', { class: 'gk-search-results' });
  const status = el('div', { class: 'gk-search-status' });
  const moreBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button' }, 'Buscar em mensagens mais antigas');

  const allMessages = () => {
    const seen = new Set();
    return [...ctx.getLoadedMessages(), ...extra].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  };
  const loadedIds = () => new Set(ctx.getLoadedMessages().map((m) => m.id));

  function fillAuthors() {
    const authors = new Map();
    for (const m of allMessages()) if (m.authorId && !m.system) authors.set(m.authorId, m.authorName || 'Usuário');
    const current = authorSel.value;
    authorSel.replaceChildren(el('option', { value: '' }, 'De: qualquer pessoa'),
      ...[...authors].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => el('option', { value: id }, name)));
    authorSel.value = authors.has(current) ? current : '';
  }

  function render() {
    const term = input.value;
    const found = filterMessages(allMessages(), { term, authorId: authorSel.value, onlyAttachments: attachChk.checked })
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    results.replaceChildren();
    const inView = loadedIds();
    const shown = found.slice(0, MAX_RESULTS);
    for (const m of shown) {
      const date = m.createdAt?.toDate ? m.createdAt.toDate() : null;
      const isLoaded = inView.has(m.id);
      const text = messagePreview(m, 220) || '(mensagem vazia)';
      const item = el('button', {
        type: 'button', class: 'gk-search-hit',
        onclick: () => {
          if (isLoaded) { close(); ctx.jumpToMessage(m.id); }
          else toast('Essa mensagem é mais antiga que as últimas 200 desta conversa — está só aqui na busca.');
        },
      }, [
        el('div', { class: 'gk-pin-head' }, [
          el('b', {}, m.authorName || 'Usuário'),
          el('span', { class: 'gk-pin-time' }, date ? `${date.toLocaleDateString('pt-BR')} ${formatTime(m.createdAt)}` : ''),
          isLoaded ? null : el('span', { class: 'gk-search-old' }, 'mais antiga'),
        ]),
        el('div', { class: 'gk-pin-text' }, [highlight(text, term)]),
      ]);
      results.appendChild(item);
    }
    const active = term.trim() || authorSel.value || attachChk.checked;
    status.textContent = !active ? 'Digite algo para buscar.'
      : found.length === 0 ? 'Nada encontrado.'
      : found.length > MAX_RESULTS ? `Mostrando ${MAX_RESULTS} de ${found.length} resultados — refine a busca.`
      : `${found.length} resultado${found.length === 1 ? '' : 's'}.`;
    const loadedCount = allMessages().length;
    moreBtn.style.display = exhausted || extraPages >= MAX_EXTRA_PAGES ? 'none' : '';
    moreBtn.textContent = loadingMore ? 'Carregando…' : `Buscar em mensagens mais antigas (${loadedCount} carregadas)`;
    moreBtn.disabled = loadingMore;
  }

  async function loadMore() {
    if (loadingMore || exhausted) return;
    const all = allMessages().filter((m) => m.createdAt?.toMillis);
    if (!all.length) { exhausted = true; render(); return; }
    const oldest = all.reduce((a, b) => (a.createdAt.toMillis() <= b.createdAt.toMillis() ? a : b));
    loadingMore = true; render();
    try {
      const snap = await getDocs(query(ctx.getMessagesCol(), orderBy('createdAt', 'desc'), startAfter(oldest.createdAt), limit(PAGE_SIZE)));
      snap.forEach((d) => extra.push({ id: d.id, ...d.data() }));
      extraPages++;
      if (snap.size < PAGE_SIZE) exhausted = true;
      fillAuthors();
    } catch (err) {
      toast('Não foi possível carregar mensagens mais antigas.', 'danger');
    } finally { loadingMore = false; render(); }
  }

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 120); });
  authorSel.addEventListener('change', render);
  attachChk.addEventListener('change', render);
  moreBtn.addEventListener('click', loadMore);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, [icon('search', { size: 22 })]),
    el('div', {}, [el('h2', {}, 'Buscar mensagens'), el('p', { class: 'gk-modal-sub' }, 'Procura no texto, nos nomes de arquivos e nas enquetes desta conversa.')]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [input]));
  modal.appendChild(el('div', { class: 'gk-search-filters' }, [
    authorSel,
    el('label', { class: 'gk-search-check', for: 'gk-search-attach' }, [attachChk, ' Só com anexos']),
  ]));
  modal.appendChild(status);
  modal.appendChild(results);
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    moreBtn,
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar'),
  ]));
  fillAuthors();
  render();
  overlay.classList.add('gk-open');
  setTimeout(() => input.focus(), 50);
}
