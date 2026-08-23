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

export async function startCallAudioMode() {
  if (!isNativeAndroid()) return;
  try { await window.Capacitor.Plugins.CallAudio.startCallMode({ speaker: true }); } catch (e) { /* plugin pode não estar disponível numa build antiga — chamada continua funcionando, só sem a correção */ }
}
export async function stopCallAudioMode() {
  if (!isNativeAndroid()) return;
  try { await window.Capacitor.Plugins.CallAudio.stopCallMode(); } catch (e) {}
}

// ---------- Compartilhamento de tela nativo (MediaProjection) ----------

let frameListenerHandle = null;
let captureCanvas = null;
let captureCtx = null;
let frameImg = null;

export async function startNativeScreenCapture(fps = 12) {
  const ScreenCapture = window.Capacitor.Plugins.ScreenCapture;
  captureCanvas = document.createElement('canvas');
  captureCtx = captureCanvas.getContext('2d');
  frameImg = new Image();
  let sized = false;

  frameListenerHandle = await ScreenCapture.addListener('frame', ({ data, width, height }) => {
    if (!sized) { captureCanvas.width = width; captureCanvas.height = height; sized = true; }
    frameImg.onload = () => captureCtx.drawImage(frameImg, 0, 0, captureCanvas.width, captureCanvas.height);
    frameImg.src = 'data:image/jpeg;base64,' + data;
  });

  await ScreenCapture.start(); // aqui aparece o diálogo nativo "Iniciar transmissão?" do Android

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
  if (ScreenCapture) { try { await ScreenCapture.stop(); } catch (e) {} }
  captureCanvas = null; captureCtx = null; frameImg = null;
}
