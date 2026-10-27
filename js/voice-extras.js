// ============================================================
// G.K.IO — Soundboard e atividades dentro da chamada
//  · Soundboard: 8 sons sintetizados (sem arquivos) + seus próprios sons (até 6 s,
//    enviados ao Cloudinary; a lista fica neste aparelho). Quem está na chamada ouve.
//  · Atividades: dados (d4–d100, com modificador e "maior de N d20"), cara ou coroa,
//    roleta de participantes e jogo da velha.
// Tudo viaja pelo canal de dados do LiveKit (sem servidor novo). Quem manda é
// identificado pela conexão (identity), nunca pelo conteúdo da mensagem.
// ============================================================
import { state, el, toast } from './state.js';
import { auth } from './db.js';
import { icon } from './icons.js';
import { uploadToCloudinary } from './cloudinary.js';
import { sendCallData, onCallData, callParticipantList, isInCall } from './calls.js';

const TOPIC_SFX = 'gk-sfx';
const TOPIC_ACT = 'gk-act';
const CUSTOM_KEY = 'gkio-soundboard-custom';
const MUTE_KEY = 'gkio-soundboard-muted';
const MAX_CUSTOM = 12;
const MAX_SECONDS = 6;
const MAX_BYTES = 600 * 1024;

// ---------- Sons sintetizados ----------
export const PRESETS = [
  { id: 'horn', label: 'Buzina', emoji: '📯' },
  { id: 'applause', label: 'Aplausos', emoji: '👏' },
  { id: 'sad', label: 'Trombone triste', emoji: '🎺' },
  { id: 'ding', label: 'Ding', emoji: '🔔' },
  { id: 'bruh', label: 'Bruh', emoji: '😐' },
  { id: 'rimshot', label: 'Tá-dum-tss', emoji: '🥁' },
  { id: 'tada', label: 'Tchan!', emoji: '🎉' },
  { id: 'siren', label: 'Alerta', emoji: '🚨' },
];
let sfxCtx = null;
const ctx = () => {
  sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
  return sfxCtx;
};
function tone(c, type, f0, f1, t0, dur, vol = 0.25) {
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function noiseBurst(c, t0, dur, vol = 0.25, hp = 1500) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination); s.start(t0);
}
export function playPreset(id) {
  const c = ctx(); const t = c.currentTime + 0.01;
  switch (id) {
    case 'horn': tone(c, 'sawtooth', 440, 440, t, 0.25); tone(c, 'sawtooth', 440, 440, t + 0.3, 0.25); tone(c, 'sawtooth', 554, 554, t + 0.6, 0.6); break;
    case 'applause': for (let i = 0; i < 26; i++) noiseBurst(c, t + i * 0.07 + Math.random() * 0.05, 0.06, 0.22, 800); break;
    case 'sad': [[392, 0], [370, 0.5], [349, 1.0]].forEach(([f, d]) => tone(c, 'sawtooth', f, f, t + d, 0.45, 0.2)); tone(c, 'sawtooth', 330, 262, t + 1.5, 1.0, 0.2); break;
    case 'ding': tone(c, 'sine', 1318, 1318, t, 1.1, 0.3); tone(c, 'sine', 2637, 2637, t, 0.6, 0.1); break;
    case 'bruh': tone(c, 'square', 180, 70, t, 0.55, 0.22); break;
    case 'rimshot': noiseBurst(c, t, 0.12, 0.3, 300); noiseBurst(c, t + 0.18, 0.12, 0.3, 300); noiseBurst(c, t + 0.5, 0.35, 0.3, 4000); tone(c, 'sine', 120, 60, t + 0.5, 0.2, 0.3); break;
    case 'tada': [523, 659, 784].forEach((f, i) => tone(c, 'triangle', f, f, t + i * 0.12, 0.3)); tone(c, 'triangle', 1046, 1046, t + 0.4, 0.9, 0.3); break;
    case 'siren': for (let i = 0; i < 3; i++) { tone(c, 'sawtooth', 600, 900, t + i * 0.5, 0.25, 0.18); tone(c, 'sawtooth', 900, 600, t + i * 0.5 + 0.25, 0.25, 0.18); } break;
    default: break;
  }
}

