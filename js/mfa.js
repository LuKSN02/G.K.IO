// ============================================================
// G.K.IO — Verificação em duas etapas (app autenticador / TOTP)
// Usa a verificação em duas etapas do próprio Firebase Auth. ATENÇÃO: o Firebase só
// libera TOTP depois de atualizar o projeto para o "Firebase Authentication com
// Identity Platform" (Console > Authentication > Settings > Verificação em várias
// etapas), o que hoje exige o plano Blaze. Sem isso a ativação falha com
// "auth/operation-not-allowed" e o app mostra o aviso — o resto continua igual.
// O SDK é carregado só quando necessário (import dinâmico), então um SDK sem TOTP
// não quebra o app.
// ============================================================
import { auth } from './db.js';
import { el, toast } from './state.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
let sdkPromise = null;
async function loadSdk() {
  sdkPromise = sdkPromise || import(SDK);
  const s = await sdkPromise;
  if (!s.TotpMultiFactorGenerator || !s.multiFactor || !s.getMultiFactorResolver) {
    const e = new Error('Esta versão do Firebase não suporta app autenticador.'); e.code = 'gkio/mfa-unsupported'; throw e;
  }
  return s;
}

export const mfaErrorMessage = (err) => ({
  'auth/operation-not-allowed': 'A verificação em duas etapas por app ainda não está ativa neste projeto Firebase (exige Identity Platform / plano Blaze).',
  'auth/invalid-verification-code': 'Código incorreto. Confira o app e tente de novo.',
  'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de mudar a verificação em duas etapas.',
  'auth/unverified-email': 'Confirme seu e-mail antes de ativar a verificação em duas etapas.',
  'gkio/mfa-unsupported': 'Este navegador/versão do Firebase não suporta app autenticador.',
}[err?.code] || err?.message || 'Não foi possível concluir.');

export async function listFactors() {
  const s = await loadSdk();
  return s.multiFactor(auth.currentUser).enrolledFactors.map((f) => ({ uid: f.uid, name: f.displayName || 'Autenticador', factorId: f.factorId, enrolledAt: f.enrollmentTime }));
}
/** Passo 1: gera a chave. Mostre `key`/`uri` (QR) ao usuário e peça o primeiro código. */
export async function startEnrollment() {
  const s = await loadSdk(); const user = auth.currentUser;
  const session = await s.multiFactor(user).getSession();
  const secret = await s.TotpMultiFactorGenerator.generateSecret(session);
  return { secret, key: secret.secretKey, uri: secret.generateQrCodeUrl(user.email || 'conta', 'G.K.IO') };
}
/** Passo 2: confirma com o código de 6 dígitos. */
export async function finishEnrollment(secret, code, name = 'Autenticador') {
  const s = await loadSdk();
  const assertion = s.TotpMultiFactorGenerator.assertionForEnrollment(secret, String(code).replace(/\s/g, ''));
  await s.multiFactor(auth.currentUser).enroll(assertion, name);
}
export async function removeFactor(uid) {
  const s = await loadSdk(); const f = s.multiFactor(auth.currentUser).enrolledFactors.find((x) => x.uid === uid);
  if (f) await s.multiFactor(auth.currentUser).unenroll(f);
}

// ----- entrar com a verificação ligada -----
export const isMfaRequired = (err) => err?.code === 'auth/multi-factor-auth-required';
export function askTotpCode() {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('gk-generic-modal-overlay'); const modal = document.getElementById('gk-generic-modal');
    modal.innerHTML = ''; modal.classList.remove('gk-modal-wizard');
    const input = el('input', { type: 'text', class: 'gk-sv-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8', placeholder: '000000', 'aria-label': 'Código de 6 dígitos' });
    const done = (v, err) => { overlay.classList.remove('gk-open'); err ? reject(err) : resolve(v); };
    const ok = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Confirmar');
    ok.addEventListener('click', () => { const v = input.value.replace(/\s/g, ''); if (v.length >= 6) done(v); else toast('Digite os 6 dígitos do app.', 'danger'); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    modal.appendChild(el('h2', {}, 'Verificação em duas etapas'));
    modal.appendChild(el('p', { class: 'gk-modal-sub' }, 'Digite o código de 6 dígitos do seu app autenticador.'));
    modal.appendChild(el('div', { class: 'gk-field' }, [input]));
    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn', type: 'button', onclick: () => done(null, Object.assign(new Error('Entrada cancelada.'), { code: 'gkio/cancelled' })) }, 'Cancelar'), ok]));
    overlay.classList.add('gk-open'); input.focus();
  });
}
/** Conclui o login depois de `auth/multi-factor-auth-required`. */
export async function resolveSignIn(err, promptCode = askTotpCode) {
  const s = await loadSdk();
  const resolver = s.getMultiFactorResolver(auth, err);
  const hint = resolver.hints.find((h) => h.factorId === s.TotpMultiFactorGenerator.FACTOR_ID) || resolver.hints[0];
  const code = await promptCode();
  const assertion = s.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
  return resolver.resolveSignIn(assertion);
}
