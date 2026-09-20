// ============================================================
// G.K.IO — Configurações
// Menu lateral (Perfil / Áudio & Vídeo / Aparência / Notificações)
// com painel de conteúdo à direita, trocando de seção sem recarregar.
// ============================================================
import { db, doc, userDoc, usersCol, socialLinksCol, updateDoc, getDoc, getDocs, addDoc, deleteDoc, query, where, serverTimestamp } from './db.js';
import { state, el, toast, fallbackAvatar, normalizeUsername } from './state.js';
import { SOCIAL_ICONS, BADGE_CATALOG, refreshMiniProfile, uploadProfileImage } from './profile.js';
import { ACCENTS, PREMIUM_ACCENTS, getThemePrefs, setThemeMode, setAccent } from './theme.js';
import { getMediaPrefs, setMediaPrefs, getNotifPrefs, setNotifPrefs, listMediaDevices, requestDesktopPermission } from './prefs.js';
import { icon } from './icons.js';

const SECTIONS = [
  { id: 'perfil', label: 'Perfil', icon: 'user' },
  { id: 'audio-video', label: 'Áudio & Vídeo', icon: 'mic' },
  { id: 'aparencia', label: 'Aparência', icon: 'palette' },
  { id: 'notificacoes', label: 'Notificações', icon: 'bell' },
  { id: 'prime', label: 'G.K.IO Prime', icon: 'diamond' },
];
// Só aparece pra quem tem isAdmin: true no próprio doc (setado manualmente
// no console do Firebase — ver firestore.rules, isAdminUser()).
const ADMIN_SECTION = { id: 'admin', label: 'Administração', icon: 'wrench' };
function visibleSections() {
  return state.user?.isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
}

const FRAME_STYLES = [
  { id: 'none', label: 'Nenhuma' },
  { id: 'glacial', label: 'Glacial' },
  { id: 'aurora', label: 'Aurora' },
];

let activeSection = 'perfil';
let micTestStream = null;
let micTestRAF = null;
let camTestStream = null;

export function openSettingsModal(section = 'perfil') {
  activeSection = visibleSections().some((s) => s.id === section) ? section : 'perfil';
  const overlay = document.getElementById('gk-settings-overlay');
  renderNav();
  renderSection();
  overlay.classList.add('gk-open');
}

function closeSettingsModal() {
  stopMicTest();
  stopCamTest();
  document.getElementById('gk-settings-overlay').classList.remove('gk-open');
}

export function wireSettingsModal() {
  document.getElementById('gk-settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('gk-settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'gk-settings-overlay') closeSettingsModal();
  });
}

function renderNav() {
  const nav = document.getElementById('gk-settings-nav');
  nav.innerHTML = '';
  nav.appendChild(el('div', { class: 'gk-settings-nav-title' }, 'Configurações'));
  for (const s of visibleSections()) {
    nav.appendChild(el('div', {
      class: 'gk-settings-nav-item' + (activeSection === s.id ? ' gk-active' : ''),
      onclick: () => { stopMicTest(); stopCamTest(); activeSection = s.id; renderNav(); renderSection(); },
    }, [el('span', { class: 'gk-settings-nav-icon' }, [icon(s.icon, { size: 16 })]), el('span', {}, s.label)]));
  }
}

function renderSection() {
  const content = document.getElementById('gk-settings-content');
  content.innerHTML = '';
  if (activeSection === 'perfil') return renderPerfilSection(content);
  if (activeSection === 'audio-video') return renderAudioVideoSection(content);
  if (activeSection === 'aparencia') return renderAparenciaSection(content);
  if (activeSection === 'notificacoes') return renderNotificacoesSection(content);
  if (activeSection === 'prime') return renderPrimeSection(content);
  if (activeSection === 'admin' && state.user?.isAdmin) return renderAdminSection(content);
}

