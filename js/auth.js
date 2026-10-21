// ============================================================
// G.K.IO — Autenticação
// ============================================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, fbUpdateProfile, userDoc, setDoc, getDoc, updateDoc, serverTimestamp,
  setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail,
  sendEmailVerification, reload, deleteUser, getIdToken,
} from './db.js';
import { stopBackgroundNotifications } from './background-notify.js';
import { clearPushToken } from './push.js';
import { state, toast, fallbackAvatar, normalizeUsername } from './state.js';
import { showStartupSplash } from './splash.js';

let onReadyCallback = null;

// Fica `true` só entre o instante em que o formulário de login/cadastro é
// submetido com sucesso e o próximo disparo do onAuthStateChanged que essa
// ação causa. Isso permite diferenciar "acabei de logar/cadastrar pelo
// formulário" (sem splash) de "o Firebase restaurou minha sessão sozinho
// ao abrir o site" (com splash) — mesmo callback, dois cenários distintos.
let justAuthenticatedViaForm = false;

export function onAuthReady(cb) { onReadyCallback = cb; }

let beforeunloadRegistered = false;

// ---------- Confirmação de e-mail ----------
// Contas criadas A PARTIR desta data só entram no app depois de confirmar o
// e-mail (link enviado no cadastro). Contas mais antigas continuam entrando
// normalmente — senão todo mundo que já usa o G.K.IO ficaria trancado pra fora.
// Ajuste para a data/hora em que você publicar esta versão.
const EMAIL_VERIFICATION_REQUIRED_AFTER = Date.parse('2026-10-20T00:00:00Z');

function needsEmailVerification(fbUser) {
  if (!fbUser || fbUser.emailVerified) return false;
  const created = Date.parse(fbUser.metadata?.creationTime || '');
  return Number.isFinite(created) && created >= EMAIL_VERIFICATION_REQUIRED_AFTER;
}

let verifyPoll = null;
let verifyCameFromForm = false;
let enteringApp = false;

export function initAuthListener() {
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      state.user = null;
      justAuthenticatedViaForm = false;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      hideVerifyPanel();
      showAuthGate();
      return;
    }
    const cameFromForm = justAuthenticatedViaForm;
    justAuthenticatedViaForm = false;

    // Conta nova com e-mail ainda não confirmado: fica na tela de confirmação.
    // Nada de perfil/presença/app até o link ser clicado.
    if (needsEmailVerification(fbUser)) {
      state.user = null;
      showVerifyPanel(fbUser, cameFromForm);
      showAuthGate();
      return;
    }
    await enterApp(fbUser, cameFromForm);
  });
}

async function enterApp(fbUser, cameFromForm) {
  const profileSnap = await getDoc(userDoc(fbUser.uid));
  if (!profileSnap.exists()) {
    // Cadastro novo: o perfil só nasce aqui, depois da confirmação do e-mail
    // (o nome de usuário escolhido fica guardado no displayName até lá).
    await bootstrapUserDoc(fbUser.uid, fbUser.displayName || 'novo-usuario', fbUser.email);
  }
  await setPresence('online');
  const snap = await getDoc(userDoc(fbUser.uid));
  state.user = { uid: fbUser.uid, ...snap.data() };
  hideAuthGate();
  startPresenceHeartbeat();
  // Sessão restaurada automaticamente (não veio de um submit do formulário)
  // = a pessoa já tinha feito cadastro + primeiro login antes -> mostra a
  // animação de abertura. No cadastro/login manual, pula direto pro app.
  if (!cameFromForm) showStartupSplash();
  onReadyCallback && onReadyCallback();

  // Só registra uma vez: como esse callback do onAuthStateChanged pode
  // disparar várias vezes numa mesma sessão (ex: relogin), sem esse
  // guard cada disparo empilhava mais um listener de beforeunload.
  if (!beforeunloadRegistered) {
    beforeunloadRegistered = true;
    window.addEventListener('beforeunload', () => { setPresence('offline'); });
  }
}

