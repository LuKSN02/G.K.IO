// ============================================================
// G.K.IO — Ferramentas da chamada: quadro branco compartilhado e legendas ao vivo
// Tudo trafega pelo canal de dados da chamada (LiveKit), sem servidor extra e sem gravar nada.
//
// QUADRO: traços normalizados (0–1) enviados em lotes; quem abre o quadro pede o estado e os
//   outros respondem em blocos (≤ 3,5 KB, limite de 4 KB por mensagem). Some quando a chamada acaba.
// LEGENDAS: usa o reconhecimento de voz do NAVEGADOR (Chrome/Edge/Safari): cada pessoa transcreve a
//   própria fala e envia o texto — quem liga as legendas vê o de todos. Atenção: no Chrome o áudio é
//   processado pelo serviço de fala do Google; o app Electron não tem esse recurso (só recebe).
// ============================================================
import { auth } from './db.js';
import { state, el, toast } from './state.js';
import { icon } from './icons.js';
import { onCallData, sendCallData, callParticipantName } from './calls.js';

const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#8B5CF6', '#ec4899', '#111111'];
const CHUNK_BYTES = 3500;

// ---------------- quadro branco ----------------
let board = null; // { wrap, canvas, ctx, ... } criado sob demanda
let fitBoard = () => {};
const strokes = new Map(); // id -> { c, w, p:[[x,y]] }
let boardOpen = false; let color = COLORS[0]; let size = 4; let drawing = null; let pending = [];
let flushTimer = null;
const sid = () => (auth.currentUser?.uid || 'x').slice(0, 6) + Math.random().toString(36).slice(2, 8);

function paintStroke(st, from = 0) {
  if (!board) return;
  const { ctx, canvas } = board; const W = canvas.width, H = canvas.height;
  ctx.strokeStyle = st.c; ctx.lineWidth = st.w * (W / 900); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  const pts = st.p; const start = Math.max(0, from - 1);
  if (pts.length - start === 1) { ctx.fillStyle = st.c; ctx.arc(pts[start][0] * W, pts[start][1] * H, ctx.lineWidth / 2, 0, 7); ctx.fill(); return; }
  ctx.moveTo(pts[start][0] * W, pts[start][1] * H);
  for (let i = start + 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
  ctx.stroke();
}
function repaintAll() {
  if (!board) return;
  const { ctx, canvas } = board; ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach((s) => s.p.length && paintStroke(s));
}
function flush() {
  flushTimer = null; if (!pending.length) return;
  const batch = pending; pending = [];
  for (const b of batch) sendCallData('gkio-board', b);
}
function queue(msg) { pending.push(msg); if (!flushTimer) flushTimer = setTimeout(flush, 70); }

function ptFrom(e) { const r = board.canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; }

function ensureBoard() {
  if (board) return board;
  const canvas = el('canvas', { class: 'gkc-board-canvas', width: 1200, height: 750 });
  const ctx = canvas.getContext('2d');
  const stage = el('div', { class: 'gkc-board-stage' }, [canvas]);
  const swatches = COLORS.map((c) => el('button', { class: 'gkc-board-sw' + (c === color ? ' gk-on' : ''), type: 'button', style: `background:${c}`, 'aria-label': `Cor ${c}`, onclick: (e) => { color = c; swatches.forEach((s) => s.classList.remove('gk-on')); e.currentTarget.classList.add('gk-on'); } }));
  const sz = el('input', { type: 'range', min: '2', max: '18', value: String(size), 'aria-label': 'Espessura', oninput: (e) => { size = +e.target.value; } });
  const wrap = el('div', { class: 'gkc-board' }, [
    el('div', { class: 'gkc-board-bar' }, [
      el('b', {}, 'Quadro branco'), ...swatches, sz,
      el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => { strokes.clear(); repaintAll(); sendCallData('gkio-board', { t: 'clear' }); } }, 'Limpar'),
      el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: () => { const a = Object.assign(document.createElement('a'), { href: canvas.toDataURL('image/png'), download: 'quadro-gkio.png' }); a.click(); } }, 'Salvar PNG'),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => setBoardOpen(false) }, 'Fechar'),
    ]),
    stage,
  ]);
  // O canvas tem proporção fixa 16:10 e é encaixado no palco com largura/altura EXATAS em px —
  // assim o retângulo medido no clique é exatamente a área desenhada (sem faixas vazias).
  const fit = () => {
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    const ar = canvas.width / canvas.height; let w = r.width, h = w / ar;
    if (h > r.height) { h = r.height; w = h * ar; }
    canvas.style.width = Math.floor(w) + 'px'; canvas.style.height = Math.floor(h) + 'px';
  };
  fitBoard = fit;
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage); else window.addEventListener('resize', fit);
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const id = sid(); drawing = { id, c: color, w: size, p: [ptFrom(e)] }; strokes.set(id, drawing); paintStroke(drawing);
    queue({ t: 's', id, c: drawing.c, w: drawing.w, p: [drawing.p[0]] }); drawing.sent = 1;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = ptFrom(e); drawing.p.push(p); paintStroke(drawing, drawing.p.length - 1);
    if (drawing.p.length - drawing.sent >= 4) { queue({ t: 'p', id: drawing.id, p: drawing.p.slice(drawing.sent) }); drawing.sent = drawing.p.length; }
  });
  const end = () => { if (!drawing) return; if (drawing.p.length > drawing.sent) queue({ t: 'p', id: drawing.id, p: drawing.p.slice(drawing.sent) }); drawing = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  document.getElementById('gk-call-screen')?.appendChild(wrap);
  board = { wrap, canvas, ctx };
  return board;
}