// ============================================================
// Seção: Perfil
// ============================================================
async function renderPerfilSection(content) {
  content.appendChild(sectionHeader('Perfil', 'Como você aparece para as outras pessoas no G.K.IO.'));

  const linksSnap = await getDocs(socialLinksCol(state.user.uid));
  const links = linksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let pendingAvatar = null;
  let pendingBanner = null;
  const isPrime = state.user.role === 'prime';

  const bannerPreview = el('div', {
    class: 'gk-settings-banner',
    style: (state.user.bannerUrl && state.user.bannerType !== 'video') ? `background-image:url(${state.user.bannerUrl})` : '',
  });
  if (state.user.bannerUrl && state.user.bannerType === 'video') {
    bannerPreview.appendChild(el('video', {
      src: state.user.bannerUrl, class: 'gk-settings-banner-video',
      autoplay: 'true', loop: 'true', muted: 'true', playsinline: 'true',
    }));
  } else if (!state.user.bannerUrl) {
    bannerPreview.textContent = 'Clique para escolher um banner';
  }
  const bannerInput = el('input', { type: 'file', accept: isPrime ? 'image/*,video/*' : 'image/*', style: 'display:none;' });
  bannerPreview.addEventListener('click', () => bannerInput.click());
  bannerInput.addEventListener('change', () => {
    const file = bannerInput.files[0];
    if (!file) return;
    pendingBanner = file;
    bannerPreview.innerHTML = '';
    bannerPreview.style.backgroundImage = '';
    if (file.type.startsWith('video/')) {
      bannerPreview.appendChild(el('video', {
        src: URL.createObjectURL(file), class: 'gk-settings-banner-video',
        autoplay: 'true', loop: 'true', muted: 'true', playsinline: 'true',
      }));
    } else {
      bannerPreview.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
    }
  });

  const avatarPreview = el('img', {
    src: state.user.avatarUrl || fallbackAvatar(state.user.username),
    class: 'gk-settings-avatar-preview',
  });
  const avatarInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const avatarWrap = el('div', { class: 'gk-settings-avatar-wrap', onclick: () => avatarInput.click() }, [avatarPreview, el('div', { class: 'gk-settings-avatar-edit' }, [icon('edit', { size: 13 })])]);
  avatarInput.addEventListener('change', () => {
    if (avatarInput.files[0]) {
      pendingAvatar = avatarInput.files[0];
      avatarPreview.src = URL.createObjectURL(pendingAvatar);
    }
  });

  const displayNameInput = el('input', { type: 'text', value: state.user.displayName || state.user.username });
  const bioInput = el('textarea', { placeholder: 'Conte algo sobre você...' }, state.user.bio || '');
  const usernameInput = el('input', { type: 'text', value: state.user.username, class: 'gk-mono', placeholder: 'nome-de-usuario' });
  const usernameError = el('div', { class: 'gk-error', style: 'display:none;' });

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    bannerPreview, bannerInput,
    !isPrime ? el('div', { class: 'gk-hint' }, 'Banners em vídeo/GIF são exclusivos de assinantes G.K.IO Prime.') : null,
    el('div', { class: 'gk-settings-identity-row' }, [
      avatarWrap, avatarInput,
    ]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Nome de exibição'), displayNameInput]),
    el('div', { class: 'gk-field' }, [
      el('label', {}, 'Nome de usuário'),
      el('div', { class: 'gk-field-row' }, [
        el('span', { class: 'gk-mono', style: 'color:var(--gk-gray-500);padding:0 2px;' }, '@'),
        usernameInput,
      ]),
      usernameError,
      el('div', { class: 'gk-hint' }, 'Só letras minúsculas, números, hífen e underline. Usado por outras pessoas para te adicionar como amigo.'),
    ]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Bio / status personalizado'), bioInput]),
  ]));

  // --- Links sociais ---
  const linksList = el('div', { id: 'gk-settings-links-list' });
  function renderLinksList() {
    linksList.innerHTML = '';
    for (const link of links) {
      linksList.appendChild(el('div', { class: 'gk-settings-link-row' }, [
        el('span', {}, [icon(SOCIAL_ICONS[link.platform] || 'link', { size: 15 })]),
        el('input', { type: 'text', value: link.url, style: 'flex:1;', oninput: (e) => { link.url = e.target.value; link._edited = true; } }),
        el('button', {
          class: 'gk-btn gk-btn-danger', style: 'padding:6px 9px;',
          onclick: () => { links.splice(links.indexOf(link), 1); if (link.id) link._deleted = true; renderLinksList(); },
        }, [icon('close', { size: 13 })]),
      ]));
    }
  }
  renderLinksList();

  const newPlatformSelect = el('select', { class: 'gk-select', style: 'width:auto;' },
    Object.keys(SOCIAL_ICONS).map((k) => el('option', { value: k }, k)));
  const newUrlInput = el('input', { type: 'text', placeholder: 'https://...', style: 'flex:1;' });

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Links sociais'),
    linksList,
    el('div', { style: 'display:flex;gap:6px;margin-top:6px;' }, [
      newPlatformSelect, newUrlInput,
      el('button', {
        class: 'gk-btn gk-btn-ghost',
        onclick: () => {
          if (!newUrlInput.value.trim()) return;
          links.push({ platform: newPlatformSelect.value, url: newUrlInput.value.trim(), _new: true });
          newUrlInput.value = '';
          renderLinksList();
        },
      }, 'Adicionar'),
    ]),
  ]));

  const saveBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Salvar alterações');
  content.appendChild(el('div', { class: 'gk-settings-save-row' }, [saveBtn]));

  saveBtn.addEventListener('click', async () => {
    usernameError.style.display = 'none';
    const newUsername = normalizeUsername(usernameInput.value);
    if (newUsername !== state.user.username) {
      if (newUsername.length < 3) {
        usernameError.textContent = 'O nome de usuário precisa ter ao menos 3 caracteres.';
        usernameError.style.display = 'block';
        return;
      }
      const takenQ = query(usersCol(), where('username', '==', newUsername));
      const takenSnap = await getDocs(takenQ);
      const takenByOther = takenSnap.docs.some((d) => d.id !== state.user.uid);
      if (takenByOther) {
        usernameError.textContent = 'Esse nome de usuário já está em uso.';
        usernameError.style.display = 'block';
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      const updates = {
        displayName: displayNameInput.value.trim() || state.user.username,
        bio: bioInput.value.trim(),
        username: newUsername,
      };
      if (pendingAvatar) updates.avatarUrl = await uploadProfileImage(pendingAvatar, 'avatars');
      if (pendingBanner) {
        updates.bannerUrl = await uploadProfileImage(pendingBanner, 'banners');
        updates.bannerType = pendingBanner.type.startsWith('video/') ? 'video' : 'image';
      }

      await updateDoc(userDoc(state.user.uid), updates);
      Object.assign(state.user, updates);

      for (const link of links) {
        if (link._deleted && link.id) await deleteDoc(doc(db, 'users', state.user.uid, 'socialLinks', link.id));
        else if (link._new) await addDoc(socialLinksCol(state.user.uid), { platform: link.platform, url: link.url });
        else if (link._edited && link.id) await updateDoc(doc(db, 'users', state.user.uid, 'socialLinks', link.id), { url: link.url });
      }

      toast('Perfil atualizado.');
      refreshMiniProfile();
    } catch (err) {
      toast(err.message || 'Falha ao salvar perfil.', 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar alterações';
    }
  });
}

// ============================================================
// Seção: Áudio & Vídeo
// ============================================================
async function renderAudioVideoSection(content) {
  content.appendChild(sectionHeader('Áudio & Vídeo', 'Escolha os dispositivos usados nas suas chamadas e canais de voz.'));
  const mediaPrefs = getMediaPrefs();

  const micSelect = el('select', { class: 'gk-select' }, [el('option', { value: '' }, 'Carregando dispositivos...')]);
  const camSelect = el('select', { class: 'gk-select' }, [el('option', { value: '' }, 'Carregando dispositivos...')]);
  const speakerSelect = el('select', { class: 'gk-select' }, [el('option', { value: '' }, 'Carregando dispositivos...')]);

  const meterFill = el('div', { class: 'gk-mic-meter-fill' });
  const meterBox = el('div', { class: 'gk-mic-meter' }, [meterFill]);
  const micTestBtn = el('button', { class: 'gk-btn gk-btn-ghost' }, 'Testar microfone');
  const camPreview = el('video', { class: 'gk-cam-preview', autoplay: 'true', muted: 'true', playsinline: 'true' });
  const camTestBtn = el('button', { class: 'gk-btn gk-btn-ghost' }, 'Testar câmera');

  micTestBtn.addEventListener('click', async () => {
    if (micTestStream) { stopMicTest(); micTestBtn.textContent = 'Testar microfone'; return; }
    try {
      await startMicTest(meterFill, micSelect.value);
      micTestBtn.textContent = 'Parar teste';
    } catch (e) { toast('Não foi possível acessar o microfone.', 'danger'); }
  });
  camTestBtn.addEventListener('click', async () => {
    if (camTestStream) { stopCamTest(); camPreview.srcObject = null; camTestBtn.textContent = 'Testar câmera'; return; }
    try {
      camTestStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camSelect.value ? { exact: camSelect.value } : undefined } });
      camPreview.srcObject = camTestStream;
      camTestBtn.textContent = 'Parar teste';
    } catch (e) { toast('Não foi possível acessar a câmera.', 'danger'); }
  });

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Entrada de áudio'),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Microfone'), micSelect]),
    el('div', { class: 'gk-field' }, [meterBox, micTestBtn]),
    toggleRow('Cancelamento de eco', mediaPrefs.echoCancellation, (v) => setMediaPrefs({ echoCancellation: v })),
    toggleRow('Supressão de ruído', mediaPrefs.noiseSuppression, (v) => setMediaPrefs({ noiseSuppression: v })),
    toggleRow('Controle automático de ganho', mediaPrefs.autoGainControl, (v) => setMediaPrefs({ autoGainControl: v })),
  ]));

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Saída de áudio'),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Alto-falante'), speakerSelect]),
  ]));

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Câmera'),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Dispositivo de vídeo'), camSelect]),
    el('div', { class: 'gk-field' }, [camPreview, camTestBtn]),
  ]));

  micSelect.addEventListener('change', () => setMediaPrefs({ micId: micSelect.value }));
  camSelect.addEventListener('change', () => setMediaPrefs({ camId: camSelect.value }));
  speakerSelect.addEventListener('change', () => setMediaPrefs({ speakerId: speakerSelect.value }));

  const { mics, cams, speakers } = await listMediaDevices();
  fillDeviceSelect(micSelect, mics, mediaPrefs.micId, 'Padrão do sistema');
  fillDeviceSelect(camSelect, cams, mediaPrefs.camId, 'Padrão do sistema');
  fillDeviceSelect(speakerSelect, speakers, mediaPrefs.speakerId, 'Padrão do sistema');
}

