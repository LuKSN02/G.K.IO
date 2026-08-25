// ============================================================
// G.K.IO — Emojis nativos, emojis personalizados e GIFs
// ============================================================
// Emojis personalizados são uma biblioteca compartilhada (qualquer
// pessoa pode enviar/usar), guardada em customEmojis/{id} no
// Firestore + Cloudinary para a imagem. São referenciados no texto
// da mensagem como :nome_do_emoji: e trocados por <img> na hora de
// renderizar (ver renderMessageContent, usado por chat.js).
// ============================================================
import {
  auth, customEmojisCol, addDoc, getDocs,
  query, where, onSnapshot, orderBy, serverTimestamp,
} from './db.js';
import { state, el, toast } from './state.js';
import { uploadToCloudinary } from './cloudinary.js';
import { giphyConfig } from './gif-config.js';
import { icon } from './icons.js';

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
// 'insert' (padrão, escreve no composer) ou 'react' (o painel foi aberto
// pra escolher o emoji de uma reação numa mensagem — ver openEmojiPickerForReaction,
// usado por chat.js). Em modo 'react' o clique num emoji chama reactionCallback
// em vez de inserir no textarea.
let pickerMode = 'insert';
let reactionCallback = null;

const customEmojiCache = new Map(); // id -> { id, name, url, uploaderId }
let unsubCustomEmojis = null;
// Arquivo selecionado aguardando um nome antes do upload (substitui o antigo
// fluxo com window.prompt(), que fica bloqueado silenciosamente em vários
// navegadores/extensões — por isso "nada acontecia" ao escolher a imagem).
let pendingEmojiFile = null;

// ---------- Listener da biblioteca de emojis personalizados ----------
export function listenCustomEmojis() {
  if (unsubCustomEmojis) unsubCustomEmojis();
  const q = query(customEmojisCol(), orderBy('name'));
  unsubCustomEmojis = onSnapshot(q, (snap) => {
    customEmojiCache.clear();
    snap.forEach((d) => customEmojiCache.set(d.id, { id: d.id, ...d.data() }));
    if (panelEl && panelEl.classList.contains('gk-open') && currentTab === 'custom') renderTab();
  });
}

// ---------- Renderização de mensagens com emoji personalizado ----------
// Troca ocorrências de :nome: (quando conhecido) por <img>. Usado por
// chat.js ao montar cada linha de mensagem.
export function renderMessageContent(text) {
  if (!text) return [];
  const regex = /:([a-z0-9_]{2,32}):/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text))) {
    const name = match[1];
    const emoji = [...customEmojiCache.values()].find((e) => e.name === name);
    if (!emoji) continue;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(el('img', { class: 'gk-inline-emoji', src: emoji.url, title: `:${name}:`, alt: `:${name}:` }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : [text];
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
  const tabs = el('div', { class: 'gk-emoji-picker-tabs' }, [
    el('button', { class: 'gk-emoji-tab gk-active', 'data-tab': 'emojis', onclick: () => switchTab('emojis') }, [icon('emojiSmile', { size: 15 }), ' Emojis']),
    el('button', { class: 'gk-emoji-tab', 'data-tab': 'custom', onclick: () => switchTab('custom') }, [icon('starOutline', { size: 15 }), ' Personalizados']),
    gifsTabBtn,
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
  searchInputEl.style.display = tab === 'emojis' ? 'none' : 'block';
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
  const uploadTile = el('button', {
    class: 'gk-emoji-upload-tile', title: 'Enviar novo emoji', type: 'button', onclick: triggerUpload,
  }, [icon('plus', { size: 20 })]);
  const grid = el('div', { class: 'gk-emoji-grid gk-emoji-grid-custom' }, [uploadTile]);
  const list = [...customEmojiCache.values()].filter((e) => !filter || e.name.includes(filter));
  bodyEl.appendChild(grid);
  if (list.length === 0) {
    bodyEl.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' },
      filter ? 'Nenhum emoji encontrado.' : 'Nenhum emoji personalizado ainda. Envie o primeiro!'));
    return;
  }
  for (const emoji of list) {
    grid.appendChild(el('button', {
      class: 'gk-emoji-item gk-emoji-item-custom', title: `:${emoji.name}:`, type: 'button',
      onclick: () => pickEmoji('custom', emoji.name),
    }, [el('img', { src: emoji.url })]));
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
    await addDoc(customEmojisCol(), { name, url, uploaderId: auth.currentUser.uid, createdAt: serverTimestamp() });
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