async function bootstrapUserDoc(uid, username, email) {
  username = normalizeUsername(username) || `usuario-${uid.slice(0, 6)}`;
  await setDoc(userDoc(uid), {
    username,
    displayName: username,
    email,
    avatarUrl: fallbackAvatar(username),
    bannerUrl: '',
    bannerType: 'image', // 'image' | 'video' — banner em vídeo é exclusivo Prime
    bio: '',
    statusPresence: 'online',
    lastActiveAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    // ---- G.K.IO Prime ----
    role: 'free',        // 'free' | 'prime' — só alterável via console/Cloud Function (ver firestore.rules)
    primeSince: null,
    tag: '',
    frameStyle: 'none',  // 'none' | 'glacial' | 'aurora'
    customBadges: [],
    isAdmin: false,       // só true se setado manualmente no console — libera a seção Administração
    fcmToken: null,        // token de push (FCM) do dispositivo — setado por js/push.js no APK
  });
}

export async function setPresence(statusPresence) {
  if (!auth.currentUser) return;
  try {
    await updateDoc(userDoc(auth.currentUser.uid), { statusPresence, lastActiveAt: serverTimestamp() });
    if (state.user) state.user.statusPresence = statusPresence;
  } catch (e) { /* doc pode ainda não existir na primeira chamada — ignora */ }
}

let heartbeatInterval = null;

// Só atualiza lastActiveAt — nunca statusPresence. Se mexesse no status,
// brigaria com alguém que setou manualmente "ausente"/"não perturbe" na
// mini-tela de perfil (profile.js), revertendo pra "online" a cada minuto.
async function heartbeatTick() {
  if (!auth.currentUser || document.hidden) return;
  try { await updateDoc(userDoc(auth.currentUser.uid), { lastActiveAt: serverTimestamp() }); } catch (e) { /* noop */ }
}

// Chamado uma vez após o login. Continua rodando em segundo plano; se o
// app for morto pelo sistema (comum no APK), o timer simplesmente para de
// disparar e lastActiveAt vai envelhecendo — é isso que effectiveStatus()
// (state.js) usa pra corrigir a presença de quem já não está mais por aqui.
function startPresenceHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatTick();
  heartbeatInterval = setInterval(heartbeatTick, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeatTick(); });
}

export async function registerUser(username, email, password) {
  username = normalizeUsername(username);
  if (username.length < 3) throw new Error('O nome de usuário precisa ter ao menos 3 caracteres.');
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    // E-mail já cadastrado: pode ser uma conta criada antes e nunca confirmada
    // (a pessoa fechou a aba). Se a senha bater, retoma a confirmação em vez de travar.
    if (err?.code === 'auth/email-already-in-use') {
      try {
        const existing = await signInWithEmailAndPassword(auth, email, password);
        if (needsEmailVerification(existing.user)) {
          await fbUpdateProfile(existing.user, { displayName: username });
          await sendEmailVerification(existing.user).catch(() => {});
        }
        return existing.user;
      } catch (_) { /* senha não bate: mostra o erro original */ }
    }
    throw err;
  }
  await fbUpdateProfile(cred.user, { displayName: username });
  // O perfil (doc em users/) só é criado depois que o e-mail for confirmado.
  // Se o envio falhar (ex.: limite de envios), a tela de confirmação tem "Reenviar".
  await sendEmailVerification(cred.user).catch((e) => console.warn('[auth] sendEmailVerification:', e.message));
  return cred.user;
}

