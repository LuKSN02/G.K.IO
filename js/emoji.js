// ============================================================
// G.K.IO — Emojis nativos, emojis personalizados e GIFs
// ============================================================
// Emojis personalizados são PESSOAIS: só quem criou (uploaderId) pode usar.
// Outra pessoa só usa se pedir acesso e o criador aceitar (o uid entra em
// allowedUserIds do emoji; os pedidos ficam em customEmojiRequests/).
// Guardados em customEmojis/{id} no Firestore + Cloudinary para a imagem. São referenciados no texto
// da mensagem como :nome_do_emoji: e trocados por <img> na hora de
// renderizar (ver renderMessageContent, usado por chat.js).
// ============================================================
import {
  db, auth, customEmojisCol, customEmojiDoc, customEmojiRequestsCol, customEmojiRequestDoc,
  addDoc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, arrayUnion, arrayRemove, userDoc,
  query, where, onSnapshot, orderBy, serverTimestamp,
} from './db.js';
import { state, el, toast } from './state.js';
import { uploadToCloudinary } from './cloudinary.js';
import { giphyConfig } from './gif-config.js';
import { icon } from './icons.js';
import { renderRichText } from './markdown.js';
import { renderStickersTab } from './stickers.js';

// ---------- Emojis nativos (curadoria por categoria) ----------
const EMOJI_CATEGORIES = {
  'Carinhas': ['😀','😁','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😜','🤔','🫡','😐','😑','😴','🤤','😪','🥱','😷','🤒','🤕','🥳','🥺','😢','😭','😡','🤬','😱','😨','😰','😅','😆','🙃','😏'],
  'Gestos': ['👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','🙏','💪','👋','🤝','✋','🖐️','🫶','👊','✊'],
  'Pessoas': ['🧑','👶','🧒','🧑‍💻','🧑‍🎤','🧑‍🚀','🧟','🧙','🧛','🕵️','💃','🕺'],
  'Animais': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐢','🐍','🦖','🐳','🐬','🦈','🐙'],
  'Comida': ['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🌽','🍕','🍔','🍟','🌭','🥪','🌮','🌯','🍜','🍣','🍩','🍪','🎂','🍰','🍫','🍿','☕','🍺','🍷'],
  'Atividades': ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🎮','🎲','🎯','🎳','🎨','🎸','🎧','🎬','🏆','🥇'],
  'Viagem': ['🚗','🚕','🚙','🚌','🚑','🚓','🚒','🚲','🏍️','✈️','🚀','🚁','⛵','🚂','🗺️','🏔️','🌋','🏖️','🏝️','🌃','🌆','🏠','🏢','⛩️'],
  'Objetos': ['💡','🔦','🕯️','📱','💻','⌨️','🖥️','🖨️','🖱️','📷','🎥','📺','⏰','🔋','🔌','💾','📀','🎁','📦','✉️','📌','📎','🔒','🔑','🛠️','🔧','⚙️','🧲','🧪','💰','💎'],
  'Símbolos': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💯','✨','⭐','🌟','💫','🔥','💧','⚡','☀️','🌙','☁️','🌈','❗','❓','✅','❌','⚠️','♻️','🔞','🆗','🆕'],
};

// ---------- Estado interno do picker ----------
let panelEl = null;
let searchInputEl = null;
let bodyEl = null;
let currentTab = 'emojis';
let attachedTextarea = null;
let onSendGifCallback = null;
let gifSearchDebounce = null;
let uploadFileInput = null;
let gifsTabBtn = null;
let stickersTabBtn = null;
// 'insert' (padrão, escreve no composer) ou 'react' (o painel foi aberto
// pra escolher o emoji de uma reação numa mensagem — ver openEmojiPickerForReaction,
// usado por chat.js). Em modo 'react' o clique num emoji chama reactionCallback
// em vez de inserir no textarea.
let pickerMode = 'insert';
let reactionCallback = null;

