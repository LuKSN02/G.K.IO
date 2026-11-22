// ============================================================
// G.K.IO — Mensagens de voz
// Grava com MediaRecorder, sobe o áudio pro Cloudinary (mesmo upload dos
// anexos) e envia como mensagem com attachmentType 'audio' + audioDuration.
// O player é um <audio> reaproveitado entre os redesenhos da lista, para a
// reprodução não cortar quando alguém reage/edita outra mensagem.
// ctx (montado em chat.js): postPayload, setUploading
// ============================================================
import { auth } from './db.js';
import { el, toast } from './state.js';
import { icon } from './icons.js';
import { uploadToCloudinary } from './cloudinary.js';
import { formatDuration } from './message-utils.js';

const MAX_SECONDS = 5 * 60;
const MIN_SECONDS = 1;

let rec = null; // { recorder, stream, chunks, startedAt, timer, send }
let starting = false; // true enquanto espera a permissão do microfone (evita 2 gravadores num duplo clique)

function pickMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

function recorderUi() {
  return {
    bar: document.getElementById('gk-voice-recorder'),
    box: document.querySelector('#gk-composer .gk-composer-box'),
  };
}

function hideRecorderUi() {
  const { bar, box } = recorderUi();
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  if (box) box.style.display = '';
}

export function isRecordingVoice() { return !!rec; }

// Chamada ao trocar de conversa: descarta a gravação em andamento.
export function cancelVoiceRecording() {
  if (!rec) return;
  finish(null, false);
}

export async function startVoiceRecording(ctx) {
  if (rec || starting) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
    toast('Este navegador não consegue gravar áudio.', 'danger');
    return;
  }
  let stream;
  starting = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast('Não consegui acessar o microfone. Verifique a permissão.', 'danger');
    return;
  } finally {
    starting = false;
  }
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec = { recorder, stream, chunks: [], startedAt: Date.now(), timer: null, send: false };
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  recorder.start(250);

  const { bar, box } = recorderUi();
  box.style.display = 'none';
  bar.style.display = 'flex';
  bar.innerHTML = '';
  const timeEl = el('span', { class: 'gk-voice-rec-time' }, '0:00');
  bar.appendChild(el('button', { class: 'gk-sv-iconbtn gk-danger', type: 'button', id: 'gk-voice-cancel', title: 'Descartar gravação', 'aria-label': 'Descartar gravação', onclick: () => finish(ctx, false) }, [icon('trash', { size: 16 })]));
  bar.appendChild(el('span', { class: 'gk-voice-rec-dot' }));
  bar.appendChild(el('span', { class: 'gk-voice-rec-label' }, 'Gravando…'));
  bar.appendChild(timeEl);
  bar.appendChild(el('button', { class: 'gk-voice-rec-send', type: 'button', id: 'gk-voice-send', title: 'Enviar mensagem de voz', 'aria-label': 'Enviar mensagem de voz', onclick: () => finish(ctx, true) }, [icon('send', { size: 16 })]));

  rec.timer = setInterval(() => {
    const secs = (Date.now() - rec.startedAt) / 1000;
    timeEl.textContent = formatDuration(secs);
    if (secs >= MAX_SECONDS) finish(ctx, true); // limite de 5 minutos: envia o que gravou
  }, 250);
}

function finish(ctx, send) {
  if (!rec) return;
  const r = rec;
  r.send = send;
  clearInterval(r.timer);
  r.recorder.onstop = async () => {
    r.stream.getTracks().forEach((t) => t.stop());
    hideRecorderUi();
    if (rec === r) rec = null;
    if (r.send && ctx) await uploadAndPost(ctx, r);
  };
  if (r.recorder.state !== 'inactive') r.recorder.stop(); else r.recorder.onstop();
}

async function uploadAndPost(ctx, r) {
  const seconds = (Date.now() - r.startedAt) / 1000;
  if (seconds < MIN_SECONDS) { toast('Mensagem de voz muito curta.'); return; }
  const type = (r.recorder.mimeType || 'audio/webm').split(';')[0];
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([new Blob(r.chunks, { type })], `voz-${Date.now()}.${ext}`, { type });
  ctx.setUploading(true);
  try {
    const peaks = await computePeaks(file).catch(() => null);
    const { url } = await uploadToCloudinary(file, `voice/${auth.currentUser.uid}`);
    await ctx.postPayload({
      content: '',
      attachmentUrl: url,
      attachmentType: 'audio',
      attachmentName: 'Mensagem de voz',
      audioDuration: Math.round(seconds * 10) / 10,
      ...(peaks ? { audioPeaks: peaks } : {}),
    }, { preview: '🎤 Mensagem de voz', skipIndex: true });
  } catch (err) {
    toast(err.message || 'Falha ao enviar a mensagem de voz.', 'danger');
  } finally {
    ctx.setUploading(false);
  }
}

