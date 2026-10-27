// ============================================================
// G.K.IO — Efeitos de voz e vídeo nas chamadas
//  · Supressão de ruído por IA (RNNoise em WebAssembly, rodando num AudioWorklet)
//  · Efeitos de vídeo (desfoque de fundo "foco no centro", filtros, espelhar)
//  · Volume por pessoa (0–200 %), guardado neste aparelho
// Tudo é opcional: se o navegador não suportar (AudioWorklet, WebAssembly,
// ctx.filter), o app segue com o áudio/vídeo normal e avisa uma vez.
// ============================================================
import { getMediaPrefs } from './prefs.js';

const WASM_URL = new URL('./vendor/rnnoise/rnnoise.wasm', import.meta.url).href;
const WORKLET_URL = new URL('./voice-worklet.js', import.meta.url).href;

export const aiNoiseSupported = () =>
  typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof AudioContext !== 'undefined';

// ---------- Supressão de ruído por IA ----------
let wasmBytes = null;
async function loadWasm() {
  if (!wasmBytes) {
    const res = await fetch(WASM_URL);
    if (!res.ok) throw new Error('rnnoise.wasm indisponível');
    wasmBytes = await res.arrayBuffer();
  }
  return wasmBytes.slice(0); // cópia: a original continua para a próxima chamada
}

/** Processador de áudio no formato do LiveKit (track.setProcessor). */
export class RnnoiseProcessor {
  constructor(strength = 'standard') {
    this.name = 'gkio-rnnoise';
    this.strength = strength;
    this.processedTrack = undefined;
    this.ctx = null; this.src = null; this.node = null; this.dest = null;
  }
  async init(opts) {
    // RNNoise trabalha em 48 kHz: cria o próprio contexto em vez de usar o do LiveKit.
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(WORKLET_URL);
    this.node = new AudioWorkletNode(this.ctx, 'gkio-rnnoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('RNNoise não respondeu')), 8000);
      this.node.port.onmessage = (e) => {
        if (e.data?.type === 'ready') { clearTimeout(t); resolve(); }
        else if (e.data?.type === 'error') { clearTimeout(t); reject(new Error(e.data.message)); }
      };
    });
    const wasm = await loadWasm();
    this.node.port.postMessage({ type: 'init', wasm }, [wasm]);
    await ready;
    this.node.port.postMessage({ type: 'config', enabled: true, strength: this.strength });
    this.src = this.ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.dest = this.ctx.createMediaStreamDestination();
    this.src.connect(this.node).connect(this.dest);
    this.processedTrack = this.dest.stream.getAudioTracks()[0];
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }
  async restart(opts) { await this.destroy(); await this.init(opts); }
  setStrength(strength) {
    this.strength = strength;
    try { this.node?.port.postMessage({ type: 'config', strength }); } catch (e) { /* já destruído */ }
  }
  async destroy() {
    try { this.node?.port.postMessage({ type: 'destroy' }); } catch (e) { /* ok */ }
    try { this.src?.disconnect(); this.node?.disconnect(); } catch (e) { /* ok */ }
    try { await this.ctx?.close(); } catch (e) { /* ok */ }
    this.ctx = this.src = this.node = this.dest = null;
    this.processedTrack = undefined;
  }
}

let warnedAi = false;
/** Liga/desliga o RNNoise no microfone publicado, conforme as preferências. */
export async function applyMicProcessing(room, Track, onWarn = () => {}) {
  const pub = room?.localParticipant?.getTrackPublication?.(Track.Source.Microphone);
  const track = pub?.audioTrack;
  if (!track || typeof track.setProcessor !== 'function') return;
  const { noiseMode, aiStrength } = getMediaPrefs();
  const current = track.getProcessor?.();
  if (noiseMode !== 'ai') {
    if (current) { try { await track.stopProcessor(); } catch (e) { /* ok */ } }
    return;
  }
  if (!aiNoiseSupported()) {
    if (!warnedAi) { warnedAi = true; onWarn('Seu navegador não suporta supressão de ruído por IA; usando a do navegador.'); }
    return;
  }
  if (current && current.name === 'gkio-rnnoise') { current.setStrength?.(aiStrength || 'standard'); return; }
  try {
    await track.setProcessor(new RnnoiseProcessor(aiStrength || 'standard'));
  } catch (err) {
    console.warn('[voz] RNNoise falhou:', err?.message || err);
    try { await track.stopProcessor(); } catch (e) { /* ok */ }
    if (!warnedAi) { warnedAi = true; onWarn('Não foi possível ligar a supressão de ruído por IA; seu microfone segue normal.'); }
  }
}