const customEmojiCache = new Map(); // id -> { id, name, url, uploaderId }
let customEmojiVersion = 0; // sobe a cada snapshot: o chat usa para invalidar linhas já desenhadas
export const getCustomEmojiVersion = () => customEmojiVersion;
let unsubCustomEmojis = null;
// Arquivo selecionado aguardando um nome antes do upload (substitui o antigo
// fluxo com window.prompt(), que fica bloqueado silenciosamente em vários
// navegadores/extensões — por isso "nada acontecia" ao escolher a imagem).
let pendingEmojiFile = null;

// ---------- Acesso aos emojis personalizados ----------
// Pode usar: quem criou, ou quem o criador liberou (allowedUserIds).
// Emojis antigos (sem allowedUserIds) ficam só com o criador.
export function canUseCustomEmoji(emoji) {
  const uid = auth.currentUser?.uid;
  if (!emoji || !uid) return false;
  // Emoji de servidor: todo membro daquele servidor pode usar.
  if (emoji.serverId && state.servers.has(emoji.serverId)) return true;
  return emoji.uploaderId === uid || (emoji.allowedUserIds || []).includes(uid);
}

// Nomes de emojis personalizados citados no texto (:nome:) que a pessoa NÃO pode
// usar. Usado por chat.js para barrar envio/edição — o emoji continua aparecendo
// normalmente nas mensagens de quem tem acesso.
export function lockedCustomEmojisIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/:([a-z0-9_]{2,32}):/g)) {
    const emoji = getCustomEmojiByName(m[1]);
    if (emoji && !canUseCustomEmoji(emoji) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function isCustomEmojiNameLocked(name) {
  const emoji = getCustomEmojiByName(name);
  return !!emoji && !canUseCustomEmoji(emoji);
}

// ---------- Listener da biblioteca de emojis personalizados ----------
let unsubMyRequests = null;
let unsubIncomingRequests = null;
const myRequests = new Map();      // emojiId -> 'pending' | 'approved' | 'denied' (pedidos que EU fiz)
let incomingRequests = [];         // pedidos pendentes feitos a emojis MEUS
let customTabBadge = null;

function refreshCustomUi() {
  if (customTabBadge) {
    customTabBadge.textContent = incomingRequests.length ? String(incomingRequests.length) : '';
    customTabBadge.style.display = incomingRequests.length ? 'inline-flex' : 'none';
  }
  if (panelEl && panelEl.classList.contains('gk-open') && currentTab === 'custom' && !pendingEmojiFile) renderTab();
}

export function listenCustomEmojis() {
  if (unsubCustomEmojis) unsubCustomEmojis();
  const q = query(customEmojisCol(), orderBy('name'));
  unsubCustomEmojis = onSnapshot(q, (snap) => {
    customEmojiCache.clear();
    customEmojiVersion++;
    snap.forEach((d) => customEmojiCache.set(d.id, { id: d.id, ...d.data() }));
    if (panelEl && panelEl.classList.contains('gk-open') && currentTab === 'custom') renderTab();
  });

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Pedidos que eu fiz: mostra "enviado/recusado" e avisa quando o criador libera.
  if (unsubMyRequests) unsubMyRequests();
  let firstMine = true;
  unsubMyRequests = onSnapshot(query(customEmojiRequestsCol(), where('requesterId', '==', uid)), (snap) => {
    myRequests.clear();
    snap.forEach((d) => myRequests.set(d.data().emojiId, d.data().status));
    if (!firstMine) {
      snap.docChanges().forEach((c) => {
        if (c.type === 'modified' && c.doc.data().status === 'approved') toast(`Acesso liberado: :${c.doc.data().emojiName}:`);
      });
    }
    firstMine = false;
    refreshCustomUi();
  }, (e) => console.warn('[emoji] pedidos feitos:', e.message));

  // Pedidos feitos aos MEUS emojis: aparecem no topo da aba Personalizados.
  if (unsubIncomingRequests) unsubIncomingRequests();
  let firstIncoming = true;
  unsubIncomingRequests = onSnapshot(query(customEmojiRequestsCol(), where('ownerId', '==', uid)), (snap) => {
    incomingRequests = [];
    snap.forEach((d) => { if (d.data().status === 'pending') incomingRequests.push({ id: d.id, ...d.data() }); });
    if (!firstIncoming) {
      snap.docChanges().forEach((c) => {
        const r = c.doc.data();
        if (c.type === 'added' && r.status === 'pending') toast(`${r.requesterName || 'Alguém'} pediu acesso ao seu emoji :${r.emojiName}:`);
      });
    }
    firstIncoming = false;
    refreshCustomUi();
  }, (e) => console.warn('[emoji] pedidos recebidos:', e.message));
}

async function requestEmojiAccess(emoji) {
  const uid = auth.currentUser?.uid;
  if (!uid || emoji.uploaderId === uid) return;
  try {
    await setDoc(customEmojiRequestDoc(`${emoji.id}_${uid}`), {
      emojiId: emoji.id,
      emojiName: emoji.name,
      ownerId: emoji.uploaderId,
      requesterId: uid,
      requesterName: state.user?.displayName || state.user?.username || 'Alguém',
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    toast(`Pedido enviado ao criador de :${emoji.name}:`);
  } catch (err) {
    toast('Não foi possível enviar o pedido.', 'danger');
  }
}

// Nome de quem tem acesso (carregado sob demanda e guardado).
const accessNameCache = new Map();
async function resolveUserName(uid) {
  if (accessNameCache.has(uid)) return accessNameCache.get(uid);
  let name = 'Usuário';
  try {
    const snap = await getDoc(userDoc(uid));
    if (snap.exists()) name = snap.data().displayName || snap.data().username || name;
  } catch (_) { /* sem permissão/offline: fica o nome genérico */ }
  accessNameCache.set(uid, name);
  return name;
}

// O criador tira o acesso de alguém. O pedido antigo também é apagado, então
// a pessoa pode pedir de novo no futuro, se o criador mudar de ideia.
async function revokeEmojiAccess(emoji, uid) {
  try {
    const batch = writeBatch(db);
    batch.update(customEmojiDoc(emoji.id), { allowedUserIds: arrayRemove(uid) });
    batch.delete(customEmojiRequestDoc(`${emoji.id}_${uid}`));
    await batch.commit();
    toast(`Acesso removido de :${emoji.name}:.`);
  } catch (err) {
    toast('Não foi possível remover o acesso.', 'danger');
  }
}

async function answerEmojiRequest(req, approve) {
  try {
    const batch = writeBatch(db);
    batch.update(customEmojiRequestDoc(req.id), { status: approve ? 'approved' : 'denied' });
    if (approve) batch.update(customEmojiDoc(req.emojiId), { allowedUserIds: arrayUnion(req.requesterId) });
    await batch.commit();
    toast(approve ? `Acesso liberado para ${req.requesterName || 'a pessoa'}.` : 'Pedido recusado.');
  } catch (err) {
    toast('Não foi possível responder ao pedido.', 'danger');
  }
}

// ---------- Renderização de mensagens com emoji personalizado ----------
// Troca ocorrências de :nome: (quando conhecido) por <img>. Usado por
// chat.js ao montar cada linha de mensagem.
let everyoneChipAllowed = false;
export function renderMessageContent(text, { everyone = false } = {}) {
  // A formatação em si (negrito, código, citação, links, spoiler) vive em
  // markdown.js; aqui só entramos com os resolvedores de emoji e @menção,
  // que dependem do estado local (cache de emojis, membros, amigos).
  // @everyone / @here só viram chip quando a mensagem foi gravada com o aviso (autor tinha permissão).
  everyoneChipAllowed = !!everyone;
  try { return renderRichText(text, getCustomEmojiByName, resolveMentionByName); } finally { everyoneChipAllowed = false; }
}

// Junta quem está "à vista" no contexto atual (servidor aberto, DM aberta,
// lista de amigos, a própria pessoa) — fonte única usada tanto pra resolver
// um @nome já escrito quanto pra sugerir nomes enquanto a pessoa digita.
function mentionCandidates() {
  const seen = new Set();
  const out = [];
  const add = (u) => { if (u?.uid && !seen.has(u.uid)) { seen.add(u.uid); out.push(u); } };
  if (state.user) add(state.user);
  if (state.currentServerId) {
    const cache = state.serverMembersCache.get(state.currentServerId);
    if (cache) for (const m of cache.values()) if (m.user) add({ uid: m.uid, ...m.user });
  }
  if (state.currentDmId) {
    const dm = state.dms.get(state.currentDmId);
    if (dm?.other) add(dm.other);
  }
  for (const f of state.friends.values()) add(f);
  return out;
}

function resolveMentionByName(name) {
  const target = name.toLowerCase();
  if (everyoneChipAllowed && (target === 'everyone' || target === 'here')) return { uid: null, name: target, username: target, special: true };
  const hit = mentionCandidates().find((u) => (u.username || '').toLowerCase() === target);
  if (!hit) return null;
  return { uid: hit.uid, name: hit.displayName || hit.username, username: hit.username };
}

// Usado pelo autocomplete do composer (ver wireMentionAutocomplete em
// chat.js) — retorna quem bate com o prefixo digitado depois do @, por
// username ou nome de exibição, limitado a um punhado de sugestões.
export function searchMentionCandidates(prefix) {
  const p = prefix.toLowerCase();
  return mentionCandidates()
    .filter((u) => (u.username || '').toLowerCase().startsWith(p) || (u.displayName || '').toLowerCase().startsWith(p))
    .slice(0, 6);
}

// ---------- Inicialização / wiring do botão + painel ----------
export function initEmojiPicker({ textarea, triggerBtn, onSendGif }) {
  attachedTextarea = textarea;
  onSendGifCallback = onSendGif;
  buildPanel();

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panelEl.classList.contains('gk-open')) { closePicker(); return; }
    pickerMode = 'insert';
    reactionCallback = null;
    if (gifsTabBtn) gifsTabBtn.style.display = '';
    if (stickersTabBtn) stickersTabBtn.style.display = '';
    const rect = triggerBtn.getBoundingClientRect();
    // position:fixed calculado a partir do botão real — evita o mesmo tipo
    // de corte por overflow que já resolvemos no menu de servidores.
    panelEl.style.left = 'auto';
    panelEl.style.top = 'auto';
    panelEl.style.right = `${window.innerWidth - rect.right}px`;
    panelEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    panelEl.classList.add('gk-open');
    switchTab('emojis');
  });

  document.addEventListener('click', (e) => {
    if (panelEl.classList.contains('gk-open') && !panelEl.contains(e.target) && e.target !== triggerBtn && !e.target.closest('.gk-reaction-add-btn')) {
      closePicker();
    }
  });
}

// Abre o mesmo painel de emojis, mas em modo "reação" — usado pelo botão
// "+😊" de cada mensagem (ver chat.js). Ao escolher um emoji nativo ou
// personalizado, chama onPick(key) em vez de inserir no composer, onde
// key é 'native:<emoji>' ou 'custom:<nome>'.
export function openEmojiPickerForReaction(anchorEl, onPick) {
  if (!panelEl) return; // picker ainda não foi inicializado (ver initEmojiPicker)
  pickerMode = 'react';
  reactionCallback = onPick;
  if (gifsTabBtn) gifsTabBtn.style.display = 'none'; // reação não manda GIF
  if (stickersTabBtn) stickersTabBtn.style.display = 'none'; // nem figurinha

  const rect = anchorEl.getBoundingClientRect();
  const panelWidth = 320;
  panelEl.style.right = 'auto';
  panelEl.style.bottom = 'auto';
  panelEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8))}px`;
  panelEl.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 380)}px`;
  panelEl.classList.add('gk-open');
  switchTab(currentTab === 'gifs' ? 'emojis' : currentTab);
}

