// ============================================================
// Campo de data de nascimento: três caixas (Dia / Mês / Ano) com teclado
// numérico, pulo automático, validação do calendário e feedback na hora.
// Mantém um <input type="hidden"> com o valor 'YYYY-MM-DD' (vazio se inválido).
// ============================================================
export function mountBirthInput(host, hidden) {
  host.classList.add('gk-birth');
  host.innerHTML = '';
  const mk = (ph, len, label) => {
    const i = document.createElement('input');
    i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = len; i.placeholder = ph;
    i.autocomplete = 'off'; i.setAttribute('aria-label', label); i.className = 'gk-birth-box gk-birth-' + ph.toLowerCase();
    return i;
  };
  const d = mk('DD', 2, 'Dia'), m = mk('MM', 2, 'Mês'), y = mk('AAAA', 4, 'Ano');
  const sep1 = document.createElement('span'); sep1.className = 'gk-birth-sep'; sep1.textContent = '/';
  const sep2 = sep1.cloneNode(true);
  const row = document.createElement('div'); row.className = 'gk-birth-row';
  row.append(d, sep1, m, sep2, y);
  const msg = document.createElement('div'); msg.className = 'gk-birth-msg'; msg.setAttribute('aria-live', 'polite');
  host.append(row, msg);

  const digits = (el) => { el.value = el.value.replace(/\D/g, ''); };
  function update() {
    const D = +d.value, M = +m.value, Y = +y.value;
    let iso = '', text = '', bad = false;
    if (d.value && m.value && y.value.length === 4) {
      const dt = new Date(Date.UTC(Y, M - 1, D));
      const valid = Y >= 1900 && M >= 1 && M <= 12 && D >= 1 && dt.getUTCFullYear() === Y && dt.getUTCMonth() === M - 1 && dt.getUTCDate() === D;
      if (!valid) { text = 'Essa data não existe.'; bad = true; }
      else if (dt > new Date()) { text = 'A data está no futuro.'; bad = true; }
      else {
        const now = new Date();
        let age = now.getUTCFullYear() - Y;
        if (now.getUTCMonth() + 1 < M || (now.getUTCMonth() + 1 === M && now.getUTCDate() < D)) age--;
        iso = `${y.value}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
        text = age >= 0 ? `${age} ${age === 1 ? 'ano' : 'anos'}` : '';
        if (age < 13) { text = 'É preciso ter pelo menos 13 anos.'; bad = true; iso = ''; }
      }
    }
    row.classList.toggle('gk-birth-bad', bad);
    msg.textContent = text; msg.className = 'gk-birth-msg' + (bad ? ' gk-bad' : (iso ? ' gk-ok' : ''));
    if (hidden.value !== iso) { hidden.value = iso; hidden.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  d.addEventListener('input', () => { digits(d); if (+d.value > 3 || d.value.length === 2) { if (+d.value > 31) d.value = '31'; m.focus(); } update(); });
  m.addEventListener('input', () => { digits(m); if (+m.value > 1 || m.value.length === 2) { if (+m.value > 12) m.value = '12'; y.focus(); } update(); });
  y.addEventListener('input', () => { digits(y); update(); });
  for (const [cur, prev] of [[m, d], [y, m]]) {
    cur.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !cur.value) { prev.focus(); } });
  }
  // colar "12/03/2001" ou "12032001" no primeiro campo preenche tudo
  d.addEventListener('paste', (e) => {
    const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
    if (t.length >= 8) { e.preventDefault(); d.value = t.slice(0, 2); m.value = t.slice(2, 4); y.value = t.slice(4, 8); update(); }
  });
  return { focus: () => d.focus(), clear: () => { d.value = m.value = y.value = ''; update(); } };
}
