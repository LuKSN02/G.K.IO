// ============================================================
// G.K.IO — Mensagens (canais de servidor e DMs), com anexos de mídia
// ============================================================
import {
  auth,
  channelMessagesCol, dmMessagesCol, dmDoc, channelDoc, channelMessageDoc, dmMessageDoc, attachmentsCol,
  addDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove,
  query, orderBy, limit, onSnapshot, serverTimestamp,
} from './db.js';
import { state, el, escapeHtml, fallbackAvatar, formatTime, cleanupListener, toast } from './state.js';
import { isEmojiOnly } from './markdown.js';
import { openProfileCard } from './profile.js';
import { hideFriendsHome } from './dms.js';
import { uploadToCloudinary } from './cloudinary.js';
import { playNotifSound, showDesktopNotification } from './prefs.js';
import { renderMessageContent, openEmojiPickerForReaction, getCustomEmojiByName, searchMentionCandidates } from './emoji.js';
import { openImageLightbox } from './lightbox.js';
import { notifyTyping, stopTyping, listenTyping } from './typing.js';
import { markConversationRead } from './unread.js';
import { icon } from './icons.js';
import { notifyDmMessage, notifyChannelMessage } from './push.js';
// Import circular com servers.js (que importa selectChannel daqui). É seguro:
// canManageChannels é uma declaração de função, então já existe no escopo do
// módulo antes de qualquer chamada — só é usada em resposta a clique, muito
// depois dos dois módulos terminarem de avaliar.
import { canManageChannels } from './servers.js';

let pendingFile = null;
let lastSeenMessageId = null;
let isFirstSnapshotForConversation = true;
let currentChannelName = '';
let currentDmOtherUid = null;

// ---------- Edição de mensagem ----------
let editingMessageId = null; // id da mensagem sendo editada no momento (ou null)
let editingDraft = '';       // texto em edição, preservado entre re-renders do snapshot
let lastRenderedMessages = [];

// Ids que já apareceram na tela desta conversa. Como cada snapshot do
// Firestore redesenha a lista inteira, é isso que distingue "mensagem
// que acabou de chegar" (ganha animação de entrada) de "mensagem que já
// estava aqui e só foi redesenhada porque alguém reagiu/editou".
const renderedMessageIds = new Set();
// notifyIfNewIncomingMessage() já zera isFirstSnapshotForConversation antes
// de renderMessages() rodar, então não dá pra usar aquela flag aqui: o
// primeiro desenho da conversa animaria o histórico inteiro de uma vez.
let hasRenderedConversationOnce = false;

export function selectChannel(serverId, channelId, name, readOnly = false) {
  stopTyping(); // saindo da conversa anterior — libera o doc de "digitando" dela
  hideFriendsHome();
  state.currentView = 'server';
  state.currentServerId = serverId;
  state.currentChannelId = channelId;
  state.currentDmId = null;
  currentChannelName = name;
  currentDmOtherUid = null;
  document.getElementById('gk-topbar-title').textContent = `# ${name}`;
  setBaseSubtitle(readOnly ? 'Canal de texto · somente leitura para você' : 'Canal de texto');
  document.getElementById('gk-call-btn').style.display = 'none';
  applyComposerReadOnly(readOnly);
  attachMessagesListener(channelMessagesCol(serverId, channelId), channelId);
  listenTyping({ serverId, channelId }, applyTypingLabel);
  refreshSidebarActiveState();
}

// O subtítulo do topbar é compartilhado com o indicador de "digitando..."
// (ver applyTypingLabel abaixo) — guardamos o texto "de base" pra poder
// restaurá-lo assim que ninguém mais estiver digitando.
let baseSubtitle = '';
function setBaseSubtitle(text) {
  baseSubtitle = text || '';
  const subtitleEl = document.getElementById('gk-topbar-subtitle');
  subtitleEl.textContent = baseSubtitle;
  subtitleEl.classList.remove('gk-typing-label');
}

