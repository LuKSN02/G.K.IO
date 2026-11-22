// ============================================================
// G.K.IO — Aba do navegador (igual ao Discord)
//  · título: "(3) G.K.IO | Amigos"  — contador + seção em que você está
//  · favicon: o gato com uma bolinha vermelha com o número quando há novidades
//  · app instalado (PWA): também põe o número no ícone (navigator.setAppBadge)
// O número é a quantidade de conversas com novidades (a mesma que a bandeja do desktop usa).
// ============================================================
const BASE = 'G.K.IO';
let catImg = null, lastKey = '', timer = null;

function count() { return document.querySelectorAll('.gk-dm-row.gk-unread, .gk-channel.gk-unread').length; }
function section() {
  const t = document.getElementById('gk-topbar-title')?.textContent?.trim();
  return t || '';
}
function loadCat() {
  if (catImg) return catImg;
  catImg = new Image(); catImg.src = 'img/favicon-180.png?v=3';
  catImg.onload = () => { lastKey = ''; update(); };
  return catImg;
}
function favLink() {
  let l = document.getElementById('gk-favicon');
  if (!l) {
    document.querySelectorAll('link[rel="icon"]').forEach((x) => x.remove());
    l = document.createElement('link'); l.id = 'gk-favicon'; l.rel = 'icon'; l.type = 'image/png';
    document.head.appendChild(l);
  }
  return l;
}
function drawFavicon(n) {
  const img = loadCat();
  if (!img.complete || !img.naturalWidth) return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, 64, 64);
  if (n > 0) {
    const label = n > 99 ? '99+' : String(n);
    const r = label.length >= 3 ? 25 : label.length === 2 ? 23 : 21;
    const cx = 64 - r - 2, cy = 64 - r - 2;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = '#F23F43'; x.fill();
    x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `800 ${label.length >= 3 ? 20 : label.length === 2 ? 25 : 31}px system-ui, "Segoe UI", sans-serif`;
    x.fillText(label, cx, cy + 2);
  }
  return c.toDataURL('image/png');
}

function update() {
  const n = count(), sec = section();
  const key = `${n}|${sec}`;
  if (key === lastKey) return;
  lastKey = key;
  document.title = `${n > 0 ? `(${n > 99 ? '99+' : n}) ` : ''}${BASE}${sec ? ' | ' + sec : ''}`;
  try { const u = drawFavicon(n); if (u) favLink().href = u; } catch (e) { /* noop */ }
  try { if (n > 0) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch (e) { /* noop */ }
}
const soon = () => { clearTimeout(timer); timer = setTimeout(update, 200); };

export function initTabBadge() {
  loadCat();
  new MutationObserver(soon).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
  setInterval(update, 5000);
  update();
}
