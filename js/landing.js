// ============================================================
// G.K.IO — Landing page (tela inicial no navegador)
// Mostra a landing para quem abre o site sem estar logado e leva
// para a tela de login/cadastro quando a pessoa clica em "Abrir".
// Quem comanda é o auth.js: ele dispara "gk:auth-gate" quando sabe
// se há sessão ou não. No app do Windows e no APK a landing é pulada.
// ============================================================

const REPO = 'luksn02/G.K.IO';

const root = document.getElementById('gk-landing');
const html = document.documentElement;

// Libera a tela de login (tira o "pending" do CSS). Sempre seguro chamar.
function settle() { html.removeAttribute('data-gk-gate'); }

const isDesktopApp = !!window.gkioDesktop;
const isNativeMobile = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web');
const skipLanding = !root || isDesktopApp || isNativeMobile || location.hash === '#entrar';

// Rede de segurança: se o Firebase nunca responder, a tela de login aparece mesmo assim.
setTimeout(settle, 6000);

if (skipLanding) {
  document.addEventListener('gk:auth-gate', settle);
} else {
  init();
}

function init() {
  const header = root.querySelector('.lp-header');

  // ---------- Mostrar / esconder conforme o estado de login ----------
  document.addEventListener('gk:auth-gate', (e) => {
    if (e.detail && e.detail.visible) {
      root.classList.add('is-open');
      root.scrollTop = 0;
    } else {
      root.classList.remove('is-open');
    }
    settle();
  });

  // ---------- Cabeçalho: logo vira "pílula" branca ao rolar ----------
  root.addEventListener('scroll', () => {
    header.classList.toggle('is-scrolled', root.scrollTop > 40);
  }, { passive: true });

  // ---------- Ir para login / cadastro (com transição leve) ----------
  // A landing some com fade + leve zoom enquanto o cartão de login sobe por baixo.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const authScreen = document.getElementById('gk-auth');
  let leaving = false;

  function openAuth(mode) {
    if (leaving) return;
    const title = document.getElementById('gk-auth-title');
    const toggle = document.getElementById('gk-auth-mode-toggle');
    const isLogin = !!title && title.textContent.trim().startsWith('Entrar');
    // o auth.js alterna login <-> cadastro a cada clique no toggle
    if (toggle && ((mode === 'register' && isLogin) || (mode === 'login' && !isLogin && title))) toggle.click();

    const finish = () => {
      root.classList.remove('is-open', 'is-leaving');
      leaving = false;
      const email = document.getElementById('gk-auth-email');
      if (email) email.focus({ preventScroll: true });
    };
    if (reduceMotion.matches || !authScreen) { finish(); return; }

    leaving = true;
    authScreen.classList.remove('lp-auth-in');
    void authScreen.offsetWidth; // reinicia a animação se já tinha rodado
    authScreen.classList.add('lp-auth-in');
    root.classList.add('is-leaving');
    setTimeout(finish, 340);
    setTimeout(() => authScreen.classList.remove('lp-auth-in'), 900);
  }

  root.querySelectorAll('[data-lp-open]').forEach((btn) => {
    btn.addEventListener('click', () => openAuth(btn.dataset.lpOpen));
  });

  // ---------- Voltar da tela de login para a landing ----------
  const authWrap = document.querySelector('.gk-auth-panel-wrap');
  if (authWrap) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'lp-back';
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg> Voltar ao início';
    back.addEventListener('click', () => {
      root.classList.add('is-open');
      root.scrollTop = 0;
    });
    authWrap.prepend(back);
  }

  // ---------- Rolagem interna do menu ----------
  root.querySelectorAll('[data-lp-scroll]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.lpScroll);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  root.querySelector('[data-lp-top]').addEventListener('click', (e) => {
    e.preventDefault();
    root.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- Botão de download conforme a plataforma ----------
  // Só existem builds para Windows (.exe) e Android (.apk). Em Mac/Linux/iOS
  // o botão some e sobra "Abrir no navegador".
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const hasBuild = isWindows || isAndroid;
  const url = isAndroid ? `https://github.com/${REPO}/releases` : `https://github.com/${REPO}/releases/latest`;
  const label = isAndroid ? 'Baixar para Android' : 'Baixar para Windows';

  root.querySelectorAll('[data-lp-download]').forEach((el) => {
    if (!hasBuild) {
      // no cabeçalho some o link; nos botões grandes, some o botão
      el.hidden = true;
      return;
    }
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener';
    const span = el.querySelector('[data-lp-download-label]');
    if (span) span.textContent = label;
  });

  // ---------- Reações do mockup: clicar soma/tira 1 ----------
  root.querySelectorAll('.lp-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') === 'true';
      const base = Number(chip.dataset.count) || 0;
      chip.setAttribute('aria-pressed', String(!on));
      chip.querySelector('b').textContent = String(on ? base : base + 1);
    });
  });
}
