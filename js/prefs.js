// ============================================================
// G.K.IO — Preferências persistentes (mídia + notificações)
// Módulo isolado para evitar dependências circulares entre
// calls.js, chat.js e settings.js.
// ============================================================

const MEDIA_KEY = 'gkio-media-prefs';
const NOTIF_KEY = 'gkio-notif-prefs';

const mediaDefaults = {
  micId: '', camId: '', speakerId: '',
  noiseSuppression: true, echoCancellation: true, autoGainControl: true,
  // noiseMode: 'browser' (padrão do navegador) | 'ai' (RNNoise, ver voice-fx.js) | 'off'
  noiseMode: 'browser', aiStrength: 'standard',
  videoFx: 'none', // efeito da câmera (ver VIDEO_EFFECTS em voice-fx.js)
  screenQuality: 'fluid',
};
// No app de desktop (Electron) o aviso do sistema já vem ligado — é o que se espera de um app instalado.
const notifDefaults = { sound: true, desktop: !!window.gkioDesktop, preview: true };
const HOTKEY_KEY = 'gkio-hotkey-prefs';
const IDLE_KEY = 'gkio-idle-prefs';
const hotkeyDefaults = { mute: 'Ctrl+Shift+M', deafen: 'Ctrl+Shift+D', ptt: '', pttEnabled: false };
const idleDefaults = { enabled: true, minutes: 10 };

function read(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch (e) { return { ...defaults }; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage indisponível */ }
}

let mediaPrefs = read(MEDIA_KEY, mediaDefaults);
let notifPrefs = read(NOTIF_KEY, notifDefaults);
let hotkeyPrefs = read(HOTKEY_KEY, hotkeyDefaults);
let idlePrefs = read(IDLE_KEY, idleDefaults);

export function getMediaPrefs() { return { ...mediaPrefs }; }

// ---------- Qualidade da transmissão de tela ----------
// O padrão do LiveKit (1080p, várias camadas de codificação, prioridade para
// manter a resolução) sobrecarrega o PC de quem transmite e derruba os
// quadros por segundo — dá a sensação de "lag". Estes perfis trocam
// nitidez por fluidez conforme o uso. Vale para a próxima transmissão iniciada.
export const SCREEN_QUALITIES = {
  fluid:    { label: 'Fluida — jogos e vídeos (720p, 30 fps)', width: 1280, height: 720,  fps: 30, bitrate: 2_500_000, hint: 'motion', degrade: 'maintain-framerate' },
  balanced: { label: 'Equilibrada (1080p, 30 fps)',            width: 1920, height: 1080, fps: 30, bitrate: 5_000_000, hint: 'motion', degrade: 'balanced' },
  sharp:    { label: 'Nítida — texto e slides (1080p, 15 fps)', width: 1920, height: 1080, fps: 15, bitrate: 3_000_000, hint: 'detail', degrade: 'maintain-resolution' },
  hd60:     { label: 'Fluida 60 fps (720p, 60 fps) — jogos rápidos', width: 1280, height: 720,  fps: 60, bitrate: 4_500_000, hint: 'motion', degrade: 'maintain-framerate' },
  ultra:    { label: 'Máxima (1080p, 60 fps) — exige PC e internet fortes', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000, hint: 'motion', degrade: 'maintain-framerate' },
};
// Opções prontas para room.localParticipant.setScreenShareEnabled(true, { audio: true, ...capture }, publish)
export function screenShareOptions() {
  const q = SCREEN_QUALITIES[mediaPrefs.screenQuality] || SCREEN_QUALITIES.fluid;
  return {
    capture: { resolution: { width: q.width, height: q.height, frameRate: q.fps }, contentHint: q.hint },
    publish: {
      screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.fps },
      screenShareSimulcastLayers: [], // uma camada só: codificar várias ao mesmo tempo pesa no PC
      degradationPreference: q.degrade,
    },
  };
}
export function setMediaPrefs(patch) {
  mediaPrefs = { ...mediaPrefs, ...patch };
  write(MEDIA_KEY, mediaPrefs);
  window.dispatchEvent(new CustomEvent('gkio-media-prefs-changed', { detail: patch })); // a chamada em andamento reaplica ruído/efeito de vídeo
}

export function getNotifPrefs() { return { ...notifPrefs }; }
export function setNotifPrefs(patch) {
  notifPrefs = { ...notifPrefs, ...patch };
  write(NOTIF_KEY, notifPrefs);
}

export function getHotkeyPrefs() { return { ...hotkeyPrefs }; }
export function setHotkeyPrefs(patch) {
  hotkeyPrefs = { ...hotkeyPrefs, ...patch };
  write(HOTKEY_KEY, hotkeyPrefs);
  window.dispatchEvent(new CustomEvent('gkio-hotkeys-changed'));
}
export function getIdlePrefs() { return { ...idlePrefs }; }
export function setIdlePrefs(patch) {
  idlePrefs = { ...idlePrefs, ...patch };
  write(IDLE_KEY, idlePrefs);
}

export async function listMediaDevices() {
  try {
    // Pede permissão rapidamente para revelar labels dos dispositivos (senão vêm vazios).
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => null);
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (tmp) tmp.getTracks().forEach((t) => t.stop());
    return {
      mics: devices.filter((d) => d.kind === 'audioinput'),
      cams: devices.filter((d) => d.kind === 'videoinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
    };
  } catch (e) {
    return { mics: [], cams: [], speakers: [] };
  }
}

export function playNotifSound() {
  if (!notifPrefs.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close();
  } catch (e) { /* AudioContext indisponível */ }
}

export async function requestDesktopPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export function showDesktopNotification(title, body, icon, onClick) {
  if (!notifPrefs.desktop) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Só fica quieto se a janela está visível E com foco: janela aberta atrás de
  // outros programas continua "visible" para o navegador, e antes disso
  // ninguém era avisado nesse caso.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const hide = !notifPrefs.preview || document.documentElement.hasAttribute('data-streamer'); // modo streamer nunca mostra prévia
    const n = new Notification(title, { body: hide ? 'Nova mensagem' : body, icon });
    // No app de desktop (Electron), clicar na notificação restaura/foca
    // a janela — no navegador comum, foca a aba. window.focus() é a API
    // padrão pros dois casos.
    n.onclick = () => { try { window.gkioDesktop?.showWindow(); window.focus(); if (onClick) onClick(); } catch (e) {} };
  } catch (e) {}
}
