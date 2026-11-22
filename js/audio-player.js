// ============================================================
// Player de arquivos de áudio enviados como anexo (mp3, m4a, wav, ogg…).
// Cartão no estilo do Discord: nome do arquivo, play/pausa, tempo, barra de
// progresso e volume. (Mensagens de voz continuam usando voice-messages.js.)
// ============================================================
import { el } from './state.js';
import { icon } from './icons.js';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|wma|amr)(\?|#|$)/i;
export const isAudioFile = (att) => !!att && (att.type === 'audio' || AUDIO_EXT.test(att.name || '') || AUDIO_EXT.test(att.url || ''));

// Mantém o mesmo <audio> entre redesenhos da lista de mensagens (a lista inteira é
// refeita a cada mudança) — senão a música cortaria toda vez que chega algo novo.
const audios = new Map();
let playing = null;

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const fmtSize = (b) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

export function buildAudioFilePlayer(att) {
  let audio = audios.get(att.url);
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.src = att.url;
    audios.set(att.url, audio);
  }

  const playBtn = el('button', { class: 'gk-ap2-play', type: 'button', 'aria-label': 'Reproduzir' });
  const time = el('span', { class: 'gk-ap2-time' }, '0:00 / 0:00');
  const bar = el('input', { class: 'gk-ap2-seek', type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Posição do áudio' });
  const volBtn = el('button', { class: 'gk-ap2-vol', type: 'button', 'aria-label': 'Silenciar' });
  const vol = el('input', { class: 'gk-ap2-volbar', type: 'range', min: '0', max: '100', value: String(Math.round(audio.volume * 100)), 'aria-label': 'Volume' });

  const sizeTxt = fmtSize(att.size);
  const card = el('div', { class: 'gk-ap2' }, [
    el('div', { class: 'gk-ap2-head' }, [
      el('div', { class: 'gk-ap2-ico' }, [icon('speaker', { size: 20 })]),
      el('div', { class: 'gk-ap2-meta' }, [
        el('a', { class: 'gk-ap2-name', href: att.url, target: '_blank', rel: 'noopener', title: att.name || 'Áudio' }, att.name || 'Áudio'),
        sizeTxt ? el('div', { class: 'gk-ap2-size' }, sizeTxt) : null,
      ].filter(Boolean)),
    ]),
    el('div', { class: 'gk-ap2-ctl' }, [playBtn, time, bar, volBtn, vol]),
  ]);

  const paint = () => {
    if (!card.isConnected && card.__dead) return;
    const d = audio.duration, c = audio.currentTime;
    time.textContent = `${fmt(c)} / ${fmt(d)}`;
    if (!bar.__drag) bar.value = Number.isFinite(d) && d > 0 ? String(Math.round((c / d) * 1000)) : '0';
    bar.style.setProperty('--p', (Number(bar.value) / 10) + '%');
    const on = !audio.paused && !audio.ended;
    playBtn.replaceChildren(icon(on ? 'pause' : 'play', { size: 18 }));
    playBtn.setAttribute('aria-label', on ? 'Pausar' : 'Reproduzir');
    const muted = audio.muted || audio.volume === 0;
    volBtn.replaceChildren(icon(muted ? 'speakerMute' : 'speaker', { size: 18 }));
    vol.style.setProperty('--p', (muted ? 0 : audio.volume * 100) + '%');
  };

  // Ouvintes do <audio> são do cartão atual; os de cartões já removidos da tela se desligam sozinhos.
  const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended', 'volumechange'];
  const onEvt = () => {
    if (!card.isConnected && card.__seen) { events.forEach((e) => audio.removeEventListener(e, onEvt)); card.__dead = true; return; }
    if (card.isConnected) card.__seen = true;
    paint();
  };
  events.forEach((e) => audio.addEventListener(e, onEvt));

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      audio.play().catch(() => {});
    } else audio.pause();
  });
  bar.addEventListener('input', () => {
    bar.__drag = true;
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(bar.value) / 1000) * audio.duration;
    paint();
  });
  bar.addEventListener('change', () => { bar.__drag = false; });
  volBtn.addEventListener('click', () => { audio.muted = !audio.muted; });
  vol.addEventListener('input', () => { audio.muted = false; audio.volume = Number(vol.value) / 100; });

  paint();
  return card;
}