function fillDeviceSelect(selectEl, devices, currentId, defaultLabel) {
  selectEl.innerHTML = '';
  selectEl.appendChild(el('option', { value: '' }, defaultLabel));
  devices.forEach((d, i) => {
    selectEl.appendChild(el('option', { value: d.deviceId }, d.label || `Dispositivo ${i + 1}`));
  });
  selectEl.value = currentId && devices.some((d) => d.deviceId === currentId) ? currentId : '';
}

async function startMicTest(meterFill, deviceId) {
  micTestStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(micTestStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    meterFill.style.width = Math.min(100, (avg / 90) * 100) + '%';
    micTestRAF = requestAnimationFrame(tick);
  }
  tick();
  micTestStream._audioCtx = ctx;
}

function stopMicTest() {
  if (micTestRAF) { cancelAnimationFrame(micTestRAF); micTestRAF = null; }
  if (micTestStream) {
    micTestStream.getTracks().forEach((t) => t.stop());
    if (micTestStream._audioCtx) micTestStream._audioCtx.close();
    micTestStream = null;
  }
}
function stopCamTest() {
  if (camTestStream) { camTestStream.getTracks().forEach((t) => t.stop()); camTestStream = null; }
}

// ============================================================
// Seção: Aparência
// ============================================================
function renderAparenciaSection(content) {
  content.appendChild(sectionHeader('Aparência', 'Personalize o visual do G.K.IO em tempo real.'));
  const prefs = getThemePrefs();

  const modes = [
    { id: 'light', label: 'Claro', icon: 'sun' },
    { id: 'dark', label: 'Escuro', icon: 'moon' },
    { id: 'auto', label: 'Automático', icon: 'screenShare' },
  ];
  const modeRow = el('div', { class: 'gk-theme-mode-row' }, modes.map((m) =>
    el('div', {
      class: 'gk-theme-mode-btn' + (prefs.mode === m.id ? ' gk-active' : ''),
      onclick: () => { setThemeMode(m.id); renderSection(); },
    }, [el('span', {}, [icon(m.icon, { size: 16 })]), el('span', {}, m.label)])
  ));

  const isPrime = state.user.role === 'prime';
  const swatchRow = el('div', { class: 'gk-accent-swatch-row' }, [
    ...Object.entries(ACCENTS).map(([key, a]) => buildAccentSwatch(key, a, prefs, false)),
    ...Object.entries(PREMIUM_ACCENTS).map(([key, a]) => buildAccentSwatch(key, a, prefs, !isPrime)),
  ]);

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Modo de exibição'),
    modeRow,
  ]));
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, [
      'Cor de destaque',
      !isPrime ? el('span', { class: 'gk-settings-card-title-hint' }, [icon('diamond', { size: 12 }), ' cores exigem Prime']) : null,
    ]),
    swatchRow,
  ]));
}

