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
import { state, toast } from './state.js';
import { isNativeAndroid } from './native-bridge.js';
import { pushConfig } from './push-config.js';

let onNotificationTap = null; // callback registrado por app.js (navega pra DM/canal certo)

export function onPushNotificationTap(cb) { onNotificationTap = cb; }

export async function initPushNotifications() {
  if (!isNativeAndroid()) return; // web fica só com showDesktopNotification (prefs.js)
  const Push = window.Capacitor?.Plugins?.PushNotifications;
  if (!Push) return; // plugin não instalado nessa build do APK ainda

  try {
    const perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') {
      const req = await Push.requestPermissions();
      if (req.receive !== 'granted') return; // pessoa negou — respeita e não insiste
    }
    await Push.register();
  } catch (e) { return; /* plugin indisponível nessa build — segue sem push */ }

  Push.addListener('registration', async (token) => {
    if (!auth.currentUser || !token?.value) return;
    try { await updateDoc(userDoc(auth.currentUser.uid), { fcmToken: token.value }); } catch (e) { /* melhor tentar de novo no próximo login do que travar o app */ }
  });
  Push.addListener('registrationError', () => { /* sem sorte nessa tentativa — próximo login tenta de novo */ });

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

// Best-effort: nunca deixa uma falha no push derrubar o envio da
// mensagem em si (ver chat.js) — por isso todo erro aqui é engolido.
async function sendPushToUid(uid, { title, body, data }) {
  if (!pushConfig.tokenEndpoint || pushConfig.tokenEndpoint.startsWith('COLE_AQUI')) return;
  if (!auth.currentUser || uid === auth.currentUser.uid) return;
  try {
    const snap = await getDoc(userDoc(uid));
    const fcmToken = snap.exists() ? snap.data().fcmToken : null;
    if (!fcmToken) return; // pessoa nunca abriu o APK (ou push ainda não registrou) — nada a fazer

    const idToken = await getIdToken(auth.currentUser);
    await fetch(pushConfig.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ token: fcmToken, title, body, data }),
    });
  } catch (e) { /* notificação é best-effort — a mensagem já foi enviada de verdade */ }
}

// Chamada por chat.js depois de enviar uma DM.
export function notifyDmMessage(otherUid, { authorName, preview, dmId }) {
  sendPushToUid(otherUid, {
    title: authorName || 'Nova mensagem',
    body: preview || 'Enviou uma mensagem.',
    data: { type: 'dm', dmId },
  });
}

// Chamada por chat.js depois de enviar uma mensagem de canal — avisa
// todo mundo do servidor, exceto quem mandou (best-effort, em paralelo).
export function notifyChannelMessage(memberUids, { authorName, preview, serverId, channelId, channelName }) {
  for (const uid of memberUids) {
    sendPushToUid(uid, {
      title: `${authorName} em #${channelName}`,
      body: preview || 'Enviou uma mensagem.',
      data: { type: 'channel', serverId, channelId },
    });
  }
}
