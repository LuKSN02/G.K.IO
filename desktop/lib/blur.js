// Efeitos de janela (equivalente ao blur.rs do Dorion).
//  Windows 11: acrylic / mica / tabbed (setBackgroundMaterial)
//  macOS:      vibrancy
//  Linux:      só "transparent" (janela criada com transparência; sem blur real)
const os = require('os');

function winBuild() { return parseInt(String(os.release()).split('.')[2], 10) || 0; }

function available() {
  if (process.platform === 'win32') return winBuild() >= 22621 ? ['none', 'acrylic', 'mica', 'tabbed'] : ['none'];
  if (process.platform === 'darwin') return ['none', 'vibrancy'];
  return ['none', 'transparent'];
}

// Precisa ser sabido ANTES de criar a janela (Linux exige `transparent: true`).
function windowOptions(effect) {
  if (!available().includes(effect) || effect === 'none') return {};
  if (process.platform === 'linux') return { transparent: true, backgroundColor: '#00000000' };
  return { backgroundColor: '#00000000' };
}

// Aplica ao vivo. Retorna true se não precisa reiniciar.
function apply(win, effect) {
  if (!win || win.isDestroyed()) return true;
  const eff = available().includes(effect) ? effect : 'none';
  try {
    if (process.platform === 'win32' && win.setBackgroundMaterial) {
      win.setBackgroundMaterial(eff === 'none' ? 'none' : eff);
      win.setBackgroundColor(eff === 'none' ? '#0b1020' : '#00000000');
      return true;
    }
    if (process.platform === 'darwin') {
      win.setVibrancy(eff === 'vibrancy' ? 'under-window' : null);
      win.setBackgroundColor(eff === 'none' ? '#0b1020' : '#00000000');
      return true;
    }
  } catch (e) { /* versão do SO sem suporte */ }
  return process.platform !== 'linux'; // Linux: transparência só vale após reiniciar
}
module.exports = { available, windowOptions, apply };