function buildAccentSwatch(key, a, prefs, locked) {
  return el('div', {
    class: 'gk-accent-swatch' + (prefs.accent === key ? ' gk-active' : '') + (locked ? ' gk-locked' : ''),
    style: `background:${a.accent};`,
    title: locked ? `${a.name} (exclusivo G.K.IO Prime)` : a.name,
    onclick: () => {
      if (locked) { toast('Essa cor é exclusiva para assinantes G.K.IO Prime.', 'danger'); return; }
      setAccent(key); renderSection();
    },
  }, [locked ? icon('lock', { size: 13 }) : (prefs.accent === key ? icon('check', { size: 13 }) : null)]);
}

// ============================================================
// Seção: Notificações
// ============================================================
function renderNotificacoesSection(content) {
  content.appendChild(sectionHeader('Notificações', 'Controle como o G.K.IO te avisa sobre novidades.'));
  const prefs = getNotifPrefs();

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    toggleRow('Som ao receber mensagem', prefs.sound, (v) => setNotifPrefs({ sound: v })),
    toggleRow('Mostrar prévia da mensagem', prefs.preview, (v) => setNotifPrefs({ preview: v })),
    toggleRow('Notificações do sistema (desktop)', prefs.desktop, async (v, rowEl) => {
      if (v) {
        const perm = await requestDesktopPermission();
        if (perm !== 'granted') {
          toast('Permissão de notificação negada pelo navegador.', 'danger');
          rowEl.querySelector('.gk-toggle').classList.remove('gk-on');
          return;
        }
      }
      setNotifPrefs({ desktop: v });
    }),
  ]));
}

