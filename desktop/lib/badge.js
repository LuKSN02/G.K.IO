// Selos de status (como o Discord): vermelho = novidades, verde = em chamada, amarelo = ausente.
// Usado na bandeja (bolinha) e na barra de tarefas do Windows (círculo com número).
const { nativeImage } = require('electron');

const COLORS = { red: [242, 63, 67], green: [35, 165, 90], yellow: [240, 177, 50] };
// Prioridade: novidades > em chamada > ausente.
function kindOf(s) { return s.unread > 0 ? 'red' : s.inCall ? 'green' : s.away ? 'yellow' : null; }

const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111', '+': '000010111010000',
};
const cache = new Map();

// Círculo 32x32 para o ícone sobreposto da barra de tarefas; só o vermelho leva número ("9+" a partir de 10).
function overlayIcon(kind, n) {
  if (!kind) return null;
  const text = kind === 'red' ? (n > 9 ? '9+' : String(n)) : '';
  const key = kind + text;
  if (cache.has(key)) return cache.get(key);
  const S = 32, buf = Buffer.alloc(S * S * 4), [R, G, B] = COLORS[kind];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5), i = (y * S + x) * 4;
    if (d <= 15.5) { const a = d > 14.5 ? Math.round((15.5 - d) * 255) : 255; buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = a; }
  }
  if (text) {
    const sc = 3, gw = 3 * sc, gap = sc, total = text.length * gw + (text.length - 1) * gap;
    let ox = Math.round((S - total) / 2), oy = Math.round((S - 5 * sc) / 2);
    for (const ch of text) {
      const g = FONT[ch] || FONT[0];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy * 3 + gx] === '1')
        for (let py = 0; py < sc; py++) for (let px = 0; px < sc; px++) {
          const i = ((oy + gy * sc + py) * S + ox + gx * sc + px) * 4; buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = 255;
        }
      ox += gw + gap;
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: S, height: S });
  cache.set(key, img);
  return img;
}
module.exports = { COLORS, kindOf, overlayIcon };
