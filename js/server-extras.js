// ============================================================
// G.K.IO — Extras de servidor
//  · tópico do canal, canal de anúncios, reordenar canais e categorias
//  · tela de regras com aceite (quem não aceitou não envia mensagens)
//  · eventos agendados com "tenho interesse"
//  · emojis do servidor (usáveis por todos os membros)
// ============================================================
import {
  auth, db, collection, writeBatch, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, query, where, orderBy,
  serverTimestamp, arrayUnion, arrayRemove, channelDoc, categoriesCol, channelsCol, memberDoc, serverDoc,
  customEmojisCol, customEmojiDoc,
} from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { uploadToCloudinary } from './cloudinary.js';
import { renderRichText } from './markdown.js';
import { getCategoriesAndChannels, canManageServerInfo, leaveServer } from './servers.js';
import { confirmDangerAction } from './dialogs.js';

export const TOPIC_MAX = 120;
export const RULES_MAX = 2000;
export const EVENT_TITLE_MAX = 60;
export const EVENT_DESC_MAX = 300;

// ---------- Canal: tópico, anúncios, ordem ----------
export async function setChannelTopic(serverId, channelId, topic) {
  await updateDoc(channelDoc(serverId, channelId), { topic: String(topic || '').trim().slice(0, TOPIC_MAX) });
}
export async function setChannelAnnouncement(serverId, channelId, on) {
  await updateDoc(channelDoc(serverId, channelId), { announcement: !!on });
}
/** Nova ordem depois de mover o item `id` uma posição (dir = -1 sobe, +1 desce). null se não há para onde ir. */
export function reorderedIds(ids, id, dir) {
  const i = ids.indexOf(id); const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = ids.slice(); [next[i], next[j]] = [next[j], next[i]];
  return next;
}
const byPos = (a, b) => (a.position || 0) - (b.position || 0);
export async function moveChannel(serverId, channelId, dir) {
  const { channels } = getCategoriesAndChannels();
  const ch = channels.find((c) => c.id === channelId); if (!ch) return false;
  const siblings = channels.filter((c) => c.categoryId === ch.categoryId).sort(byPos);
  const next = reorderedIds(siblings.map((c) => c.id), channelId, dir); if (!next) return false;
  const batch = writeBatch(db);
  next.forEach((id, i) => batch.update(channelDoc(serverId, id), { position: i }));
  await batch.commit(); return true;
}
export async function moveCategory(serverId, categoryId, dir) {
  const { categories } = getCategoriesAndChannels();
  const sorted = categories.slice().sort(byPos);
  const next = reorderedIds(sorted.map((c) => c.id), categoryId, dir); if (!next) return false;
  const batch = writeBatch(db);
  next.forEach((id, i) => batch.update(doc(categoriesCol(serverId), id), { position: i }));
  await batch.commit(); return true;
}
/** Texto do subtítulo do canal: tópico (se tiver) ou o padrão. */
export function channelSubtitle(ch, fallback = 'Canal de texto') {
  const t = String(ch?.topic || '').trim();
  const base = ch?.announcement ? 'Canal de anúncios' : fallback;
  return t ? `${base} · ${t}` : base;
}

// ---------- Regras com aceite ----------
const accepted = new Map(); // serverId -> true/false (só bloqueia quando for false)
/** Motivo para não enviar mensagens agora por causa das regras do servidor aberto (ou null). */
export function rulesBlockReason() {
  const sid = state.currentServerId; if (!sid || !state.currentChannelId) return null;
  return accepted.get(sid) === false ? 'Aceite as regras do servidor para enviar mensagens.' : null;
}
export const rulesNeedAcceptance = (rules, member) =>
  !!(rules && rules.enabled && rules.text) && (Number(member?.rulesVersion) || 0) < (Number(rules.version) || 1);