// ============================================================
// Seção: G.K.IO Prime
// ============================================================
function renderPrimeSection(content) {
  content.appendChild(sectionHeader('G.K.IO Prime', 'Customizações e vantagens exclusivas de assinante.'));

  if (state.user.role !== 'prime') {
    renderPrimeLockedView(content);
    return;
  }

  renderPrimeActiveView(content);
}

// ---------- Visão de quem ainda não é Prime ----------
function renderPrimeLockedView(content) {
  content.appendChild(el('div', { class: 'gk-settings-card gk-prime-upsell' }, [
    el('div', { class: 'gk-prime-upsell-icon' }, [icon('diamond', { size: 28 })]),
    el('div', { class: 'gk-prime-upsell-title' }, 'Você ainda não é Prime'),
    el('div', { class: 'gk-prime-upsell-sub' },
      'Assinantes Prime ganham moldura de avatar animada, tag personalizada ao lado do nome, cores de destaque exclusivas e limites maiores de upload de emoji.'),
    el('button', {
      class: 'gk-btn gk-btn-primary',
      onclick: () => toast('A assinatura ainda não está disponível — em breve!'),
    }, 'Saiba mais'),
  ]));
}

// ---------- Visão de quem já é Prime ----------
function renderPrimeActiveView(content) {
  const tagInput = el('input', {
    type: 'text', maxlength: '16', placeholder: 'ex: dev, GM, fundador',
    value: state.user.tag || '',
  });

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, [icon('diamond', { size: 14 }), ' Membro Prime']),
    el('div', { class: 'gk-hint' }, primeSinceLabel(state.user.primeSince)),
  ]));

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Tag personalizada'),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Aparece ao lado do seu nome no chat'), tagInput]),
  ]));

  const frameRow = el('div', { class: 'gk-frame-style-row' }, FRAME_STYLES.map((f) =>
    el('div', {
      class: 'gk-frame-style-swatch' + (state.user.frameStyle === f.id ? ' gk-active' : ''),
      'data-frame-preview': f.id,
      onclick: () => selectFrameStyle(f.id, frameRow),
    }, [
      el('div', { class: 'gk-avatar gk-sz-40', 'data-frame': f.id }, [
        el('img', { src: state.user.avatarUrl || fallbackAvatar(state.user.username) }),
      ]),
      el('span', {}, f.label),
    ])
  ));

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Moldura de avatar'),
    frameRow,
  ]));

  const saveBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Salvar alterações');
  content.appendChild(el('div', { class: 'gk-settings-save-row' }, [saveBtn]));

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      const updates = { tag: tagInput.value.trim().slice(0, 16) };
      await updateDoc(userDoc(state.user.uid), updates);
      Object.assign(state.user, updates);
      toast('Preferências Prime salvas.');
      refreshMiniProfile();
    } catch (err) {
      toast(err.message || 'Falha ao salvar.', 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar alterações';
    }
  });
}

