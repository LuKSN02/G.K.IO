// ============================================================
// G.K.IO — Mensagens (canais de servidor e DMs), com anexos de mídia
// ============================================================
import {
  auth,
  channelMessagesCol, dmMessagesCol, dmDoc, channelMessageDoc, dmMessageDoc, addDoc, updateDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp,
} from './db.js';
import { state, el, escapeHtml, fallbackAvatar, formatTime, cleanupListener, toast } from './state.js';
import { openProfileCard } from './profile.js';
import { uploadToCloudinary } from './cloudinary.js';
import { playNotifSound, showDesktopNotification } from './prefs.js';
import { renderMessageContent } from './emoji.js';
import { openImageLightbox } from './lightbox.js';

let pendingFile = null;
let lastSeenMessageId = null;
let isFirstSnapshotForConversation = true;

// ---------- Edição de mensagem ----------
let editingMessageId = null; // id da mensagem sendo editada no momento (ou null)
let editingDraft = '';       // texto em edição, preservado entre re-renders do snapshot
let lastRenderedMessages = [];

export function selectChannel(serverId, channelId, name, readOnly = false) {
  state.currentView = 'server';
  state.currentServerId = serverId;
  state.currentChannelId = channelId;
  state.currentDmId = null;
  document.getElementById('gk-topbar-title').textContent = `# ${name}`;
  document.getElementById('gk-topbar-subtitle').textContent = readOnly ? 'Canal de texto · somente leitura para você' : 'Canal de texto';
  document.getElementById('gk-call-btn').style.display = 'none';
  applyComposerReadOnly(readOnly);
  attachMessagesListener(channelMessagesCol(serverId, channelId));
  refreshSidebarActiveState();
}

// Overwrite de canal negando 'sendMessages' pro(s) cargo(s) do membro atual
// desabilita o composer — só no client (ver nota em CHANNEL_OVERWRITE_PERMISSIONS
// em servers.js: as regras do Firestore ainda aceitariam o envio se alguém
// forçasse via console, isto é só a barreira normal de uso pela UI).
function applyComposerReadOnly(readOnly) {
  const textarea = document.getElementById('gk-composer-input');
  const sendBtn = document.getElementById('gk-send-btn');
  const attachBtn = document.getElementById('gk-attach-btn');
  textarea.disabled = readOnly;
  sendBtn.disabled = readOnly;
  attachBtn.disabled = readOnly;
  textarea.placeholder = readOnly ? 'Você não pode enviar mensagens neste canal.' : 'Escreva uma mensagem...';
}

export function selectDm(dmId, title, subtitle) {
  state.currentView = 'dms';
  state.currentDmId = dmId;
  state.currentChannelId = null;
  document.getElementById('gk-topbar-title').textContent = title;
  document.getElementById('gk-topbar-subtitle').textContent = subtitle || '';
  document.getElementById('gk-call-btn').style.display = 'inline-flex';
  applyComposerReadOnly(false);
  attachMessagesListener(dmMessagesCol(dmId));
  refreshSidebarActiveState();
}

function refreshSidebarActiveState() {
  document.querySelectorAll('.gk-channel').forEach((n) => n.classList.remove('gk-active'));
  document.querySelectorAll('.gk-dm-row').forEach((n) => n.classList.remove('gk-active'));
  const activeId = state.currentChannelId || state.currentDmId;
  document.querySelectorAll(`[data-id="${activeId}"]`).forEach((n) => n.classList.add('gk-active'));
}

function attachMessagesListener(colRef) {
  cleanupListener('messages');
  lastSeenMessageId = null;
  isFirstSnapshotForConversation = true;
  editingMessageId = null;
  editingDraft = '';
  const q = query(colRef, orderBy('createdAt'), limit(200));
  const unsub = onSnapshot(q, (snap) => {
    const messages = [];
    snap.forEach((d) => messages.push({ id: d.id, ...d.data() }));
    notifyIfNewIncomingMessage(messages);
    lastRenderedMessages = messages;
    renderMessages(messages);
  });
  state.unsubscribers.messages = unsub;
}

function notifyIfNewIncomingMessage(messages) {
  if (!messages.length) { isFirstSnapshotForConversation = false; return; }
  const last = messages[messages.length - 1];
  const isNew = last.id !== lastSeenMessageId;
  lastSeenMessageId = last.id;
  if (!isNew || isFirstSnapshotForConversation) { isFirstSnapshotForConversation = false; return; }
  if (last.authorId === state.user?.uid) return;
  playNotifSound();
  showDesktopNotification(last.authorName || 'Nova mensagem', last.content || '📎 Anexo enviado', last.authorAvatar);
}

