// Bandeja do sistema (equivalente ao tray.rs do Dorion): ícone com estados
// (normal / não lidas / mutado / ensurdecido) e menu de contexto.
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let baseIcon = null;
const cache = new Map();

function base() {
  if (!baseIcon) baseIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'img', 'favicon-32.png')).resize({ width: 32, height: 32 });
  return baseIcon;
}

// Pinta uma bolinha colorida no canto superior direito do ícone base.
function badged(color) {
  if (!color) return base();
  if (cache.has(color)) return cache.get(color);
  const img = base();
  const { width: w, height: h } = img.getSize();
  const buf = Buffer.from(img.toBitmap()); // BGRA
  const r = Math.round(w * 0.22), cx = w - r - 1, cy = r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r + 1.5) {
      const i = (y * w + x) * 4;
      const [R, G, B] = d <= r ? color : [255, 255, 255];
      buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = 255;
    }
  }
  const out = nativeImage.createFromBitmap(buf, { width: w, height: h });
  cache.set(color, out);
  return out;
}

const COLORS = { unread: [239, 68, 68], muted: [245, 158, 11], deafened: [120, 120, 130] };
const pickColor = (s) => (s.deafened ? COLORS.deafened : s.muted ? COLORS.muted : s.unread > 0 ? COLORS.unread : null);

function menu(actions, s) {
  return Menu.buildFromTemplate([
    { label: 'Abrir G.K.IO', click: actions.open },
    { type: 'separator' },
    { label: s.muted ? 'Desmutar microfone' : 'Mutar microfone', enabled: !!s.inCall, click: () => actions.command('toggle-mute') },
    { label: s.deafened ? 'Parar de ensurdecer' : 'Ensurdecer', enabled: !!s.inCall, click: () => actions.command('toggle-deafen') },
    { type: 'separator' },
    { label: 'Recarregar', click: actions.reload },
    { label: 'Reiniciar app', click: actions.restart },
    { label: 'Sair', click: actions.quit },
  ]);
}

function create(actions, state) {
  if (tray) return tray;
  tray = new Tray(badged(pickColor(state)));
  tray.setToolTip('G.K.IO');
  tray.setContextMenu(menu(actions, state));
  tray.on('click', actions.toggle);
  return tray;
}
function update(actions, state) {
  if (!tray) return;
  tray.setImage(badged(pickColor(state)));
  tray.setToolTip(state.unread > 0 ? `G.K.IO — ${state.unread} não lida(s)` : 'G.K.IO');
  tray.setContextMenu(menu(actions, state));
}
function destroy() { if (tray) { tray.destroy(); tray = null; } }
module.exports = { create, update, destroy, exists: () => !!tray };