function selectFrameStyle(frameId, frameRow) {
  state.user.frameStyle = frameId; // otimista — a persistência real acontece no updateDoc abaixo
  frameRow.querySelectorAll('.gk-frame-style-swatch').forEach((n) => n.classList.remove('gk-active'));
  frameRow.querySelector(`[data-frame-preview="${frameId}"]`).classList.add('gk-active');
  updateDoc(userDoc(state.user.uid), { frameStyle: frameId })
    .then(refreshMiniProfile)
    .catch(() => toast('Não foi possível salvar a moldura.', 'danger'));
}

function primeSinceLabel(ts) {
  if (!ts || !ts.toDate) return 'Assinante Prime.';
  const d = ts.toDate();
  return `Assinante Prime desde ${d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}.`;
}

// ============================================================
// Seção: Administração (só visível com isAdmin: true)
// ============================================================
function renderAdminSection(content) {
  content.appendChild(sectionHeader('Administração', 'Gerencie assinaturas Prime e insígnias de qualquer usuário.'));

  const searchInput = el('input', { type: 'text', placeholder: 'nome-de-usuario' });
  const searchBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Buscar');
  const resultBox = el('div', {});

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Buscar usuário por username'),
    el('div', { class: 'gk-field-row' }, [searchInput, searchBtn]),
  ]));
  content.appendChild(resultBox);

  async function doSearch() {
    const username = searchInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!username) return;
    resultBox.innerHTML = '';
    searchBtn.disabled = true;
    try {
      const q = query(usersCol(), where('username', '==', username));
      const snap = await getDocs(q);
      if (snap.empty) {
        resultBox.appendChild(el('div', { class: 'gk-hint' }, 'Usuário não encontrado.'));
        return;
      }
      const d = snap.docs[0];
      renderAdminUserCard(resultBox, { uid: d.id, ...d.data() });
    } finally {
      searchBtn.disabled = false;
    }
  }
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
}

