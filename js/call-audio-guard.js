// ============================================================
// G.K.IO — Guarda do áudio da chamada (celular)
//
// Problema que resolve: no navegador do celular, com o app em segundo plano (ou
// com a tela apagada), quando alguém entra/sai da chamada o áudio remoto "morre":
//  1. o <audio> da pessoa que saiu era REMOVIDO e, quando ela voltava, um <audio>
//     NOVO era criado — o celular só deixa um elemento novo tocar se houver um
//     toque do usuário naquele momento (em segundo plano não há), então o play()
//     era recusado e a pessoa ficava ouvindo silêncio;
//  2. o sistema (ligação, outro app, fone Bluetooth, bloqueio de tela) pausa os
//     <audio> ou suspende o AudioContext e ninguém os religa;
//  3. o aviso "toque na tela" só reagia a `click`, que não existe em tudo no celular.
//
// Como resolve:
//  • elementos <audio> são REAPROVEITADOS (nunca destruídos durante a chamada) — um
//    elemento que já tocou uma vez continua "liberado" para tocar sem novo toque;
//  • um vigia religa tudo: ao voltar ao app, a cada gesto na tela, quando alguém
//    entra/sai, quando o sistema pausa um <audio>, e a cada 1,5 s enquanto durar a chamada;
//  • sessão de áudio "play-and-record" (iOS) e MediaSession "tocando" (Android) avisam o
//    sistema de que é uma chamada e não deve cortar o som em segundo plano.
// ============================================================
import { resumeAudioContexts } from './voice-fx.js';

let getRoom = () => null;
let getDeafened = () => false;
let getScreenEls = () => [];
let onNeedGesture = () => {};
let timer = 0;
let healthTimer = 0;
let soonTimer = 0;
let active = false;
const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'];

/** Todos os <audio> da chamada (voz, DM e áudio de tela). */
function allAudioEls() {
  const els = new Set(document.querySelectorAll('audio[data-gk-audio]'));
  getScreenEls().forEach((a) => els.add(a));
  return [...els];
}

/** Religa o que estiver parado. Seguro de chamar à vontade. */
export async function kick() {
  if (!active) return;
  const room = getRoom();
  if (!room) return;
  resumeAudioContexts();
  if (keepEl && keepEl.paused) keepEl.play().catch(() => {});
  try { if (!room.canPlaybackAudio) await room.startAudio(); } catch (e) { /* segue */ }
  let blocked = false;
  const deaf = getDeafened();
  for (const el of allAudioEls()) {
    if (!el.srcObject) continue;                 // elemento livre (ninguém falando nele)
    if (el.muted !== deaf) el.muted = deaf;       // mantém "ensurdecer" coerente
    if (el.paused) {
      try { await el.play(); } catch (e) { blocked = true; }
    }
  }
  if (blocked) { showBanner(); onNeedGesture(); } else hideBanner();
}

// ---------- aviso fixo "Toque para ativar o som" ----------
let banner = null;
function showBanner() {
  if (banner || !document.body) return;
  banner = document.createElement('button');
  banner.type = 'button';
  banner.textContent = '🔊 Toque aqui para ativar o som da chamada';
  banner.setAttribute('style', 'position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);z-index:100000;padding:12px 18px;border:0;border-radius:999px;background:#ef4444;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:92vw');
  banner.addEventListener('click', () => { rebuildAll(); });
  document.body.appendChild(banner);
}
function hideBanner() { if (banner) { banner.remove(); banner = null; } }

/** Religa do zero cada <audio> que tem som: reatribui o stream e manda tocar (use dentro de um toque). */
export async function rebuildAll() {
  for (const el of allAudioEls()) {
    const st = el.srcObject; if (!st) continue;
    el.srcObject = null; el.srcObject = st;
    try { await el.play(); } catch (e) { /* o próximo toque tenta de novo */ }
  }
  await kick();
}

// ---------- vigia de "stream morto" ----------
// Mesmo com o elemento tocando, o áudio pode estar mudo porque o celular derrubou a
// conexão enquanto o app estava em segundo plano e nenhum pacote chega mais.
// Aqui medimos de verdade: se os bytes recebidos não aumentam (e a pessoa não está
// no mudo), reassinamos a track; se o relógio do <audio> não anda, reatribuímos o stream.
const seen = new Map();      // track -> { bytes, still, at }
const clocks = new WeakMap(); // el -> { t, still }
async function health() {
  const room = getRoom();
  if (!active || !room || !room.remoteParticipants) return;
  const now = Date.now();
  for (const part of room.remoteParticipants.values()) {
    for (const pub of part.audioTrackPublications.values()) {
      const tr = pub.track;
      if (!tr || pub.isMuted || !tr.getReceiverStats) { if (tr) seen.delete(tr); continue; }
      let st; try { st = await tr.getReceiverStats(); } catch (e) { continue; }
      if (!st || typeof st.bytesReceived !== 'number') continue;
      const prev = seen.get(tr) || { bytes: -1, still: 0, at: 0 };
      if (st.bytesReceived === prev.bytes) prev.still += 1; else prev.still = 0;
      prev.bytes = st.bytesReceived;
      if (prev.still >= 3 && now - prev.at > 20000) {   // ~9 s sem receber nada
        prev.at = now; prev.still = 0;
        try { pub.setSubscribed(false); setTimeout(() => { try { pub.setSubscribed(true); } catch (e) { /* ok */ } }, 400); } catch (e) { /* ok */ }
      }
      seen.set(tr, prev);
    }
  }
  for (const el of allAudioEls()) {
    if (!el.srcObject || el.paused) { clocks.delete(el); continue; }
    const c = clocks.get(el) || { t: -1, still: 0 };
    if (el.currentTime === c.t) c.still += 1; else c.still = 0;
    c.t = el.currentTime;
    if (c.still >= 2) {                                   // ~6 s com o relógio parado
      c.still = 0;
      const stream = el.srcObject; el.srcObject = null; el.srcObject = stream;
      el.play().catch(() => { showBanner(); });
    }
    clocks.set(el, c);
  }
}