// ---------- Efeitos de vídeo ----------
export const VIDEO_EFFECTS = [
  { id: 'none', label: 'Nenhum' },
  { id: 'blur', label: 'Desfocar fundo' },
  { id: 'blur-strong', label: 'Desfoque forte' },
  { id: 'bw', label: 'Preto e branco' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'warm', label: 'Quente' },
  { id: 'cool', label: 'Frio' },
  { id: 'vivid', label: 'Vívido' },
  { id: 'mirror', label: 'Espelhar' },
];
const FILTERS = {
  bw: 'grayscale(1) contrast(1.05)',
  sepia: 'sepia(0.85)',
  warm: 'sepia(0.25) saturate(1.25) hue-rotate(-12deg) brightness(1.03)',
  cool: 'saturate(1.1) hue-rotate(15deg) brightness(1.02)',
  vivid: 'saturate(1.6) contrast(1.1)',
};
export const videoFxSupported = () => {
  try { return typeof document !== 'undefined' && 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; }
};

/**
 * Desfoque "foco no centro": o fundo é desfocado e uma elipse central (onde você
 * fica) permanece nítida, com borda suave. Não usa IA/segmentação — se você sair
 * do centro do quadro, parte de você também desfoca.
 */
export class VideoFxProcessor {
  constructor(effect = 'blur') {
    this.name = 'gkio-videofx';
    this.effect = effect;
    this.processedTrack = undefined;
    this.video = null; this.canvas = null; this.ctx = null; this.mask = null;
    this.running = false; this.raf = 0;
  }
  async init(opts) {
    const settings = opts.track.getSettings?.() || {};
    const w0 = settings.width || 640; const h0 = settings.height || 480;
    const scale = Math.min(1, 960 / w0);
    this.w = Math.round(w0 * scale); this.h = Math.round(h0 * scale);
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
    this.video.srcObject = new MediaStream([opts.track]);
    await this.video.play().catch(() => {});
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.mask = document.createElement('canvas');
    this.mask.width = this.w; this.mask.height = this.h;
    const fps = Math.min(30, settings.frameRate || 30);
    this.processedTrack = this.canvas.captureStream(fps).getVideoTracks()[0];
    this.running = true;
    this.loop();
  }
  async restart(opts) { await this.destroy(); await this.init(opts); }
  setEffect(effect) { this.effect = effect; }
  loop() {
    if (!this.running) return;
    try { this.draw(); } catch (e) { /* quadro perdido */ }
    // requestVideoFrameCallback acompanha o ritmo da câmera; rAF é o plano B.
    if (this.video?.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => this.loop());
    else this.raf = requestAnimationFrame(() => this.loop());
  }
  draw() {
    const { ctx, video, w, h, effect } = this;
    if (!video || video.readyState < 2) return;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (effect === 'mirror') {
      ctx.translate(w, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
    } else if (effect === 'blur' || effect === 'blur-strong') {
      const px = effect === 'blur' ? Math.max(6, w / 70) : Math.max(12, w / 35);
      ctx.filter = `blur(${px}px)`;
      // desenha um pouco maior para a borda do desfoque não clarear
      ctx.drawImage(video, -px, -px, w + px * 2, h + px * 2);
      ctx.filter = 'none';
      const m = this.mask.getContext('2d');
      m.save();
      m.clearRect(0, 0, w, h);
      m.drawImage(video, 0, 0, w, h);
      m.globalCompositeOperation = 'destination-in';
      m.translate(w / 2, h * 0.52);
      m.scale(w * 0.36, h * 0.52);
      const g = m.createRadialGradient(0, 0, 0.62, 0, 0, 1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(-1.2, -1.2, 2.4, 2.4);
      m.restore();
      ctx.drawImage(this.mask, 0, 0);
    } else {
      ctx.filter = FILTERS[effect] || 'none';
      ctx.drawImage(video, 0, 0, w, h);
    }
    ctx.restore();
  }
  async destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.processedTrack?.stop(); } catch (e) { /* ok */ }
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = this.canvas = this.ctx = this.mask = null;
    this.processedTrack = undefined;
  }
}

