// Modo streamer (equivalente ao streamer_mode_detection do Dorion): detecta
// programas de transmissão abertos e avisa o app web para esconder dados sensíveis.
const { listProcesses } = require('./games');

const APPS = new Set([
  'obs64.exe', 'obs32.exe', 'obs.exe', 'obs', 'obs-studio',
  'streamlabs desktop.exe', 'streamlabs obs.exe', 'slobs.exe', 'xsplit.core.exe',
  'twitchstudio.exe', 'twitch studio.exe', 'prismlivestudio.exe', 'vmix64.exe', 'tiktok live studio.exe',
]);

let timer = null;
let active = false;

async function detect() {
  const procs = await listProcesses();
  return procs.some((p) => APPS.has(String(p).split(/[\\/]/).pop().toLowerCase()));
}
function start(onChange, intervalMs = 10000) {
  stop();
  const tick = async () => { const now = await detect(); if (now !== active) { active = now; onChange(now); } };
  tick();
  timer = setInterval(tick, intervalMs);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } active = false; }
module.exports = { start, stop, isActive: () => active };
