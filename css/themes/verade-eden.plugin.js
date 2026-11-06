// Verade Éden — céu vivo do planeta Verade (par do tema verade-eden.css).
// Muda as cores da aurora conforme a hora real do seu dia (noite, amanhecer, dia, entardecer),
// com sol/lua passando, estrelas, estrela cadente, folhas, maçãs e esporos flutuando com parallax do mouse.
// Console: gkioVerade.setPhase('night'|'dawn'|'day'|'dusk'|'auto')
const root = document.documentElement;
const host = document.getElementById('gk-app') || document.body;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 900px)').matches;

const cv = document.createElement('canvas');
cv.id = 've-canvas'; cv.setAttribute('aria-hidden', 'true');
host.insertBefore(cv, host.firstChild);
const ctx = cv.getContext('2d');
// segunda camada, por cima dos painéis: só as partículas "de perto" (dá profundidade)
const fg = document.createElement('canvas');
fg.id = 've-canvas-fg'; fg.setAttribute('aria-hidden', 'true');
host.appendChild(fg);
const fctx = fg.getContext('2d');
gkio.onCleanup(() => { cv.remove(); fg.remove(); });

// ---------- paleta por hora ----------
const P = {
  night: { a: [140, 240, 74], b: [47, 211, 154], c: [255, 77, 106], d: [255, 209, 102], star: 1 },
  dawn:  { a: [255, 170, 120], b: [140, 240, 150], c: [255, 100, 150], d: [255, 225, 140], star: 0.35 },
  day:   { a: [150, 255, 80],  b: [70, 225, 235],  c: [255, 125, 95],  d: [255, 235, 120], star: 0 },
  dusk:  { a: [255, 140, 70],  b: [255, 77, 106],  c: [160, 100, 255], d: [255, 200, 100], star: 0.4 },
};
const TL = [[0, 'night'], [5, 'night'], [7, 'dawn'], [10, 'day'], [16, 'day'], [18, 'dusk'], [20.5, 'night'], [24, 'night']];
const mix = (x, y, t) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
let forced = gkio.storage.get('phase') || 'auto';
let pal = P.night, hourNow = 0;

function paletteAt(h) {
  for (let i = 0; i < TL.length - 1; i++) {
    const [h0, n0] = TL[i], [h1, n1] = TL[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1), A = P[n0], B = P[n1];
      return { a: mix(A.a, B.a, t), b: mix(A.b, B.b, t), c: mix(A.c, B.c, t), d: mix(A.d, B.d, t), star: A.star + (B.star - A.star) * t };
    }
  }
  return P.night;
}
const FORCE_H = { night: 23, dawn: 6.5, day: 13, dusk: 18.5 };
function applyPalette() {
  const d = new Date();
  hourNow = forced !== 'auto' ? FORCE_H[forced] : d.getHours() + d.getMinutes() / 60;
  pal = paletteAt(hourNow);
  for (const k of ['a', 'b', 'c', 'd']) root.style.setProperty('--ve-' + k, pal[k].join(','));
  root.style.setProperty('--ve-star', pal.star.toFixed(2));
}
applyPalette();
const clock = setInterval(applyPalette, 60000);
gkio.onCleanup(() => {
  clearInterval(clock);
  for (const k of ['a', 'b', 'c', 'd', 'star']) root.style.removeProperty('--ve-' + k);
  delete window.gkioVerade;
});
window.gkioVerade = {
  setPhase(p) { forced = P[p] ? p : 'auto'; gkio.storage.set('phase', forced); applyPalette(); },
  get phase() { return forced; },
};

// ---------- cena ----------
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, small ? 1 : 1.5);
  W = host.clientWidth; H = host.clientHeight;
  for (const c of [cv, fg]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
const ro = new ResizeObserver(resize); ro.observe(host);
gkio.onCleanup(() => ro.disconnect());

const R = (a, b) => a + Math.random() * (b - a);
const stars = Array.from({ length: small ? 50 : 110 }, () => ({ x: Math.random(), y: Math.random() * 0.65, r: R(0.4, 1.5), p: R(0, 6.28), s: R(0.6, 2) }));
const LEAF = ['#8CF04A', '#5BD06B', '#B6FF7E', '#2FD39A', '#FFD166'];
const mkLeaf = (init) => ({ kind: 'leaf', x: R(0, 1), y: init ? Math.random() : -0.05, z: R(0.3, 1), rot: R(0, 6.28), vr: R(-1, 1), sway: R(0, 6.28), col: LEAF[(Math.random() * LEAF.length) | 0], red: Math.random() < 0.2 });
const mkFruit = (init) => ({ kind: 'fruit', x: R(0, 1), y: init ? Math.random() : -0.08, z: R(0.45, 1), rot: R(0, 6.28), vr: R(-0.5, 0.5), sway: R(0, 6.28), red: Math.random() < 0.5 });
const mkSpore = (init) => ({ kind: 'spore', x: R(0, 1), y: init ? Math.random() : 1.05, z: R(0.2, 1), sway: R(0, 6.28), hue: Math.random() });
const parts = [
  ...Array.from({ length: small ? 10 : 22 }, () => mkLeaf(true)),
  ...Array.from({ length: small ? 3 : 7 }, () => mkFruit(true)),
  ...Array.from({ length: small ? 14 : 34 }, () => mkSpore(true)),
];
let mx = 0, my = 0, tx = 0, ty = 0;
const onMove = (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
addEventListener('pointermove', onMove, { passive: true });
gkio.onCleanup(() => removeEventListener('pointermove', onMove));

let shoot = null, nextShoot = 6;
function drawLeaf(ctx, p, px, py, size) {
  ctx.save(); ctx.translate(px, py); ctx.rotate(p.rot);
  ctx.globalAlpha = 0.18 + p.z * 0.4;
  ctx.fillStyle = p.red ? '#FF4D6A' : p.col;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.9, -size * 0.5, size * 0.8, size * 0.6, 0, size);
  ctx.bezierCurveTo(-size * 0.8, size * 0.6, -size * 0.9, -size * 0.5, 0, -size);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,16,8,.55)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -size * 0.8); ctx.lineTo(0, size * 0.8); ctx.stroke();
  ctx.restore();
}
function drawFruit(ctx, p, px, py, s) {
  ctx.save(); ctx.translate(px, py); ctx.rotate(p.rot);
  ctx.globalAlpha = 0.25 + p.z * 0.5;
  const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s * 1.1);
  if (p.red) { g.addColorStop(0, '#FF9AA8'); g.addColorStop(0.5, '#FF4D6A'); g.addColorStop(1, '#B01E43'); }
  else { g.addColorStop(0, '#E4FFB8'); g.addColorStop(0.5, '#8CF04A'); g.addColorStop(1, '#2E9A3E'); }
  ctx.fillStyle = g; ctx.shadowColor = p.red ? 'rgba(255,77,106,.6)' : 'rgba(140,240,74,.6)'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(-s * 0.28, 0, s * 0.72, 0, 6.283); ctx.arc(s * 0.28, 0, s * 0.72, 0, 6.283); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#2E7A2E';
  ctx.beginPath(); ctx.ellipse(s * 0.35, -s * 0.85, s * 0.4, s * 0.17, -0.5, 0, 6.283); ctx.fill();
  ctx.strokeStyle = '#4A3320'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.05, -s * 0.95); ctx.stroke();
  ctx.restore();
}