// Consultada por chat.js pra desenhar o emoji certo (imagem) num chip de
// reação a um emoji personalizado, sem duplicar a busca no cache interno.
export function getCustomEmojiByName(name) {
  return [...customEmojiCache.values()].find((e) => e.name === name) || null;
}

function closePicker() {
  pendingEmojiFile = null;
  pickerMode = 'insert';
  reactionCallback = null;
  panelEl.classList.remove('gk-open');
}

function buildPanel() {
  panelEl = el('div', { class: 'gk-emoji-picker', id: 'gk-emoji-picker' });

  gifsTabBtn = el('button', { class: 'gk-emoji-tab', 'data-tab': 'gifs', onclick: () => switchTab('gifs') }, [icon('clapperboard', { size: 15 }), ' GIFs']);
  stickersTabBtn = el('button', { class: 'gk-emoji-tab', 'data-tab': 'stickers', onclick: () => switchTab('stickers') }, [icon('sparkles', { size: 15 }), ' Figurinhas']);
  const tabs = el('div', { class: 'gk-emoji-picker-tabs' }, [
    el('button', { class: 'gk-emoji-tab gk-active', 'data-tab': 'emojis', onclick: () => switchTab('emojis') }, [icon('emojiSmile', { size: 15 }), ' Emojis']),
    el('button', { class: 'gk-emoji-tab', 'data-tab': 'custom', onclick: () => switchTab('custom') }, [icon('starOutline', { size: 15 }), ' Personalizados', customTabBadge = el('span', { class: 'gk-emoji-tab-badge', style: 'display:none;' })]),
    gifsTabBtn,
    stickersTabBtn,
  ]);

  searchInputEl = el('input', {
    type: 'text', class: 'gk-emoji-search', placeholder: 'Buscar...',
    oninput: () => handleSearchInput(),
  });
  const searchWrap = el('div', { class: 'gk-emoji-picker-search' }, [searchInputEl]);

  bodyEl = el('div', { class: 'gk-emoji-picker-body' });

  panelEl.appendChild(tabs);
  panelEl.appendChild(searchWrap);
  panelEl.appendChild(bodyEl);
  document.body.appendChild(panelEl);
}

