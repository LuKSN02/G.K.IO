// ============================================================
// Proteção de canais NSFW (+18)
//  1. Antes de abrir um canal NSFW a pessoa precisa confirmar que tem 18 anos
//     ou mais (fica gravado na conta: users/{uid}.adultConfirmedAt). Sem a
//     confirmação nada do canal é carregado.
//  2. Imagens e vídeos dentro de canal NSFW ficam desfocados até a pessoa tocar.
//  3. Notificações e o índice de "Arquivos" não mostram conteúdo desse canal.
//  4. As regras do Firestore (nsfwOk) também barram a leitura sem confirmação.
// Limite honesto: é uma declaração, não uma verificação de documento — nenhum
// site consegue provar idade só com um clique.
// ============================================================
import { state, toast, cleanupListener } from './state.js';
import { auth, updateDoc, userDoc, serverTimestamp, getDoc, channelDoc } from './db.js';
import { getCategoriesAndChannels } from './servers.js';
import { mountBirthInput } from './birth-input.js';

export const isAdultConfirmed = () => !!state.user?.adultConfirmedAt;

// ---- data de nascimento (gravada uma única vez; as regras do Firestore também exigem 18+ para confirmar) ----
function birthDateObj() {
  const b = state.user?.birthDate;
  if (!b) return null;
  return b.toDate ? b.toDate() : (b instanceof Date ? b : new Date(b));
}
export const hasBirthDate = () => !!birthDateObj();
export function ageOf(date) {
  if (!date) return null;
  const n = new Date();
  let a = n.getUTCFullYear() - date.getUTCFullYear();
  const m = n.getUTCMonth() - date.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < date.getUTCDate())) a--;
  return a;
}
export const isMinor = () => { const a = ageOf(birthDateObj()); return a !== null && a < 18; };

export function isNsfwChannel(serverId, channelId) {
  const { channels } = getCategoriesAndChannels();
  const ch = (channels || []).find((c) => c.id === channelId);
  return !!ch?.nsfw;
}

export async function setAdultConfirmed(on, birthIso = null) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const patch = { adultConfirmedAt: on ? serverTimestamp() : null };
    if (on && !hasBirthDate() && birthIso) {
      const [y, m, d] = birthIso.split('-').map(Number);
      patch.birthDate = new Date(Date.UTC(y, m - 1, d));
    }
    await updateDoc(userDoc(uid), patch);
    state.user.adultConfirmedAt = on ? new Date() : null;
    if (patch.birthDate) state.user.birthDate = patch.birthDate;
    return true;
  } catch (e) {
    toast('Não consegui salvar a confirmação. Publique as regras novas do Firestore (firestore.rules) e tente de novo.', 'danger');
    return false;
  }
}

let overlay = null;
const close = () => { overlay?.remove(); overlay = null; };

