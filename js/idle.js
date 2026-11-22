// ============================================================
// G.K.IO — Status "ausente" automático (porta da ideia do idle.rs do Dorion)
// Sem atividade por N minutos => "Ausente". Qualquer atividade volta pra
// "Online" — mas só se foi o próprio app que colocou em ausente; se a
// pessoa escolheu manualmente ausente/não perturbe, nunca mexemos.
// ============================================================
import { state } from './state.js';
import { setPresence } from './auth.js';
import { getIdlePrefs } from './prefs.js';

let lastActivity = Date.now();
let autoIdle = false;
let started = false;

function onActivity() {
  lastActivity = Date.now();
  if (autoIdle) {
    autoIdle = false;
    if (state.user?.statusPresence === 'idle') setPresence('online');
  }
}

function check() {
  const prefs = getIdlePrefs();
  if (!prefs.enabled || !state.user) return;
  if (autoIdle && state.user.statusPresence !== 'idle') autoIdle = false; // mudou na mão
  if (state.activeCall) { lastActivity = Date.now(); return; } // em chamada não é inatividade
  if (!autoIdle && state.user.statusPresence === 'online' && Date.now() - lastActivity >= prefs.minutes * 60000) {
    autoIdle = true;
    setPresence('idle');
  }
}

// App desktop: o sistema informa bloqueio/suspensão e quanto tempo o PC está parado.
// Usar o PC em outra janela (jogo, navegador) conta como atividade; bloquear a tela vira "ausente" na hora.
function hookSystemPower() {
  const d = window.gkioDesktop;
  if (!d || !d.onPower) return;
  d.onPower((s) => {
    if (!s) return;
    if (s.locked === true) {
      if (getIdlePrefs().enabled && state.user && !autoIdle && state.user.statusPresence === 'online' && !state.activeCall) { autoIdle = true; setPresence('idle'); }
    } else if (s.locked === false) onActivity();
    else if (typeof s.idleSeconds === 'number' && s.idleSeconds < 25) onActivity();
  });
}

export function initIdleDetection() {
  if (started) return;
  started = true;
  hookSystemPower();
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, onActivity, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onActivity(); });
  setInterval(check, 30000);
}