function setBoardOpen(open) {
  boardOpen = open; ensureBoard().wrap.classList.toggle('gk-open', open);
  if (open) requestAnimationFrame(() => { fitBoard(); repaintAll(); });
  document.getElementById('gk-call-board-btn')?.classList.toggle('gk-active', open);
  if (open) { repaintAll(); sendCallData('gkio-board', { t: 'req' }); }
}

function sendFull() {
  const all = [...strokes.entries()].map(([id, s]) => ({ id, c: s.c, w: s.w, p: s.p }));
  let chunk = []; let size = 0;
  const emit = () => { if (chunk.length) sendCallData('gkio-board', { t: 'full', s: chunk }); chunk = []; size = 0; };
  for (const s of all) {
    // traço grande demais para uma mensagem: divide os pontos
    for (let i = 0; i < s.p.length; i += 120) {
      const part = { id: s.id, c: s.c, w: s.w, o: i, p: s.p.slice(i, i + 120) }; const bytes = JSON.stringify(part).length;
      if (size + bytes > CHUNK_BYTES) emit();
      chunk.push(part); size += bytes;
    }
  }
  emit();
}

const cleanPts = (pts) => (Array.isArray(pts) ? pts : []).slice(0, 200).filter((q) => Array.isArray(q) && q.length === 2).map(([x, y]) => [Math.min(1, Math.max(0, +x || 0)), Math.min(1, Math.max(0, +y || 0))]);

/** Aplica uma mensagem do quadro ao mapa de traços. Devolve { from, ids } dos traços que mudaram (para repintar) ou null. */
export function applyBoardMsg(map, msg) {
  if (!msg || typeof msg !== 'object') return null;
  const touch = (id, c, w, pts, offset = 0) => {
    id = String(id).slice(0, 40); const clean = cleanPts(pts);
    let st = map.get(id);
    if (!st) { st = { c: String(c || '#fff').slice(0, 9), w: Math.min(30, Math.max(1, +w || 3)), p: [] }; map.set(id, st); }
    const L = st.p.length;
    if (offset <= L && offset + clean.length > L) { st.p.push(...clean.slice(L - offset)); return { id, from: L }; }
    return null;
  };
  if (msg.t === 's') { const r = touch(msg.id, msg.c, msg.w, msg.p, 0); return r ? { changed: [r] } : null; }
  if (msg.t === 'p') { if (!map.has(String(msg.id))) return null; const r = touch(msg.id, null, null, msg.p, map.get(String(msg.id)).p.length); return r ? { changed: [r] } : null; }
  if (msg.t === 'full' && Array.isArray(msg.s)) { const ch = msg.s.slice(0, 200).map((x) => touch(x.id, x.c, x.w, x.p, +x.o || 0)).filter(Boolean); return ch.length ? { changed: ch } : null; }
  if (msg.t === 'clear') { map.clear(); return { cleared: true }; }
  return null;
}

