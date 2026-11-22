// ============================================================
// G.K.IO — Insígnias de perfil (estilo Discord)
// Duas fontes, sem nenhuma escrita nova no banco:
//  • AUTOMÁTICAS — calculadas na hora a partir de dados que o perfil já tem:
//      Prime por tempo de assinatura (primeSince) e idade da conta (createdAt).
//  • MANUAIS — `customBadges` (ids do catálogo abaixo), dadas pelo painel de administração.
// ============================================================
const DAY = 86400000;

// Catálogo das manuais (o painel admin lista estas chaves). `tone` escolhe o gradiente.
export const BADGE_CATALOG = {
  og: { icon: 'trophy', label: 'Veterano', desc: 'Está no G.K.IO desde os primeiros tempos.', tone: 'gold' },
  booster: { icon: 'bolt', label: 'Booster', desc: 'Impulsiona a comunidade do G.K.IO.', tone: 'pink' },
  beta: { icon: 'flask', label: 'Beta Tester', desc: 'Ajudou a testar o G.K.IO antes do lançamento.', tone: 'green' },
  founder: { icon: 'crown', label: 'Fundador', desc: 'Um dos fundadores do G.K.IO.', tone: 'gold' },
  staff: { icon: 'shield', label: 'Equipe G.K.IO', desc: 'Faz parte da equipe do G.K.IO.', tone: 'violet' },
  mod: { icon: 'shield', label: 'Moderador da comunidade', desc: 'Ajuda a manter a comunidade segura.', tone: 'blue' },
  partner: { icon: 'users', label: 'Parceiro', desc: 'Dono de um servidor parceiro do G.K.IO.', tone: 'violet' },
  bughunter: { icon: 'flask', label: 'Caçador de bugs', desc: 'Encontrou e reportou falhas importantes.', tone: 'green' },
  supporter: { icon: 'sparkles', label: 'Apoiador', desc: 'Apoia o desenvolvimento do G.K.IO.', tone: 'pink' },
  creator: { icon: 'clapperboard', label: 'Criador de conteúdo', desc: 'Cria conteúdo sobre o G.K.IO.', tone: 'blue' },
};

// Prime por tempo de assinatura — do mais alto para o mais baixo (usa o primeiro que couber).
export const PRIME_TIERS = [
  { months: 24, name: 'Diamante', tone: 'diamond' }, { months: 12, name: 'Platina', tone: 'platinum' },
  { months: 6, name: 'Ouro', tone: 'gold' }, { months: 3, name: 'Prata', tone: 'silver' }, { months: 0, name: 'Bronze', tone: 'bronze' },
];
// Idade da conta.
export const AGE_TIERS = [
  { years: 3, label: 'Conta de 3 anos' }, { years: 2, label: 'Conta de 2 anos' }, { years: 1, label: 'Conta de 1 ano' },
];

const toMs = (ts) => (ts && ts.toMillis ? ts.toMillis() : ts && ts.seconds ? ts.seconds * 1000 : typeof ts === 'number' ? ts : 0);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const monthsBetween = (a, b) => { const d = new Date(a), e = new Date(b); return (e.getFullYear() - d.getFullYear()) * 12 + (e.getMonth() - d.getMonth()) - (e.getDate() < d.getDate() ? 1 : 0); };

/** Lista de insígnias do usuário: [{ id, icon, label, desc, tone }], automáticas primeiro. */
export function computeBadges(user, now = Date.now()) {
  const out = [];
  if (!user) return out;
  if (user.role === 'prime') {
    const since = toMs(user.primeSince);
    if (since && since <= now) {
      const m = monthsBetween(since, now);
      const tier = PRIME_TIERS.find((t) => m >= t.months);
      const tempo = m < 1 ? 'menos de 1 mês' : m < 12 ? `${m} ${m === 1 ? 'mês' : 'meses'}` : `${Math.floor(m / 12)} ${Math.floor(m / 12) === 1 ? 'ano' : 'anos'}`;
      out.push({ id: 'prime-' + tier.tone, icon: 'diamond', label: `Prime ${tier.name}`, desc: `Assinante G.K.IO Prime há ${tempo} (desde ${fmtDate(since)}).`, tone: tier.tone });
    } else out.push({ id: 'prime', icon: 'diamond', label: 'G.K.IO Prime', desc: 'Assinante G.K.IO Prime.', tone: 'bronze' });
  }
  const created = toMs(user.createdAt);
  if (created && created <= now) {
    const years = Math.floor((now - created) / (365.25 * DAY));
    const t = AGE_TIERS.find((x) => years >= x.years);
    if (t) out.push({ id: 'age-' + t.years, icon: 'clock', label: t.label, desc: `Conta criada em ${fmtDate(created)}.`, tone: t.years >= 3 ? 'gold' : t.years === 2 ? 'silver' : 'bronze' });
  }
  if (user.isBot) out.push({ id: 'bot', icon: 'bolt', label: 'Bot', desc: 'Esta conta é um bot.', tone: 'blue' });
  for (const key of user.customBadges || []) {
    const b = BADGE_CATALOG[key]; if (b) out.push({ id: key, icon: b.icon, label: b.label, desc: b.desc, tone: b.tone });
  }
  return out;
}

