// Verade Fábula — o mundo ilustrado do planeta Verade (par do tema verade-fabula.css).
// Pinta atrás do app um cenário de desenho animado: céu, sol/lua, nuvens, colinas com macieiras e flores.
// O céu muda com a hora real do seu dia; borboletas, vagalumes e folhas voam por cima. Parallax com o mouse.
// Console: gkioVerade.setPhase('night'|'dawn'|'day'|'dusk'|'auto')
const root = document.documentElement;
const host = document.getElementById('gk-app') || document.body;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 900px)').matches;
const R = (a, b) => a + Math.random() * (b - a);

// ---------- paleta por hora (rgb) ----------
const P = {
  night: { sky1: [6, 20, 44],   sky2: [22, 62, 78],   far: [20, 58, 58],  mid: [16, 74, 52],  near: [12, 58, 40], cloud: [110, 150, 190], crown: [30, 110, 70],  star: 1,   glow: [200, 235, 255] },
  dawn:  { sky1: [88, 64, 140], sky2: [255, 160, 120], far: [88, 140, 120], mid: [64, 150, 90], near: [44, 120, 64], cloud: [255, 210, 200], crown: [80, 170, 90], star: 0.3, glow: [255, 214, 150] },
  day:   { sky1: [70, 190, 255], sky2: [200, 244, 255], far: [120, 206, 150], mid: [84, 200, 96], near: [50, 168, 70], cloud: [255, 255, 255], crown: [108, 220, 92], star: 0, glow: [255, 240, 150] },
  dusk:  { sky1: [60, 40, 120], sky2: [255, 122, 92],  far: [96, 120, 120], mid: [70, 130, 82], near: [46, 100, 58], cloud: [255, 190, 170], crown: [70, 140, 80], star: 0.4, glow: [255, 190, 120] },
};
const TL = [[0, 'night'], [5, 'night'], [7, 'dawn'], [10, 'day'], [16, 'day'], [18, 'dusk'], [20.5, 'night'], [24, 'night']];
const FORCE_H = { night: 23, dawn: 6.5, day: 13, dusk: 18.5 };
const mix = (x, y, t) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
function paletteAt(h) {
  for (let i = 0; i < TL.length - 1; i++) {
    const [h0, n0] = TL[i], [h1, n1] = TL[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1), A = P[n0], B = P[n1], o = {};
      for (const k of Object.keys(A)) o[k] = k === 'star' ? A.star + (B.star - A.star) * t : mix(A[k], B[k], t);
      return o;
    }
  }
  return P.night;
}

