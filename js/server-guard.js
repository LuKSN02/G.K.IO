// ============================================================
// G.K.IO — Proteção do servidor: anti-raid e verificação ao entrar
//
// ANTI-RAID  (servers/{id}.antiRaid = { enabled, joins, minutes, lockMinutes } · .joinLockUntil = ms)
//   Aparelhos de quem gerencia o servidor (e estão com o app aberto) contam as entradas novas. Se
//   passarem do limite na janela, gravam joinLockUntil; as REGRAS do Firestore recusam novas
//   entradas até lá (vale também para convite). Limite honesto: só detecta enquanto algum
//   gerente estiver online — não há servidor vigiando 24 h (o projeto evita o plano Blaze).
//
// VERIFICAÇÃO  (servers/{id}.verification = { enabled, question, hash, version })
//   Quem entra responde uma pergunta antes de enviar mensagens. A resposta é comparada pelo
//   hash (SHA-256 do texto sem acento/maiúsculas). É uma barreira de cliente, como o aceite
//   das regras: segura contra bots e curiosos, não contra alguém que adultere o app.
// ============================================================
import { auth, db, doc, updateDoc, getDoc, serverTimestamp } from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { canManageServerInfo, isServerOwner, leaveServer } from './servers.js';
import { memberDoc } from './db.js';
import { logAudit } from './audit.js';
import { rulesBlockReason } from './server-extras.js';
import { fold } from './automod.js';

export const RAID_DEFAULTS = { enabled: false, joins: 8, minutes: 2, lockMinutes: 15 };

// ---------------- anti-raid ----------------
const seen = new Map(); // serverId -> { ids:Set, joins:number[] }
export function countRecent(joins, windowMs, now = Date.now()) { return joins.filter((t) => now - t <= windowMs).length; }

async function lockJoins(serverId, minutes, auto) {
  const until = Date.now() + minutes * 60_000;
  await updateDoc(doc(db, 'servers', serverId), { joinLockUntil: until });
  const s = state.servers.get(serverId); if (s) s.joinLockUntil = until;
  logAudit(serverId, 'server.antiraid', { details: { minutes, auto: !!auto } });
}
export async function unlockJoins(serverId) {
  await updateDoc(doc(db, 'servers', serverId), { joinLockUntil: 0 });
  const s = state.servers.get(serverId); if (s) s.joinLockUntil = 0;
  logAudit(serverId, 'server.antiraid', { details: { minutes: 0 } });
}
export { lockJoins };

function tickRaid() {
  const now = Date.now();
  for (const [id, s] of state.servers) {
    const cfg = { ...RAID_DEFAULTS, ...(s.antiRaid || {}) };
    const ids = new Set(Array.isArray(s.memberIds) ? s.memberIds : []);
    let rec = seen.get(id);
    if (!rec) { seen.set(id, { ids, joins: [] }); continue; } // primeira leitura: só memoriza
    for (const u of ids) if (!rec.ids.has(u)) rec.joins.push(now);
    rec.ids = ids; rec.joins = rec.joins.filter((t) => now - t <= 30 * 60_000);
    if (!cfg.enabled || !canManageServerInfo(id) || (s.joinLockUntil || 0) > now) continue;
    if (countRecent(rec.joins, cfg.minutes * 60_000, now) >= cfg.joins) {
      lockJoins(id, cfg.lockMinutes, true).then(() => toast(`🛡️ Anti-raid: entradas em "${s.name}" trancadas por ${cfg.lockMinutes} min (muitas entradas seguidas).`, 'danger')).catch(() => {});
    }
  }
}
export function initServerGuard() { setInterval(tickRaid, 5000); }

// ---------------- verificação ao entrar ----------------
export async function hashAnswer(answer) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fold(answer).replace(/\s+/g, ' ').trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const verified = new Map(); // serverId -> false enquanto precisa responder
export function verifyBlockReason() {
  const sid = state.currentServerId; if (!sid || !state.currentChannelId) return null;
  return verified.get(sid) === false ? 'Responda à pergunta de verificação do servidor para enviar mensagens.' : null;
}