// ---------- Forma de onda ----------
export const WAVE_BARS = 36;
/** Reduz uma lista de amplitudes a N barras (0–100). Exportada para teste. */
export function reducePeaks(samples, n = WAVE_BARS) {
  const out = []; const size = Math.max(1, Math.floor(samples.length / n));
  for (let i = 0; i < n; i++) {
    let m = 0; for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j++) m = Math.max(m, Math.abs(samples[j]));
    out.push(m);
  }
  const top = Math.max(...out, 1e-6);
  return out.map((v) => Math.max(8, Math.round((v / top) * 100)));
}
async function computePeaks(file) {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  const ac = new AC();
  try { const buf = await ac.decodeAudioData(await file.arrayBuffer()); return reducePeaks(buf.getChannelData(0)); }
  finally { ac.close?.(); }
}
// Sem onda gravada (mensagens antigas): barras estáveis geradas a partir do id.
function fakePeaks(id, n = WAVE_BARS) {
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => { h = (h * 1664525 + 1013904223) >>> 0; return 25 + Math.round(((h >>> 8) % 60) * (0.6 + 0.4 * Math.sin(i / 3))); });
}

// ---------- Player ----------
const audios = new Map(); // msgId -> <audio> (sobrevive aos redesenhos da lista)
let playing = null;

export function buildVoicePlayer(msg) {
  let audio = audios.get(msg.id);
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.src = msg.attachmentUrl;
    audios.set(msg.id, audio);
  }
  const stored = Number(msg.audioDuration) || 0;
  const durationOf = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : stored);

  const btn = el('button', { class: 'gk-voice-play', type: 'button', title: 'Reproduzir', 'aria-label': 'Reproduzir mensagem de voz' });
  const peaks = Array.isArray(msg.audioPeaks) && msg.audioPeaks.length ? msg.audioPeaks.slice(0, 64) : fakePeaks(msg.id);
  const bars = peaks.map((v) => el('i', { style: `height:${Math.max(8, Math.min(100, Number(v) || 8))}%` }));
  const track = el('div', { class: 'gk-voice-wave', role: 'slider', 'aria-label': 'Posição do áudio' }, bars);
  const speedBtn = el('button', { class: 'gk-voice-speed', type: 'button', title: 'Velocidade' }, '1x');
  const SPEEDS = [1, 1.5, 2];
  const paintSpeed = () => { speedBtn.textContent = (audio.playbackRate || 1) + 'x'; };
  speedBtn.addEventListener('click', () => { const i = SPEEDS.indexOf(audio.playbackRate || 1); audio.playbackRate = SPEEDS[(i + 1) % SPEEDS.length]; paintSpeed(); });
  const time = el('span', { class: 'gk-voice-time' });

  const paintButton = () => {
    btn.innerHTML = '';
    btn.appendChild(icon(audio.paused ? 'play' : 'pause', { size: 16 }));
    btn.title = audio.paused ? 'Reproduzir' : 'Pausar';
  };
  const paint = () => {
    const d = durationOf();
    const k = d ? Math.min(1, audio.currentTime / d) : 0; const on = Math.round(k * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    time.textContent = audio.paused && audio.currentTime === 0
      ? formatDuration(d)
      : `${formatDuration(audio.currentTime)} / ${formatDuration(d)}`;
  };

  // Handlers por propriedade: cada redesenho troca os nós da tela, então o
  // <audio> passa a "falar" com os nós novos (e esquece os antigos).
  audio.onplay = () => { if (playing && playing !== audio) playing.pause(); playing = audio; paintButton(); };
  audio.onpause = () => { paintButton(); paint(); };
  audio.onended = () => { audio.currentTime = 0; paintButton(); paint(); };
  audio.ontimeupdate = paint;
  btn.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => toast('Não foi possível reproduzir o áudio.', 'danger'));
    else audio.pause();
  });
  track.addEventListener('click', (e) => {
    const d = durationOf();
    if (!d) return;
    const rect = track.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * d;
    paint();
  });

  paintButton();
  paint();
  paintSpeed();
  return el('div', { class: 'gk-voice-msg' }, [btn, track, time, speedBtn]);
}
