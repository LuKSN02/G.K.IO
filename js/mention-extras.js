// #canal: sugestões ao digitar + chip clicável nas mensagens.
import { state, el } from './state.js';
import { getCategoriesAndChannels } from './servers.js';
import { selectChannel } from './chat.js';
import { setChannelResolver } from './markdown.js';

const textChannels = () => (state.currentServerId ? (getCategoriesAndChannels().channels || []).filter((c) => c.type === 'text' && !c.nsfw) : []);

setChannelResolver((name) => {
  const ch = textChannels().find((c) => c.name.toLowerCase() === name.toLowerCase());
  return ch ? { name: ch.name, go: () => selectChannel(state.currentServerId, ch.id, ch.name) } : null;
});

let panel = null; let items = []; let idx = 0; let start = -1;
const close = () => { items = []; start = -1; panel?.classList.remove('gk-open'); };
function render(ta) {
  panel ||= document.body.appendChild(el('div', { class: 'gk-mention-dropdown gk-chan-dropdown' }));
  panel.replaceChildren(...items.map((c, i) => el('button', { type: 'button', class: 'gk-mention-item' + (i === idx ? ' gk-active' : ''), onmousedown: (e) => e.preventDefault(), onclick: () => pick(ta, c) }, [
    el('span', { class: 'gk-mention-item-avatar gk-mention-item-special' }, '#'), el('span', {}, c.name),
  ])));
  const r = ta.getBoundingClientRect();
  Object.assign(panel.style, { left: r.left + 'px', bottom: (window.innerHeight - r.top + 6) + 'px', width: Math.min(280, r.width) + 'px' });
  panel.classList.add('gk-open');
}
function pick(ta, c) {
  const before = ta.value.slice(0, start); const after = ta.value.slice(ta.selectionStart);
  ta.value = before + '#' + c.name + ' ' + after;
  const caret = before.length + c.name.length + 2; ta.focus(); ta.setSelectionRange(caret, caret); close();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function update(ta) {
  const m = ta.value.slice(0, ta.selectionStart).match(/(?:^|\s)#([a-z0-9_-]{0,40})$/i);
  if (!m || !state.currentServerId) { close(); return; }
  const q = m[1].toLowerCase();
  items = textChannels().filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  if (!items.length) { close(); return; }
  idx = 0; start = ta.selectionStart - m[1].length - 1; render(ta);
}
function init() {
  const ta = document.getElementById('gk-composer-input');
  if (!ta) { setTimeout(init, 800); return; }
  ta.addEventListener('input', () => update(ta));
  ta.addEventListener('blur', () => setTimeout(close, 120));
  ta.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); idx = (idx + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(ta); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(ta, items[idx]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
}
init();