// ---------- Sons próprios ----------
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch (e) { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage indisponível */ } };
export const getCustomSounds = () => (readJson(CUSTOM_KEY, []) || []).filter((s) => s && typeof s.url === 'string').slice(0, MAX_CUSTOM);
export const isSoundboardMuted = () => readJson(MUTE_KEY, false) === true;
/** Só aceita áudio hospedado no Cloudinary (https): evita que alguém faça seu aparelho abrir qualquer endereço. */
export const isTrustedSoundUrl = (u) => typeof u === 'string' && u.length < 400 && /^https:\/\/res\.cloudinary\.com\/[^\s]+$/.test(u);

function audioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(a.duration); };
    a.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler esse áudio.')); };
    a.src = url;
  });
}
export async function addCustomSound(file, name) {
  if (!file || !/^audio\//.test(file.type)) throw new Error('Escolha um arquivo de áudio.');
  if (file.size > MAX_BYTES) throw new Error('O som deve ter no máximo 600 KB.');
  const secs = await audioDuration(file);
  if (!(secs > 0) || secs > MAX_SECONDS) throw new Error(`O som deve durar até ${MAX_SECONDS} segundos.`);
  const list = getCustomSounds();
  if (list.length >= MAX_CUSTOM) throw new Error(`Limite de ${MAX_CUSTOM} sons próprios.`);
  const up = await uploadToCloudinary(file, 'soundboard');
  const item = { id: 'c' + Date.now().toString(36), name: (name || file.name.replace(/\.[^.]+$/, '')).slice(0, 24), url: up.url };
  writeJson(CUSTOM_KEY, [...list, item]);
  return item;
}
export function removeCustomSound(id) { writeJson(CUSTOM_KEY, getCustomSounds().filter((s) => s.id !== id)); }
function playUrl(url) {
  if (!isTrustedSoundUrl(url)) return;
  const a = new Audio(url); a.volume = 0.8; a.play().catch(() => {});
  setTimeout(() => { try { a.pause(); } catch (e) { /* ok */ } }, (MAX_SECONDS + 1) * 1000);
}

const lastSfxFrom = new Map(); // uid -> ms (limita 1 som a cada 1,5 s por pessoa)
function handleSfx(msg, fromUid) {
  if (!msg || fromUid === auth.currentUser?.uid || isSoundboardMuted()) return;
  const now = Date.now();
  if (now - (lastSfxFrom.get(fromUid) || 0) < 1500) return;
  lastSfxFrom.set(fromUid, now);
  if (msg.preset && PRESETS.some((p) => p.id === msg.preset)) playPreset(msg.preset);
  else if (msg.url) playUrl(msg.url);
}
export async function triggerSound(sound) {
  if (sound.preset) playPreset(sound.preset); else playUrl(sound.url);
  await sendCallData(TOPIC_SFX, sound.preset ? { preset: sound.preset } : { url: sound.url });
}

// ---------- Atividades ----------
const logLines = []; // { t, text }
const MAX_LOG = 30;
const nameOf = (uid) => callParticipantList().find((p) => p.uid === uid)?.name || 'Alguém';
const randInt = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
export const DICE = [4, 6, 8, 10, 12, 20, 100];

export function rollDice({ sides, count = 1, mod = 0, best = false }) {
  sides = DICE.includes(sides) ? sides : 20;
  count = Math.max(1, Math.min(10, Math.floor(count) || 1));
  mod = Math.max(-99, Math.min(99, Math.floor(mod) || 0));
  const rolls = Array.from({ length: count }, () => randInt(sides) + 1);
  const base = best ? Math.max(...rolls) : rolls.reduce((a, b) => a + b, 0);
  return { sides, count, mod, best: !!best, rolls, total: base + mod };
}
const fmtMod = (m) => (m ? (m > 0 ? ` + ${m}` : ` − ${Math.abs(m)}`) : '');
function diceText(who, r) {
  const expr = `${r.count}d${r.sides}${fmtMod(r.mod)}${r.best ? ' (maior)' : ''}`;
  return `${who} rolou ${expr}: [${r.rolls.join(', ')}] = ${r.total}`;
}

// Jogo da velha
export const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function tttWinner(board) {
  for (const [a, b, c] of TTT_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? 'draw' : null;
}
let ttt = null; // { id, x, o, board, turn: 'X'|'O' } — só existe para quem joga
let pendingInvite = null; // { id, from, to }

function addLog(text) {
  logLines.push({ t: Date.now(), text });
  if (logLines.length > MAX_LOG) logLines.shift();
  renderLog();
}
function myMark() { const me = auth.currentUser?.uid; return ttt ? (ttt.x === me ? 'X' : ttt.o === me ? 'O' : null) : null; }

function handleAct(msg, fromUid) {
  if (!msg || typeof msg.type !== 'string') return;
  const me = auth.currentUser?.uid;
  if (msg.type === 'dice') {
    const r = msg.r || {};
    if (!Array.isArray(r.rolls) || r.rolls.length > 10 || !r.rolls.every((n) => Number.isInteger(n) && n >= 1 && n <= 100)) return;
    addLog(diceText(nameOf(fromUid), { sides: Number(r.sides) || 20, count: r.rolls.length, mod: Number(r.mod) || 0, best: !!r.best, rolls: r.rolls, total: Number(r.total) || 0 }));
  } else if (msg.type === 'coin') {
    addLog(`${nameOf(fromUid)} jogou a moeda: ${msg.heads ? 'cara' : 'coroa'}`);
  } else if (msg.type === 'wheel') {
    const target = callParticipantList().find((p) => p.uid === msg.pick);
    addLog(`${nameOf(fromUid)} girou a roleta: ${target ? target.name : 'alguém'} foi sorteado`);
  } else if (msg.type === 'ttt-invite' && msg.to === me && typeof msg.id === 'string') {
    pendingInvite = { id: msg.id, from: fromUid, to: me };
    addLog(`${nameOf(fromUid)} te desafiou para o jogo da velha`);
  } else if (msg.type === 'ttt-accept' && ttt === null && pendingInvite === null && msg.id && msg.to === me) {
    // quem convidou recebe o aceite: o convidante é o X
    if (myOutgoing && myOutgoing.id === msg.id && myOutgoing.to === fromUid) {
      ttt = { id: msg.id, x: me, o: fromUid, board: Array(9).fill(null), turn: 'X' };
      myOutgoing = null; addLog(`Jogo da velha: você (X) × ${nameOf(fromUid)} (O)`);
    }
  } else if (msg.type === 'ttt-move' && ttt && msg.id === ttt.id) {
    const mark = ttt.x === fromUid ? 'X' : ttt.o === fromUid ? 'O' : null;
    const cell = msg.cell;
    if (!mark || mark !== ttt.turn || !Number.isInteger(cell) || cell < 0 || cell > 8 || ttt.board[cell]) return;
    applyMove(cell, mark);
  } else if (msg.type === 'ttt-end' && ttt && msg.id === ttt.id && (fromUid === ttt.x || fromUid === ttt.o)) {
    addLog(`${nameOf(fromUid)} encerrou o jogo da velha`); ttt = null;
  } else if (msg.type === 'ttt-announce') {
    addLog(String(msg.text || '').slice(0, 120));
  }
  renderPanel();
}
let myOutgoing = null; // convite que EU enviei { id, to }

function applyMove(cell, mark) {
  ttt.board[cell] = mark;
  const w = tttWinner(ttt.board);
  if (w) {
    const text = w === 'draw' ? 'Jogo da velha: deu velha (empate)!' : `Jogo da velha: ${nameOf(w === 'X' ? ttt.x : ttt.o)} venceu!`;
    addLog(text);
    ttt.over = true;
  } else ttt.turn = mark === 'X' ? 'O' : 'X';
}

// ---------- Painel ----------
let panel = null; let tab = 'sound';
const logBox = () => panel?.querySelector('.gk-extras-log');
function renderLog() {
  const b = logBox(); if (!b) return;
  b.innerHTML = '';
  for (const l of logLines.slice(-12)) b.appendChild(el('div', { class: 'gk-extras-logline' }, l.text));
  b.scrollTop = b.scrollHeight;
}

function soundTab() {
  const wrap = el('div', { class: 'gk-extras-body' });
  const grid = el('div', { class: 'gk-sfx-grid' });
  for (const p of PRESETS) {
    grid.appendChild(el('button', { class: 'gk-sfx-btn', type: 'button', title: p.label, onclick: () => triggerSound({ preset: p.id }) }, [el('span', { class: 'gk-sfx-emoji' }, p.emoji), el('span', {}, p.label)]));
  }
  for (const s of getCustomSounds()) {
    const b = el('div', { class: 'gk-sfx-custom' }, [
      el('button', { class: 'gk-sfx-btn', type: 'button', title: s.name, onclick: () => triggerSound({ url: s.url }) }, [el('span', { class: 'gk-sfx-emoji' }, '🔊'), el('span', {}, s.name)]),
      el('button', { class: 'gk-sfx-del', type: 'button', title: 'Remover som', 'aria-label': `Remover ${s.name}`, onclick: () => { removeCustomSound(s.id); renderPanel(); } }, [icon('close', { size: 11 })]),
    ]);
    grid.appendChild(b);
  }
  wrap.appendChild(grid);
  const file = el('input', { type: 'file', accept: 'audio/*', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = '';
    if (!f) return;
    try { toast('Enviando som…'); await addCustomSound(f); toast('Som adicionado!'); renderPanel(); }
    catch (e) { toast(e.message || 'Não foi possível adicionar o som.', 'danger'); }
  });
  const mute = el('input', { type: 'checkbox' }); mute.checked = isSoundboardMuted();
  mute.addEventListener('change', () => writeJson(MUTE_KEY, mute.checked));
  wrap.appendChild(el('div', { class: 'gk-extras-actions' }, [
    el('button', { class: 'gk-btn', type: 'button', onclick: () => file.click() }, [icon('plus', { size: 13 }), ' Adicionar som (até 6 s)']),
    file,
    el('label', { class: 'gk-extras-check' }, [mute, ' Silenciar sons dos outros']),
  ]));
  return wrap;
}

function actTab() {
  const wrap = el('div', { class: 'gk-extras-body' });
  // dados
  const sides = el('select', { class: 'gk-select', 'aria-label': 'Tipo de dado' }, DICE.map((n) => el('option', { value: String(n) }, `d${n}`)));
  sides.value = '20';
  const count = el('input', { type: 'number', min: '1', max: '10', value: '1', class: 'gk-extras-num', 'aria-label': 'Quantidade de dados' });
  const mod = el('input', { type: 'number', min: '-99', max: '99', value: '0', class: 'gk-extras-num', 'aria-label': 'Modificador' });
  const best = el('input', { type: 'checkbox' });
  const roll = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, [icon('sparkles', { size: 13 }), ' Rolar']);
  roll.addEventListener('click', async () => {
    const r = rollDice({ sides: Number(sides.value), count: Number(count.value), mod: Number(mod.value), best: best.checked });
    addLog(diceText('Você', r));
    await sendCallData(TOPIC_ACT, { type: 'dice', r });
  });
  wrap.appendChild(el('div', { class: 'gk-extras-row' }, [el('b', {}, 'Dados'), count, sides, el('span', {}, '+'), mod, el('label', { class: 'gk-extras-check' }, [best, ' maior']), roll]));
  // moeda e roleta
  const coin = el('button', { class: 'gk-btn', type: 'button', onclick: async () => { const heads = randInt(2) === 0; addLog(`Você jogou a moeda: ${heads ? 'cara' : 'coroa'}`); await sendCallData(TOPIC_ACT, { type: 'coin', heads }); } }, '🪙 Cara ou coroa');
  const wheel = el('button', { class: 'gk-btn', type: 'button', onclick: async () => {
    const list = callParticipantList(); if (!list.length) return;
    const pick = list[randInt(list.length)];
    addLog(`Você girou a roleta: ${pick.name} foi sorteado`); await sendCallData(TOPIC_ACT, { type: 'wheel', pick: pick.uid });
  } }, '🎡 Roleta de participantes');
  wrap.appendChild(el('div', { class: 'gk-extras-row' }, [coin, wheel]));
  wrap.appendChild(tttSection());
  return wrap;
}

function tttSection() {
  const me = auth.currentUser?.uid;
  const sec = el('div', { class: 'gk-ttt' }, [el('b', {}, 'Jogo da velha')]);
  if (pendingInvite) {
    sec.appendChild(el('div', { class: 'gk-extras-row' }, [
      el('span', {}, `${nameOf(pendingInvite.from)} te desafiou`),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: async () => {
        const inv = pendingInvite; pendingInvite = null;
        ttt = { id: inv.id, x: inv.from, o: me, board: Array(9).fill(null), turn: 'X' };
        addLog(`Jogo da velha: ${nameOf(inv.from)} (X) × você (O)`);
        await sendCallData(TOPIC_ACT, { type: 'ttt-accept', id: inv.id, to: inv.from }); renderPanel();
      } }, 'Aceitar'),
      el('button', { class: 'gk-btn', type: 'button', onclick: () => { pendingInvite = null; renderPanel(); } }, 'Recusar'),
    ]));
  }
  if (ttt) {
    const mark = myMark();
    const yourTurn = !ttt.over && mark === ttt.turn;
    sec.appendChild(el('div', { class: 'gk-extras-hint' }, ttt.over ? 'Fim de jogo.' : yourTurn ? `Sua vez (${mark})` : `Vez de ${nameOf(ttt.turn === 'X' ? ttt.x : ttt.o)} (${ttt.turn})`));
    const board = el('div', { class: 'gk-ttt-board', role: 'grid', 'aria-label': 'Tabuleiro do jogo da velha' });
    ttt.board.forEach((v, i) => board.appendChild(el('button', {
      class: 'gk-ttt-cell', type: 'button', role: 'gridcell', 'aria-label': `Casa ${i + 1}${v ? ': ' + v : ''}`, disabled: (v || !yourTurn) ? 'true' : null,
      onclick: async () => { if (!yourTurn || ttt.board[i]) return; applyMove(i, mark); await sendCallData(TOPIC_ACT, { type: 'ttt-move', id: ttt.id, cell: i }); renderPanel(); },
    }, v || '')));
    sec.appendChild(board);
    sec.appendChild(el('button', { class: 'gk-btn', type: 'button', onclick: async () => { const id = ttt.id; ttt = null; await sendCallData(TOPIC_ACT, { type: 'ttt-end', id }); addLog('Você encerrou o jogo da velha'); renderPanel(); } }, 'Encerrar jogo'));
  } else {
    const others = callParticipantList().filter((p) => p.uid !== me);
    if (!others.length) sec.appendChild(el('div', { class: 'gk-extras-hint' }, 'Chame alguém para a chamada para jogar.'));
    for (const p of others) {
      sec.appendChild(el('button', { class: 'gk-btn', type: 'button', onclick: async () => {
        const id = 'g' + Date.now().toString(36); myOutgoing = { id, to: p.uid };
        await sendCallData(TOPIC_ACT, { type: 'ttt-invite', id, to: p.uid }); addLog(`Você desafiou ${p.name}`); renderPanel();
      } }, `Desafiar ${p.name}`));
    }
  }
  return sec;
}