export async function maybeShowRules(serverId) {
  const me = auth.currentUser?.uid; const srv = state.servers.get(serverId);
  if (!me || !srv?.rules?.enabled || !srv.rules.text || srv.ownerId === me) { accepted.set(serverId, true); return; }
  let member = null;
  try { const s = await getDoc(memberDoc(serverId, me)); member = s.exists() ? s.data() : null; } catch (e) { return; }
  if (!rulesNeedAcceptance(srv.rules, member)) { accepted.set(serverId, true); return; }
  accepted.set(serverId, false);
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
  const accept = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Li e aceito');
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      await updateDoc(memberDoc(serverId, me), { rulesAcceptedAt: serverTimestamp(), rulesVersion: Number(srv.rules.version) || 1 });
      accepted.set(serverId, true); overlay.classList.remove('gk-open'); toast('Bem-vindo(a)! Regras aceitas.');
    } catch (e) { accept.disabled = false; toast('Não foi possível registrar o aceite.', 'danger'); }
  });
  const leave = el('button', { class: 'gk-btn', type: 'button' }, 'Sair do servidor');
  leave.addEventListener('click', () => {
    overlay.classList.remove('gk-open');
    confirmDangerAction('Sair do servidor', `Sair de "${srv.name}"?`, async () => { await leaveServer(serverId); }, { confirmLabel: 'Sair' });
  });
  modal.appendChild(el('h2', {}, `Regras de ${srv.name || 'este servidor'}`));
  modal.appendChild(el('div', { class: 'gk-rules-text' }, renderRichText(srv.rules.text)));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [leave, accept]));
  overlay.classList.add('gk-open');
}

export async function saveRules(serverId, { enabled, text }) {
  const srv = state.servers.get(serverId) || {};
  const old = srv.rules || {};
  const clean = String(text || '').trim().slice(0, RULES_MAX);
  const changed = clean !== (old.text || '');
  await updateDoc(serverDoc(serverId), { rules: { enabled: !!enabled && !!clean, text: clean, version: (Number(old.version) || 1) + (changed ? 1 : 0) } });
}

export function renderRegrasSection(content, header) {
  const sid = state.currentServerId || [...state.servers.keys()][0];
  const rules = state.servers.get(sid)?.rules || {};
  content.appendChild(header('Regras do servidor', 'Quem entra precisa aceitar as regras antes de enviar mensagens.'));
  const enabled = el('input', { type: 'checkbox' }); enabled.checked = !!rules.enabled;
  const text = el('textarea', { class: 'gk-sv-input gk-sv-textarea', rows: '10', maxlength: String(RULES_MAX), placeholder: '1. Respeite todo mundo.\n2. Sem spam.\n3. …' });
  text.value = rules.text || '';
  const save = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Salvar');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await saveRules(sid, { enabled: enabled.checked, text: text.value }); toast('Regras salvas. Membros precisarão aceitar de novo se o texto mudou.'); }
    catch (e) { toast('Não foi possível salvar as regras.', 'danger'); }
    finally { save.disabled = false; }
  });
  content.appendChild(el('div', { class: 'gk-sv-card' }, [
    el('label', { class: 'gk-nsfw-option' }, [enabled, el('span', {}, [el('strong', {}, 'Exigir aceite das regras'), el('small', {}, 'Quem não aceitou fica sem poder enviar mensagens (o dono é isento).')])]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Texto das regras (aceita **negrito**, listas e links)'), text]),
    el('div', { class: 'gk-hint' }, `${RULES_MAX} caracteres no máximo.`),
    save,
  ]));
}

// ---------- Eventos agendados ----------
let eventsUnsub = null;
const eventsCol = (serverId) => collection(db, 'servers', serverId, 'events');
export const eventIsUpcoming = (ev, now = Date.now()) => {
  const t = ev?.startsAt?.toMillis ? ev.startsAt.toMillis() : (ev?.startsAt instanceof Date ? ev.startsAt.getTime() : 0);
  return t >= now - 2 * 3600 * 1000; // some 2 h depois do início
};
const fmtWhen = (ev) => {
  const d = ev.startsAt?.toDate ? ev.startsAt.toDate() : null;
  return d ? d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};
