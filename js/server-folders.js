// ============================================================
// G.K.IO — Pastas de servidores (só suas; sincronizam entre aparelhos)
//  · users/{uid}/prefs/serverFolders = { folders: [{ id, name, color, serverIds[], open }] }
//  · Arraste um servidor para cima de uma pasta, ou use o clique direito > "Mover para pasta".
//  · Servidores que você saiu somem da pasta sozinhos (limpeza na hora de desenhar).
// ============================================================
import { auth, db, doc, setDoc, onSnapshot, serverTimestamp } from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { confirmDialog, resetGenericModal } from './dialogs.js';

const COLORS = ['#8B5CF6', '#4F7DF7', '#3DDC84', '#F5A524', '#F04B4B', '#E879F9'];
let folders = [];
let unsub = null;
let onChange = () => {};

const ref = () => doc(db, 'users', auth.currentUser.uid, 'prefs', 'serverFolders');
const cacheKey = () => `gkio-server-folders:${auth.currentUser?.uid}`;
const clean = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 30).map((f) => ({
  id: String(f.id || '').slice(0, 20), name: String(f.name || 'Pasta').slice(0, 30),
  color: COLORS.includes(f.color) ? f.color : COLORS[0], open: f.open !== false,
  serverIds: (Array.isArray(f.serverIds) ? f.serverIds : []).map(String).slice(0, 100),
})).filter((f) => f.id);

export function initServerFolders(cb) {
  onChange = cb || (() => {});
  if (unsub) { unsub(); unsub = null; }
  if (!auth.currentUser) return;
  try { folders = clean(JSON.parse(localStorage.getItem(cacheKey()) || '[]')); } catch (e) { folders = []; }
  unsub = onSnapshot(ref(), (snap) => {
    folders = clean(snap.exists() ? snap.data().folders : []);
    try { localStorage.setItem(cacheKey(), JSON.stringify(folders)); } catch (e) { /* noop */ }
    onChange();
  }, () => { /* sem permissão ainda (regras antigas): segue com o cache local */ });
}
export function stopServerFolders() { if (unsub) unsub(); unsub = null; folders = []; }

async function save(next) {
  folders = clean(next);
  try { localStorage.setItem(cacheKey(), JSON.stringify(folders)); } catch (e) { /* noop */ }
  onChange();
  try { await setDoc(ref(), { folders, updatedAt: serverTimestamp() }); }
  catch (e) { toast('Pasta salva só neste aparelho (publique as regras novas do Firestore para sincronizar).', 'danger'); }
}

const folderOf = (serverId) => folders.find((f) => f.serverIds.includes(serverId));
export async function moveToFolder(serverId, folderId) {
  const next = folders.map((f) => ({ ...f, serverIds: f.serverIds.filter((s) => s !== serverId) }));
  if (folderId) { const t = next.find((f) => f.id === folderId); if (t) t.serverIds.push(serverId); }
  await save(next);
}
export async function createFolder(name, serverId, color) {
  const n = String(name || '').trim().slice(0, 30);
  if (!n) return;
  if (folders.length >= 30) { toast('Limite de 30 pastas.', 'danger'); return; }
  const f = { id: Math.random().toString(36).slice(2, 10), name: n, color: COLORS.includes(color) ? color : COLORS[folders.length % COLORS.length], open: true, serverIds: [] };
  const next = [...folders.map((x) => ({ ...x, serverIds: x.serverIds.filter((s) => s !== serverId) })), f];
  if (serverId) f.serverIds.push(serverId);
  await save(next);
}