export async function loginUser(email, password, keepSignedIn = true) {
  // "Manter-me conectado" desmarcado = sessão morre ao fechar a aba/app
  // (browserSessionPersistence); marcado (padrão) = sobrevive, como hoje.
  await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutUser() {
  await clearPushToken(); // antes do signOut: ainda precisa estar autenticado pra gravar
  await setPresence('offline');
  stopBackgroundNotifications();
  await signOut(auth);
}

// Avisa a landing (js/landing.js) se há sessão ou não — é ela que decide
// se mostra a tela inicial antes do login.
function emitAuthGate(visible) {
  document.dispatchEvent(new CustomEvent('gk:auth-gate', { detail: { visible } }));
}
function showAuthGate() {
  document.getElementById('gk-auth').style.display = 'flex';
  document.getElementById('gk-app').classList.remove('gk-ready');
  emitAuthGate(true);
}
function hideAuthGate() {
  document.getElementById('gk-auth').style.display = 'none';
  document.getElementById('gk-app').classList.add('gk-ready');
  emitAuthGate(false);
}

// ---------- Wiring da UI de autenticação ----------
export function wireAuthForm() {
  const form = document.getElementById('gk-auth-form');
  const modeToggle = document.getElementById('gk-auth-mode-toggle');
  const title = document.getElementById('gk-auth-title');
  const sub = document.getElementById('gk-auth-sub');
  const usernameField = document.getElementById('gk-auth-username-field');
  const submitBtn = document.getElementById('gk-auth-submit');
  const errorBox = document.getElementById('gk-auth-error');
  const keepSignedInBox = document.getElementById('gk-auth-keep-signed-in');
  const forgotLink = document.getElementById('gk-auth-forgot');

  let mode = 'login'; // 'login' | 'register'

  function applyMode() {
    if (mode === 'login') {
      title.textContent = 'Entrar no G.K.IO';
      sub.textContent = 'Bem-vindo de volta. Entre com seu e-mail e senha.';
      usernameField.style.display = 'none';
      submitBtn.textContent = 'Entrar';
      modeToggle.innerHTML = 'Não tem conta? <span class="gk-auth-toggle-action">Criar conta</span>';
    } else {
      title.textContent = 'Criar conta no G.K.IO';
      sub.textContent = 'Escolha um nome de usuário para começar.';
      usernameField.style.display = 'block';
      submitBtn.textContent = 'Criar conta';
      modeToggle.innerHTML = 'Já tem conta? <span class="gk-auth-toggle-action">Entrar</span>';
    }
    errorBox.style.display = 'none';
  }
  applyMode();

  modeToggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.classList.add('gk-btn-loading');
    const email = document.getElementById('gk-auth-email').value.trim();
    const password = document.getElementById('gk-auth-password').value;
    const username = document.getElementById('gk-auth-username').value.trim();
    justAuthenticatedViaForm = true;
    try {
      if (mode === 'register') {
        const newUser = await registerUser(username, email, password);
        toast(needsEmailVerification(newUser)
          ? 'Conta criada! Confirme seu e-mail para entrar.'
          : 'Bem-vindo(a) de volta ao G.K.IO.');
      } else {
        await loginUser(email, password, !keepSignedInBox || keepSignedInBox.checked);
      }
    } catch (err) {
      justAuthenticatedViaForm = false; // a autenticação não mudou de fato — desfaz a marcação
      errorBox.textContent = friendlyAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('gk-btn-loading');
    }
  });

  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Pré-preenche com o que já foi digitado no login, pra não pedir de novo.
      const typedEmail = document.getElementById('gk-auth-email').value.trim();
      showForgotPanel(typedEmail);
    });
  }

  wireForgotPasswordPanel();
  wireVerifyPanel();
}

// ---------- Aba dedicada de "esqueci minha senha" ----------
// Antes era só um link que disparava o e-mail na hora, sem nenhuma tela
// própria — agora é uma aba de verdade dentro do mesmo cartão, com seu
// próprio estado de carregamento, erro e confirmação de envio.
function showForgotPanel(prefillEmail = '') {
  document.getElementById('gk-auth-form').style.display = 'none';
  document.getElementById('gk-auth-mode-toggle').style.display = 'none';
  document.getElementById('gk-auth-forgot-panel').style.display = 'block';
  document.getElementById('gk-auth-forgot-form').style.display = 'block';
  document.getElementById('gk-auth-forgot-sent').style.display = 'none';
  const emailInput = document.getElementById('gk-auth-forgot-email');
  emailInput.value = prefillEmail;
  document.getElementById('gk-auth-forgot-error').style.display = 'none';
  setTimeout(() => emailInput.focus(), 0);
}

function hideForgotPanel() {
  document.getElementById('gk-auth-forgot-panel').style.display = 'none';
  document.getElementById('gk-auth-form').style.display = 'block';
  document.getElementById('gk-auth-mode-toggle').style.display = 'block';
}

function wireForgotPasswordPanel() {
  const emailInput = document.getElementById('gk-auth-forgot-email');
  const errorBox = document.getElementById('gk-auth-forgot-error');
  const submitBtn = document.getElementById('gk-auth-forgot-submit');
  const resendBtn = document.getElementById('gk-auth-forgot-resend');
  const backBtn = document.getElementById('gk-auth-forgot-back');

  async function send() {
    const email = emailInput.value.trim();
    if (!email) {
      errorBox.textContent = 'Digite seu e-mail primeiro.';
      errorBox.style.display = 'block';
      return;
    }
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.classList.add('gk-btn-loading');
    try {
      await sendPasswordResetEmail(auth, email);
      document.getElementById('gk-auth-forgot-sent-email').textContent = email;
      document.getElementById('gk-auth-forgot-form').style.display = 'none';
      document.getElementById('gk-auth-forgot-sent').style.display = 'block';
    } catch (err) {
      errorBox.textContent = friendlyAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('gk-btn-loading');
    }
  }

  submitBtn.addEventListener('click', send);
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, document.getElementById('gk-auth-forgot-sent-email').textContent);
      toast('Reenviado.');
    } catch (err) {
      toast(friendlyAuthError(err), 'danger');
    } finally {
      resendBtn.disabled = false;
    }
  });
  backBtn.addEventListener('click', hideForgotPanel);
}