// ---------- cenário (SVG) ----------
const hill = (y, amp, seed, fill) => {
  let d = `M-40 900 L-40 ${y}`;
  for (let x = -40; x <= 1640; x += 200) d += ` C ${x + 60} ${y - amp * Math.sin(seed + x)} ${x + 140} ${y + amp * Math.cos(seed * 2 + x)} ${x + 200} ${y - amp * 0.4 * Math.sin(seed + x * 2)}`;
  return `<path d="${d} L1640 900 Z" fill="${fill}"/>`;
};
const tree = (x, y, s, fruit) => {
  const dots = [[-18, -6], [10, -22], [20, 4], [-6, 8], [2, -4]].map(([dx, dy], i) => `<circle cx="${dx}" cy="${dy - 52}" r="${5 - (i % 2)}" fill="${(i + fruit) % 3 ? '#FF4D6A' : '#FFE066'}" stroke="#06140b" stroke-width="1.5"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-6" y="-44" width="12" height="46" rx="5" fill="#6b3f22" stroke="#06140b" stroke-width="3"/>
    <g stroke="#06140b" stroke-width="3.5" fill="rgb(var(--vf-crown))"><circle cx="-24" cy="-58" r="30"/><circle cx="24" cy="-58" r="30"/><circle cx="0" cy="-84" r="34"/><circle cx="0" cy="-52" r="34"/></g>
    <g fill="rgba(255,255,255,.22)"><circle cx="-10" cy="-96" r="10"/></g>${dots}</g>`;
};
const flower = (x, y, c) => `<g transform="translate(${x} ${y})"><path d="M0 0v-14" stroke="#06140b" stroke-width="3"/><g fill="${c}" stroke="#06140b" stroke-width="2"><circle cx="-5" cy="-17" r="4.5"/><circle cx="5" cy="-17" r="4.5"/><circle cx="0" cy="-23" r="4.5"/><circle cx="0" cy="-12" r="4.5"/></g><circle cx="0" cy="-17" r="3.4" fill="#FFE066" stroke="#06140b" stroke-width="1.5"/></g>`;
const cloud = (x, y, s, dur, delay) => `<g class="vf-cloud" style="--dur:${dur}s;--del:${delay}s" transform="translate(0 ${y}) scale(${s})"><g class="vf-cloud-in" fill="rgb(var(--vf-cloud))" opacity=".92"><circle cx="0" cy="0" r="30"/><circle cx="38" cy="-14" r="38"/><circle cx="84" cy="-4" r="32"/><circle cx="116" cy="10" r="24"/><rect x="-30" y="6" width="170" height="28" rx="14"/></g></g>`;

const scene = document.createElement('div');
scene.id = 'vf-scene'; scene.setAttribute('aria-hidden', 'true');
const starsSvg = Array.from({ length: 70 }, () => `<circle cx="${R(0, 1600) | 0}" cy="${R(0, 520) | 0}" r="${R(0.8, 2.4).toFixed(1)}" class="vf-star" style="animation-delay:${R(0, 4).toFixed(1)}s"/>`).join('');
scene.innerHTML = `
<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="vf-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--vf-sky1))"/><stop offset="1" stop-color="rgb(var(--vf-sky2))"/></linearGradient>
    <radialGradient id="vf-glow"><stop offset="0" stop-color="rgb(var(--vf-glow))" stop-opacity=".9"/><stop offset=".35" stop-color="rgb(var(--vf-glow))" stop-opacity=".25"/><stop offset="1" stop-color="rgb(var(--vf-glow))" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="-100" y="-100" width="1800" height="1100" fill="url(#vf-sky)"/>
  <g id="vf-stars" fill="#fff" style="opacity:var(--vf-star)">${starsSvg}</g>
  <g id="vf-orb"><circle r="190" fill="url(#vf-glow)"/><circle id="vf-disc" r="46" stroke="#06140b" stroke-width="4"/><g id="vf-craters" fill="rgba(0,0,0,.12)"><circle cx="-14" cy="-10" r="9"/><circle cx="16" cy="12" r="12"/><circle cx="12" cy="-20" r="5"/></g></g>
  <g id="vf-l-clouds">${cloud(0, 150, 1.1, 150, -40)}${cloud(0, 260, 0.7, 210, -120)}${cloud(0, 90, 0.9, 260, -200)}${cloud(0, 330, 1.3, 180, -70)}</g>
  <g id="vf-l-far">${hill(640, 40, 1, 'rgb(var(--vf-far))')}</g>
  <g id="vf-l-mid">${hill(720, 50, 3, 'rgb(var(--vf-mid))')}${tree(260, 722, 0.8, 0)}${tree(560, 700, 0.62, 1)}${tree(1180, 726, 0.85, 2)}${tree(1460, 700, 0.6, 1)}</g>
  <g id="vf-l-near">${hill(800, 55, 5, 'rgb(var(--vf-near))')}${tree(120, 800, 1.2, 1)}${tree(900, 812, 1.05, 0)}${tree(1500, 800, 1.25, 2)}
    ${[[330, 850, '#FF4D6A'], [420, 868, '#FFE066'], [700, 860, '#fff'], [1040, 872, '#FF8FB0'], [1280, 858, '#FFE066'], [1380, 880, '#FF4D6A']].map(([x, y, c]) => flower(x, y, c)).join('')}</g>
</svg>`;
host.insertBefore(scene, host.firstChild);
const orb = scene.querySelector('#vf-orb'), disc = scene.querySelector('#vf-disc'), craters = scene.querySelector('#vf-craters');
const layers = ['#vf-l-clouds', '#vf-l-far', '#vf-l-mid', '#vf-l-near'].map((s, i) => [scene.querySelector(s), [8, 14, 26, 44][i]]);

// ---------- hora do dia ----------
let forced = gkio.storage.get('phase') || 'auto', pal = P.night, hourNow = 23;
function applyPalette() {
  const d = new Date();
  hourNow = forced !== 'auto' ? FORCE_H[forced] : d.getHours() + d.getMinutes() / 60;
  pal = paletteAt(hourNow);
  for (const k of ['sky1', 'sky2', 'far', 'mid', 'near', 'cloud', 'crown', 'glow']) root.style.setProperty('--vf-' + k, pal[k].join(','));
  root.style.setProperty('--vf-star', pal.star.toFixed(2));
  const day = hourNow >= 6 && hourNow < 18, prog = day ? (hourNow - 6) / 12 : ((hourNow + 6) % 24) / 12;
  orb.setAttribute('transform', `translate(${160 + 1280 * prog} ${520 - Math.sin(prog * Math.PI) * 300})`);
  disc.setAttribute('fill', day ? '#FFE066' : '#EAF2FF');
  craters.style.display = day ? 'none' : '';
}
applyPalette();
const clock = setInterval(applyPalette, 60000);
window.gkioVerade = { setPhase(p) { forced = P[p] ? p : 'auto'; gkio.storage.set('phase', forced); applyPalette(); }, get phase() { return forced; } };

// ---------- criaturas voadoras (canvas por cima do app) ----------
const fg = document.createElement('canvas');
fg.id = 'vf-fg'; fg.setAttribute('aria-hidden', 'true'); host.appendChild(fg);
const ctx = fg.getContext('2d');
let W = 0, H = 0, dpr = 1;
function resize() { dpr = Math.min(devicePixelRatio || 1, 1.5); W = host.clientWidth; H = host.clientHeight; fg.width = W * dpr; fg.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
resize(); const ro = new ResizeObserver(resize); ro.observe(host);

const WING = ['#FFB84D', '#FF7A9C', '#7AD0FF', '#C58BFF', '#FFE066'];
const flies = Array.from({ length: small ? 2 : 4 }, () => ({ x: R(0, 1), y: R(0.2, 0.9), ph: R(0, 6.28), sp: R(0.03, 0.06), c: WING[(Math.random() * WING.length) | 0], dir: Math.random() < 0.5 ? 1 : -1, s: R(0.8, 1.3) }));
const fireflies = Array.from({ length: small ? 10 : 26 }, () => ({ x: R(0, 1), y: R(0.3, 1), ph: R(0, 6.28), v: R(0.01, 0.03) }));
const leaves = Array.from({ length: small ? 5 : 10 }, () => ({ x: R(0, 1), y: R(0, 1), r: R(0, 6.28), s: R(5, 9), v: R(0.015, 0.035), ph: R(0, 6.28) }));
let mx = 0, my = 0, tx = 0, ty = 0;
const onMove = (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
addEventListener('pointermove', onMove, { passive: true });

function butterfly(b, t) {
  const flap = Math.abs(Math.sin(t * 9 + b.ph)), x = b.x * W, y = b.y * H + Math.sin(t * 1.7 + b.ph) * 14;
  ctx.save(); ctx.translate(x, y); ctx.scale(b.s * b.dir, b.s); ctx.rotate(Math.sin(t * 1.3 + b.ph) * 0.25);
  ctx.lineWidth = 2; ctx.strokeStyle = '#06140b'; ctx.fillStyle = b.c;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side * (0.25 + flap * 0.75), 1);
    ctx.beginPath(); ctx.ellipse(9, -6, 9, 12, -0.5, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(7, 8, 6, 8, 0.5, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#06140b'; ctx.beginPath(); ctx.ellipse(0, 0, 2.4, 9, 0, 0, 6.283); ctx.fill();
  ctx.restore();
}
function leaf(l) {
  ctx.save(); ctx.translate(l.x * W - mx * 30, l.y * H); ctx.rotate(l.r); ctx.fillStyle = '#7BE04A'; ctx.strokeStyle = '#06140b'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(0, -l.s); ctx.bezierCurveTo(l.s, -l.s * 0.4, l.s * 0.8, l.s * 0.7, 0, l.s); ctx.bezierCurveTo(-l.s * 0.8, l.s * 0.7, -l.s, -l.s * 0.4, 0, -l.s); ctx.fill(); ctx.stroke(); ctx.restore();
}
let last = performance.now(), t = 0, raf = 0, acc = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (small) { acc += dt; if (acc < 1 / 30) return; acc = 0; }
  t += dt; mx += (tx - mx) * 0.06; my += (ty - my) * 0.06;
  // parallax do cenário
  for (const [g, k] of layers) g.setAttribute('transform', `translate(${(-mx * k).toFixed(1)} ${(-my * k * 0.5).toFixed(1)})`);
  ctx.clearRect(0, 0, W, H);
  const night = hourNow >= 20 || hourNow < 5.5, day = hourNow >= 7 && hourNow < 18;
  if (day) for (const b of flies) { b.x += b.dir * b.sp * dt * 0.5; b.y += Math.sin(t * 0.7 + b.ph) * dt * 0.02; if (b.x > 1.1) b.x = -0.1; if (b.x < -0.1) b.x = 1.1; butterfly(b, t); }
  if (!day) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      f.y -= f.v * dt * 0.5; f.x += Math.sin(t * 0.6 + f.ph) * dt * 0.02; if (f.y < -0.05) { f.y = 1.05; f.x = Math.random(); }
      const a = (night ? 1 : 0.5) * (0.3 + 0.7 * Math.abs(Math.sin(t * 1.6 + f.ph))), px = f.x * W, py = f.y * H;
      const g = ctx.createRadialGradient(px, py, 0, px, py, 9); g.addColorStop(0, `rgba(230,255,140,${a})`); g.addColorStop(1, 'rgba(230,255,140,0)');
      ctx.fillStyle = g; ctx.fillRect(px - 9, py - 9, 18, 18);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const l of leaves) { l.y += l.v * dt; l.x += Math.sin(t + l.ph) * dt * 0.02; l.r += dt * 0.8; if (l.y > 1.05) { l.y = -0.05; l.x = Math.random(); } leaf(l); }
}
const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
document.addEventListener('visibilitychange', vis);
if (reduce) { frame(performance.now()); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(frame);

gkio.onCleanup(() => {
  clearInterval(clock); cancelAnimationFrame(raf); ro.disconnect();
  removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', vis);
  scene.remove(); fg.remove(); delete window.gkioVerade;
  for (const k of ['sky1', 'sky2', 'far', 'mid', 'near', 'cloud', 'crown', 'glow', 'star']) root.style.removeProperty('--vf-' + k);
});