function popup(x, y, items) {
  document.querySelector('.gk-folder-menu')?.remove();
  const m = el('div', { class: 'gk-folder-menu', style: `left:${Math.min(x, innerWidth - 220)}px;top:${Math.min(y, innerHeight - 40 - items.length * 34)}px` },
    items.map((it) => it.sep ? el('div', { class: 'gk-folder-menu-sep' }) : el('button', { type: 'button', onclick: () => { m.remove(); it.run(); } }, it.label)));
  document.body.appendChild(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}

// Cartão para criar/editar pasta: nome, cor e uma prévia de como ela fica na lista.
function folderDialog({ title, confirmLabel, name = '', color, note = null, onSave }) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  if (!overlay || !modal) return;
  modal.innerHTML = '';
  let picked = COLORS.includes(color) ? color : COLORS[folders.length % COLORS.length];

  const input = el('input', { type: 'text', class: 'gk-input gk-fd-input', maxlength: '30', placeholder: 'Ex.: Jogos, Trabalho, Amigos', value: name, 'aria-label': 'Nome da pasta' });
  const count = el('span', { class: 'gk-fd-count' }, `${name.length}/30`);
  const pvName = el('span', { class: 'gk-folder-name' }, name || 'Nome da pasta');
  const ghost = (w) => el('div', { class: 'gk-fd-ghost' }, [el('span', { class: 'gk-fd-ghost-av' }), el('span', { class: 'gk-fd-ghost-bars' }, [el('i', { style: `width:${w}%` }), el('i', { style: 'width:34%' })])]);
  const preview = el('div', { class: 'gk-fd-previewbox' }, [
    el('div', { class: 'gk-folder-head gk-fd-preview' }, [
      el('span', { class: 'gk-folder-chev gk-open' }, [icon('chevronDown', { size: 14 })]),
      el('span', { class: 'gk-folder-dot' }), pvName, el('span', { class: 'gk-folder-count' }, '2'),
    ]),
    el('div', { class: 'gk-fd-previewbody' }, [ghost(62), ghost(44)]),
  ]);
  const swatches = el('div', { class: 'gk-fd-swatches', role: 'radiogroup', 'aria-label': 'Cor da pasta' });
  const paint = () => {
    preview.style.setProperty('--gk-folder', picked);
    swatches.innerHTML = '';
    for (const c of COLORS) swatches.appendChild(el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(c === picked), 'aria-label': c,
      class: 'gk-fd-swatch' + (c === picked ? ' gk-active' : ''), style: `background:${c}`,
      onclick: () => { picked = c; paint(); },
    }));
  };
  paint();
  input.addEventListener('input', () => { pvName.textContent = input.value.trim() || 'Nome da pasta'; count.textContent = `${input.value.length}/30`; });

  const close = () => overlay.classList.remove('gk-open');
  const save = () => { const v = input.value.trim(); if (!v) { input.focus(); input.classList.add('gk-fd-bad'); return; } close(); onSave(v, picked); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') close(); });

  modal.appendChild(el('div', { class: 'gk-confirm gk-accent gk-fd' }, [
    el('div', { class: 'gk-confirm-icon' }, [icon('folder', { size: 24 })]),
    el('h2', {}, title),
    el('p', { class: 'gk-modal-sub' }, 'Agrupe servidores para manter a lista organizada. Só você vê as suas pastas.'),
    el('div', { class: 'gk-fd-field' }, [el('label', {}, ['Nome ', count]), input]),
    el('div', { class: 'gk-fd-field' }, [el('label', {}, 'Cor'), swatches]),
    el('div', { class: 'gk-fd-field' }, [el('label', {}, 'Prévia'), preview]),
    note ? el('div', { class: 'gk-confirm-note' }, [icon('info', { size: 15 }), el('span', {}, note)]) : null,
    el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar'),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: save }, confirmLabel),
    ]),
  ]));
  overlay.classList.add('gk-open');
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function deleteFolder(f, count) {
  confirmDialog({
    title: 'Excluir pasta?',
    message: `A pasta "${f.name}" será excluída.`,
    note: count
      ? `Os ${count} ${count === 1 ? 'servidor' : 'servidores'} dentro dela NÃO são apagados: voltam para a lista, como estavam antes de entrarem na pasta.`
      : 'Ela está vazia, nenhum servidor será afetado.',
    confirmLabel: 'Excluir pasta', iconName: 'trash',
    onConfirm: () => save(folders.filter((x) => x.id !== f.id)),
  });
}

