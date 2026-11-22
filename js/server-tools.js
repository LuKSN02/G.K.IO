// Ferramentas do servidor: cargos por reação e estatísticas.
import { auth, db, doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, collection, getDocs, query, orderBy, limit, serverTimestamp } from './db.js';
import { state, el, toast } from './state.js';
import { isServerOwner, getRoles, canManageServerInfo, getCategoriesAndChannels } from './servers.js';
import { openEmojiPickerForReaction } from './emoji.js';

// ---------- Cargos por reação ----------
// servers/{id}/reactionRoles/{msgId} = { channelId, map: { chave-da-reação: roleId } }
// servers/{id}/reactionRoles/_allowed = { roleIds: [...] }  (lista que as regras usam para deixar a pessoa se auto-atribuir)
const cfgCache = new Map();
const cfgRef = (sid, id) => doc(db, 'servers', sid, 'reactionRoles', id);

export async function applyReactionRole(msg, key, added) {
  const sid = state.currentServerId; const uid = auth.currentUser?.uid;
  if (!sid || !state.currentChannelId || !uid) return;
  const ck = sid + '/' + msg.id;
  try {
    if (!cfgCache.has(ck)) { const s = await getDoc(cfgRef(sid, msg.id)); cfgCache.set(ck, s.exists() ? s.data() : null); }
    const roleId = cfgCache.get(ck)?.map?.[key];
    if (!roleId) return;
    await updateDoc(doc(db, 'servers', sid, 'members', uid), { roleIds: added ? arrayUnion(roleId) : arrayRemove(roleId) });
    const r = getRoles().find((x) => x.id === roleId);
    toast(added ? `Você ganhou o cargo ${r?.name || ''}.` : `Cargo ${r?.name || ''} removido.`);
  } catch (e) { toast('Não consegui atualizar seu cargo: ' + (e.code || e.message), 'danger'); }
}

export function canConfigReactionRoles(serverId) { return isServerOwner(serverId); }

export async function openReactionRolesModal(msg, toggleReaction) {
  const sid = state.currentServerId;
  const roles = getRoles().filter((r) => !Object.values(r.permissions || {}).some(Boolean));
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Cargos por reação'));
  if (!roles.length) {
    modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Crie antes um cargo SEM permissões (só cosmético, como "Gamer" ou "Cor azul") em Configurações do servidor > Cargos. Por segurança, só esses podem ser dados por reação.'));
    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Fechar')]));
    overlay.classList.add('gk-open'); return;
  }
  modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Quem reagir a esta mensagem com o emoji ganha o cargo; ao tirar a reação, perde. Só cargos sem permissões aparecem.'));
  let current = {};
  try { const s = await getDoc(cfgRef(sid, msg.id)); current = s.exists() ? (s.data().map || {}) : {}; } catch { /* noop */ }
  const rows = []; const list = el('div', { class: 'gk-rr-list' });
  const labelOf = (k) => (k.startsWith('native:') ? k.slice(7) : ':' + k.replace(/^custom:/, '') + ':');
  const addRow = (key = '', roleId = '') => {
    const row = { key, sel: el('select', { class: 'gk-sv-select' }, roles.map((r) => el('option', { value: r.id }, r.name))) };
    if (roleId) row.sel.value = roleId;
    row.btn = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: (e) => openEmojiPickerForReaction(e.currentTarget, (k) => { row.key = k; row.btn.textContent = labelOf(k); }) }, key ? labelOf(key) : 'Escolher emoji');
    row.el = el('div', { class: 'gk-rr-row' }, [row.btn, row.sel, el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); } }, '✕')]);
    rows.push(row); list.appendChild(row.el);
  };
  Object.entries(current).forEach(([k, r]) => addRow(k, r)); if (!rows.length) addRow();
  modal.appendChild(list);
  modal.appendChild(el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => addRow() }, '+ Adicionar emoji'));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Cancelar'),
    el('button', { class: 'gk-btn gk-btn-primary', onclick: async () => {
      const map = {}; rows.forEach((r) => { if (r.key) map[r.key] = r.sel.value; });
      try {
        await setDoc(cfgRef(sid, msg.id), { channelId: state.currentChannelId, map, updatedAt: serverTimestamp() });
        const al = await getDoc(cfgRef(sid, '_allowed'));
        const ids = new Set([...(al.exists() ? al.data().roleIds || [] : []), ...Object.values(map)]);
        await setDoc(cfgRef(sid, '_allowed'), { roleIds: [...ids] });
        cfgCache.set(sid + '/' + msg.id, { map });
        // Deixa os emojis já aparecendo como reação clicável (a reação do dono também lhe dá o cargo)
        for (const k of Object.keys(map)) if (!(msg.reactions?.[k] || []).includes(auth.currentUser.uid)) await toggleReaction(msg, k);
        overlay.classList.remove('gk-open'); toast('Cargos por reação salvos.');
      } catch (e) { toast('Não foi possível salvar: ' + (e.code || e.message) + ' (publicou o firestore.rules novo?)', 'danger'); }
    } }, 'Salvar'),
  ]));
  overlay.classList.add('gk-open');
}

