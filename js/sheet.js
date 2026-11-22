// ============================================================
// G.K.IO — Folha inferior (bottom sheet) para o celular
// Usada pelo menu de "segurar a mensagem" (context-menu.js), pelo menu da barra
// de usuário e pelo "⋯" do chat. Os itens têm o mesmo formato do menu de contexto:
//   { label, hint, icon, danger, disabled, checked, onClick, submenu:[...] } | { sep:true } | { emojis:[...], onPick }
// Os itens entre dois { sep:true } viram um "cartão", como no Discord.
// ============================================================
import { icon } from './icons.js';

export const isMobileView = () => window.matchMedia('(max-width: 900px)').matches;

const ICONS = [
  [/^responder/i, 'reply'], [/tópico/i, 'chatBubble'], [/copiar (texto|id)/i, 'copy'], [/(fixar|desafixar)/i, 'pin'],
  [/encaminhar/i, 'send'], [/não lida/i, 'eyeOff'], [/editar/i, 'edit'], [/apagar|excluir|remover/i, 'trash'],
  [/salvar|favoritar/i, 'starOutline'], [/mensagens salvas/i, 'starFilled'], [/lembr/i, 'clock'], [/traduzir/i, 'book'],
  [/reação|reagir/i, 'emojiSmile'], [/cargos/i, 'shield'], [/silenciar|reativar|notifica/i, 'bell'], [/convid/i, 'personPlus'],
  [/exportar/i, 'download'], [/configura/i, 'settings'], [/perfil/i, 'user'], [/bloquear/i, 'block'], [/lida/i, 'check'],
];
const iconFor = (it) => it.icon || (ICONS.find(([re]) => re.test(it.label || '')) || [])[1] || null;

function groups(items) {
  const out = [[]];
  for (const it of items.filter(Boolean)) {
    if (it.sep) { if (out[out.length - 1].length) out.push([]); continue; }
    if (it.emojis) { if (out[out.length - 1].length) out.push([]); out[out.length - 1].push(it); out.push([]); continue; } // reações rápidas ficam sozinhas
    out[out.length - 1].push(it);
  }
  return out.filter((g) => g.length);
}

/**
 * Abre a folha. `onDone` roda ao fechar. Devolve { layer, close }.
 * Cada clique de item fecha a folha ANTES de executar a ação (igual ao menu de contexto).
 */
export function openSheet(items, { title = '', onDone = null, className = '' } = {}) {
  document.querySelectorAll('.gk-cm-layer.gk-sheet-layer').forEach((n) => n.remove());
  const layer = document.createElement('div');
  layer.className = 'gk-cm-layer gk-sheet-layer';
  const backdrop = document.createElement('div'); backdrop.className = 'gk-sheet-backdrop';
  const sheet = document.createElement('div'); sheet.className = 'gk-cm gk-cm-sheet ' + className; sheet.setAttribute('role', 'menu');
  const handle = document.createElement('div'); handle.className = 'gk-sheet-handle';
  handle.appendChild(document.createElement('span'));
  const body = document.createElement('div'); body.className = 'gk-sheet-body';
  sheet.append(handle, body);
  layer.append(backdrop, sheet);
  document.body.appendChild(layer);

  let closed = false;
  const close = () => { if (closed) return; closed = true; sheet.classList.add('gk-out'); setTimeout(() => { layer.remove(); onDone?.(); }, 140); };
  const t0 = Date.now();
  backdrop.addEventListener('click', () => { if (Date.now() - t0 > 350) close(); }); // ignora o "soltar" do toque longo
  layer._close = close;

  const stack = [];
  const render = (list, heading) => {
    body.replaceChildren();
    if (heading) {
      const h = document.createElement('button'); h.type = 'button'; h.className = 'gk-sheet-back';
      h.append(icon('chevronLeft', { size: 18 }), document.createTextNode(' ' + heading));
      h.addEventListener('click', () => { stack.pop(); const prev = stack[stack.length - 1]; render(prev.list, prev.heading); });
      body.appendChild(h);
    } else if (title) {
      const t = document.createElement('div'); t.className = 'gk-sheet-title'; t.textContent = title; body.appendChild(t);
    }
    for (const g of groups(list)) {
      const card = document.createElement('div'); card.className = 'gk-sheet-card';
      for (const it of g) {
        if (it.emojis) {
          const strip = document.createElement('div'); strip.className = 'gk-sheet-reacts';
          for (const em of it.emojis) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'gk-sheet-react'; b.textContent = em;
            b.addEventListener('click', (e) => { e.stopPropagation(); close(); it.onPick?.(em); });
            strip.appendChild(b);
          }
          card.classList.add('gk-sheet-card-bare'); card.appendChild(strip); continue;
        }
        if (it.slider) continue; // controles de volume ficam só no desktop
        const row = document.createElement('button'); row.type = 'button';
        row.className = 'gk-sheet-row' + (it.danger ? ' gk-danger' : '') + (it.disabled ? ' gk-disabled' : '');
        row.setAttribute('role', 'menuitem');
        const ic = iconFor(it);
        const left = document.createElement('span'); left.className = 'gk-sheet-ico'; if (ic) left.appendChild(icon(ic, { size: 20 }));
        const main = document.createElement('span'); main.className = 'gk-sheet-main';
        const lab = document.createElement('span'); lab.className = 'gk-sheet-label'; lab.textContent = it.label; main.appendChild(lab);
        if (it.hint) { const hi = document.createElement('span'); hi.className = 'gk-sheet-hint'; hi.textContent = it.hint; main.appendChild(hi); }
        row.append(left, main);
        if (it.checked !== undefined) { const c = document.createElement('span'); c.className = 'gk-sheet-check' + (it.checked ? ' gk-on' : ''); if (it.checked) c.appendChild(icon('check', { size: 14 })); row.appendChild(c); }
        if (it.submenu) {
          const ch = document.createElement('span'); ch.className = 'gk-sheet-chev'; ch.appendChild(icon('chevronDown', { size: 16 })); row.appendChild(ch);
          row.addEventListener('click', (e) => { e.stopPropagation(); stack.push({ list: it.submenu, heading: it.label }); render(it.submenu, it.label); });
        } else if (!it.disabled) {
          row.addEventListener('click', (e) => { e.stopPropagation(); close(); Promise.resolve(it.onClick?.()).catch(() => {}); });
        }
        card.appendChild(row);
      }
      body.appendChild(card);
    }
  };
  stack.push({ list: items, heading: '' });
  render(items, '');

  // Arrastar a alça para baixo fecha
  let y0 = null, dy = 0;
  handle.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
  handle.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  handle.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; sheet.style.transition = ''; if (dy > 90) close(); else sheet.style.transform = ''; }, { passive: true });
  return { layer, close };
}