/** Agenda um kick curto (agrupa vários eventos seguidos). */
export function kickSoon(ms = 120) {
  if (!active) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(kick, ms);
}

/**
 * Pega (ou cria) o <audio> com esse id e liga a track nele.
 * Reaproveita elementos livres para não depender de um novo toque do usuário.
 */
export function acquireAudioEl(id, track) {
  let el = document.getElementById(id);
  if (!el) {
    el = [...document.querySelectorAll('audio[data-gk-audio]')].find((a) => !a.srcObject) || null;
    if (el) el.id = id;
  }
  if (el) {
    track.attach(el);
  } else {
    el = track.attach();
    el.id = id;
    el.setAttribute('data-gk-audio', '1');
    el.setAttribute('playsinline', '');
    el.autoplay = true;
    el.addEventListener('pause', () => { if (active && el.srcObject) kickSoon(250); });
    el.addEventListener('stalled', () => kickSoon(500));
    document.body.appendChild(el);
  }
  return el;
}

/** Solta a track do(s) <audio> mas MANTÉM o elemento para ser reaproveitado. */
export function releaseAudioTrack(track) {
  track.detach().forEach((n) => {
    if (n.hasAttribute?.('data-gk-audio')) { n.srcObject = null; } else n.remove();
  });
}

/** Libera o elemento de uma pessoa que saiu (sem destruí-lo). */
export function releaseAudioEl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.hasAttribute('data-gk-audio')) { try { el.pause(); } catch (e) { /* ok */ } el.srcObject = null; el.id = ''; }
  else el.remove();
}

/** Apaga de vez os elementos (só quando a chamada termina). */
export function destroyAudioEls() {
  document.querySelectorAll('audio[data-gk-audio]').forEach((n) => { try { n.pause(); } catch (e) { /* ok */ } n.srcObject = null; n.remove(); });
}

function onVisible() { if (!document.hidden) kick(); else kickSoon(400); }
const onGesture = () => { kick(); };

// ---------- manter a aba viva (Chrome do celular) ----------
// O Chrome Android congela abas em segundo plano (timers a 1/min, conexão pausada), mas poupa as
// que estão TOCANDO ÁUDIO e mostra a notificação de mídia. Quando ninguém fala, não há som nenhum
// tocando; então mantemos um chiado inaudível (≈ -55 dB) em loop, só durante a chamada.
let keepEl = null;
function silentWavUrl() {
  const rate = 8000, secs = 6, n = rate * secs, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round((Math.random() * 2 - 1) * 55), true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function startKeepAliveAudio() {
  if (keepEl) return;
  try {
    keepEl = document.createElement('audio');
    keepEl.src = silentWavUrl(); keepEl.loop = true; keepEl.setAttribute('playsinline', ''); keepEl.setAttribute('data-gk-keepalive', '1');
    document.body.appendChild(keepEl);
    keepEl.play().catch(() => { /* o próximo toque (gesto) reinicia pelo vigia */ });
  } catch (e) { keepEl = null; }
}
function stopKeepAliveAudio() {
  if (!keepEl) return;
  try { keepEl.pause(); URL.revokeObjectURL(keepEl.src); keepEl.remove(); } catch (e) { /* ok */ }
  keepEl = null;
}

function setupSession() {
  startKeepAliveAudio();
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* iOS antigo */ }
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Chamada em andamento', artist: 'G.K.IO' });
      navigator.mediaSession.playbackState = 'playing';
      // O sistema às vezes manda "pause" (ligação, fone). Ignoramos: numa chamada o áudio não pausa.
      for (const act of ['play', 'pause']) {
        try { navigator.mediaSession.setActionHandler(act, () => { navigator.mediaSession.playbackState = 'playing'; kick(); }); } catch (e) { /* sem suporte */ }
      }
    }
  } catch (e) { /* sem MediaSession */ }
}
function teardownSession() {
  stopKeepAliveAudio();
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      for (const act of ['play', 'pause']) { try { navigator.mediaSession.setActionHandler(act, null); } catch (e) { /* ok */ } }
    }
  } catch (e) { /* ok */ }
}

export function startAudioGuard(opts) {
  getRoom = opts.getRoom; getDeafened = opts.getDeafened; getScreenEls = opts.getScreenEls || (() => []);
  onNeedGesture = opts.onNeedGesture || (() => {});
  if (active) return;
  active = true;
  setupSession();
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('pageshow', onVisible);
  addEventListener('focus', onVisible);
  addEventListener('online', onVisible);
  GESTURES.forEach((g) => document.addEventListener(g, onGesture, { capture: true, passive: true }));
  timer = setInterval(kick, 1500);
  healthTimer = setInterval(health, 3000);
  kick();
}

export function stopAudioGuard() {
  if (!active) return;
  active = false;
  clearInterval(timer); clearInterval(healthTimer); clearTimeout(soonTimer); hideBanner(); seen.clear();
  document.removeEventListener('visibilitychange', onVisible);
  removeEventListener('pageshow', onVisible);
  removeEventListener('focus', onVisible);
  removeEventListener('online', onVisible);
  GESTURES.forEach((g) => document.removeEventListener(g, onGesture, { capture: true }));
  teardownSession();
}