function renderMessages(messages) {
  const box = document.getElementById('gk-messages');
  const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
  box.innerHTML = '';

  if (messages.length === 0) {
    box.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, '💬'),
      el('div', {}, 'Nenhuma mensagem ainda. Diga oi!'),
    ]));
    return;
  }

  let lastAuthor = null;
  let lastGroup = null;
  const GROUP_WINDOW_MS = 5 * 60 * 1000;
  let lastTs = 0;

  for (const msg of messages) {
    const ts = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : Date.now();
    const sameGroup = lastAuthor === msg.authorId && (ts - lastTs) < GROUP_WINDOW_MS;
    if (!sameGroup) {
      lastGroup = el('div', { class: 'gk-msg-group' }, [
        el('div', {
          class: 'gk-avatar gk-sz-40', style: 'cursor:pointer;',
          'data-frame': msg.authorFrameStyle || 'none',
          onclick: () => openProfileCard(msg.authorId),
        }, [el('img', { src: msg.authorAvatar || fallbackAvatar(msg.authorName) })]),
        el('div', { class: 'gk-msg-body' }, [
          el('div', { class: 'gk-msg-head' }, [
            el('span', { class: 'gk-author', onclick: () => openProfileCard(msg.authorId) }, msg.authorName || 'Usuário'),
            msg.authorRole === 'prime' ? el('span', { class: 'gk-badge-prime', title: 'G.K.IO Prime' }, '◆') : null,
            msg.authorTag ? el('span', { class: 'gk-author-tag' }, msg.authorTag) : null,
            el('span', { class: 'gk-time' }, formatTime(msg.createdAt)),
          ]),
        ]),
      ]);
      box.appendChild(lastGroup);
    }
    const body = lastGroup.querySelector('.gk-msg-body');
    const isOwn = msg.authorId === state.user?.uid;
    const isEditingThis = editingMessageId === msg.id;

    const row = el('div', { class: 'gk-msg-row', 'data-msg-id': msg.id });
    if (isEditingThis) {
      row.appendChild(buildEditBox(msg));
    } else {
      if (msg.content) {
        const line = el('div', { class: 'gk-msg-line' + (msg.authorRole === 'prime' ? ' gk-msg-line-prime' : '') }, renderMessageContent(msg.content));
        if (msg.editedAt) line.appendChild(el('span', { class: 'gk-msg-edited-tag' }, '(editado)'));
        row.appendChild(line);
      }
      if (isOwn) {
        row.appendChild(el('div', { class: 'gk-msg-actions' }, [
          el('button', {
            class: 'gk-msg-action-btn', type: 'button', title: 'Editar mensagem',
            onclick: () => startEditMessage(msg.id, msg.content || ''),
          }, '✎'),
        ]));
      }
    }
    body.appendChild(row);

    if (msg.attachmentUrl && !isEditingThis) {
      if (msg.attachmentType === 'image' || msg.attachmentType === 'gif') {
        body.appendChild(el('div', { class: 'gk-msg-attachment' }, [
          el('img', {
            src: msg.attachmentUrl, class: 'gk-msg-image-zoomable',
            onclick: () => openImageLightbox(msg.attachmentUrl),
          }),
        ]));
      } else if (msg.attachmentType === 'video') {
        body.appendChild(el('div', { class: 'gk-msg-attachment' }, [el('video', { src: msg.attachmentUrl, controls: 'true' })]));
      } else {
        body.appendChild(el('a', { class: 'gk-msg-file', href: msg.attachmentUrl, target: '_blank' }, [
          el('span', { html: '&#128206;' }), el('span', {}, msg.attachmentName || 'Arquivo anexado'),
        ]));
      }
    }
    lastAuthor = msg.authorId;
    lastTs = ts;
  }

  if (wasAtBottom || true) box.scrollTop = box.scrollHeight;

  if (editingMessageId) {
    const ta = box.querySelector(`.gk-msg-row[data-msg-id="${editingMessageId}"] .gk-msg-edit-textarea`);
    if (ta) {
      autoResizeEditTextarea(ta);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
  }
}

// ---------- Edição de mensagem própria ----------
function buildEditBox(msg) {
  const textarea = el('textarea', {
    class: 'gk-msg-edit-textarea',
    rows: '1',
    oninput: (e) => { editingDraft = e.target.value; autoResizeEditTextarea(e.target); },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMessage(msg.id); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEditMessage(); }
    },
  }, editingDraft);

  return el('div', { class: 'gk-msg-edit-box' }, [
    textarea,
    el('div', { class: 'gk-msg-edit-actions' }, [
      el('span', { class: 'gk-msg-edit-hint' }, 'esc para cancelar • enter para salvar'),
      el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: cancelEditMessage }, 'Cancelar'),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => saveEditMessage(msg.id) }, 'Salvar'),
    ]),
  ]);
}

function autoResizeEditTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