/** Monta a lista do seletor de servidores já com pastas. makeRow(server) devolve a linha de um servidor. */
export function buildFolderedList(servers, makeRow) {
  const wrap = el('div', { class: 'gk-server-picker-list' });
  const byId = new Map(servers.map((s) => [s.id, s]));
  // limpa servidores que você não tem mais
  const live = folders.map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => byId.has(id)) }));

  const decorate = (row, server) => {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/gkio-server', server.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('gk-dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('gk-dragging'));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const cur = folderOf(server.id);
      popup(e.clientX, e.clientY, [
        ...folders.filter((f) => !cur || f.id !== cur.id).map((f) => ({ label: `Mover para “${f.name}”`, run: () => moveToFolder(server.id, f.id) })),
        { label: 'Nova pasta com este servidor…', run: () => folderDialog({ title: 'Nova pasta', confirmLabel: 'Criar pasta', note: `O servidor "${server.name || 'Servidor'}" entra nesta pasta.`, onSave: (n, c) => createFolder(n, server.id, c) }) },
        ...(cur ? [{ sep: true }, { label: `Tirar da pasta “${cur.name}”`, run: () => moveToFolder(server.id, null) }] : []),
      ]);
    });
    return row;
  };
  const dropTarget = (node, folderId) => {
    node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/gkio-server')) { e.preventDefault(); node.classList.add('gk-drop'); } });
    node.addEventListener('dragleave', () => node.classList.remove('gk-drop'));
    node.addEventListener('drop', (e) => { e.preventDefault(); node.classList.remove('gk-drop'); const id = e.dataTransfer.getData('text/gkio-server'); if (id && byId.has(id)) moveToFolder(id, folderId); });
  };

  const bar = el('div', { class: 'gk-folder-bar' }, [
    el('button', { type: 'button', class: 'gk-folder-new', onclick: () => folderDialog({ title: 'Nova pasta', confirmLabel: 'Criar pasta', onSave: (n, c) => createFolder(n, null, c) }) }, [icon('plus', { size: 13 }), ' Nova pasta']),
  ]);
  wrap.appendChild(bar);

  for (const f of live) {
    const members = f.serverIds.map((id) => byId.get(id));
    const head = el('div', { class: 'gk-folder-head', style: `--gk-folder:${f.color}` }, [
      el('span', { class: 'gk-folder-chev' + (f.open ? ' gk-open' : '') }, [icon('chevronDown', { size: 14 })]),
      el('span', { class: 'gk-folder-dot' }),
      el('span', { class: 'gk-folder-name' }, f.name),
      el('span', { class: 'gk-folder-count' }, String(members.length)),
      el('button', { type: 'button', class: 'gk-folder-more', title: 'Opções da pasta', onclick: (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        popup(r.left, r.bottom + 4, [
          { label: 'Editar pasta (nome e cor)', run: () => folderDialog({ title: 'Editar pasta', confirmLabel: 'Salvar', name: f.name, color: f.color, onSave: (n, c) => save(folders.map((x) => x.id === f.id ? { ...x, name: n, color: c } : x)) }) },
          { sep: true },
          { label: 'Excluir pasta…', run: () => deleteFolder(f, members.length) },
        ]);
      } }, '⋯'),
    ]);
    head.addEventListener('click', () => save(folders.map((x) => x.id === f.id ? { ...x, open: !x.open } : x)));
    dropTarget(head, f.id);
    wrap.appendChild(head);
    if (f.open) {
      const box = el('div', { class: 'gk-folder-body', style: `--gk-folder:${f.color}` });
      if (!members.length) box.appendChild(el('div', { class: 'gk-folder-empty' }, 'Arraste servidores para cá'));
      for (const s of members) box.appendChild(decorate(makeRow(s), s));
      dropTarget(box, f.id);
      wrap.appendChild(box);
    }
  }
  const inFolder = new Set(live.flatMap((f) => f.serverIds));
  const rest = servers.filter((s) => !inFolder.has(s.id));
  const tail = el('div', { class: 'gk-folder-rest' });
  if (live.length && rest.length) tail.appendChild(el('div', { class: 'gk-folder-rest-label' }, 'Sem pasta'));
  for (const s of rest) tail.appendChild(decorate(makeRow(s), s));
  dropTarget(tail, null);
  wrap.appendChild(tail);
  return wrap;
}