/** Aplica o efeito escolhido nas preferências à câmera publicada. */
export async function applyVideoFx(room, Track, onWarn = () => {}) {
  const pub = room?.localParticipant?.getTrackPublication?.(Track.Source.Camera);
  const track = pub?.videoTrack;
  if (!track || typeof track.setProcessor !== 'function') return;
  const { videoFx } = getMediaPrefs();
  const current = track.getProcessor?.();
  if (!videoFx || videoFx === 'none') {
    if (current) { try { await track.stopProcessor(); } catch (e) { /* ok */ } }
    return;
  }
  if (!videoFxSupported()) { onWarn('Seu navegador não suporta efeitos de vídeo.'); return; }
  if (current && current.name === 'gkio-videofx') { current.setEffect(videoFx); return; }
  try { await track.setProcessor(new VideoFxProcessor(videoFx)); }
  catch (err) {
    console.warn('[vídeo] efeito falhou:', err?.message || err);
    try { await track.stopProcessor(); } catch (e) { /* ok */ }
    onWarn('Não foi possível aplicar o efeito de vídeo.');
  }
}

// ---------- Volume por pessoa ----------
const VOL_KEY = 'gkio-voice-volumes';
export const VOLUME_MAX = 200;
let volumes = (() => { try { return JSON.parse(localStorage.getItem(VOL_KEY) || '{}') || {}; } catch (e) { return {}; } })();
const saveVolumes = () => { try { localStorage.setItem(VOL_KEY, JSON.stringify(volumes)); } catch (e) { /* storage indisponível */ } };
const clampPct = (v) => Math.max(0, Math.min(VOLUME_MAX, Math.round(Number(v) || 0)));

export const getPersonVolume = (uid) => (uid in volumes ? clampPct(volumes[uid]) : 100);

let shareCtx = null;
const graphs = new WeakMap(); // <audio> -> { gain }
function ensureGraph(audioEl) {
  let g = graphs.get(audioEl);
  if (g) return g;
  try {
    shareCtx = shareCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = shareCtx.createMediaElementSource(audioEl);
    const gain = shareCtx.createGain();
    src.connect(gain).connect(shareCtx.destination);
    g = { gain };
    graphs.set(audioEl, g);
    if (shareCtx.state === 'suspended') shareCtx.resume().catch(() => {});
    return g;
  } catch (e) { return null; }
}
/** Aplica o volume guardado dessa pessoa a um <audio>. Até 100 % usa o próprio elemento; acima disso, um ganho do WebAudio. */
export function applyPersonVolume(audioEl, uid) {
  if (!audioEl) return;
  const pct = getPersonVolume(uid);
  const g = graphs.get(audioEl) || (pct > 100 ? ensureGraph(audioEl) : null);
  if (g) { audioEl.volume = 1; g.gain.gain.value = pct / 100; if (shareCtx?.state === 'suspended') shareCtx.resume().catch(() => {}); }
  else audioEl.volume = Math.min(1, pct / 100);
}
export function setPersonVolume(uid, pct, audioEl = null) {
  volumes[uid] = clampPct(pct);
  if (volumes[uid] === 100) delete volumes[uid];
  saveVolumes();
  applyPersonVolume(audioEl || document.getElementById(`gk-voice-audio-${uid}`), uid);
}

/** Pequeno painel com o controle de volume de uma pessoa (clique direito ou botão no participante). */
export function openVolumePopover(anchor, uid, name) {
  document.getElementById('gk-volume-popover')?.remove();
  const pop = document.createElement('div');
  pop.id = 'gk-volume-popover';
  pop.className = 'gk-volume-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Volume de ${name}`);
  const title = document.createElement('div'); title.className = 'gk-volume-title'; title.textContent = name;
  const row = document.createElement('div'); row.className = 'gk-volume-row';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = String(VOLUME_MAX); slider.step = '5';
  slider.value = String(getPersonVolume(uid)); slider.setAttribute('aria-label', `Volume de ${name}`);
  const label = document.createElement('span'); label.className = 'gk-volume-val';
  const upd = () => { label.textContent = slider.value === '0' ? 'Mudo' : `${slider.value}%`; };
  upd();
  slider.addEventListener('input', () => { setPersonVolume(uid, slider.value); upd(); });
  row.append(slider, label);
  const reset = document.createElement('button');
  reset.type = 'button'; reset.className = 'gk-btn'; reset.textContent = 'Restaurar 100%';
  reset.addEventListener('click', () => { slider.value = '100'; setPersonVolume(uid, 100); upd(); });
  pop.append(title, row, reset);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = 240;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left)) + 'px';
  pop.style.top = Math.min(window.innerHeight - 130, r.bottom + 6) + 'px';
  const close = (e) => {
    if (e && pop.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', close, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', onKey, true); }, 0);
  slider.focus();
}