export function closeEvents() {
  if (eventsUnsub) { eventsUnsub(); eventsUnsub = null; }
  document.getElementById('gk-generic-modal-overlay')?.classList.remove('gk-open');
}
export function openEventsModal(serverId) {
  const me = auth.currentUser?.uid; const manage = canManageServerInfo(serverId);
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  if (eventsUnsub) { eventsUnsub(); eventsUnsub = null; }
  modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
  const list = el('div', { class: 'gk-events-list' });
  modal.appendChild(el('div', { class: 'gk-thread-head' }, [
    el('div', { class: 'gk-thread-title' }, [icon('clock', { size: 16 }), el('h2', {}, 'Eventos')]),
    el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Fechar', 'aria-label': 'Fechar eventos', onclick: closeEvents }, [icon('close', { size: 16 })]),
  ]));
  modal.appendChild(list);
  if (manage) modal.appendChild(eventForm(serverId));
  overlay.classList.add('gk-open');
  eventsUnsub = onSnapshot(query(eventsCol(serverId), orderBy('startsAt')), (snap) => {
    list.innerHTML = '';
    const evs = []; snap.forEach((d) => evs.push({ id: d.id, ...d.data() }));
    const up = evs.filter((e) => eventIsUpcoming(e));
    if (!up.length) { list.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Nenhum evento marcado.')); return; }
    const { channels } = getCategoriesAndChannels();
    for (const ev of up) {
      const interested = Array.isArray(ev.interestedUids) ? ev.interestedUids : [];
      const mine = interested.includes(me);
      const chName = channels.find((c) => c.id === ev.channelId)?.name;
      const btn = el('button', { class: 'gk-btn' + (mine ? ' gk-btn-primary' : ''), type: 'button', 'aria-pressed': String(mine) }, [icon('starOutline', { size: 13 }), mine ? ' Tenho interesse' : ' Tenho interesse?']);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await updateDoc(doc(eventsCol(serverId), ev.id), { interestedUids: mine ? arrayRemove(me) : arrayUnion(me) }); }
        catch (e) { toast('Não foi possível atualizar seu interesse.', 'danger'); } finally { btn.disabled = false; }
      });
      const card = el('div', { class: 'gk-event-card' }, [
        el('div', { class: 'gk-event-when' }, fmtWhen(ev)),
        el('b', {}, ev.title || 'Evento'),
        ev.description ? el('div', { class: 'gk-event-desc' }, renderRichText(ev.description)) : null,
        el('div', { class: 'gk-event-meta' }, [chName ? `# ${chName} · ` : '', `${interested.length} ${interested.length === 1 ? 'interessado' : 'interessados'}`]),
        el('div', { class: 'gk-extras-row' }, [btn,
          (manage || ev.createdBy === me) ? el('button', { class: 'gk-btn', type: 'button', onclick: async () => { try { await deleteDoc(doc(eventsCol(serverId), ev.id)); } catch (e) { toast('Não foi possível apagar o evento.', 'danger'); } } }, [icon('trash', { size: 13 }), ' Apagar']) : null]),
      ]);
      list.appendChild(card);
    }
  }, () => { list.innerHTML = ''; list.appendChild(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Não foi possível carregar os eventos.')); });
}

function eventForm(serverId) {
  const title = el('input', { type: 'text', class: 'gk-sv-input', maxlength: String(EVENT_TITLE_MAX), placeholder: 'Nome do evento', 'aria-label': 'Nome do evento' });
  const when = el('input', { type: 'datetime-local', class: 'gk-sv-input', 'aria-label': 'Data e hora' });
  const { channels } = getCategoriesAndChannels();
  const chan = el('select', { class: 'gk-sv-select', 'aria-label': 'Canal do evento' }, [el('option', { value: '' }, 'Sem canal'), ...channels.map((c) => el('option', { value: c.id }, `${c.type === 'voice' ? '🔊' : '#'} ${c.name}`))]);
  const desc = el('textarea', { class: 'gk-sv-input gk-sv-textarea', rows: '2', maxlength: String(EVENT_DESC_MAX), placeholder: 'Descrição (opcional)', 'aria-label': 'Descrição' });
  const add = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, [icon('plus', { size: 13 }), ' Criar evento']);
  add.addEventListener('click', async () => {
    const t = title.value.trim(); const ms = when.value ? new Date(when.value).getTime() : NaN;
    if (!t) return toast('Dê um nome ao evento.', 'danger');
    if (!Number.isFinite(ms) || ms < Date.now() - 60000) return toast('Escolha uma data e hora no futuro.', 'danger');
    add.disabled = true;
    try {
      await addDoc(eventsCol(serverId), {
        title: t, description: desc.value.trim().slice(0, EVENT_DESC_MAX), startsAt: new Date(ms),
        channelId: chan.value || null, createdBy: auth.currentUser.uid, createdAt: serverTimestamp(), interestedUids: [],
      });
      title.value = ''; desc.value = ''; when.value = ''; toast('Evento criado!');
    } catch (e) { toast('Não foi possível criar o evento.', 'danger'); } finally { add.disabled = false; }
  });
  return el('div', { class: 'gk-event-form' }, [el('b', {}, 'Novo evento'), title, when, chan, desc, add]);
}

