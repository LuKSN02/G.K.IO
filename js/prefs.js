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
};
const notifDefaults = { sound: true, desktop: false, preview: true };

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

export function getMediaPrefs() { return { ...mediaPrefs }; }
export function setMediaPrefs(patch) {
  mediaPrefs = { ...mediaPrefs, ...patch };
  write(MEDIA_KEY, mediaPrefs);
}

export function getNotifPrefs() { return { ...notifPrefs }; }
export function setNotifPrefs(patch) {
  notifPrefs = { ...notifPrefs, ...patch };
  write(NOTIF_KEY, notifPrefs);
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

export function showDesktopNotification(title, body, icon) {
  if (!notifPrefs.desktop) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body: notifPrefs.preview ? body : 'Nova mensagem', icon });
    // No app de desktop (Electron), clicar na notificação restaura/foca
    // a janela — no navegador comum, foca a aba. window.focus() é a API
    // padrão pros dois casos.
    n.onclick = () => { try { window.focus(); } catch (e) {} };
  } catch (e) {}
}
