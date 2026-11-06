// Verade Fábula Deluxe — o mundo ilustrado do planeta Verade (par do tema verade-fabula.css).
// Pinta atrás do app um cenário de desenho animado: céu, sol/lua, nuvens, colinas com macieiras e flores.
// O céu muda com a hora real do seu dia; borboletas, vagalumes e folhas voam por cima. Parallax com o mouse.
// Console: gkioVerade.setPhase('night'|'dawn'|'day'|'dusk'|'auto')
const root = document.documentElement;
const host = document.body; // o cenário vive fora do app (position:fixed, atrás de tudo)
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 900px)').matches;
const R = (a, b) => a + Math.random() * (b - a);

// ---------- paleta por hora (rgb) ----------
const P = {
  night: { sky1: [6, 20, 44],   sky2: [22, 62, 78],   far: [20, 58, 58],  mid: [16, 74, 52],  near: [12, 58, 40], cloud: [110, 150, 190], crown: [30, 110, 70],  star: 1,   glow: [200, 235, 255], water: [20, 60, 100],   peak: [34, 70, 100],   snow: [170, 195, 225], rain: 0 },
  dawn:  { sky1: [88, 64, 140], sky2: [255, 160, 120], far: [88, 140, 120], mid: [64, 150, 90], near: [44, 120, 64], cloud: [255, 210, 200], crown: [80, 170, 90], star: 0.3, glow: [255, 214, 150], water: [255, 170, 160], peak: [120, 110, 160], snow: [255, 225, 225], rain: 0.2 },
  day:   { sky1: [70, 190, 255], sky2: [200, 244, 255], far: [120, 206, 150], mid: [84, 200, 96], near: [50, 168, 70], cloud: [255, 255, 255], crown: [108, 220, 92], star: 0, glow: [255, 240, 150], water: [90, 200, 255], peak: [130, 170, 220], snow: [255, 255, 255], rain: 0.55 },
  dusk:  { sky1: [60, 40, 120], sky2: [255, 122, 92],  far: [96, 120, 120], mid: [70, 130, 82], near: [46, 100, 58], cloud: [255, 190, 170], crown: [70, 140, 80], star: 0.4, glow: [255, 190, 120], water: [255, 140, 120], peak: [110, 80, 140], snow: [255, 210, 200], rain: 0.15 },
};
const TL = [[0, 'night'], [5, 'night'], [7, 'dawn'], [10, 'day'], [16, 'day'], [18, 'dusk'], [20.5, 'night'], [24, 'night']];
const FORCE_H = { night: 23, dawn: 6.5, day: 13, dusk: 18.5 };
const mix = (x, y, t) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
function paletteAt(h) {
  for (let i = 0; i < TL.length - 1; i++) {
    const [h0, n0] = TL[i], [h1, n1] = TL[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0 || 1), A = P[n0], B = P[n1], o = {};
      for (const k of Object.keys(A)) o[k] = (k === 'star' || k === 'rain') ? A[k] + (B[k] - A[k]) * t : mix(A[k], B[k], t);
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
const cloud = (x, y, s, dur, delay) => `<g transform="translate(0 ${y}) scale(${s})"><g class="vf-cloud" style="--dur:${dur}s;--del:${delay}s"><g fill="rgb(var(--vf-cloud))" opacity=".92"><circle cx="0" cy="0" r="30"/><circle cx="38" cy="-14" r="38"/><circle cx="84" cy="-4" r="32"/><circle cx="116" cy="10" r="24"/><rect x="-30" y="6" width="170" height="28" rx="14"/></g></g></g>`;

const mountains = () => {
  const pts = [[-40, 600], [120, 470], [210, 520], [330, 380], [450, 520], [560, 450], [700, 560], [840, 430], [980, 540], [1120, 400], [1260, 520], [1400, 440], [1520, 530], [1640, 470], [1640, 900], [-40, 900]];
  const peaks = [[330, 380], [840, 430], [1120, 400], [120, 470], [1400, 440]];
  const body = `<path d="M${pts.map((p) => p.join(' ')).join(' L')} Z" fill="rgb(var(--vf-peak))" stroke="#06140b" stroke-width="3"/>`;
  const snow = peaks.map(([x, y]) => `<path d="M${x} ${y} L${x - 34} ${y + 52} Q${x - 18} ${y + 40} ${x - 6} ${y + 56} Q${x + 8} ${y + 40} ${x + 20} ${y + 52} Q${x + 28} ${y + 44} ${x + 34} ${y + 52} Z" fill="rgb(var(--vf-snow))" stroke="#06140b" stroke-width="2.5" stroke-linejoin="round"/>`).join('');
  return body + snow;
};
const bush = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#06140b" stroke-width="3" fill="${c || 'rgb(var(--vf-crown))'}"><circle cx="-18" cy="-8" r="16"/><circle cx="18" cy="-8" r="16"/><circle cx="0" cy="-18" r="20"/></g>`;
const tuft = (x, y) => `<path transform="translate(${x} ${y})" d="M0 0 l-5 -16 l7 10 l3 -18 l4 18 l7 -10 l-3 16 z" fill="rgb(var(--vf-near))" stroke="#06140b" stroke-width="2" stroke-linejoin="round"/>`;
const mushroom = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#06140b" stroke-width="2.5"><rect x="-5" y="-14" width="10" height="16" rx="4" fill="#FFF3D6"/><path d="M-18 -14 a18 16 0 0 1 36 0 z" fill="#FF5470"/><circle cx="-6" cy="-22" r="3" fill="#fff" stroke="none"/><circle cx="7" cy="-19" r="2.4" fill="#fff" stroke="none"/></g>`;
const windmill = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#06140b" stroke-width="3.5" stroke-linejoin="round">
  <path d="M-34 0 L-22 -110 L22 -110 L34 0 Z" fill="#FFF0D0"/><path d="M-26 -110 L0 -150 L26 -110 Z" fill="#FF5470"/>
  <rect x="-9" y="-30" width="18" height="30" rx="8" fill="#8A5530"/><rect x="-8" y="-84" width="16" height="16" rx="4" fill="#7AD0FF"/>
  <g transform="translate(0 -104)"><g class="vf-blades"><g fill="#FFF8E8"><rect x="-6" y="-92" width="12" height="92" rx="3"/><rect x="-6" y="0" width="12" height="92" rx="3"/><rect x="-92" y="-6" width="92" height="12" rx="3"/><rect x="0" y="-6" width="92" height="12" rx="3"/></g></g><circle r="9" fill="#FFD166"/></g></g>`;
const house = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#06140b" stroke-width="3.5" stroke-linejoin="round">
  <rect x="48" y="-110" width="20" height="46" fill="#B8774A"/><g fill="#fff" stroke="none"><circle class="vf-smoke" cx="58" cy="-116" r="9"/><circle class="vf-smoke" style="animation-delay:-2.5s" cx="58" cy="-116" r="9"/></g>
  <rect x="-60" y="-70" width="130" height="70" rx="6" fill="#FFE9B8"/><path d="M-76 -66 L5 -128 L86 -66 Z" fill="#E8485F"/>
  <rect x="-12" y="-44" width="26" height="44" rx="12" fill="#8A5530"/><rect x="-50" y="-52" width="26" height="24" rx="5" fill="#7AD0FF"/><rect x="28" y="-52" width="26" height="24" rx="5" fill="#7AD0FF"/></g>`;
const balloon = (y) => `<g class="vf-balloon"><g transform="translate(0 ${y})"><g class="vf-balloon-in"><g stroke="#06140b" stroke-width="3.5">
  <path d="M0 -60 C-48 -60 -50 -4 -18 34 L18 34 C50 -4 48 -60 0 -60 Z" fill="#FF5470"/><path d="M0 -60 C-16 -50 -20 0 -6 34 L6 34 C20 0 16 -50 0 -60 Z" fill="#FFD166"/>
  <path d="M-12 34 L-10 52 M12 34 L10 52" fill="none"/><rect x="-14" y="52" width="28" height="18" rx="4" fill="#B8774A"/></g></g></g></g>`;
const bird = (y, dur, del, s) => `<g class="vf-bird" style="--dur:${dur}s;--del:${del}s"><g transform="translate(0 ${y}) scale(${s})"><g class="vf-flap"><path d="M0 0 q10 -12 20 0 q10 -12 20 0" fill="none" stroke="#06140b" stroke-width="3.5" stroke-linecap="round"/></g></g></g>`;
const rays = () => Array.from({ length: 14 }, (_, i) => `<path transform="rotate(${i * (360 / 14)})" d="M-9 -70 L0 -150 L9 -70 Z" fill="rgb(var(--vf-glow))" opacity=".55"/>`).join('');
const rainbow = () => ['#FF5470', '#FFA64D', '#FFE066', '#7BE04A', '#5CC8FF', '#9B7BFF'].map((c, i) => `<path d="M280 720 A 520 520 0 0 1 1320 720" transform="translate(0 ${i * 0})" fill="none" stroke="${c}" stroke-width="16" style="transform:scale(${1 - i * 0.034});transform-origin:800px 720px"/>`).join('');
const water = () => `<path d="M-40 820 C 200 790 420 850 700 820 C 980 790 1240 850 1640 810 L1640 900 L-40 900 Z" fill="rgb(var(--vf-water))" stroke="#06140b" stroke-width="3.5"/>${[[260, 835, 90], [620, 842, 70], [980, 830, 100], [1320, 838, 80]].map(([x, y, w], i) => `<path class="vf-shimmer" style="animation-delay:${i * .8}s" d="M${x} ${y} q ${w / 4} -6 ${w / 2} 0 t ${w / 2} 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`).join('')}`;
const flowerS = (x, y, c) => `<g transform="translate(${x} ${y})"><g class="vf-sway">${flower(0, 0, c)}</g></g>`;

const scene = document.createElement('div');
scene.id = 'vf-scene'; scene.setAttribute('aria-hidden', 'true');
const starsSvg = Array.from({ length: 80 }, () => `<circle cx="${R(0, 1600) | 0}" cy="${R(0, 520) | 0}" r="${R(0.8, 2.4).toFixed(1)}" class="vf-star" style="animation-delay:${R(0, 4).toFixed(1)}s"/>`).join('');
scene.innerHTML = `
<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="vf-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--vf-sky1))"/><stop offset="1" stop-color="rgb(var(--vf-sky2))"/></linearGradient>
    <radialGradient id="vf-glow"><stop offset="0" stop-color="rgb(var(--vf-glow))" stop-opacity=".9"/><stop offset=".35" stop-color="rgb(var(--vf-glow))" stop-opacity=".25"/><stop offset="1" stop-color="rgb(var(--vf-glow))" stop-opacity="0"/></radialGradient>
    <radialGradient id="vf-planet" cx=".35" cy=".3"><stop offset="0" stop-color="#FFE9A8"/><stop offset=".55" stop-color="#8CF04A"/><stop offset="1" stop-color="#1F7A4A"/></radialGradient>
  </defs>
  <rect x="-100" y="-100" width="1800" height="1100" fill="url(#vf-sky)"/>
  <g id="vf-stars" fill="#fff" style="opacity:var(--vf-star)">${starsSvg}</g>
  <g style="opacity:calc(var(--vf-star) * .95)" transform="translate(260 190) rotate(-18)"><path d="M-96 0 A96 26 0 0 1 96 0" fill="none" stroke="#FFD166" stroke-width="9" stroke-linecap="round"/><circle r="46" fill="url(#vf-planet)" stroke="#06140b" stroke-width="4"/><path d="M-96 0 A96 26 0 0 0 96 0" fill="none" stroke="#FFD166" stroke-width="9" stroke-linecap="round"/></g>
  <g id="vf-rainbow" style="opacity:var(--vf-rain)">${rainbow()}</g>
  <g id="vf-orb"><circle r="200" fill="url(#vf-glow)"/><g class="vf-rays" id="vf-rayg">${rays()}</g><circle id="vf-disc" r="46" stroke="#06140b" stroke-width="4"/><g id="vf-craters" fill="rgba(0,0,0,.12)"><circle cx="-14" cy="-10" r="9"/><circle cx="16" cy="12" r="12"/><circle cx="12" cy="-20" r="5"/></g></g>
  <g id="vf-l-clouds">${cloud(0, 150, 1.1, 150, -40)}${cloud(0, 270, 0.7, 210, -120)}${cloud(0, 90, 0.9, 260, -200)}${cloud(0, 340, 1.3, 180, -70)}</g>
  <g style="opacity:calc(1 - var(--vf-star))">${balloon(230)}${bird(160, 38, -5, 1)}${bird(190, 46, -20, 0.8)}${bird(130, 52, -33, 0.7)}</g>
  <g id="vf-l-peaks">${mountains()}</g>
  <g id="vf-l-far">${hill(660, 40, 1, 'rgb(var(--vf-far))')}</g>
  <g id="vf-l-mid">${hill(730, 50, 3, 'rgb(var(--vf-mid))')}${windmill(700, 724, 0.8)}${house(1010, 736, 0.8)}${tree(250, 726, 0.8, 0)}${tree(520, 706, 0.6, 1)}${tree(1260, 730, 0.85, 2)}${tree(1480, 706, 0.6, 1)}${bush(420, 730, 0.9)}${bush(900, 740, 0.7)}</g>
  <g id="vf-l-near">${hill(805, 55, 5, 'rgb(var(--vf-near))')}${water()}${tree(110, 800, 1.25, 1)}${tree(930, 812, 1.05, 0)}${tree(1510, 800, 1.3, 2)}${bush(300, 850, 1.1)}${bush(1180, 860, 1)}
    ${[[330, 862, '#FF5470'], [420, 876, '#FFE066'], [560, 868, '#fff'], [800, 880, '#FF8FB0'], [1040, 872, '#FFE066'], [1280, 866, '#FF5470'], [1390, 884, '#fff'], [60, 868, '#FF8FB0']].map(([x, y, c]) => flowerS(x, y, c)).join('')}
    ${[[200, 880], [480, 890], [720, 886], [1100, 892], [1450, 880]].map(([x, y]) => tuft(x, y)).join('')}${mushroom(640, 870, 1)}${mushroom(1210, 884, 1.2)}</g>
</svg>`;
host.insertBefore(scene, host.firstChild);
const orb = scene.querySelector('#vf-orb'), disc = scene.querySelector('#vf-disc'), craters = scene.querySelector('#vf-craters');
const raysEl = scene.querySelector('#vf-rayg');
const layers = ['#vf-l-clouds', '#vf-l-peaks', '#vf-l-far', '#vf-l-mid', '#vf-l-near'].map((q, i) => [scene.querySelector(q), [8, 10, 16, 28, 46][i]]);

// ---------- hora do dia ----------
let forced = gkio.storage.get('phase') || 'auto', pal = P.night, hourNow = 23;
function applyPalette() {
  const d = new Date();
  hourNow = forced !== 'auto' ? FORCE_H[forced] : d.getHours() + d.getMinutes() / 60;
  pal = paletteAt(hourNow);
  for (const k of ['sky1', 'sky2', 'far', 'mid', 'near', 'cloud', 'crown', 'glow', 'water', 'peak', 'snow']) root.style.setProperty('--vf-' + k, pal[k].join(','));
  root.style.setProperty('--vf-star', pal.star.toFixed(2));
  root.style.setProperty('--vf-rain', pal.rain.toFixed(2));
  const day = hourNow >= 6 && hourNow < 18, prog = day ? (hourNow - 6) / 12 : ((hourNow + 6) % 24) / 12;
  orb.setAttribute('transform', `translate(${160 + 1280 * prog} ${520 - Math.sin(prog * Math.PI) * 300})`);
  disc.setAttribute('fill', day ? '#FFE066' : '#EAF2FF');
  craters.style.display = day ? 'none' : '';
  raysEl.style.display = day ? '' : 'none';
}
applyPalette();
const clock = setInterval(applyPalette, 60000);
window.gkioVerade = { setPhase(p) { forced = P[p] ? p : 'auto'; gkio.storage.set('phase', forced); applyPalette(); }, get phase() { return forced; } };

// ---------- criaturas voadoras (canvas por cima do app) ----------
const fg = document.createElement('canvas');
fg.id = 'vf-fg'; fg.setAttribute('aria-hidden', 'true'); host.appendChild(fg);
const ctx = fg.getContext('2d');
let W = 0, H = 0, dpr = 1;
function resize() { dpr = Math.min(devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight; fg.width = W * dpr; fg.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
resize(); const ro = new ResizeObserver(resize); ro.observe(document.documentElement);

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
  for (const k of ['sky1', 'sky2', 'far', 'mid', 'near', 'cloud', 'crown', 'glow', 'star', 'water', 'peak', 'snow', 'rain']) root.style.removeProperty('--vf-' + k);
});
