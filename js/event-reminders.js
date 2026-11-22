// ============================================================
// G.K.IO — Lembretes de eventos de servidor
// Avisa 15 min antes (e na hora) dos eventos em que você marcou "Tenho interesse".
// Sem servidor de agendamento (o projeto evita o Blaze), a checagem roda no próprio app a cada
// minuto — então o lembrete chega com o app/aba aberto ou o desktop na bandeja. Com tudo
// fechado, só o push de uma mensagem nova chega (ver js/web-push.js).
// Custo: 1 leitura por servidor a cada 10 min (eventos futuros), nada além disso.
// ============================================================
import { auth, db, collection, query, where, orderBy, getDocs } from './db.js';
import { state, toast } from './state.js';
import { playNotifSound, showDesktopNotification } from './prefs.js';

const LEAD_MS = 15 * 60_000;
const REFRESH_MS = 10 * 60_000;
let cache = []; // { key, serverId, id, title, at, mine }
let started = false;

const doneKey = (key, stage) => `gkio-ev-${key}-${stage}`;
const wasDone = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const markDone = (k) => { try { localStorage.setItem(k, '1'); } catch (e) { /* noop */ } };

async function refresh() {
  const me = auth.currentUser?.uid; if (!me) return;
  const out = [];
  await Promise.all([...state.servers.keys()].map(async (serverId) => {
    try {
      const snap = await getDocs(query(collection(db, 'servers', serverId, 'events'), where('startsAt', '>=', new Date(Date.now() - 5 * 60_000)), orderBy('startsAt')));
      snap.forEach((d) => {
        const ev = d.data();
        const at = ev.startsAt?.toMillis?.() || 0;
        if (at && Array.isArray(ev.interestedUids) && ev.interestedUids.includes(me)) out.push({ key: `${serverId}-${d.id}`, serverId, title: ev.title || 'Evento', at });
      });
    } catch (e) { /* sem permissão/offline: tenta de novo depois */ }
  }));
  cache = out;
}

function tick() {
  const now = Date.now();
  for (const ev of cache) {
    const left = ev.at - now;
    const stage = left <= 0 ? 'now' : left <= LEAD_MS ? 'soon' : null;
    if (!stage || left < -5 * 60_000) continue;
    const k = doneKey(ev.key, stage);
    if (wasDone(k)) continue;
    markDone(k);
    const body = stage === 'now' ? 'Está começando agora!' : `Começa em ${Math.max(1, Math.round(left / 60_000))} min.`;
    toast(`🗓️ ${ev.title} — ${body}`);
    playNotifSound();
    showDesktopNotification(ev.title, body, 'img/favicon-180.png');
  }
}

export function initEventReminders() {
  if (started) return; started = true;
  setTimeout(refresh, 8000); // dá tempo de state.servers carregar
  setInterval(refresh, REFRESH_MS);
  setInterval(tick, 30_000);
}
