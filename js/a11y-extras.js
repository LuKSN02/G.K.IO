// Acessibilidade extra: nome acessível para botões só com ícone, link "Pular para o conteúdo",
// leitores de tela avisam toasts, e aviso de "sem conexão".
const label = (root) => {
  root.querySelectorAll?.('button:not([aria-label]), [role="button"]:not([aria-label])').forEach((b) => {
    if (b.textContent.trim()) return;
    const t = b.getAttribute('title'); if (t) b.setAttribute('aria-label', t);
  });
};
let t = null;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => label(document.body), 250); }).observe(document.body, { childList: true, subtree: true });
label(document.body);

const stack = document.getElementById('gk-toast-stack');
if (stack) { stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); }

const skip = document.createElement('a');
skip.href = '#gk-messages'; skip.className = 'gk-skip-link'; skip.textContent = 'Pular para as mensagens';
skip.addEventListener('click', (e) => { const m = document.getElementById('gk-messages'); if (m) { e.preventDefault(); m.setAttribute('tabindex', '-1'); m.focus(); } });
document.body.prepend(skip);

// ---- Sem conexão ----
const bar = document.createElement('div');
bar.className = 'gk-offline-bar'; bar.setAttribute('role', 'status'); bar.textContent = 'Sem conexão — mostrando o que já estava salvo. Suas mensagens serão enviadas quando a internet voltar.';
document.body.appendChild(bar);
const sync = () => bar.classList.toggle('gk-show', !navigator.onLine);
window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();