function registerBoardHandler() {
onCallData('gkio-board', (msg, from) => {
  if (!msg || from === auth.currentUser?.uid) return;
  if (msg.t === 'req') { if (strokes.size) sendFull(); return; }
  const r = applyBoardMsg(strokes, msg); if (!r) return;
  if (r.cleared) repaintAll();
  else if (boardOpen) r.changed.forEach((c) => paintStroke(strokes.get(c.id), c.from));
  if (msg.t === 's' && !boardOpen) {
    document.getElementById('gk-call-board-btn')?.classList.add('gk-ping');
    if (!pingedOnce) { pingedOnce = true; toast(`${callParticipantName(from)} está desenhando no quadro branco da chamada.`); }
  }
});
}
let pingedOnce = false;

// ---------------- legendas ----------------
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let capOn = false; let rec = null; let capBox = null; const lines = [];
const canTranscribe = () => !!SR && !window.gkioDesktop;

function showCaption(name, text) {
  if (!capBox) { capBox = el('div', { class: 'gkc-captions', 'aria-live': 'polite' }); document.getElementById('gk-call-screen')?.appendChild(capBox); }
  lines.push({ name, text, at: Date.now() }); while (lines.length > 3) lines.shift();
  capBox.replaceChildren(...lines.map((l) => el('div', {}, [el('b', {}, l.name + ': '), l.text])));
  capBox.style.display = 'block';
  clearTimeout(showCaption.t); showCaption.t = setTimeout(() => { lines.length = 0; if (capBox) capBox.style.display = 'none'; }, 7000);
}
function startRec() {
  if (!canTranscribe() || rec) return;
  rec = new SR(); rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (!ev.results[i].isFinal) continue;
      const text = ev.results[i][0].transcript.trim().slice(0, 300); if (!text) continue;
      showCaption('Você', text); sendCallData('gkio-cap', { t: text });
    }
  };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('O navegador não deixou transcrever sua fala.', 'danger'); stopRec(); } };
  rec.onend = () => { if (capOn && rec) { try { rec.start(); } catch (e) { /* já rodando */ } } };
  try { rec.start(); } catch (e) { rec = null; }
}
function stopRec() { const r = rec; rec = null; try { r?.stop(); } catch (e) { /* ok */ } }
function setCaptions(on) {
  capOn = on; document.getElementById('gk-call-captions-btn')?.classList.toggle('gk-active', on);
  if (on) { if (canTranscribe()) startRec(); else toast('Legendas ligadas: você vê as dos outros, mas este app não transcreve a sua fala.'); }
  else { stopRec(); lines.length = 0; if (capBox) capBox.style.display = 'none'; }
}
function registerCaptionHandler() {
onCallData('gkio-cap', (msg, from) => {
  if (!capOn || !msg || typeof msg.t !== 'string' || from === auth.currentUser?.uid) return;
  showCaption(callParticipantName(from), msg.t.slice(0, 300));
});
}

// ---------------- montagem ----------------
// Os handlers só podem ser registrados DEPOIS que calls.js terminou de carregar (ele importa este arquivo,
// então `dataHandlers` ainda não existe quando este módulo é avaliado).
let registered = false;
export function initCallTools() {
  if (!registered) { registered = true; registerBoardHandler(); registerCaptionHandler(); }
  const bar = document.getElementById('gk-call-controls'); const hang = document.getElementById('gk-call-hangup-btn');
  if (!bar || !hang || document.getElementById('gk-call-board-btn')) return;
  const mk = (id, title, ic, fn) => { const b = el('button', { class: 'gk-call-ctrl-btn', id, title, 'aria-label': title, type: 'button' }, [icon(ic, { size: 20 })]); b.addEventListener('click', fn); return b; };
  bar.insertBefore(mk('gk-call-board-btn', 'Quadro branco', 'edit', (e) => { e.currentTarget.classList.remove('gk-ping'); setBoardOpen(!boardOpen); }), hang);
  bar.insertBefore(mk('gk-call-captions-btn', 'Legendas ao vivo', 'speaker', () => setCaptions(!capOn)), hang);
}

export function resetCallTools() {
  strokes.clear(); pending = []; drawing = null; pingedOnce = false;
  if (boardOpen) setBoardOpen(false); if (board) repaintAll();
  setCaptions(false);
  document.getElementById('gk-call-board-btn')?.classList.remove('gk-ping');
}
