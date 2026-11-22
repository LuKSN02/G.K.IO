// Canal de palco: sala de voz com flag stage:true. Só quem está em channels/{id}.stageSpeakers (e quem
// gerencia canais) pode ligar o microfone; a plateia "pede a palavra" e um moderador chama ao palco.
// O bloqueio do microfone é feito no app (o servidor de voz não é nosso para barrar a publicação).
import { auth, db, doc, onSnapshot, updateDoc, arrayUnion, arrayRemove } from './db.js';
import { state, el, toast } from './state.js';
import { canManageChannels, getCategoriesAndChannels } from './servers.js';
import { onCallData, sendCallData, setMicEnabled, callParticipantList } from './calls.js';

let cur = null; // { serverId, channelId, unsub, speakers:[], asks:Map, panel, asked }
const me = () => auth.currentUser?.uid;
const nameOf = (uid) => callParticipantList().find((p) => p.uid === uid)?.name || 'Membro';
const isMod = () => cur && canManageChannels(cur.serverId);
const canSpeak = () => !!cur && (isMod() || cur.speakers.includes(me()));

function stop() {
  cur?.unsub?.(); cur?.panel?.remove(); cur = null; window.__gkStageAudience = false;
}

function render() {
  if (!cur) return;
  const wasAudience = !!window.__gkStageAudience;
  window.__gkStageAudience = !canSpeak();
  if (window.__gkStageAudience && !wasAudience) setMicEnabled(false).catch(() => {});
  if (!window.__gkStageAudience && wasAudience && !isMod()) toast('🎙 Você foi chamado ao palco! Já pode ligar o microfone.');
  const people = callParticipantList();
  const box = cur.panel; box.replaceChildren();
  box.appendChild(el('div', { class: 'gk-stage-head' }, '🎙 Palco'));
  box.appendChild(el('div', { class: 'gk-stage-sec' }, 'No palco'));
  const spk = people.filter((p) => cur.speakers.includes(p.uid));
  if (!spk.length) box.appendChild(el('div', { class: 'gk-stage-empty' }, 'Ninguém ainda — moderadores sempre podem falar.'));
  spk.forEach((p) => box.appendChild(el('div', { class: 'gk-stage-row' }, [el('span', {}, p.name),
    isMod() ? el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => mutate(arrayRemove(p.uid)) }, 'Tirar') : null])));
  if (isMod() && cur.asks.size) {
    box.appendChild(el('div', { class: 'gk-stage-sec' }, '✋ Pediram a palavra'));
    [...cur.asks.keys()].forEach((uid) => box.appendChild(el('div', { class: 'gk-stage-row' }, [el('span', {}, nameOf(uid)),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => { cur.asks.delete(uid); mutate(arrayUnion(uid)); } }, 'Chamar ao palco')])));
  }
  if (!canSpeak()) {
    box.appendChild(el('button', { class: 'gk-btn gk-btn-primary gk-stage-ask', type: 'button', onclick: async () => {
      cur.asked = !cur.asked; await sendCallData('stage', { t: cur.asked ? 'ask' : 'cancel' }); render();
    } }, cur.asked ? 'Cancelar pedido' : '✋ Pedir a palavra'));
  }
}
async function mutate(op) {
  try { await updateDoc(doc(db, 'servers', cur.serverId, 'channels', cur.channelId), { stageSpeakers: op }); }
  catch { toast('Não foi possível alterar o palco.', 'danger'); }
}

window.addEventListener('gkio-voice-joined', (e) => {
  stop();
  const { serverId, channelId } = e.detail || {};
  const ch = getCategoriesAndChannels().channels?.find((c) => c.id === channelId);
  if (!ch?.stage) return;
  const panel = document.body.appendChild(el('div', { class: 'gk-stage-panel' }));
  cur = { serverId, channelId, speakers: [], asks: new Map(), panel, asked: false };
  cur.unsub = onSnapshot(doc(db, 'servers', serverId, 'channels', channelId), (s) => {
    cur.speakers = s.data()?.stageSpeakers || [];
    if (cur.speakers.includes(me())) { cur.asked = false; }
    render();
  });
  window.__gkStageAudience = !canSpeak(); render();
});
window.addEventListener('gkio-call-ended', stop);
onCallData('stage', (msg, from) => {
  if (!cur || !msg) return;
  if (msg.t === 'ask') cur.asks.set(from, true); else if (msg.t === 'cancel') cur.asks.delete(from);
  render();
});