function renderPanel() {
  if (!panel) return;
  const body = panel.querySelector('.gk-extras-content'); body.innerHTML = '';
  panel.querySelectorAll('.gk-extras-tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('gk-active', on); t.setAttribute('aria-selected', String(on)); });
  body.appendChild(tab === 'sound' ? soundTab() : actTab());
  renderLog();
}

export function closeExtrasPanel() { panel?.remove(); panel = null; }
export function toggleExtrasPanel(force = false) {
  if (panel) return closeExtrasPanel();
  if (force !== true && !isInCall()) { toast('Entre em uma chamada para usar o soundboard e as atividades.'); return; }
  panel = el('div', { class: 'gk-extras-panel', role: 'dialog', 'aria-label': 'Soundboard e atividades' }, [
    el('div', { class: 'gk-extras-head' }, [
      el('div', { class: 'gk-extras-tabs', role: 'tablist' }, [
        el('button', { class: 'gk-extras-tab', type: 'button', role: 'tab', 'data-tab': 'sound', onclick: () => { tab = 'sound'; renderPanel(); } }, [icon('speaker', { size: 13 }), ' Soundboard']),
        el('button', { class: 'gk-extras-tab', type: 'button', role: 'tab', 'data-tab': 'act', onclick: () => { tab = 'act'; renderPanel(); } }, [icon('gamepad', { size: 13 }), ' Atividades']),
      ]),
      el('button', { class: 'gk-sv-iconbtn', type: 'button', title: 'Fechar', 'aria-label': 'Fechar painel', onclick: closeExtrasPanel }, [icon('close', { size: 15 })]),
    ]),
    el('div', { class: 'gk-extras-content' }),
    el('div', { class: 'gk-extras-log', 'aria-live': 'polite' }),
  ]);
  document.body.appendChild(panel);
  renderPanel();
}

let inited = false;
/** Liga os receptores uma vez (chamado por calls.js depois que todos os módulos carregaram). */
export function initVoiceExtras() {
  if (inited) return; inited = true;
  onCallData(TOPIC_SFX, handleSfx);
  onCallData(TOPIC_ACT, (msg, from) => handleAct(msg, from));
}
/** Chamado quando a chamada termina: limpa jogo, convites e histórico. */
export function resetVoiceExtras() {
  ttt = null; pendingInvite = null; myOutgoing = null; logLines.length = 0; lastSfxFrom.clear(); closeExtrasPanel();
}
export const _test = { handleAct, handleSfx, get ttt() { return ttt; }, get log() { return logLines; }, setTtt(v) { ttt = v; } };
