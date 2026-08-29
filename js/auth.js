// ============================================================
// G.K.IO — Autenticação
// ============================================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, fbUpdateProfile, userDoc, setDoc, getDoc, updateDoc, serverTimestamp,
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

export function initAuthListener() {
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      state.user = null;
      justAuthenticatedViaForm = false;
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
    // Sessão restaurada automaticamente (não veio de um submit do formulário)
    // = a pessoa já tinha feito cadastro + primeiro login antes -> mostra a
    // animação de abertura. No cadastro/login manual, pula direto pro app.
    if (!cameFromForm) showStartupSplash();
    onReadyCallback && onReadyCallback();

    window.addEventListener('beforeunload', () => { setPresence('offline'); });
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
    await updateDoc(userDoc(auth.currentUser.uid), { statusPresence });
    if (state.user) state.user.statusPresence = statusPresence;
  } catch (e) { /* doc pode ainda não existir na primeira chamada — ignora */ }
}

export async function registerUser(username, email, password) {
  username = normalizeUsername(username);
  if (username.length < 3) throw new Error('O nome de usuário precisa ter ao menos 3 caracteres.');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await fbUpdateProfile(cred.user, { displayName: username });
  await bootstrapUserDoc(cred.user.uid, username, email);
  return cred.user;
}

export async function loginUser(email, password) {
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

  let mode = 'login'; // 'login' | 'register'

  function applyMode() {
    if (mode === 'login') {
      title.textContent = 'Entrar no G.K.IO';
      sub.textContent = 'Bem-vindo de volta. Entre com seu e-mail e senha.';
      usernameField.style.display = 'none';
      submitBtn.textContent = 'Entrar';
      modeToggle.textContent = 'Não tem conta? Criar conta';
    } else {
      title.textContent = 'Criar conta no G.K.IO';
      sub.textContent = 'Escolha um nome de usuário para começar.';
      usernameField.style.display = 'block';
      submitBtn.textContent = 'Criar conta';
      modeToggle.textContent = 'Já tem conta? Entrar';
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
    const email = document.getElementById('gk-auth-email').value.trim();
    const password = document.getElementById('gk-auth-password').value;
    const username = document.getElementById('gk-auth-username').value.trim();
    justAuthenticatedViaForm = true;
    try {
      if (mode === 'register') {
        await registerUser(username, email, password);
        toast('Conta criada! Bem-vindo(a) ao G.K.IO.');
      } else {
        await loginUser(email, password);
      }
    } catch (err) {
      justAuthenticatedViaForm = false; // a autenticação não mudou de fato — desfaz a marcação
      errorBox.textContent = friendlyAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
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
  };
  return map[code] || err.message || 'Ocorreu um erro. Tente novamente.';
}