let last = performance.now(), t = 0, raf = 0, acc = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (small) { acc += dt; if (acc < 1 / 30) return; acc = 0; }
  t += dt; mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
  ctx.clearRect(0, 0, W, H); fctx.clearRect(0, 0, W, H);

  // sol / lua cruzando o céu (aparece borrado por trás do vidro)
  const day = hourNow >= 6 && hourNow < 18;
  const prog = day ? (hourNow - 6) / 12 : ((hourNow + 6) % 24) / 12;
  const ox = W * (0.08 + 0.84 * prog) - mx * 30, oy = H * (0.5 - Math.sin(prog * Math.PI) * 0.42) - my * 20;
  const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, 150);
  const oc = day ? pal.d : [200, 235, 255];
  og.addColorStop(0, `rgba(${oc},${day ? 0.55 : 0.4})`); og.addColorStop(0.25, `rgba(${oc},${day ? 0.22 : 0.14})`); og.addColorStop(1, `rgba(${oc},0)`);
  ctx.fillStyle = og; ctx.fillRect(ox - 160, oy - 160, 320, 320);

  // estrelas
  if (pal.star > 0.02) {
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = pal.star * (0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p)));
      ctx.beginPath(); ctx.arc(s.x * W - mx * 10 * s.r, s.y * H - my * 6 * s.r, s.r, 0, 6.283); ctx.fill();
    }
    nextShoot -= dt;
    if (!shoot && nextShoot <= 0 && !reduce) { shoot = { x: R(0.2, 0.9) * W, y: R(0, 0.3) * H, l: 0 }; nextShoot = R(9, 20); }
    if (shoot) {
      shoot.l += dt * 900; shoot.x -= dt * 620; shoot.y += dt * 260;
      const gr = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x + 110, shoot.y - 46);
      gr.addColorStop(0, `rgba(255,255,255,${pal.star})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.strokeStyle = gr; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x + 110, shoot.y - 46); ctx.stroke();
      if (shoot.l > 1500) shoot = null;
    }
  }

  // folhas, maçãs, esporos
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!reduce) {
      p.sway += dt * (0.6 + p.z);
      if (p.kind === 'spore') { p.y -= dt * 0.012 * (0.4 + p.z); p.x += Math.sin(p.sway) * dt * 0.01; if (p.y < -0.05) Object.assign(p, mkSpore(false)); }
      else {
        p.y += dt * (p.kind === 'fruit' ? 0.012 : 0.02) * (0.5 + p.z); p.x += Math.sin(p.sway) * dt * 0.02; p.rot += p.vr * dt * 0.8;
        if (p.y > 1.08) Object.assign(p, p.kind === 'fruit' ? mkFruit(false) : mkLeaf(false));
      }
    }
    const px = p.x * W - mx * 60 * p.z, py = p.y * H - my * 40 * p.z;
    const C = p.z > 0.72 ? fctx : ctx; // as mais próximas ficam na frente dos painéis
    if (p.kind === 'leaf') drawLeaf(C, p, px, py, 5 + p.z * 9);
    else if (p.kind === 'fruit') drawFruit(C, p, px, py, 6 + p.z * 8);
    else {
      const ctx = C;
      const c = p.hue < 0.5 ? pal.a : p.hue < 0.8 ? pal.d : pal.c, a = 0.25 + 0.55 * Math.abs(Math.sin(t * 1.3 + p.sway));
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createRadialGradient(px, py, 0, px, py, 3 + p.z * 5);
      sg.addColorStop(0, `rgba(${c},${a})`); sg.addColorStop(1, `rgba(${c},0)`);
      ctx.globalAlpha = 1; ctx.fillStyle = sg; ctx.fillRect(px - 9, py - 9, 18, 18);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.globalAlpha = 1;
}
const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
document.addEventListener('visibilitychange', vis);
gkio.onCleanup(() => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); });
if (reduce) { frame(performance.now()); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(frame);