function renderAdminUserCard(container, target) {
  container.innerHTML = '';
  let pendingRole = target.role || 'free';

  const roleBtn = el('button', { class: 'gk-btn ' + (pendingRole === 'prime' ? 'gk-btn-danger' : 'gk-btn-primary'), type: 'button' },
    pendingRole === 'prime' ? 'Remover Prime' : 'Tornar Prime');
  roleBtn.addEventListener('click', () => {
    pendingRole = pendingRole === 'prime' ? 'free' : 'prime';
    roleBtn.textContent = pendingRole === 'prime' ? 'Remover Prime' : 'Tornar Prime';
    roleBtn.className = 'gk-btn ' + (pendingRole === 'prime' ? 'gk-btn-danger' : 'gk-btn-primary');
  });

  const badgeChecks = {};
  const badgesRow = el('div', { class: 'gk-admin-badges-row' }, Object.entries(BADGE_CATALOG).map(([key, b]) => {
    const cb = el('input', { type: 'checkbox' });
    if ((target.customBadges || []).includes(key)) cb.checked = true;
    badgeChecks[key] = cb;
    return el('label', { class: 'gk-admin-badge-check' }, [cb, icon(b.icon, { size: 13 }), ` ${b.label}`]);
  }));

  const saveBtn = el('button', { class: 'gk-btn gk-btn-primary' }, 'Salvar');

  container.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-admin-user-head' }, [
      el('img', { class: 'gk-admin-user-avatar', src: target.avatarUrl || fallbackAvatar(target.username) }),
      el('div', {}, [
        el('div', { class: 'gk-name' }, target.displayName || target.username),
        el('div', { class: 'gk-hint' }, '@' + target.username + (target.role === 'prime' ? ' · atualmente Prime' : ' · atualmente free')),
      ]),
    ]),
    el('div', { class: 'gk-settings-card-title', style: 'margin-top:16px;' }, 'Assinatura'),
    roleBtn,
    el('div', { class: 'gk-settings-card-title', style: 'margin-top:16px;' }, 'Insígnias'),
    badgesRow,
    el('div', { class: 'gk-settings-save-row' }, [saveBtn]),
  ]));

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      const customBadges = Object.entries(badgeChecks).filter(([, cb]) => cb.checked).map(([key]) => key);
      const updates = { role: pendingRole, customBadges };
      if (pendingRole === 'prime' && target.role !== 'prime') updates.primeSince = serverTimestamp();
      await updateDoc(userDoc(target.uid), updates);
      toast(`Perfil de @${target.username} atualizado.`);
      target.role = pendingRole;
      target.customBadges = customBadges;
    } catch (err) {
      toast(err.message || 'Falha ao salvar — confira se isAdmin: true está setado na sua conta.', 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar';
    }
  });
}

// ============================================================
// Helpers de UI
// ============================================================
function sectionHeader(title, sub) {
  return el('div', { class: 'gk-settings-section-header' }, [
    el('h2', {}, title),
    el('p', { class: 'gk-modal-sub' }, sub),
  ]);
}

function toggleRow(label, checked, onChange) {
  const row = el('div', { class: 'gk-toggle-row' });
  const toggle = el('div', { class: 'gk-toggle' + (checked ? ' gk-on' : '') });
  toggle.addEventListener('click', () => {
    const next = !toggle.classList.contains('gk-on');
    toggle.classList.toggle('gk-on', next);
    onChange(next, row);
  });
  row.appendChild(el('span', {}, label));
  row.appendChild(toggle);
  return row;
}
