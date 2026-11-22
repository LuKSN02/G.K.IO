// ============================================================
// G.K.IO — Push no navegador / PWA (FCM Web) com o site FECHADO
// ============================================================
// Mesmo caminho do Android: o token FCM fica no doc do usuário e o envio passa
// pelo Cloudflare Worker (sem Blaze, sem Cloud Functions). Aqui só cuidamos do
// lado do navegador: pedir permissão, obter o token e guardá-lo em `webTokens`
// (lista — a pessoa pode ter vários navegadores).
//
// Fica INERTE até você colar a chave VAPID em js/push-config.js (Console do
// Firebase → Configurações → Cloud Messaging → Certificados Web Push).
// No app Electron não existe serviço de push do navegador: lá continua o aviso
// normal do app (bandeja + overlay).
// ============================================================
import { auth, app as firebaseApp, userDoc, getDoc, updateDoc, arrayRemove } from './db.js';
import { isNativeAndroid } from './native-bridge.js';
import { pushConfig } from './push-config.js';
import { triggerNotificationTap } from './push.js';

const FLAG = 'gkio-webpush';
const MSG_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
const MAX_TOKENS = 8; // por pessoa; os mais antigos saem

const vapid = () => pushConfig.webVapidKey && !String(pushConfig.webVapidKey).startsWith('COLE_AQUI') ? pushConfig.webVapidKey : null;
const getFlag = () => { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } };
const setFlag = (v) => { try { v ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch (e) { /* noop */ } };
const myToken = () => { try { return localStorage.getItem(FLAG + '-token') || null; } catch (e) { return null; } };
const setMyToken = (t) => { try { t ? localStorage.setItem(FLAG + '-token', t) : localStorage.removeItem(FLAG + '-token'); } catch (e) { /* noop */ } };

export function isWebPushSupported() {
  return !isNativeAndroid() && !window.gkioDesktop
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function isWebPushConfigured() { return !!vapid(); }
export function isWebPushOn() { return isWebPushSupported() && getFlag() && Notification.permission === 'granted'; }

async function obtainToken() {
  const reg = await navigator.serviceWorker.ready;
  const { getMessaging, getToken } = await import(MSG_SDK);
  return getToken(getMessaging(firebaseApp), { vapidKey: vapid(), serviceWorkerRegistration: reg });
}

async function storeToken(token) {
  if (!token || !auth.currentUser) return;
  const ref = userDoc(auth.currentUser.uid);
  const snap = await getDoc(ref);
  let list = (snap.exists() && Array.isArray(snap.data().webTokens)) ? snap.data().webTokens : [];
  if (list.includes(token)) { setMyToken(token); return; }
  list = [...list, token].slice(-MAX_TOKENS);
  await updateDoc(ref, { webTokens: list });
  setMyToken(token);
}

// Liga (pede permissão se precisar). Retorna 'ok' | 'denied' | 'unsupported' | 'not-configured' | 'error'.
export async function enableWebPush() {
  if (!isWebPushSupported()) return 'unsupported';
  if (!vapid()) return 'not-configured';
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    await storeToken(await obtainToken());
    setFlag(true);
    return 'ok';
  } catch (e) {
    console.warn('[web-push] falhou ao ativar:', e.message);
    return 'error';
  }
}

export async function disableWebPush() {
  setFlag(false);
  const t = myToken();
  setMyToken(null);
  if (t && auth.currentUser) { try { await updateDoc(userDoc(auth.currentUser.uid), { webTokens: arrayRemove(t) }); } catch (e) { /* best-effort */ } }
  try {
    const { getMessaging, deleteToken } = await import(MSG_SDK);
    await deleteToken(getMessaging(firebaseApp));
  } catch (e) { /* noop */ }
}

// Ao entrar: se a pessoa já tinha ativado, confere/renova o token em silêncio.
export async function initWebPush() {
  if (!isWebPushSupported()) return;
  // Toque numa notificação: o service worker avisa a aba (ou abre uma nova com ?gk-open=...)
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'gkio-notif-tap') triggerNotificationTap(ev.data.data);
  });
  try {
    const q = new URLSearchParams(location.search).get('gk-open');
    if (q) { history.replaceState(null, '', location.pathname); setTimeout(() => triggerNotificationTap(JSON.parse(q)), 1500); }
  } catch (e) { /* noop */ }
  if (!vapid() || !getFlag() || Notification.permission !== 'granted') return;
  try { await storeToken(await obtainToken()); } catch (e) { console.warn('[web-push] renovação falhou:', e.message); }
}

// Ao sair da conta: este navegador deixa de receber os avisos dessa conta.
export async function clearWebPushToken() {
  const t = myToken();
  if (!t || !auth.currentUser) return;
  try { await updateDoc(userDoc(auth.currentUser.uid), { webTokens: arrayRemove(t) }); } catch (e) { /* best-effort */ }
  setMyToken(null);
}
