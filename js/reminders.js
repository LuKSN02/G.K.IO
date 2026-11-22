// Lembretes de mensagem e mensagens agendadas (guardados neste aparelho; só disparam com o G.K.IO aberto).
import { state, el, toast } from './state.js';
import { sendTextTo } from './chat.js';

const KEY = 'gkio-timers';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const store = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* noop */ } };
const uidOf = () => state.user?.uid || '';
const convNow = () => state.currentChannelId && state.currentServerId
  ? { kind: 'ch', serverId: state.currentServerId, channelId: state.currentChannelId }
  : state.currentDmId ? { kind: 'dm', dmId: state.currentDmId } : null;

export function addReminder(msg, ms) {
  const conv = convNow(); if (!conv) return;
  const a = load();
  a.push({ id: Date.now() + '' + Math.random().toString(36).slice(2, 6), type: 'remind', at: Date.now() + ms, uid: uidOf(), conv, text: String(msg.content || '(anexo)').slice(0, 140), author: msg.authorName || '' });
  store(a); toast('Lembrete criado. ⏰');
}

/** "15m", "2h", "1d" ou "18:30" (hoje, ou amanhã se já passou). */
export function parseWhen(s) {
  const m = /^(\d+)\s*(m|min|h|d)$/i.exec(s);
  if (m) return Date.now() + Number(m[1]) * ({ m: 60e3, min: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()]);
  const t = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (t && +t[1] < 24 && +t[2] < 60) { const d = new Date(); d.setHours(+t[1], +t[2], 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
  return null;
}
const fmt = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function openTimersList() {
  const mine = load().filter((x) => x.uid === uidOf()).sort((a, b) => a.at - b.at);
  const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.appendChild(el('h2', {}, 'Lembretes e mensagens agendadas'));
  if (!mine.length) modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Nada agendado. Use /agendar 30m texto, /agendar 18:30 texto, ou "Lembrar-me" no menu de uma mensagem.'));
  mine.forEach((x) => modal.appendChild(el('div', { class: 'gk-timer-row' }, [
    el('span', {}, `${x.type === 'send' ? '✉ Enviar' : '⏰ Lembrar'} · ${fmt(x.at)} — ${x.text}`),
    el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => { store(load().filter((y) => y.id !== x.id)); openTimersList(); } }, 'Cancelar'),
  ])));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', onclick: () => overlay.classList.remove('gk-open') }, 'Fechar')]));
  overlay.classList.add('gk-open');
}

async function tick() {
  if (!uidOf()) return;
  const all = load(); const now = Date.now();
  const due = all.filter((x) => x.uid === uidOf() && x.at <= now);
  if (!due.length) return;
  store(all.filter((x) => !due.includes(x)));
  for (const x of due) {
    if (x.type === 'remind') {
      toast(`⏰ Lembrete: "${x.text}"${x.author ? ' — ' + x.author : ''}`);
      try { if (Notification?.permission === 'granted') new Notification('Lembrete — G.K.IO', { body: x.text }); } catch { /* noop */ }
    } else {
      const ok = await sendTextTo(x.conv, x.text).catch(() => false);
      toast(ok ? '✉ Mensagem agendada enviada.' : 'Não consegui enviar uma mensagem agendada.', ok ? undefined : 'danger');
    }
  }
}
setInterval(tick, 15000);

// "/agendar 15m texto" e "/agendadas" no campo de mensagem
document.addEventListener('keydown', (e) => {
  const ta = e.target;
  if (ta?.id !== 'gk-composer-input' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const v = ta.value.trim();
  if (/^\/agendadas\s*$/i.test(v)) { e.preventDefault(); e.stopImmediatePropagation(); ta.value = ''; openTimersList(); return; }
  const m = /^\/agendar\s+(\S+)\s+([\s\S]+)$/i.exec(v);
  if (!m && /^\/agendar(\s|$)/i.test(v)) { e.preventDefault(); e.stopImmediatePropagation(); toast('Use: /agendar 30m texto  (ou 2h, 1d, 18:30)'); return; }
  if (!m) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const at = parseWhen(m[1]); const conv = convNow();
  if (!at || !conv) { toast('Horário inválido. Exemplos: 30m, 2h, 1d, 18:30', 'danger'); return; }
  const a = load(); a.push({ id: Date.now() + '', type: 'send', at, uid: uidOf(), conv, text: m[2].slice(0, 2000) });
  store(a); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
  toast(`Mensagem agendada para ${fmt(at)}. Mantenha o G.K.IO aberto até lá.`);
}, true);