function switchTab(tab) {
  currentTab = tab;
  pendingEmojiFile = null;
  panelEl.querySelectorAll('.gk-emoji-tab').forEach((b) => b.classList.toggle('gk-active', b.dataset.tab === tab));
  searchInputEl.value = '';
  searchInputEl.style.display = (tab === 'emojis' || tab === 'stickers') ? 'none' : 'block';
  searchInputEl.placeholder = tab === 'gifs' ? 'Buscar GIFs...' : 'Buscar emoji personalizado...';
  renderTab();
  if (tab === 'gifs') fetchGifs('');
}

function handleSearchInput() {
  if (currentTab === 'custom') renderTab();
  else if (currentTab === 'gifs') {
    clearTimeout(gifSearchDebounce);
    gifSearchDebounce = setTimeout(() => fetchGifs(searchInputEl.value.trim()), 350);
  }
}

function renderTab() {
  bodyEl.innerHTML = '';
  if (currentTab === 'emojis') renderEmojisTab();
  else if (currentTab === 'custom') renderCustomTab();
  else if (currentTab === 'stickers') renderStickersTab(bodyEl, (sticker) => { closePicker(); window.dispatchEvent(new CustomEvent('gkio-send-sticker', { detail: sticker })); });
  // 'gifs' é preenchido de forma assíncrona por fetchGifs()
}