// ---------- Estatísticas ----------
export function openStatsModal(serverId) {
  if (serverId !== state.currentServerId) { toast('Abra o servidor primeiro e tente de novo.'); return; }
  if (!canManageServerInfo(serverId)) { toast('Só quem gerencia o servidor vê as estatísticas.'); return; }
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = ''; modal.classList.add('gk-stats-modal');
  modal.appendChild(el('h2', {}, 'Estatísticas do servidor'));
  const body = el('div', {}, [el('p', { class: 'gk-modal-sub' }, 'Calcula em cima das últimas 200 mensagens de cada canal de texto (até 15 canais). Isso lê bastante do Firestore, então só roda quando você pedir.')]);
  const go = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Calcular');
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Calculando…';
    try { body.replaceChildren(render(await collect(serverId))); } catch (e) { toast('Falhou: ' + (e.code || e.message), 'danger'); go.disabled = false; go.textContent = 'Calcular'; }
  });
  body.appendChild(go);
  modal.appendChild(body);
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Fechar')]));
  overlay.classList.add('gk-open');
}
async function collect(serverId) {
  const channels = getCategoriesAndChannels().channels || [];
  const text = channels.filter((c) => c.type === 'text' && !c.nsfw).slice(0, 15);
  const msgs = [];
  await Promise.all(text.map(async (c) => {
    try {
      const snap = await getDocs(query(collection(db, 'servers', serverId, 'channels', c.id, 'messages'), orderBy('createdAt', 'desc'), limit(200)));
      snap.forEach((d) => { const x = d.data(); msgs.push({ ch: c.name, a: x.authorName || '?', t: x.createdAt?.toMillis?.() || 0, bot: !!x.isBot }); });
    } catch { /* sem acesso a esse canal */ }
  }));
  return { msgs: msgs.filter((m) => m.t), channels: text.length };
}
export function summarize({ msgs }, now = Date.now()) {
  const days = Array(7).fill(0); const hours = Array(24).fill(0); const by = new Map(); const ch = new Map();
  for (const m of msgs) {
    const age = Math.floor((now - m.t) / 86400000); if (age >= 0 && age < 7) days[6 - age]++;
    hours[new Date(m.t).getHours()]++;
    by.set(m.a, (by.get(m.a) || 0) + 1); ch.set(m.ch, (ch.get(m.ch) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { total: msgs.length, days, hours, authors: top(by), channels: top(ch), peak: hours.indexOf(Math.max(...hours)) };
}
function render(data) {
  const s = summarize(data); const max = Math.max(1, ...s.days);
  const bars = el('div', { class: 'gk-stat-bars' }, s.days.map((n, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return el('div', { class: 'gk-stat-bar', title: `${n} mensagens` }, [el('i', { style: `height:${Math.round((n / max) * 100)}%` }), el('span', {}, ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()])]);
  }));
  const list = (arr) => el('ol', { class: 'gk-stat-list' }, arr.length ? arr.map(([n, v]) => el('li', {}, `${n} — ${v}`)) : [el('li', {}, '—')]);
  return el('div', {}, [
    el('p', { class: 'gk-modal-sub' }, `${s.total} mensagens analisadas em ${data.channels} canais. Horário de pico: ${s.total ? s.peak + 'h' : '—'}.`),
    el('div', { class: 'gk-stat-title' }, 'Mensagens nos últimos 7 dias'), bars,
    el('div', { class: 'gk-stat-cols' }, [el('div', {}, [el('div', { class: 'gk-stat-title' }, 'Quem mais fala'), list(s.authors)]), el('div', {}, [el('div', { class: 'gk-stat-title' }, 'Canais mais ativos'), list(s.channels)])]),
  ]);
}