// Abre o aviso. onAccept roda depois da confirmação gravada.
export function showNsfwGate(channelName, onAccept, what = 'canal') {
  close();
  overlay = document.createElement('div');
  overlay.className = 'gk-nsfw-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = document.createElement('div');
  card.className = 'gk-nsfw-card';
  const badge = document.createElement('div'); badge.className = 'gk-nsfw-badge'; badge.textContent = '+18';
  const h = document.createElement('h2');
  const p = document.createElement('p');
  const row = document.createElement('div'); row.className = 'gk-nsfw-actions';
  const no = document.createElement('button'); no.type = 'button'; no.className = 'gk-btn gk-btn-ghost'; no.textContent = 'Voltar';
  no.addEventListener('click', close);
  const small = document.createElement('small'); small.textContent = 'Você pode retirar essa confirmação em Configurações > Conta.';
  card.append(badge, h, p);

  if (isMinor()) {
    h.textContent = 'Conteúdo restrito para maiores de 18';
    p.textContent = `${what === 'servidor' ? 'Este servidor' : `#${channelName || 'Este canal'}`} tem conteúdo adulto e não está disponível para a sua conta, de acordo com a data de nascimento informada.`;
    row.appendChild(no); card.append(row);
  } else {
    h.textContent = what === 'servidor' ? 'Servidor com conteúdo adulto' : 'Canal com conteúdo adulto';
    p.textContent = `${what === 'servidor' ? (channelName || 'Este servidor') : `#${channelName || 'canal'}`} foi marcado como +18. Pode ter conteúdo sexual, violento ou impróprio para menores de 18 anos.`;
    let dateInput = null;
    if (!hasBirthDate()) {
      const f = document.createElement('div'); f.className = 'gk-nsfw-birth';
      const t0 = document.createElement('span'); t0.textContent = 'Sua data de nascimento';
      const hostEl = document.createElement('div');
      dateInput = document.createElement('input'); dateInput.type = 'hidden';
      f.append(t0, hostEl, dateInput); card.appendChild(f);
      mountBirthInput(hostEl, dateInput);
    }
    const label = document.createElement('label'); label.className = 'gk-nsfw-check';
    const cb = document.createElement('input'); cb.type = 'checkbox';
    const t = document.createElement('span'); t.textContent = 'Declaro que tenho 18 anos ou mais e quero ver este tipo de conteúdo.';
    label.append(cb, t);
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'gk-btn gk-btn-primary'; yes.textContent = 'Entrar'; yes.disabled = true;
    const sync = () => { yes.disabled = !cb.checked || (dateInput && !dateInput.value); };
    cb.addEventListener('change', sync); dateInput?.addEventListener('input', sync);
    yes.addEventListener('click', async () => {
      if (dateInput) {
        const a = ageOf(new Date(dateInput.value + 'T00:00:00Z'));
        if (a === null || Number.isNaN(a) || a < 0 || a > 130) { toast('Data de nascimento inválida.', 'danger'); return; }
        if (a < 18) {
          // Menor de idade: grava só a data (sem confirmação) e mostra o bloqueio.
          yes.disabled = true;
          try { await updateDoc(userDoc(auth.currentUser.uid), { birthDate: new Date(dateInput.value + 'T00:00:00Z') }); state.user.birthDate = new Date(dateInput.value + 'T00:00:00Z'); } catch (e) { /* noop */ }
          showNsfwGate(channelName, onAccept, what); return;
        }
      }
      yes.disabled = true;
      if (await setAdultConfirmed(true, dateInput?.value || null)) { close(); onAccept(); } else sync();
    });
    row.append(no, yes); card.append(label, row, small);
  }
  overlay.appendChild(card);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(overlay);
  no.focus();
}

// Chamado por selectChannel. Retorna true se pode abrir agora.
export function guardChannel(serverId, channelId, channelName, retry) {
  if (isAdultConfirmed()) return true;
  const { channels } = getCategoriesAndChannels();
  const known = (channels || []).find((c) => c.id === channelId);
  if (known) {
    if (!known.nsfw) return true;
    showNsfwGate(channelName, retry);
    return false;
  }
  // Lista de canais ainda não carregada (ex.: veio da busca de outro servidor): abre e confere no banco.
  getDoc(channelDoc(serverId, channelId)).then((snap) => {
    if (!snap.exists() || !snap.data().nsfw || isAdultConfirmed()) return;
    if (state.currentChannelId !== channelId) return;
    cleanupListener('messages');
    const box = document.getElementById('gk-messages'); if (box) box.innerHTML = '';
    showNsfwGate(channelName, retry);
  }).catch(() => {});
  return true;
}

// ---------- Mídia desfocada dentro de canal NSFW ----------
export function setNsfwView(mode) {
  // true/'1' = canal NSFW · 'dm' = conversa com quem não é amigo (mídia desfocada)
  const box = document.getElementById('gk-messages');
  if (!box) return;
  if (mode) box.dataset.nsfw = mode === 'dm' ? 'dm' : '1'; else delete box.dataset.nsfw;
}
const shown = new Set();
document.addEventListener('click', (e) => {
  const box = document.getElementById('gk-messages');
  if (!box || !box.dataset.nsfw) return;
  const m = e.target.closest?.('.gk-msg-attachment');
  if (!m || !box.contains(m) || m.classList.contains('gk-nsfw-shown')) return;
  e.preventDefault(); e.stopPropagation();
  m.classList.add('gk-nsfw-shown');
  const src = m.querySelector('img,video')?.getAttribute('src');
  if (src) shown.add(src);
}, true);
// A lista de mensagens é refeita a cada mudança: reaplica o "já revelei" por URL.
new MutationObserver(() => {
  const box = document.getElementById('gk-messages');
  if (!box || !box.dataset.nsfw || !shown.size) return;
  box.querySelectorAll('.gk-msg-attachment:not(.gk-nsfw-shown)').forEach((m) => {
    const src = m.querySelector('img,video')?.getAttribute('src');
    if (src && shown.has(src)) m.classList.add('gk-nsfw-shown');
  });
}).observe(document.documentElement, { childList: true, subtree: true });

// Servidor inteiro marcado como +18
export function guardServer(serverId, retry) {
  const sv = state.servers.get(serverId);
  if (!sv?.nsfw || isAdultConfirmed()) return true;
  showNsfwGate(sv.name, retry, 'servidor');
  return false;
}
