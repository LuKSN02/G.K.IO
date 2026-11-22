// Moderação automática (filtro de palavras, anti-link, anti-spam, excesso de menções).
// Config em servers/{id}.automod. A checagem roda no app de quem envia: protege contra o uso normal,
// mas um cliente adulterado poderia contorná-la (o Firestore não tem como checar lista de palavras).
import { auth, db, doc, updateDoc } from './db.js';
import { state, el, toast } from './state.js';
import { canManageMessages, canManageServerInfo, isServerOwner } from './servers.js';

export const DEFAULTS = { enabled: false, words: [], blockLinks: false, spamMax: 0, spamSeconds: 10, maxMentions: 0 };

export const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Função pura: devolve o motivo do bloqueio ou null. `recent` = instantes (ms) das minhas últimas mensagens. */
export function checkText(text, cfg, recent = [], now = Date.now()) {
  if (!cfg?.enabled || !text) return null;
  const t = fold(text);
  for (const w of cfg.words || []) {
    const word = fold(w).trim(); if (!word) continue;
    if (new RegExp(`(?<![a-z0-9])${escapeRe(word)}(?![a-z0-9])`).test(t)) return 'Sua mensagem tem uma palavra bloqueada neste servidor.';
  }
  if (cfg.blockLinks && /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|gg|io|me|br|xyz|app)\b)/i.test(text)) return 'Links não são permitidos neste servidor.';
  if (cfg.maxMentions > 0 && (text.match(/@[a-zA-Z0-9_-]{2,32}/g) || []).length > cfg.maxMentions) return `Muitas menções numa mensagem (máximo ${cfg.maxMentions}).`;
  if (cfg.spamMax > 0) {
    const inWindow = recent.filter((x) => now - x < (cfg.spamSeconds || 10) * 1000).length;
    if (inWindow >= cfg.spamMax) return 'Devagar! Você está mandando mensagens rápido demais.';
  }
  return null;
}

const history = new Map(); // serverId -> [ms]
/** Chamado antes de enviar. Quem gerencia mensagens/servidor é isento. */
export function automodBlockReason(text) {
  const sid = state.currentServerId; if (!sid || !state.currentChannelId) return null;
  const cfg = state.servers.get(sid)?.automod; if (!cfg?.enabled) return null;
  if (isServerOwner(sid) || canManageMessages(sid) || canManageServerInfo(sid)) return null;
  const now = Date.now(); const h = (history.get(sid) || []).filter((x) => now - x < 120000);
  const why = checkText(text, cfg, h, now);
  if (!why) { h.push(now); history.set(sid, h); }
  return why;
}

export function buildAutomodCard(serverId) {
  const cfg = { ...DEFAULTS, ...(state.servers.get(serverId)?.automod || {}) };
  const cb = (label, checked) => { const i = el('input', { type: 'checkbox' }); i.checked = !!checked; return [i, el('label', { class: 'gk-nsfw-option' }, [i, el('span', {}, label)])]; };
  const [enI, enL] = cb('Ativar moderação automática', cfg.enabled);
  const [lkI, lkL] = cb('Bloquear links', cfg.blockLinks);
  const words = el('textarea', { class: 'gk-sv-input gk-sv-textarea', rows: '3', placeholder: 'palavra1, palavra2, outra palavra' }); words.value = (cfg.words || []).join(', ');
  const num = (v, min, max) => { const i = el('input', { type: 'number', class: 'gk-sv-input', min: String(min), max: String(max), style: 'width:90px' }); i.value = v; return i; };
  const spam = num(cfg.spamMax, 0, 30); const secs = num(cfg.spamSeconds, 3, 60); const men = num(cfg.maxMentions, 0, 30);
  const save = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
    const clamp = (i, a, b) => Math.min(b, Math.max(a, parseInt(i.value, 10) || 0));
    const automod = {
      enabled: enI.checked, blockLinks: lkI.checked,
      words: words.value.split(',').map((w) => w.trim()).filter(Boolean).slice(0, 100).map((w) => w.slice(0, 40)),
      spamMax: clamp(spam, 0, 30), spamSeconds: clamp(secs, 3, 60), maxMentions: clamp(men, 0, 30),
    };
    try { await updateDoc(doc(db, 'servers', serverId), { automod }); const s = state.servers.get(serverId); if (s) s.automod = automod; toast('Moderação automática salva.'); }
    catch (e) { toast('Não foi possível salvar: ' + (e.code || e.message) + ' (publicou o firestore.rules novo?)', 'danger'); }
  } }, 'Salvar');
  return el('div', { class: 'gk-sv-card', id: 'gk-automod-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, 'Moderação automática')]),
    enL, lkL,
    el('div', { class: 'gk-field' }, [el('label', {}, 'Palavras bloqueadas (separadas por vírgula)'), words]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Anti-spam: máx. de mensagens (0 = desligado) em X segundos'), el('div', { style: 'display:flex;gap:8px' }, [spam, secs])]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Máximo de @menções por mensagem (0 = sem limite)'), men]),
    el('div', { class: 'gk-hint' }, 'Quem gerencia mensagens ou o servidor não é afetado. A checagem acontece no app de quem envia.'),
    save,
  ]);
}
