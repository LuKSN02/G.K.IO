// ============================================================
// G.K.IO — Ponte com plugins nativos Android (Capacitor)
// Tudo aqui só faz algo de verdade quando o app está rodando dentro
// do Capacitor no Android — em qualquer outro ambiente (navegador,
// Electron/desktop), essas funções são no-ops seguros.
// ============================================================

export function isNativeAndroid() {
  return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
}

// ---------- Modo de áudio de chamada (corrige eco) ----------

// Idempotente: só liga o modo uma vez por chamada. Isso permite chamar
// antes de abrir o microfone (ordem importa no Android: trocar o modo de
// áudio DEPOIS que o mic já começou a capturar pode deixar a captura muda)
// e de novo mais tarde sem reiniciar o modo no meio da conversa.
let callAudioModeOn = false;
export async function startCallAudioMode() {
  if (!isNativeAndroid() || callAudioModeOn) return;
  callAudioModeOn = true;
  try { await window.Capacitor.Plugins.CallAudio.startCallMode({ speaker: true }); } catch (e) { /* plugin pode não estar disponível numa build antiga — chamada continua funcionando, só sem a correção */ }
}
// Serviço em primeiro plano: mantém microfone e som vivos com o app em segundo plano.
// Só pode subir depois que a permissão de microfone foi concedida, então tentamos de novo algumas vezes.
let keepAliveTimers = [];
export function startCallKeepAlive() {
  if (!isNativeAndroid()) return;
  stopCallKeepAliveTimers();
  const attempt = async () => {
    try { await window.Capacitor.Plugins.CallAudio.startKeepAlive(); stopCallKeepAliveTimers(); } catch (e) { /* sem permissão ainda ou build antiga: tenta de novo */ }
  };
  attempt();
  keepAliveTimers = [2000, 5000, 10000, 20000].map((ms) => setTimeout(attempt, ms));
}
function stopCallKeepAliveTimers() { keepAliveTimers.forEach(clearTimeout); keepAliveTimers = []; }
export async function stopCallKeepAlive() {
  stopCallKeepAliveTimers();
  if (!isNativeAndroid()) return;
  try { await window.Capacitor.Plugins.CallAudio.stopKeepAlive(); } catch (e) { /* ok */ }
}
export async function stopCallAudioMode() {
  if (!isNativeAndroid() || !callAudioModeOn) return;
  callAudioModeOn = false;
  try { await window.Capacitor.Plugins.CallAudio.stopCallMode(); } catch (e) {}
}

// ---------- Compartilhamento de tela nativo (MediaProjection) ----------

let frameListenerHandle = null;
let captureCanvas = null;
let captureCtx = null;
let frameImg = null;

let stoppedListenerHandle = null;
export async function startNativeScreenCapture(fps = 12, onStopped = () => {}) {
  const ScreenCapture = window.Capacitor?.Plugins?.ScreenCapture;
  // Build antiga do app (sem o plugin nativo): avisa em vez de falhar calado.
  if (!ScreenCapture) { const err = new Error('plugin-missing'); err.code = 'plugin-missing'; throw err; }
  captureCanvas = document.createElement('canvas');
  captureCtx = captureCanvas.getContext('2d');
  frameImg = new Image();
  let sized = false;

  frameListenerHandle = await ScreenCapture.addListener('frame', ({ data, width, height }) => {
    if (!sized) { captureCanvas.width = width; captureCanvas.height = height; sized = true; }
    frameImg.onload = () => captureCtx.drawImage(frameImg, 0, 0, captureCanvas.width, captureCanvas.height);
    frameImg.src = 'data:image/jpeg;base64,' + data;
  });

  stoppedListenerHandle = await ScreenCapture.addListener('stopped', () => onStopped());
  await ScreenCapture.start({ fps }); // aqui aparece o diálogo nativo "Iniciar transmissão?" do Android

  // Espera o primeiro frame chegar antes de criar o stream — senão o
  // canvas.captureStream() sai de um canvas ainda em branco.
  await new Promise((resolve) => {
    const check = setInterval(() => { if (sized) { clearInterval(check); resolve(); } }, 50);
    setTimeout(() => { clearInterval(check); resolve(); }, 3000); // timeout de segurança
  });

  return captureCanvas.captureStream(fps);
}

export async function stopNativeScreenCapture() {
  const ScreenCapture = window.Capacitor?.Plugins?.ScreenCapture;
  if (frameListenerHandle) { frameListenerHandle.remove(); frameListenerHandle = null; }
  if (stoppedListenerHandle) { stoppedListenerHandle.remove(); stoppedListenerHandle = null; }
  if (ScreenCapture) { try { await ScreenCapture.stop(); } catch (e) {} }
  captureCanvas = null; captureCtx = null; frameImg = null;
}