/** Trilha de níveis do Prime: [{ name, tone, months, unlocked, label }] (null se a pessoa não é Prime). */
export function primeProgress(user, now = Date.now()) {
  if (!user || user.role !== 'prime') return null;
  const since = toMs(user.primeSince); if (!since || since > now) return null;
  const m = monthsBetween(since, now);
  return [...PRIME_TIERS].reverse().map((t) => {
    const unlocked = m >= t.months;
    const when = (n) => (n === 0 ? 'Início' : n < 12 ? `${n} ${n === 1 ? 'mês' : 'meses'}` : `${n / 12} ${n === 12 ? 'ano' : 'anos'}`);
    const left = t.months - m;
    const sub = unlocked ? when(t.months) : `faltam ${left + (left === 1 ? ' mês' : ' meses')}`;
    return { name: t.name, tone: t.tone, months: t.months, unlocked, label: when(t.months), sub };
  });
}

// ---------- Tooltip (um só, no <body>, nunca cortado pelo card) ----------
let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'gk-badge-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  return tipEl;
}
function showTip(target, b) {
  const t = tip(); t.innerHTML = '';
  const h = document.createElement('strong'); h.textContent = b.label;
  const d = document.createElement('span'); d.textContent = b.desc;
  t.append(h, d); t.classList.add('gk-on');
  const r = target.getBoundingClientRect(), w = t.offsetWidth, hh = t.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let y = r.top - hh - 8; if (y < 8) y = r.bottom + 8;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function hideTip() { tipEl?.classList.remove('gk-on'); }

// ---------- Janela "Insígnias de …" (estilo Discord) ----------
export function openBadgeModal(user, iconFn, elFn, startId) {
  hideTip();
  const list = computeBadges(user); if (!list.length) return;
  document.querySelector('.gk-badge-overlay')?.remove();
  let cur = list.find((b) => b.id === startId) || list[0];
  const name = user.displayName || user.username || 'usuário';
  const detail = elFn('div', { class: 'gk-badge-detail' });
  const grid = elFn('div', { class: 'gk-badge-picker' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const draw = () => {
    grid.querySelectorAll('.gk-badge-pick').forEach((n) => n.classList.toggle('gk-on', n.dataset.id === cur.id));
    detail.innerHTML = '';
    detail.appendChild(elFn('span', { class: `gk-badge gk-badge-${cur.tone} gk-badge-xl`, style: '--gk-badge-size:120px' }, [iconFn(cur.icon, { size: 62 })]));
    detail.appendChild(elFn('div', { class: 'gk-badge-detail-title' }, cur.label));
    detail.appendChild(elFn('p', { class: 'gk-badge-detail-desc' }, cur.desc));
    detail.appendChild(elFn('div', { class: 'gk-badge-detail-meta' }, `${list.indexOf(cur) + 1} de ${list.length} insígnias`));
    const prog = cur.id.startsWith('prime') ? primeProgress(user) : null;
    if (prog) {
      detail.appendChild(elFn('div', { class: 'gk-badge-progress' }, [
        elFn('div', { class: 'gk-badge-progress-title' }, `Progresso de ${name}`),
        elFn('div', { class: 'gk-badge-progress-grid' }, prog.map((t) => elFn('div', { class: 'gk-badge-step' + (t.unlocked ? '' : ' gk-locked') }, [
          elFn('span', { class: `gk-badge gk-badge-${t.tone}`, style: '--gk-badge-size:40px' }, [iconFn(t.unlocked ? 'diamond' : 'shield', { size: 20 })]),
          elFn('strong', {}, t.name),
          elFn('small', {}, t.sub),
        ]))),
      ]));
    }
  };
  for (const b of list) {
    const btn = elFn('button', { class: 'gk-badge-pick', type: 'button', 'data-id': b.id, title: b.label, 'aria-label': b.label }, [
      elFn('span', { class: `gk-badge gk-badge-${b.tone}`, style: '--gk-badge-size:34px' }, [iconFn(b.icon, { size: 18 })]),
    ]);
    btn.addEventListener('click', () => { cur = b; draw(); });
    grid.appendChild(btn);
  }
  const modal = elFn('div', { class: 'gk-badge-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Insígnias de ${name}` }, [
    elFn('div', { class: 'gk-badge-side' }, [
      elFn('div', { class: 'gk-badge-side-title' }, `Insígnias de ${name}`),
      elFn('p', { class: 'gk-badge-side-sub' }, 'Toque em uma insígnia para ver o que ela significa e como foi conquistada.'),
      grid,
    ]),
    detail,
    elFn('button', { class: 'gk-badge-close', type: 'button', 'aria-label': 'Fechar', onclick: close }, [iconFn('close', { size: 18 })]),
  ]);
  const overlay = elFn('div', { class: 'gk-badge-overlay' }, [modal]);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  draw();
  grid.querySelector('.gk-badge-pick.gk-on')?.focus();
}

/** Linha de insígnias só com ícones (dica no hover/foco; clique abre a janela de detalhes). */
export function buildBadgeRow(user, iconFn, elFn, { size = 28 } = {}) {
  const list = computeBadges(user);
  if (!list.length) return null;
  return elFn('div', { class: 'gk-badge-row', role: 'list', 'aria-label': 'Insígnias' },
    list.map((b) => {
      const n = elFn('button', { class: `gk-badge gk-badge-${b.tone}`, type: 'button', role: 'listitem', 'aria-label': `${b.label}. ${b.desc}`, style: `--gk-badge-size:${size}px` }, [iconFn(b.icon, { size: Math.round(size * 0.52) })]);
      n.addEventListener('mouseenter', () => showTip(n, b));
      n.addEventListener('mouseleave', hideTip);
      n.addEventListener('focus', () => showTip(n, b));
      n.addEventListener('blur', hideTip);
      n.addEventListener('click', (e) => { e.stopPropagation(); openBadgeModal(user, iconFn, elFn, b.id); });
      return n;
    }));
}
