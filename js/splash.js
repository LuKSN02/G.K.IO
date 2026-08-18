// ============================================================
// G.K.IO — Animação de inicialização (splash)
// Exibida apenas quando a sessão é restaurada automaticamente
// (a pessoa já tinha feito cadastro + primeiro login antes, e
// está apenas reabrindo o site) — nunca no cadastro ou no
// primeiro login feito manualmente pelo formulário.
// Ver js/auth.js (flag `justAuthenticatedViaForm`) para a lógica
// que decide quando chamar showStartupSplash().
// ============================================================

const SPLASH_VISIBLE_MS = 1400; // tempo mínimo visível antes de poder sumir
const SPLASH_FADE_MS = 480;     // duração do fade-out (bate com o CSS)

export function showStartupSplash() {
  const splash = document.getElementById('gk-splash');
  if (!splash) return;

  splash.classList.remove('gk-splash-out');
  splash.classList.add('gk-open');

  setTimeout(() => {
    splash.classList.add('gk-splash-out');
    setTimeout(() => {
      splash.classList.remove('gk-open', 'gk-splash-out');
    }, SPLASH_FADE_MS);
  }, SPLASH_VISIBLE_MS);
}
