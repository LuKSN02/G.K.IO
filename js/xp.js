// ============================================================
// G.K.IO — Atividade e níveis por servidor (ranking)
// Cada mensagem enviada num canal dá 15–25 XP (no máx. 1 vez por minuto por servidor),
// guardado em servers/{id}/xp/{uid}. Nível = floor(sqrt(xp / 60)). É cosmético: as regras só
// limitam quanto dá para subir de uma vez, não impedem um cliente adulterado de farmar.
// ============================================================
import { auth, db, doc, collection, setDoc, getDocs, query, orderBy, limit, increment, serverTimestamp } from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';

export const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 60));
const xpForLevel = (l) => l * l * 60;
const COOLDOWN = 60_000;
const last = new Map();

export function awardXp(serverId) {
  const me = auth.currentUser?.uid; if (!me || !serverId) return;
  const now = Date.now();
  if (now - (last.get(serverId) || 0) < COOLDOWN) return;
  last.set(serverId, now);
  const gain = 15 + Math.floor(Math.random() * 11);
  setDoc(doc(db, 'servers', serverId, 'xp', me), {
    xp: increment(gain),
    name: String(state.user?.displayName || state.user?.username || '').slice(0, 60),
    avatar: String(state.user?.avatarUrl || '').slice(0, 400),
    updatedAt: serverTimestamp(),
  }, { merge: true }).catch(() => {});
}

export async function openLeaderboard(serverId) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal(); modal.innerHTML = '';
  const close = () => overlay.classList.remove('gk-open');
  const list = el('div', { class: 'gk-xp-list' }, el('div', { class: 'gk-hint' }, 'Carregando…'));
  modal.append(
    el('div', { class: 'gk-modal-icon-header' }, [el('div', { class: 'gk-modal-icon' }, [icon('sparkles', { size: 22 })]),
      el('div', {}, [el('h2', {}, 'Ranking de atividade'), el('p', { class: 'gk-modal-sub' }, state.servers.get(serverId)?.name || 'Servidor')])]),
    list,
    el('div', { class: 'gk-poll-footer-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar')]),
  );
  overlay.classList.add('gk-open');
  let docs = [];
  try { docs = (await getDocs(query(collection(db, 'servers', serverId, 'xp'), orderBy('xp', 'desc'), limit(20)))).docs; }
  catch (e) { list.replaceChildren(el('div', { class: 'gk-hint' }, 'Não foi possível carregar o ranking.')); return; }
  if (!docs.length) { list.replaceChildren(el('div', { class: 'gk-empty-state gk-empty-state-sm' }, 'Ninguém pontuou ainda. Converse nos canais para subir de nível!')); return; }
  list.replaceChildren(...docs.map((d, i) => {
    const x = d.data(); const xp = x.xp || 0; const lv = levelOf(xp);
    const pct = Math.min(100, Math.round(((xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv))) * 100));
    return el('div', { class: 'gk-xp-row' + (d.id === auth.currentUser?.uid ? ' gk-me' : '') }, [
      el('span', { class: 'gk-xp-pos' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
      el('img', { class: 'gk-xp-av', src: x.avatar || fallbackAvatar(x.name || 'GK'), alt: '' }),
      el('div', { class: 'gk-xp-main' }, [
        el('div', {}, [el('b', {}, x.name || 'Membro'), el('span', { class: 'gk-xp-lv' }, ` Nível ${lv}`)]),
        el('div', { class: 'gk-xp-bar' }, el('span', { style: `width:${pct}%` })),
      ]),
      el('span', { class: 'gk-xp-num' }, `${xp} XP`),
    ]);
  }));
}
