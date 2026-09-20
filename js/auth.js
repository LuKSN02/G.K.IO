// ============================================================
// G.K.IO — Autenticação
// ============================================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, fbUpdateProfile, userDoc, setDoc, getDoc, updateDoc, serverTimestamp,
  setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail,
} from './db.js';
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

export function initAuthListener() {
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      state.user = null;
      justAuthenticatedViaForm = false;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      showAuthGate();
      return;
    }
    const cameFromForm = justAuthenticatedViaForm;
    justAuthenticatedViaForm = false;

    const profileSnap = await getDoc(userDoc(fbUser.uid));
    if (!profileSnap.exists()) {
      // Não deveria acontecer no fluxo normal (o registro já cria o doc), mas por segurança:
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
  });
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
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await fbUpdateProfile(cred.user, { displayName: username });
  await bootstrapUserDoc(cred.user.uid, username, email);
  return cred.user;
}

export async function loginUser(email, password, keepSignedIn = true) {
  // "Manter-me conectado" desmarcado = sessão morre ao fechar a aba/app
  // (browserSessionPersistence); marcado (padrão) = sobrevive, como hoje.
  await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutUser() {
  await setPresence('offline');
  await signOut(auth);
}

function showAuthGate() {
  document.getElementById('gk-auth').style.display = 'flex';
  document.getElementById('gk-app').classList.remove('gk-ready');
}
function hideAuthGate() {
  document.getElementById('gk-auth').style.display = 'none';
  document.getElementById('gk-app').classList.add('gk-ready');
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
        await registerUser(username, email, password);
        toast('Conta criada! Bem-vindo(a) ao G.K.IO.');
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
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = document.getElementById('gk-auth-email').value.trim();
      if (!email) {
        errorBox.textContent = 'Digite seu e-mail no campo acima primeiro.';
        errorBox.style.display = 'block';
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        toast(`Enviamos um link de redefinição pra ${email}.`);
      } catch (err) {
        errorBox.textContent = friendlyAuthError(err);
        errorBox.style.display = 'block';
      }
    });
  }
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
  };
  return map[code] || err.message || 'Ocorreu um erro. Tente novamente.';
}