export async function maybeShowVerify(serverId) {
  const me = auth.currentUser?.uid; const srv = state.servers.get(serverId); const v = srv?.verification;
  if (!me || !v?.enabled || !v.hash || srv.ownerId === me || canManageServerInfo(serverId)) { verified.set(serverId, true); return; }
  let member = null;
  try { const s = await getDoc(memberDoc(serverId, me)); member = s.exists() ? s.data() : null; } catch (e) { return; }
  if (!member || (Number(member.verifiedVersion) || 0) >= (Number(v.version) || 1)) { verified.set(serverId, true); return; }
  verified.set(serverId, false);
  for (let i = 0; i < 600 && rulesBlockReason(); i++) await new Promise((r) => setTimeout(r, 1000)); // espera as regras serem aceitas
  if (state.currentServerId !== serverId) return;
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
  const input = el('input', { type: 'text', class: 'gk-sv-input', placeholder: 'Sua resposta', autocomplete: 'off', 'aria-label': 'Resposta' });
  const msg = el('div', { class: 'gk-hint' }, '');
  const ok = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Verificar');
  const submit = async () => {
    ok.disabled = true;
    if (await hashAnswer(input.value) !== v.hash) { msg.textContent = 'Resposta incorreta. Tente de novo.'; ok.disabled = false; return; }
    try {
      await updateDoc(memberDoc(serverId, me), { verifiedAt: serverTimestamp(), verifiedVersion: Number(v.version) || 1 });
      verified.set(serverId, true); overlay.classList.remove('gk-open'); toast('Verificado! Bem-vindo(a).');
    } catch (e) { ok.disabled = false; toast('Não foi possível registrar a verificação.', 'danger'); }
  };
  ok.addEventListener('click', submit); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const leave = el('button', { class: 'gk-btn', type: 'button', onclick: async () => { overlay.classList.remove('gk-open'); try { await leaveServer(serverId); } catch (e) { /* noop */ } } }, 'Sair do servidor');
  modal.append(el('h2', {}, `Verificação — ${srv.name || 'servidor'}`), el('p', { class: 'gk-modal-sub' }, v.question || 'Responda para continuar.'), input, msg, el('div', { class: 'gk-modal-actions' }, [leave, ok]));
  overlay.classList.add('gk-open'); input.focus();
}

// ---------------- cartões de configuração ----------------
const cbox = (label, checked) => { const i = el('input', { type: 'checkbox' }); i.checked = !!checked; return [i, el('label', { class: 'gk-nsfw-option' }, [i, el('span', {}, label)])]; };
const numIn = (v, min, max) => { const i = el('input', { type: 'number', class: 'gk-sv-input', min: String(min), max: String(max), style: 'width:90px' }); i.value = v; return i; };
const clamp = (i, a, b) => Math.min(b, Math.max(a, parseInt(i.value, 10) || a));
const saveErr = (e) => toast('Não foi possível salvar: ' + (e.code || e.message) + ' (publicou o firestore.rules novo?)', 'danger');

