// Desenha a lista de voz e os avisos. Tudo com textContent (nada de innerHTML com dados dos outros).
const root = document.getElementById('root');
const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px';
const toasts = document.createElement('div');
root.append(box, toasts);
let st = { snapshot: null, speaking: [], selfMuted: false, selfDeaf: false };

function safeImg(url) { return /^https:\/\//i.test(url || '') ? url : ''; }
function initialAvatar(name) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const h = [...String(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  x.fillStyle = `hsl(${h},35%,38%)`; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#fff'; x.font = '700 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(name || '?').trim().slice(0, 1).toUpperCase(), 32, 34);
  return c.toDataURL();
}
function avatar(url, name, cls) {
  const i = document.createElement('img'); i.className = cls; i.src = safeImg(url) || initialAvatar(name);
  i.onerror = () => { i.onerror = null; i.src = initialAvatar(name); };
  return i;
}
function report() { window.gkioOverlay.hasContent(!!(st.snapshot && st.snapshot.members?.length) || toasts.children.length > 0); }

function render() {
  box.textContent = '';
  const s = st.snapshot;
  if (s && s.members?.length) {
    const t = document.createElement('div'); t.className = 'title'; t.textContent = String(s.title || 'Chamada').slice(0, 40); box.append(t);
    const speaking = new Set(st.speaking || []);
    for (const m of s.members) {
      const row = document.createElement('div'); row.className = 'm' + (speaking.has(m.uid) ? ' on' : '');
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = String(m.name || 'Membro').slice(0, 40);
      row.append(avatar(m.avatar, m.name, 'av'), nm);
      const muted = m.self ? st.selfMuted : m.muted;
      if (m.self && st.selfDeaf) { const i = document.createElement('div'); i.className = 'ic'; i.textContent = '🎧✕'; row.append(i); }
      else if (muted) { const i = document.createElement('div'); i.className = 'ic'; i.textContent = '🎤✕'; row.append(i); }
      box.append(row);
    }
  }
  report();
}
window.gkioOverlay.onState((s) => { st = { ...st, ...s }; render(); });
window.gkioOverlay.onToast((t) => {
  const el = document.createElement('div'); el.className = 't';
  const body = document.createElement('div');
  const b = document.createElement('b'); b.textContent = String(t.title || '').slice(0, 60);
  const sp = document.createElement('span'); sp.textContent = String(t.body || '').slice(0, 160);
  body.append(b, sp); el.append(avatar(t.icon, t.title, ''), body);
  toasts.prepend(el);
  while (toasts.children.length > 3) toasts.lastChild.remove();
  report();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); report(); }, 300); }, 6000);
});
render();