// ---------- Emojis do servidor ----------
const EMOJI_MAX_BYTES = 256 * 1024;
export const isServerEmoji = (e) => !!(e && e.serverId);
export const canUseServerEmoji = (e) => isServerEmoji(e) && state.servers.has(e.serverId);

let emojiUnsub = null;
export function renderEmojisSection(content, header) {
  const sid = state.currentServerId;
  content.appendChild(header('Emojis do servidor', 'Todos os membros podem usar esses emojis em qualquer conversa.'));
  const list = el('div', { class: 'gk-sv-card gk-server-emoji-list' }, [el('div', { class: 'gk-sv-empty' }, 'Carregando…')]);
  const nameIn = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '32', placeholder: 'nome_do_emoji', 'aria-label': 'Nome do emoji' });
  nameIn.addEventListener('input', () => { nameIn.value = nameIn.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'); });
  const file = el('input', { type: 'file', accept: 'image/png,image/gif,image/webp,image/jpeg', style: 'display:none' });
  const add = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, [icon('plus', { size: 13 }), ' Enviar emoji']);
  add.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = ''; if (!f) return;
    const name = nameIn.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    if (name.length < 2) return toast('Dê um nome de 2 a 32 letras/números ao emoji.', 'danger');
    if (f.size > EMOJI_MAX_BYTES) return toast('A imagem deve ter no máximo 256 KB.', 'danger');
    add.disabled = true;
    try {
      const up = await uploadToCloudinary(f, 'server-emojis');
      await addDoc(customEmojisCol(), { name, url: up.url, uploaderId: auth.currentUser.uid, allowedUserIds: [], serverId: sid, createdAt: serverTimestamp() });
      nameIn.value = ''; toast(`Emoji :${name}: adicionado.`);
    } catch (e) { toast('Não foi possível enviar o emoji.', 'danger'); } finally { add.disabled = false; }
  });
  content.appendChild(el('div', { class: 'gk-sv-card' }, [el('div', { class: 'gk-extras-row' }, [nameIn, add, file]), el('div', { class: 'gk-hint' }, 'Até 256 KB. PNG, GIF, WebP ou JPG.')]));
  content.appendChild(list);
  if (!sid) return;
  if (emojiUnsub) { emojiUnsub(); emojiUnsub = null; }
  emojiUnsub = onSnapshot(query(customEmojisCol(), where('serverId', '==', sid)), (snap) => {
    list.innerHTML = '';
    if (snap.empty) { list.appendChild(el('div', { class: 'gk-sv-empty' }, 'Nenhum emoji do servidor ainda.')); return; }
    snap.forEach((d) => {
      const e = { id: d.id, ...d.data() };
      list.appendChild(el('div', { class: 'gk-sv-row' }, [
        el('img', { src: e.url, alt: '', width: 28, height: 28 }), el('span', {}, `:${e.name}:`),
        el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Excluir emoji', 'aria-label': `Excluir ${e.name}`, onclick: () => deleteDoc(customEmojiDoc(e.id)).catch(() => toast('Não foi possível excluir.', 'danger')) }, [icon('trash', { size: 14 })]),
      ]));
    });
  });
}