// ---------- Tela de confirmação de e-mail ----------
function showVerifyPanel(fbUser, cameFromForm) {
  verifyCameFromForm = cameFromForm;
  document.getElementById('gk-auth-form').style.display = 'none';
  document.getElementById('gk-auth-mode-toggle').style.display = 'none';
  document.getElementById('gk-auth-forgot-panel').style.display = 'none';
  document.getElementById('gk-auth-verify-panel').style.display = 'block';
  document.getElementById('gk-auth-verify-email').textContent = fbUser.email || '';
  document.getElementById('gk-auth-verify-error').style.display = 'none';
  // Entra sozinho assim que o link for clicado (mesmo em outra aba/aparelho).
  if (!verifyPoll) verifyPoll = setInterval(() => checkVerified(true), 4000);
}

function hideVerifyPanel() {
  if (verifyPoll) { clearInterval(verifyPoll); verifyPoll = null; }
  const panel = document.getElementById('gk-auth-verify-panel');
  if (!panel || panel.style.display !== 'block') return;
  panel.style.display = 'none';
  document.getElementById('gk-auth-form').style.display = 'block';
  document.getElementById('gk-auth-mode-toggle').style.display = 'block';
}

async function checkVerified(silent) {
  const user = auth.currentUser;
  if (!user || enteringApp) return;
  const errorBox = document.getElementById('gk-auth-verify-error');
  try {
    await reload(user); // sem isso o emailVerified local nunca muda
  } catch (e) {
    if (!silent) { errorBox.textContent = friendlyAuthError(e); errorBox.style.display = 'block'; }
    return;
  }
  if (!user.emailVerified) {
    if (!silent) { errorBox.textContent = 'Ainda não consta como confirmado. Clique no link do e-mail e tente de novo.'; errorBox.style.display = 'block'; }
    return;
  }
  enteringApp = true;
  try {
    await getIdToken(user, true);
    hideVerifyPanel();
    await enterApp(user, verifyCameFromForm);
  } finally {
    enteringApp = false;
  }
}

function wireVerifyPanel() {
  const errorBox = document.getElementById('gk-auth-verify-error');
  const msg = document.getElementById('gk-auth-verify-msg');
  const checkBtn = document.getElementById('gk-auth-verify-check');
  const resendBtn = document.getElementById('gk-auth-verify-resend');
  const wrongBtn = document.getElementById('gk-auth-verify-wrong');

  checkBtn.addEventListener('click', async () => {
    errorBox.style.display = 'none';
    checkBtn.disabled = true;
    try { await checkVerified(false); } finally { checkBtn.disabled = false; }
  });

  resendBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    errorBox.style.display = 'none';
    resendBtn.disabled = true;
    try {
      await sendEmailVerification(user);
      msg.textContent = `Reenviamos o link para ${user.email}.`;
      msg.style.display = 'block';
    } catch (e) {
      msg.style.display = 'none';
      errorBox.textContent = friendlyAuthError(e);
      errorBox.style.display = 'block';
    }
    // Pausa curta: o Firebase limita envios seguidos para o mesmo e-mail.
    setTimeout(() => { resendBtn.disabled = false; }, 30000);
  });

  // E-mail digitado errado: apaga a conta ainda não confirmada (ela nunca virou
  // perfil de verdade) e volta pro formulário; se não der, só sai da conta.
  wrongBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    try { if (user) await deleteUser(user); }
    catch (_) { try { await signOut(auth); } catch (__) { /* noop */ } }
    if (auth.currentUser) { try { await signOut(auth); } catch (_) { /* noop */ } }
    msg.style.display = 'none';
    hideVerifyPanel();
  });
}

function friendlyAuthError(err) {
  const code = err && err.code || '';
  const map = {
    'auth/email-already-in-use': 'Este e-mail já está em uso.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'A senha precisa ter ao menos 6 caracteres.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  };
  return map[code] || err.message || 'Ocorreu um erro. Tente novamente.';
}