function renderEmojisTab() {
  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, category));
    const grid = el('div', { class: 'gk-emoji-grid' });
    for (const emoji of emojis) {
      grid.appendChild(el('button', {
        class: 'gk-emoji-item', title: emoji, type: 'button',
        onclick: () => pickEmoji('native', emoji),
      }, emoji));
    }
    bodyEl.appendChild(grid);
  }
}

function renderCustomTab() {
  if (pendingEmojiFile) { renderEmojiNameForm(); return; }
  const filter = searchInputEl.value.trim().toLowerCase();

  // 1) Pedidos de acesso aos MEUS emojis (só aparece se houver)
  if (incomingRequests.length) {
    bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, 'Pedidos de acesso'));
    for (const req of incomingRequests) {
      const emoji = customEmojiCache.get(req.emojiId);
      bodyEl.appendChild(el('div', { class: 'gk-emoji-req-row' }, [
        emoji ? el('img', { src: emoji.url, alt: '' }) : el('span', {}),
        el('div', { class: 'gk-emoji-req-text' }, [
          el('b', {}, req.requesterName || 'Alguém'),
          ` quer usar :${req.emojiName}:`,
        ]),
        el('button', { class: 'gk-btn gk-btn-ghost gk-btn-sm', type: 'button', onclick: () => answerEmojiRequest(req, false) }, 'Recusar'),
        el('button', { class: 'gk-btn gk-btn-primary gk-btn-sm', type: 'button', onclick: () => answerEmojiRequest(req, true) }, 'Aceitar'),
      ]));
    }
  }

  // 2) Emojis que eu posso usar (meus + liberados) + botão de enviar novo
  const uploadTile = el('button', {
    class: 'gk-emoji-upload-tile', title: 'Enviar novo emoji', type: 'button', onclick: triggerUpload,
  }, [icon('plus', { size: 20 })]);
  const grid = el('div', { class: 'gk-emoji-grid gk-emoji-grid-custom' }, [uploadTile]);
  // emojis de servidores dos quais você não faz parte não aparecem (nem como "peça acesso")
  const all = [...customEmojiCache.values()].filter((e) => (!e.serverId || state.servers.has(e.serverId)) && (!filter || e.name.includes(filter)));
  const usable = all.filter(canUseCustomEmoji);
  const locked = all.filter((e) => !canUseCustomEmoji(e));
  bodyEl.appendChild(grid);
  for (const emoji of usable) {
    grid.appendChild(el('button', {
      class: 'gk-emoji-item gk-emoji-item-custom', title: `:${emoji.name}:`, type: 'button',
      onclick: () => pickEmoji('custom', emoji.name),
    }, [el('img', { src: emoji.url })]));
  }
  if (usable.length === 0 && locked.length === 0) {
    bodyEl.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' },
      filter ? 'Nenhum emoji encontrado.' : 'Nenhum emoji personalizado ainda. Envie o primeiro!'));
    return;
  }

  // 3) Emojis de outras pessoas: não dá pra usar sem o OK do criador
  if (locked.length) {
    bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, 'De outras pessoas — peça acesso'));
    for (const emoji of locked) {
      const status = myRequests.get(emoji.id);
      const action = status === 'pending'
        ? el('span', { class: 'gk-emoji-req-state' }, 'Pedido enviado')
        : status === 'denied'
          ? el('span', { class: 'gk-emoji-req-state' }, 'Recusado')
          : el('button', { class: 'gk-btn gk-btn-ghost gk-btn-sm', type: 'button', onclick: () => requestEmojiAccess(emoji) }, 'Pedir acesso');
      bodyEl.appendChild(el('div', { class: 'gk-emoji-req-row gk-emoji-req-locked' }, [
        el('img', { src: emoji.url, alt: '' }),
        el('div', { class: 'gk-emoji-req-text' }, `:${emoji.name}:`),
        action,
      ]));
    }
  }

  // 4) Meus emojis liberados para outras pessoas: o criador pode tirar o acesso
  const shared = usable.filter((e) => e.uploaderId === auth.currentUser?.uid && (e.allowedUserIds || []).length);
  if (shared.length) {
    bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, 'Seus emojis liberados'));
    for (const emoji of shared) {
      bodyEl.appendChild(el('div', { class: 'gk-emoji-req-row' }, [
        el('img', { src: emoji.url, alt: '' }),
        el('div', { class: 'gk-emoji-req-text' }, `:${emoji.name}:`),
      ]));
      for (const uid of emoji.allowedUserIds) {
        const nameEl = el('div', { class: 'gk-emoji-req-text' }, accessNameCache.get(uid) || 'Carregando...');
        if (!accessNameCache.has(uid)) resolveUserName(uid).then((n) => { nameEl.textContent = n; });
        bodyEl.appendChild(el('div', { class: 'gk-emoji-req-row gk-emoji-req-sub' }, [
          nameEl,
          el('button', { class: 'gk-btn gk-btn-ghost gk-btn-sm', type: 'button', onclick: () => revokeEmojiAccess(emoji, uid) }, 'Remover acesso'),
        ]));
      }
    }
  }
}

