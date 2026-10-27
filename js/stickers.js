// ============================================================
// G.K.IO — Figurinhas
//  · pacote pronto: emojis em tamanho grande
//  · suas figurinhas: imagens (PNG/GIF/WebP, até 512 KB) enviadas ao Cloudinary;
//    a lista fica neste aparelho (até 30)
// A mensagem leva `sticker: { emoji }` ou `sticker: { url, name }`. Só imagens do
// Cloudinary (https) são desenhadas — qualquer outro endereço é ignorado.
// ============================================================
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { uploadToCloudinary } from './cloudinary.js';

const KEY = 'gkio-stickers';
const MAX = 30;
const MAX_BYTES = 512 * 1024;
export const BUILTIN = ['😂', '😍', '🥳', '😭', '😎', '🤯', '🥹', '😡', '🙏', '👍', '👏', '🔥', '💯', '❤️', '💀', '🤝', '🎉', '👀', '🫡', '🤔', '😴', '🍕', '🐱', '🐟'];

export const isTrustedStickerUrl = (u) => typeof u === 'string' && u.length < 400 && /^https:\/\/res\.cloudinary\.com\/[^\s]+$/.test(u);
/** Normaliza o que vem numa mensagem (ou null se inválido). */
export function cleanSticker(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.emoji === 'string' && s.emoji.length > 0 && s.emoji.length <= 16) return { emoji: s.emoji };
  if (isTrustedStickerUrl(s.url)) return { url: s.url, name: String(s.name || 'figurinha').slice(0, 30) };
  return null;
}
export const getMyStickers = () => { try { return (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter((x) => isTrustedStickerUrl(x?.url)).slice(0, MAX); } catch (e) { return []; } };
const saveMine = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage indisponível */ } };
export async function addMySticker(file) {
  if (!file || !/^image\/(png|gif|webp|jpeg)$/.test(file.type)) throw new Error('Use PNG, GIF, WebP ou JPG.');
  if (file.size > MAX_BYTES) throw new Error('A figurinha deve ter no máximo 512 KB.');
  const list = getMyStickers(); if (list.length >= MAX) throw new Error(`Limite de ${MAX} figurinhas.`);
  const up = await uploadToCloudinary(file, 'stickers');
  const item = { id: 's' + Date.now().toString(36), name: file.name.replace(/\.[^.]+$/, '').slice(0, 30), url: up.url };
  saveMine([...list, item]); return item;
}
export const removeMySticker = (id) => saveMine(getMyStickers().filter((s) => s.id !== id));

/** Figurinha desenhada dentro da mensagem. */
export function buildStickerNode(sticker) {
  const s = cleanSticker(sticker); if (!s) return null;
  if (s.emoji) return el('div', { class: 'gk-sticker gk-sticker-emoji', role: 'img', 'aria-label': 'Figurinha' }, s.emoji);
  return el('div', { class: 'gk-sticker' }, [el('img', { src: s.url, alt: s.name, loading: 'lazy', referrerpolicy: 'no-referrer' })]);
}

/** Preenche a aba "Figurinhas" do seletor de emojis. `onPick(sticker)` manda a figurinha. */
export function renderStickersTab(bodyEl, onPick) {
  bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, 'Pacote básico'));
  const grid = el('div', { class: 'gk-sticker-grid' });
  for (const e of BUILTIN) grid.appendChild(el('button', { class: 'gk-sticker-pick', type: 'button', title: 'Enviar figurinha', onclick: () => onPick({ emoji: e }) }, e));
  bodyEl.appendChild(grid);
  bodyEl.appendChild(el('div', { class: 'gk-emoji-category-label' }, 'Minhas figurinhas'));
  const mine = el('div', { class: 'gk-sticker-grid' });
  const file = el('input', { type: 'file', accept: 'image/png,image/gif,image/webp,image/jpeg', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = ''; if (!f) return;
    try { toast('Enviando figurinha…'); await addMySticker(f); toast('Figurinha adicionada!'); redraw(); } catch (e) { toast(e.message || 'Não foi possível adicionar.', 'danger'); }
  });
  function redraw() {
    mine.innerHTML = '';
    mine.appendChild(el('button', { class: 'gk-sticker-pick gk-sticker-add', type: 'button', title: 'Adicionar figurinha', 'aria-label': 'Adicionar figurinha', onclick: () => file.click() }, [icon('plus', { size: 22 })]));
    for (const s of getMyStickers()) {
      mine.appendChild(el('div', { class: 'gk-sticker-mine' }, [
        el('button', { class: 'gk-sticker-pick', type: 'button', title: s.name, onclick: () => onPick({ url: s.url, name: s.name }) }, [el('img', { src: s.url, alt: s.name, loading: 'lazy' })]),
        el('button', { class: 'gk-sfx-del', type: 'button', title: 'Remover figurinha', 'aria-label': `Remover ${s.name}`, onclick: () => { removeMySticker(s.id); redraw(); } }, [icon('close', { size: 11 })]),
      ]));
    }
  }
  redraw();
  bodyEl.appendChild(mine); bodyEl.appendChild(file);
}