export function buildAntiRaidCard(serverId) {
  const s = state.servers.get(serverId) || {};
  const cfg = { ...RAID_DEFAULTS, ...(s.antiRaid || {}) };
  const [enI, enL] = cbox('Ativar proteção anti-raid', cfg.enabled);
  const joins = numIn(cfg.joins, 3, 100), mins = numIn(cfg.minutes, 1, 30), lock = numIn(cfg.lockMinutes, 1, 1440);
  const status = el('div', { class: 'gk-hint' });
  const paint = () => { const u = state.servers.get(serverId)?.joinLockUntil || 0; status.textContent = u > Date.now() ? `🔒 Entradas trancadas até ${new Date(u).toLocaleTimeString('pt-BR')}.` : 'Entradas liberadas.'; };
  paint();
  const save = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
    const antiRaid = { enabled: enI.checked, joins: clamp(joins, 3, 100), minutes: clamp(mins, 1, 30), lockMinutes: clamp(lock, 1, 1440) };
    try { await updateDoc(doc(db, 'servers', serverId), { antiRaid }); const sv = state.servers.get(serverId); if (sv) sv.antiRaid = antiRaid; toast('Anti-raid salvo.'); } catch (e) { saveErr(e); }
  } }, 'Salvar');
  const lockNow = el('button', { class: 'gk-btn', type: 'button', onclick: async () => { try { await lockJoins(serverId, clamp(lock, 1, 1440), false); paint(); toast('Entradas trancadas.'); } catch (e) { saveErr(e); } } }, 'Trancar agora');
  const unlock = el('button', { class: 'gk-btn', type: 'button', onclick: async () => { try { await unlockJoins(serverId); paint(); toast('Entradas liberadas.'); } catch (e) { saveErr(e); } } }, 'Destrancar');
  return el('div', { class: 'gk-sv-card', id: 'gk-antiraid-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, [icon('shield', { size: 14 }), ' Anti-raid'])]),
    enL,
    el('div', { class: 'gk-field' }, [el('label', {}, 'Trancar se entrarem X pessoas em Y minutos'), el('div', { style: 'display:flex;gap:8px;align-items:center' }, [joins, el('span', {}, 'pessoas em'), mins, el('span', {}, 'min')])]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Tempo de tranca (minutos)'), lock]),
    status,
    el('div', { class: 'gk-hint' }, 'Só detecta enquanto alguém que gerencia o servidor estiver com o app aberto.'),
    el('div', { class: 'gk-modal-actions' }, [lockNow, unlock, save]),
  ]);
}

export function buildVerificationCard(serverId) {
  const s = state.servers.get(serverId) || {}; const v = s.verification || {};
  const [enI, enL] = cbox('Exigir pergunta de verificação ao entrar', v.enabled);
  const q = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '120', placeholder: 'Ex.: Qual a cor do cavalo branco de Napoleão?' }); q.value = v.question || '';
  const a = el('input', { type: 'text', class: 'gk-sv-input', maxlength: '60', placeholder: v.hash ? '(resposta já definida — preencha só para trocar)' : 'Resposta correta' });
  const save = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
    const question = q.value.trim(); const answer = a.value.trim();
    if (enI.checked && (!question || (!answer && !v.hash))) return toast('Escreva a pergunta e a resposta.', 'danger');
    const hash = answer ? await hashAnswer(answer) : (v.hash || '');
    const changed = hash !== (v.hash || '') || question !== (v.question || '');
    const verification = { enabled: enI.checked, question, hash, version: (Number(v.version) || 1) + (changed ? 1 : 0) };
    try { await updateDoc(doc(db, 'servers', serverId), { verification }); const sv = state.servers.get(serverId); if (sv) sv.verification = verification; a.value = ''; logAudit(serverId, 'server.verification', { details: { enabled: verification.enabled } }); toast('Verificação salva.'); } catch (e) { saveErr(e); }
  } }, 'Salvar');
  return el('div', { class: 'gk-sv-card', id: 'gk-verify-card' }, [
    el('div', { class: 'gk-sv-card-head' }, [el('span', { class: 'gk-mod-section-title' }, [icon('lock', { size: 14 }), ' Verificação ao entrar'])]),
    enL, el('div', { class: 'gk-field' }, [el('label', {}, 'Pergunta'), q]), el('div', { class: 'gk-field' }, [el('label', {}, 'Resposta (sem diferenciar maiúsculas/acentos)'), a]),
    el('div', { class: 'gk-hint' }, 'Quem já entrou precisa responder de novo se você trocar a pergunta ou a resposta. Donos e gerentes não precisam responder.'),
    el('div', { class: 'gk-modal-actions' }, [save]),
  ]);
}
export { isServerOwner };