// Ponto único de decisão: em modo normal insere no composer (comportamento
// de sempre); em modo "reação" (aberto via openEmojiPickerForReaction)
// devolve a escolha pro chamador e fecha o painel.
function pickEmoji(kind, value) {
  if (pickerMode === 'react' && reactionCallback) {
    const cb = reactionCallback;
    closePicker();
    cb(`${kind}:${value}`);
    return;
  }
  insertAtCursor(kind === 'native' ? value : `:${value}:`);
}

// Formulário exibido depois de escolher a imagem — substitui o antigo
// window.prompt() por um campo dentro do próprio painel, para funcionar
// de forma confiável em qualquer navegador.
function renderEmojiNameForm() {
  const previewUrl = URL.createObjectURL(pendingEmojiFile);
  const suggestedName = pendingEmojiFile.name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 32);

  const nameInput = el('input', {
    type: 'text', class: 'gk-emoji-name-input', placeholder: 'ex: pepe_feliz', maxlength: '32',
    value: suggestedName,
    oninput: (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); } },
  });
  const errorBox = el('div', { class: 'gk-error' });
  const cancelBtn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: cancelPendingEmoji }, 'Cancelar');
  const confirmBtn = el('button', {
    class: 'gk-btn gk-btn-primary', type: 'button',
    onclick: () => confirmPendingEmoji(nameInput, errorBox, confirmBtn),
  }, 'Enviar');

  bodyEl.appendChild(el('div', { class: 'gk-emoji-upload-form' }, [
    el('img', { class: 'gk-emoji-upload-preview', src: previewUrl }),
    el('div', { class: 'gk-field', style: 'width:100%;' }, [
      el('label', {}, 'Nome do emoji'),
      nameInput,
      errorBox,
    ]),
    el('div', { class: 'gk-emoji-upload-form-actions' }, [cancelBtn, confirmBtn]),
  ]));
  nameInput.focus();
  nameInput.select();
}