function applyTypingLabel(names) {
  const subtitleEl = document.getElementById('gk-topbar-subtitle');
  if (!names.length) {
    subtitleEl.textContent = baseSubtitle;
    subtitleEl.classList.remove('gk-typing-label');
    return;
  }
  const label = names.length === 1 ? `${names[0]} está digitando...`
    : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando...`
    : `${names.length} pessoas estão digitando...`;
  subtitleEl.textContent = label;
  subtitleEl.classList.add('gk-typing-label');
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

export function selectDm(dmId, title, subtitle, otherUid = null) {
  stopTyping(); // saindo da conversa anterior — libera o doc de "digitando" dela
  hideFriendsHome();
  state.currentView = 'dms';
  state.currentDmId = dmId;
  state.currentChannelId = null;
  currentChannelName = '';
  currentDmOtherUid = otherUid;
  document.getElementById('gk-topbar-title').textContent = title;
  setBaseSubtitle(subtitle || '');
  document.getElementById('gk-call-btn').style.display = 'inline-flex';
  applyComposerReadOnly(false);
  attachMessagesListener(dmMessagesCol(dmId), dmId);
  listenTyping({ dmId }, applyTypingLabel);
  refreshSidebarActiveState();
}

function refreshSidebarActiveState() {
  document.querySelectorAll('.gk-channel').forEach((n) => n.classList.remove('gk-active'));
  document.querySelectorAll('.gk-dm-row').forEach((n) => n.classList.remove('gk-active'));
  const activeId = state.currentChannelId || state.currentDmId;
  document.querySelectorAll(`[data-id="${activeId}"]`).forEach((n) => n.classList.add('gk-active'));
}

function attachMessagesListener(colRef, conversationId) {
  cleanupListener('messages');
  lastSeenMessageId = null;
  isFirstSnapshotForConversation = true;
  editingMessageId = null;
  editingDraft = '';
  renderedMessageIds.clear();
  hasRenderedConversationOnce = false;
  clearPendingFile(); // anexo escolhido e não enviado não "viaja" pra outra conversa
  closeMentionAutocomplete();
  // Mostra um esqueleto na hora — sem isso, ao trocar de conversa a tela
  // fica com as mensagens da conversa anterior (ou em branco) até o
  // primeiro snapshot do Firestore chegar, o que parece travado.
  renderMessagesSkeleton();
  const q = query(colRef, orderBy('createdAt'), limit(200));
  const unsub = onSnapshot(q, (snap) => {
    const messages = [];
    snap.forEach((d) => messages.push({ id: d.id, ...d.data() }));
    const isNewIncoming = notifyIfNewIncomingMessage(messages);
    lastRenderedMessages = messages;
    renderMessages(messages, isNewIncoming);
    // A pessoa está com esta conversa aberta agora — qualquer mensagem que
    // chegue (inclusive em tempo real) conta como "lida" na hora.
    markConversationRead(conversationId);
  });
  state.unsubscribers.messages = unsub;
}

// Referência do doc de uma mensagem na conversa atualmente aberta —
// compartilhada entre edição (saveEditMessage) e reações (toggleReaction).
function getMessageRef(msgId) {
  if (state.currentChannelId && state.currentServerId) return channelMessageDoc(state.currentServerId, state.currentChannelId, msgId);
  if (state.currentDmId) return dmMessageDoc(state.currentDmId, msgId);
  return null;
}

// Retorna true quando a última mensagem do snapshot é realmente nova (chegou
// agora, não é só um re-render por edição/reação, e não é o primeiro
// snapshot ao abrir a conversa) — usado tanto pra notificação quanto pro
// "pill" de novas mensagens quando a pessoa está com o scroll pra cima.
function notifyIfNewIncomingMessage(messages) {
  if (!messages.length) { isFirstSnapshotForConversation = false; return false; }
  const last = messages[messages.length - 1];
  const isNew = last.id !== lastSeenMessageId;
  lastSeenMessageId = last.id;
  if (!isNew || isFirstSnapshotForConversation) { isFirstSnapshotForConversation = false; return false; }
  if (last.authorId === state.user?.uid) return false;
  playNotifSound();
  showDesktopNotification(last.authorName || 'Nova mensagem', last.content || '📎 Anexo enviado', last.authorAvatar);
  return true;
}

// Esqueleto simples (barras pulsando) enquanto o primeiro snapshot da
// conversa não chega — algumas "linhas" com largura/alinhamento variados
// pra sugerir texto de verdade em vez de blocos idênticos.
function renderMessagesSkeleton() {
  const box = document.getElementById('gk-messages');
  box.innerHTML = '';
  hideJumpToBottomPill();
  const widths = [72, 45, 88, 60];
  for (let i = 0; i < 4; i++) {
    box.appendChild(el('div', { class: 'gk-msg-skeleton-row' }, [
      el('div', { class: 'gk-skeleton gk-skeleton-avatar' }),
      el('div', { class: 'gk-msg-skeleton-lines' }, [
        el('div', { class: 'gk-skeleton gk-skeleton-line', style: 'width:120px' }),
        el('div', { class: 'gk-skeleton gk-skeleton-line', style: `width:${widths[i % widths.length]}%` }),
      ]),
    ]));
  }
}

function renderMessages(messages, isNewIncoming = false) {
  const box = document.getElementById('gk-messages');
  const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
  // Guardados pra restaurar a posição de leitura depois do re-render: sem
  // isso, quem estava lendo mensagens antigas era jogado pro topo toda vez
  // que alguém reagia ou editava algo na conversa.
  const prevScrollTop = box.scrollTop;
  const prevScrollHeight = box.scrollHeight;
  box.innerHTML = '';
  hideJumpToBottomPill();

  if (messages.length === 0) {
    box.appendChild(el('div', { class: 'gk-empty-state' }, [
      el('div', { class: 'gk-emoji' }, [icon('chatBubble', { size: 32 })]),
      el('div', {}, 'Nenhuma mensagem ainda. Diga oi!'),
    ]));
    hasRenderedConversationOnce = true; // a próxima a chegar é nova de verdade
    return;
  }

  let lastAuthor = null;
  let lastGroup = null;
  const GROUP_WINDOW_MS = 5 * 60 * 1000;
  let lastTs = 0;
  let lastDayKey = null;

  for (const msg of messages) {
    const ts = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : Date.now();
    const date = new Date(ts);
    const dayKey = date.toDateString();

    // Divisor de dia — também quebra o agrupamento, pra que a primeira
    // mensagem depois da virada sempre mostre autor e horário.
    const newDay = dayKey !== lastDayKey;
    if (newDay) {
      box.appendChild(el('div', { class: 'gk-date-divider' }, [
        el('span', {}, formatDateLabel(date)),
      ]));
      lastDayKey = dayKey;
    }

    const sameGroup = !newDay && lastAuthor === msg.authorId && (ts - lastTs) < GROUP_WINDOW_MS;
    if (!sameGroup) {
      lastGroup = el('div', { class: 'gk-msg-group' }, [
        el('div', {
          class: 'gk-avatar gk-sz-40', style: 'cursor:pointer;',
          'data-frame': msg.authorFrameStyle || 'none',
          onclick: () => openProfileCard(msg.authorId),
        }, [el('img', { src: resolveAuthorAvatar(msg) || fallbackAvatar(msg.authorName) })]),
        el('div', { class: 'gk-msg-body' }, [
          el('div', { class: 'gk-msg-head' }, [
            el('span', { class: 'gk-author', onclick: () => openProfileCard(msg.authorId) }, msg.authorName || 'Usuário'),
            msg.authorRole === 'prime' ? el('span', { class: 'gk-badge-prime', title: 'G.K.IO Prime' }, [icon('diamond', { size: 12 })]) : null,
            msg.authorTag ? el('span', { class: 'gk-author-tag' }, msg.authorTag) : null,
            el('span', { class: 'gk-time', title: formatFullDate(date) }, formatTime(msg.createdAt)),
          ]),
        ]),
      ]);
      box.appendChild(lastGroup);
    }
    const body = lastGroup.querySelector('.gk-msg-body');
    const isOwn = msg.authorId === state.user?.uid;
    const isEditingThis = editingMessageId === msg.id;

    const row = el('div', { class: 'gk-msg-row', 'data-msg-id': msg.id });
    // Mensagem que acabou de chegar entra com um leve fade; as que já
    // estavam na tela são redesenhadas sem animação nenhuma.
    if (hasRenderedConversationOnce && !renderedMessageIds.has(msg.id)) {
      row.classList.add('gk-msg-new');
    }
    renderedMessageIds.add(msg.id);

    // Nas mensagens seguidas do mesmo autor o cabeçalho não se repete —
    // o horário aparece na margem esquerda ao passar o mouse, como no Discord.
    if (sameGroup) {
      row.appendChild(el('span', { class: 'gk-msg-row-time', title: formatFullDate(date) }, formatTime(msg.createdAt)));
    }

    if (isEditingThis) {
      row.appendChild(buildEditBox(msg));
    } else {
      if (msg.content) {
        const classes = ['gk-msg-line'];
        if (msg.authorRole === 'prime') classes.push('gk-msg-line-prime');
        if (isEmojiOnly(msg.content)) classes.push('gk-msg-line-jumbo');
        const line = el('div', { class: classes.join(' ') }, renderMessageContent(msg.content));
        if (msg.editedAt) line.appendChild(el('span', { class: 'gk-msg-edited-tag', title: 'Mensagem editada' }, '(editado)'));
        row.appendChild(line);
      }
      const actionButtons = [
        el('button', {
          class: 'gk-msg-action-btn', type: 'button', title: 'Reagir',
          // O listener de "clique fora fecha o painel" (em emoji.js) roda no
          // document durante o bubbling — sem isso, o mesmo clique que abre
          // o painel também "vê" esse clique como um clique de fora e fecha
          // na hora, fazendo o botão parecer travado/sem função.
          onclick: (e) => { e.stopPropagation(); openEmojiPickerForReaction(e.currentTarget, (key) => toggleReaction(msg, key)); },
        }, [icon('emojiSmile', { size: 15 })]),
      ];
      if (msg.content) {
        actionButtons.push(el('button', {
          class: 'gk-msg-action-btn', type: 'button', title: 'Copiar texto',
          onclick: () => copyMessageText(msg.content),
        }, [icon('copy', { size: 14 })]));
      }
      // Editar é só do autor, e agora também quando a mensagem tem um
      // anexo sem legenda (dava pra reagir/apagar mas nunca editar pra
      // adicionar um texto). Apagar segue a régua do Firestore: o autor
      // sempre, e quem modera o canal apaga a de qualquer um (em DM não
      // há moderação — só o autor).
      if (isOwn && (msg.content || msg.attachmentUrl)) {
        actionButtons.push(el('button', {
          class: 'gk-msg-action-btn', type: 'button', title: 'Editar mensagem',
          onclick: () => startEditMessage(msg.id, msg.content || ''),
        }, [icon('edit', { size: 14 })]));
      }
      if (isOwn || canModerateCurrentChannel()) {
        actionButtons.push(el('button', {
          class: 'gk-msg-action-btn gk-msg-action-danger', type: 'button',
          title: isOwn ? 'Apagar mensagem' : 'Apagar mensagem (moderação)',
          onclick: () => confirmDeleteMessage(msg, !isOwn),
        }, [icon('trash', { size: 14 })]));
      }
      row.appendChild(el('div', { class: 'gk-msg-actions' }, actionButtons));
    }

    // O anexo agora mora DENTRO de .gk-msg-row (antes era irmão dela, fora
    // do hover): numa mensagem só de foto, sem nenhum texto, a row inteira
    // colapsava pra altura zero (as ações são position:absolute, não geram
    // altura), então passar o mouse sobre a foto nunca "tocava" a row e
    // reagir/editar/apagar ficavam inacessíveis. Fica visível mesmo
    // editando, pra dar pra ver o que está ganhando legenda.
    if (msg.attachmentUrl) {
      if (msg.attachmentType === 'image' || msg.attachmentType === 'gif') {
        row.appendChild(el('div', { class: 'gk-msg-attachment' + (msg.attachmentType === 'gif' ? ' gk-msg-attachment-gif' : '') }, [
          el('img', {
            src: msg.attachmentUrl, class: 'gk-msg-image-zoomable',
            onclick: () => openImageLightbox(msg.attachmentUrl),
          }),
        ]));
      } else if (msg.attachmentType === 'video') {
        row.appendChild(el('div', { class: 'gk-msg-attachment' }, [el('video', { src: msg.attachmentUrl, controls: 'true' })]));
      } else {
        row.appendChild(el('a', { class: 'gk-msg-file', href: msg.attachmentUrl, target: '_blank' }, [
          icon('attach', { size: 14 }), el('span', {}, msg.attachmentName || 'Arquivo anexado'),
        ]));
      }
    }
    body.appendChild(row);

    if (!isEditingThis) {
      const reactionsBar = buildReactionsBar(msg);
      if (reactionsBar) body.appendChild(reactionsBar);
    }

    lastAuthor = msg.authorId;
    lastTs = ts;
  }

  if (wasAtBottom) {
    box.scrollTop = box.scrollHeight;
  } else {
    // Mantém a mesma mensagem debaixo do olho da pessoa: se a lista cresceu
    // (chegou algo novo acima ou abaixo), compensa a diferença de altura.
    box.scrollTop = prevScrollTop + (box.scrollHeight - prevScrollHeight);
    if (isNewIncoming) showJumpToBottomPill(box);
  }

  hasRenderedConversationOnce = true;

  if (editingMessageId) {
    const ta = box.querySelector(`.gk-msg-row[data-msg-id="${editingMessageId}"] .gk-msg-edit-textarea`);
    if (ta) {
      autoResizeEditTextarea(ta);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
  }
}

// msg.authorAvatar é gravado no documento da mensagem na hora do envio —
// funciona pra manter o histórico, mas nunca acompanha uma troca de foto
// de perfil depois. Aqui a gente prefere o dado mais fresco que já estiver
// em algum cache vivo do app (membros do servidor, a outra pessoa da DM,
// ou a própria pessoa logada) e só cai pro valor congelado da mensagem
// quando ninguém desses tem o autor carregado (ex: membro que já saiu).
function resolveAuthorAvatar(msg) {
  if (msg.authorId === state.user?.uid) return state.user.avatarUrl || msg.authorAvatar || '';
  if (state.currentServerId) {
    const member = state.serverMembersCache.get(state.currentServerId)?.get(msg.authorId);
    if (member?.user?.avatarUrl) return member.user.avatarUrl;
  } else if (state.currentDmId) {
    const dm = state.dms.get(state.currentDmId);
    if (dm?.other?.uid === msg.authorId && dm.other.avatarUrl) return dm.other.avatarUrl;
  }
  return msg.authorAvatar || '';
}

// ---------- Datas ----------
// "Hoje" / "Ontem" pro que é recente, data por extenso pro resto — e o
// ano só aparece quando a mensagem é de outro ano, senão vira ruído.
function formatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  const opts = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('pt-BR', opts);
}

function formatFullDate(date) {
  return date.toLocaleString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---------- Copiar / apagar ----------
async function copyMessageText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Texto copiado.');
  } catch (err) {
    toast('Não foi possível copiar o texto.', 'danger');
  }
}

// Só faz sentido em canal de servidor — DM não tem moderação.
function canModerateCurrentChannel() {
  if (!state.currentServerId || !state.currentChannelId) return false;
  return canManageChannels(state.currentServerId);
}

function confirmDeleteMessage(msg, asModerator = false) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';

  const preview = (msg.content || '').trim();
  modal.appendChild(el('h2', {}, 'Apagar mensagem?'));
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, asModerator
    ? `Você vai apagar a mensagem de ${msg.authorName || 'outra pessoa'}. Ela some para todo mundo no canal e não dá pra recuperar.`
    : 'Ela some para todo mundo na conversa e não dá pra recuperar.'));
  if (preview) {
    modal.appendChild(el('div', { class: 'gk-delete-preview' }, preview.length > 220 ? preview.slice(0, 220) + '…' : preview));
  }
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', {
      class: 'gk-btn gk-btn-danger',
      onclick: async () => {
        overlay.classList.remove('gk-open');
        const ref = getMessageRef(msg.id);
        if (!ref) return;
        try {
          await deleteDoc(ref);
          toast('Mensagem apagada.');
        } catch (err) {
          toast('Não foi possível apagar a mensagem.', 'danger');
        }
      },
    }, [icon('trash', { size: 15 }), ' Apagar']),
  ]));
  overlay.classList.add('gk-open');
}

// ---------- Reações rápidas ----------
// Guardadas no doc da mensagem como reactions: { chave: [uid, uid, ...] }.
// A chave é 'native:<emoji>' pra emoji nativo ou 'custom:<nome>' pra emoji
// personalizado (biblioteca compartilhada — ver emoji.js), o que permite
// reaproveitar o mesmo picker usado no composer (ver openEmojiPickerForReaction).
function buildReactionsBar(msg) {
  const reactions = msg.reactions || {};
  const entries = Object.entries(reactions).filter(([, uids]) => Array.isArray(uids) && uids.length);
  if (!entries.length) return null;

  const bar = el('div', { class: 'gk-reactions-bar' });
  for (const [key, uids] of entries) {
    const mine = uids.includes(state.user?.uid);
    const [kind, ...rest] = key.split(':');
    const value = rest.join(':');
    let contentNode;
    if (kind === 'custom') {
      const emoji = getCustomEmojiByName(value);
      contentNode = emoji
        ? el('img', { class: 'gk-reaction-emoji-img', src: emoji.url, title: `:${value}:`, alt: `:${value}:` })
        : el('span', {}, `:${value}:`);
    } else {
      contentNode = el('span', {}, value);
    }
    bar.appendChild(el('button', {
      class: 'gk-reaction-chip' + (mine ? ' gk-reaction-mine' : ''),
      type: 'button', title: mine ? 'Remover reação' : 'Reagir',
      onclick: () => toggleReaction(msg, key),
    }, [contentNode, el('span', { class: 'gk-reaction-count' }, String(uids.length))]));
  }
  return bar;
}

async function toggleReaction(msg, key) {
  const uid = state.user?.uid;
  const ref = getMessageRef(msg.id);
  if (!ref || !uid) return;
  const already = (msg.reactions?.[key] || []).includes(uid);
  try {
    await updateDoc(ref, { [`reactions.${key}`]: already ? arrayRemove(uid) : arrayUnion(uid) });
  } catch (err) {
    toast('Não foi possível reagir.', 'danger');
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

// ---------- "Novas mensagens" (pill de voltar ao fim) ----------
// Antes disso, um `|| true` deixado no código forçava a rolagem pro fim a
// cada snapshot do Firestore — mesmo com a pessoa lendo mensagens antigas
// mais acima. Agora só rola sozinho se ela já estava perto do fim; senão,
// mostra esse aviso discreto em vez de puxar a tela.
function showJumpToBottomPill(box) {
  if (document.getElementById('gk-jump-pill')) return;
  const pill = el('button', {
    id: 'gk-jump-pill', class: 'gk-jump-pill', type: 'button',
    onclick: () => { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); hideJumpToBottomPill(); },
  }, [el('span', {}, 'Novas mensagens'), icon('chevronDown', { size: 14 })]);
  box.appendChild(pill);
}
function hideJumpToBottomPill() {
  document.getElementById('gk-jump-pill')?.remove();
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
  const ref = getMessageRef(msgId);
  if (!ref) return;

  editingMessageId = null;
  editingDraft = '';
  try {
    await updateDoc(ref, { content: newText, editedAt: serverTimestamp() });
  } catch (err) {
    toast('Não foi possível editar a mensagem.', 'danger');
  }
}

// Espelha o anexo num índice pessoal e leve (coleção attachments/), a
// base da seção "Arquivos" no rail — sem isso, listar "meus arquivos"
// exigiria varrer toda conversa que a pessoa já participou. Best-effort:
// uma falha aqui nunca derruba o envio da mensagem em si, que já saiu.
async function indexAttachment(payload, context) {
  if (!payload.attachmentUrl) return;
  try {
    await addDoc(attachmentsCol(), {
      uid: payload.authorId,
      url: payload.attachmentUrl,
      name: payload.attachmentName || '',
      type: payload.attachmentType || 'file',
      ...context,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[attachments] Falhou ao indexar anexo:', err.message);
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
    setAttachmentUploading(true);
    try {
      const { url } = await uploadToCloudinary(pendingFile, `attachments/${uid}`);
      payload.attachmentUrl = url;
      payload.attachmentName = pendingFile.name;
      payload.attachmentType = pendingFile.type.startsWith('image/') ? 'image'
        : pendingFile.type.startsWith('video/') ? 'video' : 'file';
    } catch (err) {
      toast(err.message || 'Falha ao enviar anexo.', 'danger');
    }
    setAttachmentUploading(false);
    clearPendingFile();
  }

  textarea.value = '';
  autoResizeComposer();
  stopTyping(); // a mensagem já saiu — não faz sentido continuar mostrando "digitando..."

  try {
    if (state.currentChannelId && state.currentServerId) {
      await addDoc(channelMessagesCol(state.currentServerId, state.currentChannelId), payload);
      // Denormalizado no próprio canal — é o que a sidebar usa pra saber se
      // há mensagem "nova" ali (ver isConversationUnread em unread.js).
      await updateDoc(channelDoc(state.currentServerId, state.currentChannelId), {
        lastMessageAt: serverTimestamp(), lastMessageAuthorId: uid,
      });
      notifyChannelMessage(otherServerMemberUids(state.currentServerId, uid), {
        authorName: payload.authorName, preview: text || (payload.attachmentUrl ? 'Enviou um anexo.' : ''),
        serverId: state.currentServerId, channelId: state.currentChannelId, channelName: currentChannelName,
      });
      indexAttachment(payload, { serverId: state.currentServerId, channelId: state.currentChannelId });
    } else if (state.currentDmId) {
      await addDoc(dmMessagesCol(state.currentDmId), payload);
      await updateDoc(dmDoc(state.currentDmId), {
        lastMessageAt: serverTimestamp(), lastMessageAuthorId: uid, lastMessagePreview: text.slice(0, 80),
      });
      if (currentDmOtherUid) {
        notifyDmMessage(currentDmOtherUid, { authorName: payload.authorName, preview: text || 'Enviou um anexo.', dmId: state.currentDmId });
      }
      indexAttachment(payload, { dmId: state.currentDmId });
    }
  } catch (err) {
    toast('Não foi possível enviar a mensagem.', 'danger');
  }
}

// Uids de todo mundo no servidor, exceto quem acabou de mandar a mensagem
// — usado só pra notificar push (ver push.js); vem do cache de membros já
// carregado pelo painel de membros (servers.js).
function otherServerMemberUids(serverId, exceptUid) {
  const membersMap = state.serverMembersCache.get(serverId);
  if (!membersMap) return [];
  return [...membersMap.keys()].filter((uid) => uid !== exceptUid);
}

// O arquivo escolhido fica visível acima do composer até ser enviado —
// antes ele virava só um toast, então dava pra esquecer que havia um
// anexo engatilhado e não havia como desistir dele.
export function setPendingFile(file) {
  pendingFile = file;
  renderPendingFile();
}

function clearPendingFile() {
  if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
  pendingFile = null;
  const box = document.getElementById('gk-composer-attachment');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
}

function renderPendingFile() {
  const box = document.getElementById('gk-composer-attachment');
  if (!box || !pendingFile) return;
  box.innerHTML = '';

  const isImage = pendingFile.type.startsWith('image/');
  let thumb;
  if (isImage) {
    pendingFile.previewUrl = URL.createObjectURL(pendingFile);
    thumb = el('img', { class: 'gk-attach-thumb', src: pendingFile.previewUrl, alt: '' });
  } else {
    thumb = el('div', { class: 'gk-attach-thumb gk-attach-thumb-file' }, [icon('attach', { size: 18 })]);
  }

  box.appendChild(el('div', { class: 'gk-attach-chip', id: 'gk-attach-chip' }, [
    thumb,
    el('div', { class: 'gk-attach-meta' }, [
      el('div', { class: 'gk-attach-name', title: pendingFile.name }, pendingFile.name),
      el('div', { class: 'gk-attach-size' }, formatFileSize(pendingFile.size)),
    ]),
    el('button', {
      class: 'gk-attach-remove', type: 'button', title: 'Remover anexo',
      onclick: clearPendingFile,
    }, [icon('close', { size: 14 })]),
  ]));
  box.style.display = 'block';
}

function setAttachmentUploading(on) {
  const chip = document.getElementById('gk-attach-chip');
  if (chip) chip.classList.toggle('gk-uploading', on);
  const sendBtn = document.getElementById('gk-send-btn');
  if (sendBtn) sendBtn.disabled = on;
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
      await updateDoc(channelDoc(state.currentServerId, state.currentChannelId), {
        lastMessageAt: serverTimestamp(), lastMessageAuthorId: uid,
      });
      notifyChannelMessage(otherServerMemberUids(state.currentServerId, uid), {
        authorName: payload.authorName, preview: 'Enviou um GIF.',
        serverId: state.currentServerId, channelId: state.currentChannelId, channelName: currentChannelName,
      });
      indexAttachment(payload, { serverId: state.currentServerId, channelId: state.currentChannelId });
    } else if (state.currentDmId) {
      await addDoc(dmMessagesCol(state.currentDmId), payload);
      await updateDoc(dmDoc(state.currentDmId), {
        lastMessageAt: serverTimestamp(), lastMessageAuthorId: uid, lastMessagePreview: '📎 GIF',
      });
      if (currentDmOtherUid) {
        notifyDmMessage(currentDmOtherUid, { authorName: payload.authorName, preview: 'Enviou um GIF.', dmId: state.currentDmId });
      }
      indexAttachment(payload, { dmId: state.currentDmId });
    }
  } catch (err) {
    toast('Não foi possível enviar o GIF.', 'danger');
  }
}

// ---------- Autocomplete de @menção ----------
// O dropdown é um único elemento reaproveitado (como o picker de emoji em
// emoji.js), criado sob demanda e reposicionado a cada abertura.
let mentionPanelEl = null;
let mentionMatches = [];
let mentionActiveIndex = 0;
let mentionTokenStart = -1; // posição do "@" no texto, pra saber o que substituir ao aceitar

function ensureMentionPanel() {
  if (mentionPanelEl) return mentionPanelEl;
  mentionPanelEl = el('div', { class: 'gk-mention-dropdown' });
  document.body.appendChild(mentionPanelEl);
  return mentionPanelEl;
}

// Acha o "@parcial" sendo digitado bem antes do cursor — só conta se o @
// estiver no início da linha ou depois de um espaço (assim "fulano@mail.com"
// não dispara o autocomplete no meio de um e-mail).
function currentMentionToken(textarea) {
  const pos = textarea.selectionStart;
  const upToCaret = textarea.value.slice(0, pos);
  const m = upToCaret.match(/(?:^|\s)@([a-zA-Z0-9_-]{0,32})$/);
  if (!m) return null;
  return { query: m[1], start: pos - m[1].length - 1 };
}

function updateMentionAutocomplete(textarea) {
  const token = currentMentionToken(textarea);
  if (!token) { closeMentionAutocomplete(); return; }
  const matches = searchMentionCandidates(token.query);
  if (!matches.length) { closeMentionAutocomplete(); return; }

  mentionMatches = matches;
  mentionActiveIndex = 0;
  mentionTokenStart = token.start;
  renderMentionPanel(textarea);
}

function renderMentionPanel(textarea) {
  const panel = ensureMentionPanel();
  panel.innerHTML = '';
  mentionMatches.forEach((u, i) => {
    panel.appendChild(el('button', {
      type: 'button', class: 'gk-mention-item' + (i === mentionActiveIndex ? ' gk-active' : ''),
      onmousedown: (e) => e.preventDefault(), // não tira o foco do textarea antes do click disparar
      onclick: () => applyMentionSelection(textarea, u),
    }, [
      el('img', { class: 'gk-mention-item-avatar', src: u.avatarUrl || fallbackAvatar(u.displayName || u.username) }),
      el('span', {}, u.displayName || u.username),
      el('span', { class: 'gk-mention-item-username' }, `@${u.username}`),
    ]));
  });

  const rect = textarea.getBoundingClientRect();
  panel.style.left = `${rect.left}px`;
  panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  panel.style.width = `${Math.min(280, rect.width)}px`;
  panel.classList.add('gk-open');
}

function closeMentionAutocomplete() {
  mentionMatches = [];
  mentionTokenStart = -1;
  if (mentionPanelEl) mentionPanelEl.classList.remove('gk-open');
}

// Retorna true quando consumiu a tecla (dropdown estava aberto) — o
// keydown handler do composer então NÃO deve seguir pro comportamento padrão.
function handleMentionKeydown(e, textarea) {
  if (!mentionMatches.length) return false;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    mentionActiveIndex = (mentionActiveIndex + 1) % mentionMatches.length;
    renderMentionPanel(textarea);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    mentionActiveIndex = (mentionActiveIndex - 1 + mentionMatches.length) % mentionMatches.length;
    renderMentionPanel(textarea);
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    applyMentionSelection(textarea, mentionMatches[mentionActiveIndex]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeMentionAutocomplete();
    return true;
  }
  return false;
}

function applyMentionSelection(textarea, user) {
  const before = textarea.value.slice(0, mentionTokenStart);
  const after = textarea.value.slice(textarea.selectionStart);
  const insert = `@${user.username} `;
  textarea.value = before + insert + after;
  const caret = before.length + insert.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  closeMentionAutocomplete();
  autoResizeComposer();
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

  textarea.addEventListener('input', () => {
    autoResizeComposer();
    if (textarea.value.trim()) notifyTyping();
    updateMentionAutocomplete(textarea);
  });
  textarea.addEventListener('keydown', (e) => {
    // Com o dropdown de @menção aberto, as setas/Enter/Esc pertencem a
    // ele — só cai pro comportamento normal (enviar mensagem) quando não
    // há nenhuma sugestão em exibição.
    if (handleMentionKeydown(e, textarea)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });
  textarea.addEventListener('blur', () => {
    // Pequeno atraso pra não fechar antes do clique num item do dropdown registrar.
    setTimeout(closeMentionAutocomplete, 150);
  });
  sendBtn.addEventListener('click', sendCurrentMessage);
  document.getElementById('gk-attach-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setPendingFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // Se a pessoa rolar de volta pro fim por conta própria (sem clicar no
  // pill), some com o aviso de "novas mensagens" também.
  const messagesBox = document.getElementById('gk-messages');
  messagesBox.addEventListener('scroll', () => {
    const atBottom = messagesBox.scrollTop + messagesBox.clientHeight >= messagesBox.scrollHeight - 60;
    if (atBottom) hideJumpToBottomPill();
  }, { passive: true });
}
