// ============================================================
// G.K.IO — Preferências de notificação (silenciar / só menções)
// Guardadas no próprio doc do usuário (campo `notifPrefs`):
//   { servers: { [serverId]: 'mentions'|'none' },
//     channels: { [channelId]: 'all'|'mentions'|'none' },   // sem entrada = usa o do servidor
//     dms: { [dmId]: 'none' } }
// Níveis: 'all' (tudo) | 'mentions' (só quando citam/respondem você) | 'none'.
// ============================================================
import { auth, userDoc, updateDoc } from './db.js';
import { state, el, toast } from './state.js';
import { icon, iconHtml } from './icons.js';

const listeners = new Set();
export function onNotifPrefsChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { listeners.forEach((cb) => { try { cb(); } catch (e) { /* noop */ } }); }

const prefsOf = () => (state.user && state.user.notifPrefs) || {};

// Vale para qualquer objeto de prefs (o meu, ou o de outra pessoa na hora do push).
// ctx = { serverId, channelId } ou { dmId }
export function levelFromPrefs(prefs, ctx) {
  const p = prefs || {};
  if (ctx.dmId) return p.dms?.[ctx.dmId] === 'none' ? 'none' : 'all';
  const ch = p.channels?.[ctx.channelId];
  if (ch && ch !== 'default') return ch;
  return p.servers?.[ctx.serverId] || 'all';
}
export const effectiveLevel = (ctx) => levelFromPrefs(prefsOf(), ctx);

// Deve avisar (som / notificação / push)? `mentioned` = a mensagem cita ou responde a pessoa.
export function shouldAlert(level, mentioned) {
  return level === 'all' || (level === 'mentions' && !!mentioned);
}

// Mostra o ponto de "não lida" na sidebar?
export function showUnreadDot(ctx, mentionedUids) {
  const level = effectiveLevel(ctx);
  if (level === 'none') return false;
  if (level === 'mentions') return Array.isArray(mentionedUids) && mentionedUids.includes(auth.currentUser?.uid);
  return true;
}
export const isMuted = (ctx) => effectiveLevel(ctx) === 'none';

export async function setLevel(kind, id, level) {
  const uid = auth.currentUser?.uid;
  if (!uid || !state.user) return;
  const next = JSON.parse(JSON.stringify(prefsOf()));
  next[kind] = next[kind] || {};
  const isDefault = (kind === 'channels' && level === 'default') || (kind !== 'channels' && level === 'all');
  if (isDefault) delete next[kind][id]; else next[kind][id] = level;
  const prev = state.user.notifPrefs;
  state.user.notifPrefs = next;
  emit();
  try {
    await updateDoc(userDoc(uid), { notifPrefs: next });
  } catch (err) {
    state.user.notifPrefs = prev;
    emit();
    toast('Não foi possível salvar a preferência.', 'danger');
  }
}

// Sino do topo: mostra "cortado" quando a conversa está silenciada.
export function refreshNotifButton(ctx) {
  const btn = document.getElementById('gk-conv-notif-btn');
  if (!btn || !ctx) return;
  const level = effectiveLevel(ctx);
  btn.innerHTML = iconHtml(level === 'none' ? 'bellOff' : 'bell');
  btn.classList.toggle('gk-notif-off', level === 'none');
  btn.title = level === 'none' ? 'Conversa silenciada' : level === 'mentions' ? 'Notificações: só @menções' : 'Notificações';
}

export function openNotifModal({ serverId, channelId, dmId, channelName }, onChange) {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  const ctx = dmId ? { dmId } : { serverId, channelId };

  const render = () => {
    modal.innerHTML = '';
    modal.appendChild(el('h2', {}, 'Notificações'));
    modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Escolha quando você quer ser avisado (som, notificação e ponto de não lida).'));

    const p = prefsOf();
    const sections = dmId
      ? [{ title: 'Esta conversa', kind: 'dms', id: dmId, current: p.dms?.[dmId] === 'none' ? 'none' : 'all',
           options: [['all', 'Todas as mensagens'], ['none', 'Silenciar conversa']] }]
      : [
        { title: `Este canal (#${channelName})`, kind: 'channels', id: channelId, current: p.channels?.[channelId] || 'default',
          options: [['default', 'Usar o padrão do servidor'], ['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Silenciar canal']] },
        { title: 'Servidor inteiro', kind: 'servers', id: serverId, current: p.servers?.[serverId] || 'all',
          options: [['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Silenciar servidor']] },
      ];

    for (const s of sections) {
      modal.appendChild(el('div', { class: 'gk-notif-section-title' }, s.title));
      const group = el('div', { class: 'gk-notif-group', role: 'radiogroup' });
      for (const [value, label] of s.options) {
        const active = s.current === value;
        group.appendChild(el('button', {
          type: 'button', class: 'gk-notif-opt' + (active ? ' gk-active' : ''), role: 'radio', 'aria-checked': String(active),
          'data-kind': s.kind, 'data-value': value,
          onclick: async () => { await setLevel(s.kind, s.id, value); render(); onChange && onChange(); },
        }, [el('span', {}, label), active ? icon('check', { size: 16 }) : null]));
      }
      modal.appendChild(group);
    }
    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => overlay.classList.remove('gk-open') }, 'Concluído'),
    ]));
  };
  render();
  overlay.classList.add('gk-open');
  return ctx;
}
