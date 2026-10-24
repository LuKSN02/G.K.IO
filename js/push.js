// ============================================================
// G.K.IO — Notificações push (via APK/Capacitor + FCM)
// ============================================================
// Só faz algo de verdade quando o app está rodando dentro do
// Capacitor no Android (ver isNativeAndroid em native-bridge.js) —
// no navegador, initPushNotifications() é um no-op seguro (o
// navegador já tem seu próprio aviso via Notification API, ver
// showDesktopNotification em prefs.js).
//
// Pré-requisitos pra isso funcionar de verdade no APK:
//   1. O projeto Android (Capacitor) precisa ter o plugin oficial
//      @capacitor/push-notifications instalado e o google-services.json
//      do Firebase (Project Settings -> seus apps -> app Android)
//      colocado em android/app/.
//   2. js/push-config.js precisa apontar pro Worker publicado
//      (ver cloudflare-worker/push-server.js).
//   3. firestore.rules precisa permitir o campo fcmToken no próprio
//      doc do usuário (já incluído — ver isValidSelfProfileEdit).
// ============================================================
import { auth, userDoc, getDoc, updateDoc, getIdToken } from './db.js';
import { toast } from './state.js';
import { isNativeAndroid } from './native-bridge.js';
import { pushConfig } from './push-config.js';
import { levelFromPrefs, shouldAlert } from './notify-prefs.js';

let onNotificationTap = null; // callback registrado por app.js (navega pra DM/canal certo)

export function onPushNotificationTap(cb) { onNotificationTap = cb; }
// Usado também pelas notificações de desktop (background-notify.js) para abrir a conversa certa.
export function triggerNotificationTap(data) { if (data && onNotificationTap) onNotificationTap(data); }

// Canal de notificação do Android (8+). Sem um canal de importância ALTA, o
// Android joga o push no canal padrão do FCM ("Diversos"): a notificação chega
// calada, sem aparecer na tela e, em vários celulares (Xiaomi, Samsung...),
// nem aparece. O mesmo id também vai em AndroidManifest (patch-android.js) e
// no Worker (push-server.js), pra funcionar mesmo com um dos lados desatualizado.
export const PUSH_CHANNEL_ID = 'gkio-messages';

let listenersAttached = false;
let registering = false;

function attachListeners(Push) {
  if (listenersAttached) return; // initPush pode rodar de novo (novo login) — não duplica listeners/toasts
  listenersAttached = true;

  // IMPORTANTE: os listeners precisam ser registrados ANTES de chamar
  // Push.register() — o evento 'registration' pode disparar rápido
  // demais e, se o listener ainda não estiver anexado, o token se perde.
  Push.addListener('registration', async (token) => {
    // Se o token chegar antes do login terminar, não perde: guarda e salva depois.
    pendingToken = token?.value || pendingToken;
    await savePendingToken();
  });
  Push.addListener('registrationError', (err) => {
    console.warn('[push] registrationError:', JSON.stringify(err));
  });

  // App aberto e em primeiro plano na hora que a notificação chega —
  // o Android não mostra a notificação sozinho nesse caso, então
  // avisamos com um toast em vez de deixar a pessoa sem nada.
  Push.addListener('pushNotificationReceived', (notification) => {
    toast(`${notification.title || 'Nova mensagem'}: ${notification.body || ''}`);
  });

  // Pessoa tocou na notificação (app em segundo plano/fechado) —
  // repassa pro app.js decidir pra onde navegar.
  Push.addListener('pushNotificationActionPerformed', (action) => {
    const data = action.notification?.data;
    if (data && onNotificationTap) onNotificationTap(data);
  });
}

let pendingToken = null;
async function savePendingToken() {
  if (!pendingToken || !auth.currentUser) return;
  try {
    await updateDoc(userDoc(auth.currentUser.uid), { fcmToken: pendingToken });
  } catch (e) {
    console.warn('[push] Falhou ao salvar fcmToken:', e.message);
  }
}

