// Sistema de bots do G.K.IO (lado do app).
// Um bot é uma conta comum (programa externo que entra com e-mail/senha) marcada com isBot:true
// no documento do usuário. Aqui: etiqueta BOT, embeds, autocomplete de comandos e o card "Bots" do servidor.
import { state, el, toast } from './state.js';
import { createInvite } from './servers.js';

const CSS = `
.gk-bot-tag{display:inline-flex;align-items:center;margin-left:6px;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.04em;color:#fff;background:var(--gk-brand-gradient,linear-gradient(135deg,#8B5CF6,#4F7DF7));vertical-align:middle}
.gk-embed{display:flex;gap:12px;max-width:440px;margin-top:6px;padding:10px 12px;border-radius:10px;background:var(--nv-panel,rgba(255,255,255,.04));border:1px solid var(--nv-line,rgba(255,255,255,.08));border-left:4px solid var(--embed-color,var(--gk-accent,#6C63F5))}
.gk-embed-main{min-width:0;flex:1}
.gk-embed-title{font-weight:700;font-size:14px;margin-bottom:2px;overflow-wrap:anywhere}
.gk-embed-title a{color:inherit;text-decoration:none}.gk-embed-title a:hover{text-decoration:underline}
.gk-embed-desc{font-size:13px;opacity:.85;white-space:pre-wrap;overflow-wrap:anywhere}
.gk-embed-fields{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:6px}
.gk-embed-field b{display:block;font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.04em}
.gk-embed-field span{font-size:13px}
.gk-embed-thumb{width:64px;height:64px;border-radius:8px;object-fit:cover;flex:none}
.gk-embed-foot{margin-top:6px;font-size:11px;opacity:.55}
.gk-cmd-pop{position:absolute;left:12px;right:12px;bottom:100%;margin-bottom:6px;max-height:260px;overflow:auto;z-index:60;border-radius:12px;background:var(--nv-panel,#1c1c26);border:1px solid var(--nv-line,rgba(255,255,255,.1));box-shadow:0 10px 30px rgba(0,0,0,.35);padding:4px}
.gk-cmd-item{display:flex;gap:10px;align-items:baseline;padding:7px 10px;border-radius:8px;cursor:pointer}
.gk-cmd-item.on,.gk-cmd-item:hover{background:var(--gk-accent-soft,rgba(108,99,245,.18))}
.gk-cmd-name{font-weight:600;font-size:13px}.gk-cmd-args{opacity:.5;font-size:12px}.gk-cmd-desc{opacity:.7;font-size:12px;margin-left:auto;text-align:right}.gk-cmd-bot{font-size:10px;opacity:.5}
.gk-bots-row{display:flex;align-items:center;gap:10px;padding:6px 0}
.gk-bots-row img{width:32px;height:32px;border-radius:50%}
.gk-bots-hint{font-size:12px;opacity:.65;margin:6px 0}
`;
function injectCss() {
  if (document.getElementById('gk-bots-css')) return;
  const s = document.createElement('style'); s.id = 'gk-bots-css'; s.textContent = CSS; document.head.appendChild(s);
}
injectCss();

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '');

/** Embed { title, url, description, color, thumbnail, fields:[{name,value}], footer } */
export function buildBotEmbed(e) {
  if (!e || typeof e !== 'object') return null;
  const color = safeColor(e.color);
  const url = safeUrl(e.url);
  const main = el('div', { class: 'gk-embed-main' }, [
    e.title ? el('div', { class: 'gk-embed-title' }, [url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, String(e.title).slice(0, 256)) : String(e.title).slice(0, 256)]) : null,
    e.description ? el('div', { class: 'gk-embed-desc' }, String(e.description).slice(0, 2000)) : null,
    Array.isArray(e.fields) && e.fields.length
      ? el('div', { class: 'gk-embed-fields' }, e.fields.slice(0, 8).map((f) => el('div', { class: 'gk-embed-field' }, [el('b', {}, String(f.name || '').slice(0, 64)), el('span', {}, String(f.value || '').slice(0, 256))])))
      : null,
    e.footer ? el('div', { class: 'gk-embed-foot' }, String(e.footer).slice(0, 200)) : null,
  ]);
  const thumb = safeUrl(e.thumbnail);
  return el('div', { class: 'gk-embed', style: color ? `--embed-color:${color}` : undefined }, [main, thumb ? el('img', { class: 'gk-embed-thumb', src: thumb, alt: '', loading: 'lazy' }) : null]);
}