function startEditMessage(msgId, currentText) {
  editingMessageId = msgId;
  editingDraft = currentText;
  renderMessages(lastRenderedMessages);
}

function cancelEditMessage() {
  editingMessageId = null;
  editingDraft = '';
  renderMessages(lastRenderedMessages);
}

async function saveEditMessage(msgId) {
  const newText = editingDraft.trim();
  if (!newText) {
    toast('A mensagem não pode ficar vazia.', 'danger');
    return;
  }
  const ref = state.currentChannelId && state.currentServerId
    ? channelMessageDoc(state.currentServerId, state.currentChannelId, msgId)
    : state.currentDmId ? dmMessageDoc(state.currentDmId, msgId) : null;
  if (!ref) return;

  editingMessageId = null;
  editingDraft = '';
  try {
    await updateDoc(ref, { content: newText, editedAt: serverTimestamp() });
  } catch (err) {
    toast('Não foi possível editar a mensagem.', 'danger');
  }
}

export async function sendCurrentMessage() {
  const textarea = document.getElementById('gk-composer-input');
  const text = textarea.value.trim();
  if (!text && !pendingFile) return;

  const uid = auth.currentUser.uid;
  const payload = {
    authorId: uid,
    authorName: state.user.displayName || state.user.username,
    authorAvatar: state.user.avatarUrl || '',
    authorRole: state.user.role || 'free',
    authorTag: state.user.tag || '',
    authorFrameStyle: state.user.frameStyle || 'none',
    content: text,
    createdAt: serverTimestamp(),
  };

  if (pendingFile) {
    try {
      const { url } = await uploadToCloudinary(pendingFile, `attachments/${uid}`);
      payload.attachmentUrl = url;
      payload.attachmentName = pendingFile.name;
      payload.attachmentType = pendingFile.type.startsWith('image/') ? 'image'
        : pendingFile.type.startsWith('video/') ? 'video' : 'file';
    } catch (err) {
      toast(err.message || 'Falha ao enviar anexo.', 'danger');
    }
    clearPendingFile();
  }

  textarea.value = '';
  autoResizeComposer();

  try {
    if (state.currentChannelId && state.currentServerId) {
      await addDoc(channelMessagesCol(state.currentServerId, state.currentChannelId), payload);
    } else if (state.currentDmId) {
      await addDoc(dmMessagesCol(state.currentDmId), payload);
      await updateDoc(dmDoc(state.currentDmId), { lastMessageAt: serverTimestamp(), lastMessagePreview: text.slice(0, 80) });
    }
  } catch (err) {
    toast('Não foi possível enviar a mensagem.', 'danger');
  }
}

export function setPendingFile(file) {
  pendingFile = file;
  toast(`Anexo pronto: ${file.name}`);
}
function clearPendingFile() { pendingFile = null; }

// Envia um anexo direto (sem passar pelo textarea) — usado pelo picker de
// GIFs, já que o GIF escolhido já tem uma URL pronta (GIPHY), sem precisar
// de upload próprio para o Cloudinary.
export async function sendAttachmentMessage(url, attachmentType, attachmentName) {
  if (!state.currentChannelId && !state.currentDmId) {
    toast('Selecione uma conversa antes.', 'danger');
    return;
  }
  const uid = auth.currentUser.uid;
  const payload = {
    authorId: uid,
    authorName: state.user.displayName || state.user.username,
    authorAvatar: state.user.avatarUrl || '',
    authorRole: state.user.role || 'free',
    authorTag: state.user.tag || '',
    authorFrameStyle: state.user.frameStyle || 'none',
    content: '',
    attachmentUrl: url,
    attachmentType,
    attachmentName: attachmentName || 'GIF',
    createdAt: serverTimestamp(),
  };
  try {
    if (state.currentChannelId && state.currentServerId) {
      await addDoc(channelMessagesCol(state.currentServerId, state.currentChannelId), payload);
    } else if (state.currentDmId) {
      await addDoc(dmMessagesCol(state.currentDmId), payload);
      await updateDoc(dmDoc(state.currentDmId), { lastMessageAt: serverTimestamp(), lastMessagePreview: '📎 GIF' });
    }
  } catch (err) {
    toast('Não foi possível enviar o GIF.', 'danger');
  }
}

export function autoResizeComposer() {
  const textarea = document.getElementById('gk-composer-input');
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

export function wireComposer() {
  const textarea = document.getElementById('gk-composer-input');
  const sendBtn = document.getElementById('gk-send-btn');
  const fileInput = document.getElementById('gk-file-input');

  textarea.addEventListener('input', autoResizeComposer);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });
  sendBtn.addEventListener('click', sendCurrentMessage);
  document.getElementById('gk-attach-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setPendingFile(fileInput.files[0]);
    fileInput.value = '';
  });
}