async function registerDevice(Push) {
  if (registering) return;
  registering = true;
  try {
    // Canal ANTES de registrar (e antes de qualquer push chegar).
    try {
      await Push.createChannel({
        id: PUSH_CHANNEL_ID,
        name: 'Mensagens',
        description: 'Mensagens diretas e de canais',
        importance: 5, // máxima: som + aparece na tela (heads-up)
        visibility: 1,
        vibration: true,
        lights: true,
      });
    } catch (e) { console.warn('[push] createChannel:', e.message); }

    const perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') {
      const req = await Push.requestPermissions();
      if (req.receive !== 'granted') return; // pessoa negou — respeita e não insiste
    }
    await Push.register();
  } catch (e) {
    console.warn('[push] Erro em checkPermissions/register:', e.message);
  } finally {
    registering = false;
  }
}

export async function initPushNotifications() {
  if (!isNativeAndroid()) return; // web fica só com showDesktopNotification (prefs.js)
  const Push = window.Capacitor?.Plugins?.PushNotifications;
  if (!Push) return; // plugin não instalado nessa build do APK ainda

  attachListeners(Push);
  await savePendingToken(); // caso o token já tenha chegado antes deste login
  await registerDevice(Push);

  // O Android pode ter matado o app ou a pessoa pode ter liberado a permissão
  // de notificações nas configurações: ao voltar pro app, confere de novo e
  // garante que o token atual está salvo (o token do FCM também muda de vez em quando).
  if (!initPushNotifications._resumeWired) {
    initPushNotifications._resumeWired = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && auth.currentUser) registerDevice(Push);
    });
  }
}

// Ao sair da conta, solta o token deste aparelho — senão ele continuaria
// no doc de quem saiu e as notificações dessa conta seguiriam chegando aqui.
export async function clearPushToken() {
  if (!isNativeAndroid() || !auth.currentUser) return;
  try { await updateDoc(userDoc(auth.currentUser.uid), { fcmToken: null }); } catch (e) { /* best-effort */ }
  pendingToken = null;
}

// Best-effort: nunca deixa uma falha no push derrubar o envio da
// mensagem em si (ver chat.js) — por isso todo erro aqui só vai pro
// console, nunca pra um toast que a pessoa que está enviando veria.
async function sendPushToUid(uid, { title, body, data, filter }) {
  if (!pushConfig.tokenEndpoint || pushConfig.tokenEndpoint.startsWith('COLE_AQUI')) return;
  if (!auth.currentUser || uid === auth.currentUser.uid) return;
  try {
    const snap = await getDoc(userDoc(uid));
    const userData = snap.exists() ? snap.data() : null;
    const fcmToken = userData ? userData.fcmToken : null;
    if ((userData.blockedUids || []).includes(auth.currentUser.uid)) return; // quem recebe me bloqueou: sem push
    if (!fcmToken) return; // pessoa nunca abriu o APK (ou push ainda não registrou) — nada a fazer
    // Quem recebe pode ter silenciado essa conversa (ou pedido só @menções).
    if (filter && !shouldAlert(levelFromPrefs(userData.notifPrefs, filter.ctx), filter.mentioned)) return;

    const idToken = await getIdToken(auth.currentUser);
    const res = await fetch(pushConfig.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ token: fcmToken, title, body, data }),
    });
    if (!res.ok) {
      const resBody = await res.text().catch(() => '(sem corpo)');
      console.warn(`[push] Worker respondeu ${res.status}:`, resBody);
    }
  } catch (e) {
    console.warn('[push] Erro no fetch pro Worker:', e.message);
  }
}

// Chamada por chat.js depois de enviar uma DM.
export function notifyDmMessage(otherUid, { authorName, preview, dmId }) {
  sendPushToUid(otherUid, {
    title: authorName || 'Nova mensagem',
    body: preview || 'Enviou uma mensagem.',
    data: { type: 'dm', dmId },
    filter: { ctx: { dmId }, mentioned: false },
  });
}

// Chamada por chat.js depois de enviar uma mensagem de canal — avisa
// todo mundo do servidor, exceto quem mandou (best-effort, em paralelo).
export function notifyChannelMessage(memberUids, { authorName, preview, serverId, channelId, channelName, mentionedUids = [] }) {
  for (const uid of memberUids) {
    sendPushToUid(uid, {
      title: `${authorName} em #${channelName}`,
      body: preview || 'Enviou uma mensagem.',
      data: { type: 'channel', serverId, channelId },
      filter: { ctx: { serverId, channelId }, mentioned: mentionedUids.includes(uid) },
    });
  }
}
