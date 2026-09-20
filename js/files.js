// ============================================================
// G.K.IO — "Arquivos": biblioteca pessoal dos seus próprios anexos
// ============================================================
// Escopo deliberado: mostra só o que VOCÊ enviou (imagens, GIFs, vídeos,
// arquivos), em qualquer servidor ou DM — não é um drive compartilhado do
// servidor. Isso mantém a regra do Firestore simples (cada um só lê o
// próprio índice) e evita ter que varrer conversas de outras pessoas.
//
// Os itens vêm de attachments/ — um índice leve, gravado por
// indexAttachment() em chat.js toda vez que uma mensagem com anexo é
// enviada (ver ali pro porquê da denormalização).
// ============================================================
import { attachmentsCol, query, where, onSnapshot, auth } from './db.js';
import { state, el, cleanupListener, toast } from './state.js';
import { icon } from './icons.js';
import { openImageLightbox } from './lightbox.js';

let unsubFiles = null;
let lastFiles = [];

export function goToFilesView() {
  document.getElementById('gk-home-view').style.display = 'none';
  document.getElementById('gk-friends-home').style.display = 'none';
  document.getElementById('gk-communities-view').style.display = 'none';
  document.getElementById('gk-messages').style.display = 'none';
  document.getElementById('gk-messages').innerHTML = '';
  document.getElementById('gk-composer').style.display = 'none';
  document.getElementById('gk-members').style.display = 'none';
  document.getElementById('gk-server-settings-btn').style.display = 'none';
  document.getElementById('gk-members-toggle-btn').style.display = 'none';
  document.getElementById('gk-call-btn').style.display = 'none';
  document.getElementById('gk-video-call-btn').style.display = 'none';
  document.getElementById('gk-server-picker-add').style.display = 'none';
  document.getElementById('gk-topbar-title').textContent = 'Arquivos';
  document.getElementById('gk-topbar-subtitle').textContent = '';
  document.getElementById('gk-sidebar-header-title').textContent = 'Arquivos';
  document.getElementById('gk-sidebar-body').innerHTML = '';
  document.querySelectorAll('.gk-rail-item').forEach((n) => n.classList.remove('gk-active'));
  document.getElementById('gk-nav-files')?.classList.add('gk-active');

  const main = document.getElementById('gk-files-view');
  main.style.display = 'flex';
  listenFiles();
}

export function hideFilesView() {
  const main = document.getElementById('gk-files-view');
  if (main) main.style.display = 'none';
}

function listenFiles() {
  cleanupListener('_files');
  if (!auth.currentUser) return;
  const q = query(attachmentsCol(), where('uid', '==', auth.currentUser.uid));
  unsubFiles = onSnapshot(q, (snap) => {
    lastFiles = [];
    snap.forEach((d) => lastFiles.push({ id: d.id, ...d.data() }));
    // Sem orderBy na query (evita precisar de índice composto) — ordena aqui.
    lastFiles.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderFiles();
  }, () => { /* pode falhar por regras ainda não publicadas — silencioso, a view fica vazia */ });
  state.unsubscribers._files = () => unsubFiles && unsubFiles();
}

function renderFiles() {
  const main = document.getElementById('gk-files-view');
  if (!main || main.style.display === 'none') return;
  main.innerHTML = '';

  if (!lastFiles.length) {
    main.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('attach', { size: 32 })]),
      el('div', {}, 'Nenhum arquivo ainda. Tudo que você enviar em conversas e servidores aparece aqui.'),
    ]));
    return;
  }

  const grid = el('div', { class: 'gk-files-grid' });
  for (const f of lastFiles) {
    grid.appendChild(buildFileCard(f));
  }
  main.appendChild(grid);
}

function buildFileCard(f) {
  const isVisual = f.type === 'image' || f.type === 'gif';
  const open = () => {
    if (isVisual) openImageLightbox(f.url);
    else window.open(f.url, '_blank', 'noopener');
  };
  const dateLabel = f.createdAt?.toDate ? f.createdAt.toDate().toLocaleDateString('pt-BR') : '';
  return el('div', { class: 'gk-file-card', onclick: open }, [
    isVisual
      ? el('img', { class: 'gk-file-card-thumb', src: f.url, loading: 'lazy' })
      : el('div', { class: 'gk-file-card-thumb gk-file-card-thumb-generic' }, [icon('attach', { size: 22 })]),
    el('div', { class: 'gk-file-card-meta' }, [
      el('div', { class: 'gk-file-card-name' }, f.name || (isVisual ? 'Imagem' : 'Arquivo')),
      el('div', { class: 'gk-file-card-date' }, dateLabel),
    ]),
  ]);
}