function cancelPendingEmoji() {
  pendingEmojiFile = null;
  renderTab();
}

async function confirmPendingEmoji(nameInput, errorBox, confirmBtn) {
  errorBox.style.display = 'none';
  const name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
  if (name.length < 2) {
    errorBox.textContent = 'Digite um nome com pelo menos 2 caracteres.';
    errorBox.style.display = 'block';
    return;
  }

  const existingQ = query(customEmojisCol(), where('name', '==', name));
  const existingSnap = await getDocs(existingQ);
  if (!existingSnap.empty) {
    errorBox.textContent = 'Já existe um emoji com esse nome.';
    errorBox.style.display = 'block';
    return;
  }

  const file = pendingEmojiFile;
  confirmBtn.disabled = true;
  const originalLabel = confirmBtn.textContent;
  confirmBtn.textContent = 'Enviando...';
  try {
    const { url } = await uploadToCloudinary(file, `emojis/${auth.currentUser.uid}`);
    await addDoc(customEmojisCol(), { name, url, uploaderId: auth.currentUser.uid, allowedUserIds: [], createdAt: serverTimestamp() });
    toast(`Emoji :${name}: adicionado!`);
    pendingEmojiFile = null;
    renderTab();
  } catch (err) {
    errorBox.textContent = err.message || 'Falha ao enviar o emoji.';
    errorBox.style.display = 'block';
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalLabel;
  }
}