export const botTag = () => el('span', { class: 'gk-bot-tag', title: 'Bot' }, 'BOT');

/** Bots do servidor atual (membros com user.isBot). */
export function serverBots(serverId) {
  const cache = state.serverMembersCache.get(serverId);
  return cache ? [...cache.values()].filter((m) => m.user?.isBot) : [];
}

// ---------- autocomplete "/" ----------
let pop = null; let items = []; let sel = 0;
function closePop() { pop?.remove(); pop = null; items = []; }
function commandsFor(serverId) {
  const out = [];
  for (const b of serverBots(serverId)) {
    for (const c of Array.isArray(b.user.botCommands) ? b.user.botCommands : []) {
      if (c && c.name) out.push({ bot: b.user.displayName || b.user.username || 'Bot', name: String(c.name), args: String(c.args || ''), desc: String(c.desc || '') });
    }
  }
  return out;
}
function render(ta) {
  const v = ta.value;
  if (!state.currentServerId || !v.startsWith('/') || /\s/.test(v.slice(1).split('\n')[0]) && v.includes(' ')) { closePop(); return; }
  const q = v.slice(1).toLowerCase();
  items = commandsFor(state.currentServerId).filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 12);
  if (!items.length) { closePop(); return; }
  sel = Math.min(sel, items.length - 1);
  const host = ta.closest('#gk-composer') || ta.parentElement;
  if (!pop) { pop = el('div', { class: 'gk-cmd-pop', role: 'listbox' }); host.style.position ||= 'relative'; host.appendChild(pop); }
  pop.replaceChildren(...items.map((c, i) => el('div', { class: 'gk-cmd-item' + (i === sel ? ' on' : ''), onmousedown: (ev) => { ev.preventDefault(); pick(ta, c); } }, [
    el('span', { class: 'gk-cmd-name' }, '/' + c.name), c.args ? el('span', { class: 'gk-cmd-args' }, c.args) : null,
    el('span', { class: 'gk-cmd-desc' }, [c.desc, ' ', el('span', { class: 'gk-cmd-bot' }, '· ' + c.bot)]),
  ])));
}
function pick(ta, c) { ta.value = '/' + c.name + ' '; closePop(); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); }
function initAutocomplete() {
  const ta = document.getElementById('gk-composer-input');
  if (!ta || ta.dataset.botsInit) { if (!ta) setTimeout(initAutocomplete, 800); return; }
  ta.dataset.botsInit = '1';
  ta.addEventListener('input', () => { sel = 0; render(ta); });
  ta.addEventListener('blur', () => setTimeout(closePop, 120));
  ta.addEventListener('keydown', (e) => {
    if (!pop || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; render(ta); }
    else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && ta.value.trim() !== '/' + items[sel].name)) { e.preventDefault(); e.stopImmediatePropagation(); pick(ta, items[sel]); }
    else if (e.key === 'Escape') { closePop(); }
  }, true);
}
initAutocomplete();

// ---------- card "Bots" nas configurações do servidor ----------
export function buildBotsCard(serverId) {
  const list = el('div', {});
  const bots = serverBots(serverId);
  if (!bots.length) list.appendChild(el('div', { class: 'gk-bots-hint' }, 'Nenhum bot neste servidor ainda.'));
  bots.forEach((b) => list.appendChild(el('div', { class: 'gk-bots-row' }, [
    el('img', { src: b.user.avatarUrl || '', alt: '' }), el('span', {}, b.user.displayName || b.user.username || 'Bot'), botTag(),
    el('span', { class: 'gk-cmd-desc' }, (Array.isArray(b.user.botCommands) ? b.user.botCommands.length : 0) + ' comandos'),
  ])));
  const out = el('div', { class: 'gk-bots-hint' });
  const btn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
    try {
      const code = await createInvite(serverId, { expiresInSeconds: 3600, maxUses: 1 });
      out.textContent = `Código para o bot entrar (vale 1 hora, 1 uso): ${code}  —  no programa do bot: npm run join -- ${code}`;
    } catch (e) { toast('Não foi possível gerar o código: ' + (e.message || e), 'danger'); }
  } }, 'Gerar código para adicionar um bot');
  return el('div', { class: 'gk-sv-card', id: 'gk-bots-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, 'Bots')]),
    list, btn, out,
    el('div', { class: 'gk-bots-hint' }, 'Bots são programas que você roda (no seu PC ou num servidor). Veja o guia do bot de música.'),
  ]);
}