function triggerUpload() {
  if (!uploadFileInput) {
    uploadFileInput = document.createElement('input');
    uploadFileInput.type = 'file';
    uploadFileInput.accept = 'image/*';
    uploadFileInput.style.display = 'none';
    uploadFileInput.addEventListener('change', () => {
      const file = uploadFileInput.files[0];
      uploadFileInput.value = '';
      if (!file) return;
      const maxMB = state.user?.role === 'prime' ? 8 : 2;
      if (file.size > maxMB * 1024 * 1024) { toast(`O emoji precisa ter até ${maxMB}MB.`, 'danger'); return; }
      pendingEmojiFile = file;
      renderTab();
    });
    // Anexado DENTRO do painel (não em document.body) — o listener de
    // "clique fora fecha o painel" (ver initEmojiPicker) considera esse
    // input como parte do painel, evitando fechar o picker no meio da
    // seleção do arquivo, antes da pessoa poder nomear o emoji.
    panelEl.appendChild(uploadFileInput);
  }
  uploadFileInput.click();
}

// ---------- GIFs (via GIPHY) ----------
async function fetchGifs(searchTerm) {
  bodyEl.innerHTML = '';
  bodyEl.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Carregando...'));
  const endpoint = searchTerm
    ? `https://api.giphy.com/v1/gifs/search?api_key=${giphyConfig.apiKey}&q=${encodeURIComponent(searchTerm)}&limit=24&rating=pg-13&lang=pt`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${giphyConfig.apiKey}&limit=24&rating=pg-13`;
  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    if (currentTab !== 'gifs') return; // usuário já trocou de aba enquanto carregava
    bodyEl.innerHTML = '';
    if (!data.data || data.data.length === 0) {
      bodyEl.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nenhum GIF encontrado.'));
      return;
    }
    const grid = el('div', { class: 'gk-gif-grid' });
    for (const gif of data.data) {
      const preview = gif.images?.fixed_width_small?.url || gif.images?.fixed_width?.url;
      const full = gif.images?.fixed_width?.url || gif.images?.original?.url;
      if (!preview || !full) continue;
      grid.appendChild(el('button', {
        class: 'gk-gif-item', title: gif.title || 'GIF', type: 'button',
        onclick: () => { onSendGifCallback && onSendGifCallback(full, gif.title || 'GIF'); closePicker(); },
      }, [el('img', { src: preview, loading: 'lazy' })]));
    }
    bodyEl.appendChild(grid);
  } catch (err) {
    if (currentTab !== 'gifs') return;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Não foi possível carregar os GIFs.'));
  }
}

// ---------- Inserção no textarea, respeitando a posição do cursor ----------
function insertAtCursor(text) {
  if (!attachedTextarea) return;
  const start = attachedTextarea.selectionStart ?? attachedTextarea.value.length;
  const end = attachedTextarea.selectionEnd ?? attachedTextarea.value.length;
  const value = attachedTextarea.value;
  attachedTextarea.value = value.slice(0, start) + text + value.slice(end);
  const newPos = start + text.length;
  attachedTextarea.selectionStart = attachedTextarea.selectionEnd = newPos;
  attachedTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  attachedTextarea.focus();
}
