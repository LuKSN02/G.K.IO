// ============================================================
// G.K.IO — Configurações
// Menu lateral (Perfil / Áudio & Vídeo / Aparência / Notificações)
// com painel de conteúdo à direita, trocando de seção sem recarregar.
// ============================================================
import { db, doc, userDoc, usersCol, socialLinksCol, updateDoc, getDoc, getDocs, addDoc, deleteDoc, query, where, serverTimestamp } from './db.js';
import { state, el, toast, fallbackAvatar, normalizeUsername, PROFILE_EFFECTS, NAMEPLATES, activeCustomStatus, hexToRgba } from './state.js';
import { SOCIAL_ICONS, BADGE_CATALOG, refreshMiniProfile, uploadProfileImage, applyWallpaper } from './profile.js';
import { ACCENTS, PREMIUM_ACCENTS, getThemePrefs, setThemeMode, setAccent } from './theme.js';
import { VIDEO_EFFECTS } from './voice-fx.js';
import { linkPreviewsEnabled, setLinkPreviews } from './link-preview.js';
import { buildReportsCard } from './reports.js';
import { getMediaPrefs, setMediaPrefs, SCREEN_QUALITIES, getNotifPrefs, setNotifPrefs, listMediaDevices, requestDesktopPermission } from './prefs.js';
import { icon } from './icons.js';
import { openImageCropper } from './cropper.js';
import { renderAccountSection } from './settings-account.js';
import { buildCustomAccentCard, buildReadingCard, buildSurfaceCard, renderAccessibilitySection } from './settings-appearance.js';
import { buildZoomCard, buildDesktopCard, buildHotkeysCard, buildIdleCard, renderExtensionsSection } from './settings-extras.js';

const SECTIONS = [
  { id: 'perfil', label: 'Perfil', icon: 'user' },
  { id: 'conta', label: 'Conta', icon: 'lock' },
  { id: 'audio-video', label: 'Áudio & Vídeo', icon: 'mic' },
  { id: 'aparencia', label: 'Aparência', icon: 'palette' },
  { id: 'acessibilidade', label: 'Acessibilidade', icon: 'eye' },
  { id: 'notificacoes', label: 'Notificações', icon: 'bell' },
  { id: 'extensoes', label: 'Temas & Plugins', icon: 'sparkles' },
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
  nav.appendChild(el('div', { class: 'gk-settings-nav-footer' }, [
    el('img', { src: 'img/logo.png', alt: '' }),
    el('p', {}, ['Mais que um chat,', el('br'), 'uma comunidade.']),
  ]));
}

function renderSection() {
  const content = document.getElementById('gk-settings-content');
  content.innerHTML = '';
  if (activeSection === 'perfil') return renderPerfilSection(content);
  if (activeSection === 'conta') return renderAccountSection(content, { sectionHeader, toggleRow });
  if (activeSection === 'audio-video') return renderAudioVideoSection(content);
  if (activeSection === 'aparencia') return renderAparenciaSection(content);
  if (activeSection === 'acessibilidade') return renderAccessibilitySection(content, sectionHeader);
  if (activeSection === 'notificacoes') return renderNotificacoesSection(content);
  if (activeSection === 'extensoes') return renderExtensionsSection(content, sectionHeader);
  if (activeSection === 'prime') return renderPrimeSection(content);
  if (activeSection === 'admin' && state.user?.isAdmin) return renderAdminSection(content);
}

// ============================================================
// Seção: Perfil
// ============================================================
async function renderPerfilSection(content) {
  content.appendChild(sectionHeader('Perfil', 'Como você aparece para as outras pessoas no G.K.IO.', 'user'));

  const linksSnap = await getDocs(socialLinksCol(state.user.uid));
  const links = linksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let pendingAvatar = null;
  let pendingAvatarUrl = null; // avatar reaproveitado da lista de recentes
  let pendingBanner = null;
  const isPrime = state.user.role === 'prime';

  const bannerPreview = el('div', {
    class: 'gk-settings-banner',
    style: (state.user.bannerUrl && state.user.bannerType !== 'video') ? `background-image:url(${state.user.bannerUrl})` : '',
  });
  if (state.user.bannerUrl && state.user.bannerType === 'video') {
    const previewVideo = el('video', {
      src: state.user.bannerUrl, class: 'gk-settings-banner-video',
      autoplay: 'true', loop: 'true', muted: 'true', playsinline: 'true',
    });
    previewVideo.muted = true; // o atributo sozinho não muta um <video> criado por JS
    bannerPreview.appendChild(previewVideo);
  } else if (!state.user.bannerUrl) {
    bannerPreview.textContent = 'Clique para escolher um banner';
  }
  const bannerInput = el('input', { type: 'file', accept: isPrime ? 'image/*,video/*' : 'image/*', style: 'display:none;' });
  bannerPreview.addEventListener('click', () => bannerInput.click());
  bannerInput.addEventListener('change', async () => {
    const file = bannerInput.files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) {
      pendingBanner = file;
      bannerPreview.innerHTML = '';
      bannerPreview.style.backgroundImage = '';
      const pickedVideo = el('video', {
        src: URL.createObjectURL(file), class: 'gk-settings-banner-video',
        autoplay: 'true', loop: 'true', muted: 'true', playsinline: 'true',
      });
      pickedVideo.muted = true;
      bannerPreview.appendChild(pickedVideo);
      return;
    }
    const cropped = await openImageCropper(file, 3, { title: 'Ajustar banner', outputWidth: 1200 });
    if (!cropped) return;
    pendingBanner = cropped;
    bannerPreview.innerHTML = '';
    bannerPreview.style.backgroundImage = `url(${URL.createObjectURL(cropped)})`;
  });

  const avatarPreview = el('img', {
    src: state.user.avatarUrl || fallbackAvatar(state.user.username),
    class: 'gk-settings-avatar-preview',
  });
  const avatarInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const avatarWrap = el('div', { class: 'gk-settings-avatar-wrap', onclick: () => avatarInput.click() }, [avatarPreview, el('div', { class: 'gk-settings-avatar-edit' }, [icon('edit', { size: 13 })])]);
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    if (!file) return;
    const cropped = await openImageCropper(file, 1, { title: 'Ajustar avatar', outputWidth: 512 });
    if (!cropped) return;
    pendingAvatar = cropped;
    avatarPreview.src = URL.createObjectURL(cropped);
  });

  const displayNameInput = el('input', { type: 'text', value: state.user.displayName || state.user.username });
  const pronounsInput = el('input', { type: 'text', maxlength: '32', placeholder: 'ex: ela/dela, ele/dele, elu/delu', value: state.user.pronouns || '' });
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
    el('div', { class: 'gk-field' }, [el('label', {}, 'Pronomes'), pronounsInput, el('div', { class: 'gk-hint' }, 'Opcional — aparece ao lado do seu @ no cartão de perfil.')]),
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


  // --- Avatares recentes: reaproveita uma imagem que você já usou ---
  const history = (state.user.avatarHistory || []).filter(Boolean);
  if (history.length) {
    const histRow = el('div', { class: 'gk-avatar-history-row' }, history.map((url) =>
      el('button', {
        type: 'button', class: 'gk-avatar-history-item', title: 'Usar este avatar',
        onclick: () => {
          pendingAvatar = null;
          pendingAvatarUrl = url;
          avatarPreview.src = url;
          histRow.querySelectorAll('.gk-avatar-history-item').forEach((b) => b.classList.remove('gk-active'));
          histRow.querySelector(`[data-url="${CSS.escape(url)}"]`)?.classList.add('gk-active');
        },
        'data-url': url,
      }, [el('img', { src: url, alt: '' })])));
    content.appendChild(el('div', { class: 'gk-settings-card' }, [
      el('div', { class: 'gk-settings-card-title' }, 'Avatares recentes'),
      histRow,
      el('div', { class: 'gk-hint' }, 'Escolha um e clique em "Salvar alterações" para voltar a usá-lo.'),
    ]));
  }

  // --- Status personalizado (texto + emoji + duração) ---
  const currentCs = activeCustomStatus(state.user);
  let csEmoji = currentCs?.emoji || '';
  let csDirty = false;
  const csText = el('input', { type: 'text', maxlength: '60', placeholder: 'O que está rolando?', value: currentCs?.text || '', oninput: () => { csDirty = true; } });
  const csEmojiShow = el('span', { class: 'gk-cs-emoji-show' }, csEmoji || '🙂');
  const csDuration = el('select', { class: 'gk-select', onchange: () => { csDirty = true; } }, [
    el('option', { value: 'never' }, 'Não limpar'),
    el('option', { value: '30' }, 'Em 30 minutos'),
    el('option', { value: '60' }, 'Em 1 hora'),
    el('option', { value: '240' }, 'Em 4 horas'),
    el('option', { value: 'today' }, 'Hoje'),
  ]);
  const quickEmoji = ['🎮', '📚', '💻', '🎧', '💤', '🍕', '🔥', '🎨', '🚗', '🏠'];
  const csQuick = el('div', { class: 'gk-cs-quick' }, quickEmoji.map((e) =>
    el('button', { type: 'button', class: 'gk-cs-quick-btn', onclick: () => { csEmoji = e; csEmojiShow.textContent = e; csDirty = true; } }, e)));
  const csClear = el('button', {
    type: 'button', class: 'gk-btn gk-btn-ghost gk-btn-sm',
    onclick: () => { csEmoji = ''; csText.value = ''; csEmojiShow.textContent = '🙂'; csDirty = true; },
  }, 'Limpar status');
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Status personalizado'),
    el('div', { class: 'gk-field-row' }, [csEmojiShow, csText]),
    csQuick,
    el('div', { class: 'gk-field', style: 'margin-top:8px;' }, [el('label', {}, 'Limpar depois de'), csDuration]),
    csClear,
  ]));

  // --- Aparência do cartão: tema, efeito e placa de nome (Prime) ---
  const cur = {
    themeOn: !!(state.user.profileTheme && state.user.profileTheme.primary),
    primary: state.user.profileTheme?.primary || '#6c63ff',
    accent: state.user.profileTheme?.accent || '#38e0c8',
    effect: state.user.profileEffect || 'none',
    nameplate: state.user.nameplate || 'none',
  };
  let appearanceDirty = false;
  const lockedMsg = () => toast('Tema, efeitos e placas de nome são exclusivos G.K.IO Prime.', 'danger');

  const pv = el('div', { class: 'gk-pc-preview' });
  const pvName = el('div', { class: 'gk-pc-preview-name' }, state.user.displayName || state.user.username);
  const pvPlate = el('div', { class: 'gk-pc-preview-plate' }, [pvName]);
  const pvFx = el('div', { class: 'gk-profile-fx' });
  pv.append(pvFx, pvPlate);
  function renderPreview() {
    pv.style.backgroundImage = cur.themeOn ? `linear-gradient(135deg, ${cur.primary}, ${cur.accent})` : '';
    pvPlate.setAttribute('data-nameplate', cur.nameplate);
    pvFx.setAttribute('data-fx', cur.effect);
    pvFx.innerHTML = '';
    if (cur.effect !== 'none') for (let i = 0; i < 14; i++) pvFx.appendChild(el('i'));
  }

  const colorPrimary = el('input', { type: 'color', value: cur.primary, oninput: (e) => { if (!isPrime) { e.target.value = cur.primary; return lockedMsg(); } cur.primary = e.target.value; cur.themeOn = true; appearanceDirty = true; themeToggle.checked = true; renderPreview(); } });
  const colorAccent = el('input', { type: 'color', value: cur.accent, oninput: (e) => { if (!isPrime) { e.target.value = cur.accent; return lockedMsg(); } cur.accent = e.target.value; cur.themeOn = true; appearanceDirty = true; themeToggle.checked = true; renderPreview(); } });
  const themeToggle = el('input', { type: 'checkbox', onchange: (e) => { if (!isPrime) { e.target.checked = false; return lockedMsg(); } cur.themeOn = e.target.checked; appearanceDirty = true; renderPreview(); } });
  themeToggle.checked = cur.themeOn;

  function swatchRow(list, key, labelPrefix) {
    const row = el('div', { class: 'gk-cosmetic-row' });
    for (const o of list) {
      row.appendChild(el('button', {
        type: 'button', class: 'gk-cosmetic-swatch' + (cur[key] === o.id ? ' gk-active' : ''), 'data-id': o.id,
        'data-nameplate': key === 'nameplate' ? o.id : null,
        onclick: () => {
          if (!isPrime && o.id !== 'none') return lockedMsg();
          cur[key] = o.id; appearanceDirty = true;
          row.querySelectorAll('.gk-cosmetic-swatch').forEach((b) => b.classList.toggle('gk-active', b.dataset.id === o.id));
          renderPreview();
        },
      }, o.label));
    }
    return row;
  }

  renderPreview();
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, [icon('diamond', { size: 14 }), ' Aparência do cartão']),
    !isPrime ? el('div', { class: 'gk-hint' }, 'Exclusivo G.K.IO Prime — você pode olhar as opções, mas só assinantes aplicam.') : null,
    pv,
    el('label', { class: 'gk-admin-badge-check', style: 'margin-top:12px;' }, [themeToggle, ' Usar cores personalizadas']),
    el('div', { class: 'gk-field-row', style: 'gap:12px;margin-top:6px;' }, [
      el('label', { class: 'gk-color-field' }, ['Cor principal ', colorPrimary]),
      el('label', { class: 'gk-color-field' }, ['Cor de destaque ', colorAccent]),
    ]),
    el('div', { class: 'gk-settings-card-title', style: 'margin-top:14px;' }, 'Efeito ao abrir o perfil'),
    swatchRow(PROFILE_EFFECTS, 'effect'),
    el('div', { class: 'gk-settings-card-title', style: 'margin-top:14px;' }, 'Placa de nome'),
    el('div', { class: 'gk-hint' }, 'Aparece atrás do seu nome na lista de membros, nas conversas diretas e no cartão.'),
    swatchRow(NAMEPLATES, 'nameplate'),
  ]));

  // --- Privacidade do perfil ---
  const priv = state.user.privacy || {};
  const hideActivityCb = el('input', { type: 'checkbox' });
  hideActivityCb.checked = !!priv.hideActivity;
  const hideLinksCb = el('input', { type: 'checkbox' });
  hideLinksCb.checked = !!priv.hideLinks;
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Privacidade do perfil'),
    el('label', { class: 'gk-admin-badge-check' }, [hideActivityCb, ' Ocultar o jogo que estou jogando']),
    el('label', { class: 'gk-admin-badge-check' }, [hideLinksCb, ' Ocultar meus links sociais no cartão']),
    el('div', { class: 'gk-hint' }, 'Vale para o cartão de perfil das outras pessoas. Você continua vendo tudo no seu.'),
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
        pronouns: pronounsInput.value.trim().slice(0, 32),
        privacy: { hideActivity: hideActivityCb.checked, hideLinks: hideLinksCb.checked },
      };
      // Avatar novo (upload) ou reaproveitado (recentes): o anterior vai pro histórico (máx. 8).
      const newAvatarUrl = pendingAvatar ? await uploadProfileImage(pendingAvatar, 'avatars') : pendingAvatarUrl;
      if (newAvatarUrl && newAvatarUrl !== state.user.avatarUrl) {
        updates.avatarUrl = newAvatarUrl;
        const prev = state.user.avatarUrl;
        updates.avatarHistory = [prev, ...(state.user.avatarHistory || [])]
          .filter((u, i, a) => u && u !== newAvatarUrl && a.indexOf(u) === i)
          .slice(0, 8);
      }
      if (csDirty) {
        const text = csText.value.trim().slice(0, 60);
        if (!text && !csEmoji) updates.customStatus = null;
        else {
          const dur = csDuration.value;
          let expiresAt = null;
          if (dur === 'today') { const d = new Date(); d.setHours(23, 59, 59, 999); expiresAt = d.getTime(); }
          else if (dur !== 'never') expiresAt = Date.now() + Number(dur) * 60000;
          updates.customStatus = { text, emoji: csEmoji, expiresAt };
        }
      }
      if (isPrime && appearanceDirty) {
        updates.profileTheme = cur.themeOn ? { primary: cur.primary, accent: cur.accent } : null;
        updates.profileEffect = cur.effect;
        updates.nameplate = cur.nameplate;
      }
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
  content.appendChild(sectionHeader('Áudio & Vídeo', 'Escolha os dispositivos usados nas suas chamadas e canais de voz.', 'mic'));
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

  // Supressão de ruído: navegador (padrão) ou IA (RNNoise, roda no seu aparelho).
  const noiseSelect = el('select', { class: 'gk-select', 'aria-label': 'Modo de supressão de ruído' }, [
    el('option', { value: 'browser' }, 'Navegador (padrão)'),
    el('option', { value: 'ai' }, 'IA — padrão (RNNoise)'),
    el('option', { value: 'ai-strong' }, 'IA — forte (corta tudo que não é voz)'),
    el('option', { value: 'off' }, 'Desligada'),
  ]);
  noiseSelect.value = mediaPrefs.noiseMode === 'ai' ? (mediaPrefs.aiStrength === 'strong' ? 'ai-strong' : 'ai') : (mediaPrefs.noiseMode || 'browser');
  noiseSelect.addEventListener('change', () => {
    const v = noiseSelect.value;
    setMediaPrefs(v === 'ai' ? { noiseMode: 'ai', aiStrength: 'standard' } : v === 'ai-strong' ? { noiseMode: 'ai', aiStrength: 'strong' } : { noiseMode: v });
  });
  const noiseModeField = el('div', { class: 'gk-field' }, [
    el('label', {}, 'Supressão de ruído'), noiseSelect,
    el('div', { class: 'gk-hint' }, 'A IA remove teclado, ventilador e ruídos de fundo no seu aparelho (adiciona ~10 ms). Vale na hora, mesmo em chamada.'),
  ]);

  // Efeitos da câmera (valem ao ligar a câmera e mudam ao vivo durante a chamada).
  const fxSelect = el('select', { class: 'gk-select', 'aria-label': 'Efeito da câmera' },
    VIDEO_EFFECTS.map((f) => el('option', { value: f.id }, f.label)));
  fxSelect.value = VIDEO_EFFECTS.some((f) => f.id === mediaPrefs.videoFx) ? mediaPrefs.videoFx : 'none';
  fxSelect.addEventListener('change', () => setMediaPrefs({ videoFx: fxSelect.value }));

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Entrada de áudio'),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Microfone'), micSelect]),
    el('div', { class: 'gk-field' }, [meterBox, micTestBtn]),
    toggleRow('Cancelamento de eco', mediaPrefs.echoCancellation, (v) => setMediaPrefs({ echoCancellation: v })),
    noiseModeField,
    toggleRow('Supressão de ruído do navegador', mediaPrefs.noiseSuppression, (v) => setMediaPrefs({ noiseSuppression: v })),
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
    el('div', { class: 'gk-field' }, [
      el('label', {}, 'Efeito da câmera'), fxSelect,
      el('div', { class: 'gk-hint' }, '"Desfocar fundo" mantém o centro do quadro nítido e desfoca as laterais (sem IA: fique no centro).'),
    ]),
  ]));

  // Qualidade da transmissão de tela: se trava, escolha "Fluida".
  const screenSelect = el('select', { class: 'gk-select' },
    Object.entries(SCREEN_QUALITIES).map(([key, q]) => el('option', { value: key }, q.label)));
  screenSelect.value = SCREEN_QUALITIES[mediaPrefs.screenQuality] ? mediaPrefs.screenQuality : 'fluid';
  screenSelect.addEventListener('change', () => setMediaPrefs({ screenQuality: screenSelect.value }));
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Compartilhamento de tela'),
    el('div', { class: 'gk-field' }, [
      el('label', {}, 'Qualidade da transmissão'), screenSelect,
      el('small', { class: 'gk-field-hint' }, 'Se a transmissão estiver travando, use "Fluida". Vale a partir da próxima vez que você compartilhar a tela.'),
    ]),
  ]));

  content.appendChild(buildHotkeysCard());

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
async function renderAparenciaSection(content) {
  content.appendChild(sectionHeader('Aparência', 'Personalize o visual do G.K.IO em tempo real.', 'palette'));
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
  content.appendChild(buildCustomAccentCard(() => renderSection()));
  content.appendChild(buildReadingCard());
  content.appendChild(buildSurfaceCard());
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Mensagens'),
    toggleRow('Mostrar prévia de links e imagens', linkPreviewsEnabled(), (v) => setLinkPreviews(v)),
  ]));
  content.appendChild(buildWallpaperCard());
  content.appendChild(buildZoomCard());
  const desktopCard = await buildDesktopCard();
  if (desktopCard && content.isConnected) content.appendChild(desktopCard);
}

// Papel de parede — atrás das mensagens/composer, não no rail/sidebar
// (eles continuam sólidos pra manter o texto sempre legível). A escolha
// grava direto no doc do usuário (ver isValidSelfProfileEdit no
// firestore.rules) e aplica na hora, sem precisar de "Salvar alterações".
const WALLPAPER_PRESETS = [
  { id: 'none', label: 'Nenhum' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'nebula', label: 'Nebulosa' },
  { id: 'mountains', label: 'Montanhas' },
  { id: 'mascot', label: 'Mascote' },
  { id: 'waves', label: 'Ondas' },
];

function buildWallpaperCard() {
  const current = state.user.wallpaper || 'none';
  const grid = el('div', { class: 'gk-wallpaper-grid' });

  const choose = async (id, url) => {
    try {
      const payload = { wallpaper: id };
      if (id === 'custom') payload.wallpaperUrl = url;
      await updateDoc(userDoc(state.user.uid), payload);
      state.user.wallpaper = id;
      if (url) state.user.wallpaperUrl = url;
      applyWallpaper();
      renderSection();
    } catch (err) {
      toast('Não foi possível salvar o papel de parede.', 'danger');
    }
  };

  for (const w of WALLPAPER_PRESETS) {
    grid.appendChild(el('button', {
      type: 'button', class: 'gk-wallpaper-tile' + (current === w.id ? ' gk-active' : ''),
      'data-wallpaper-preview': w.id,
      onclick: () => choose(w.id),
    }, [
      current === w.id ? el('span', { class: 'gk-wallpaper-check' }, [icon('check', { size: 13 })]) : null,
      el('span', { class: 'gk-wallpaper-tile-label' }, w.label),
    ]));
  }

  // Papel de parede próprio — mesma engrenagem de upload do avatar/banner.
  const customInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  customInput.addEventListener('change', async () => {
    const file = customInput.files[0];
    if (!file) return;
    try {
      const url = await uploadProfileImage(file, 'wallpapers');
      await choose('custom', url);
    } catch (err) {
      toast('Falha ao enviar a imagem.', 'danger');
    }
  });
  grid.appendChild(el('button', {
    type: 'button',
    class: 'gk-wallpaper-tile gk-wallpaper-tile-add' + (current === 'custom' ? ' gk-active' : ''),
    'data-wallpaper-preview': current === 'custom' ? 'custom' : null,
    style: current === 'custom' && state.user.wallpaperUrl ? `background-image:url('${state.user.wallpaperUrl}');` : '',
    onclick: () => customInput.click(),
  }, [
    current === 'custom' ? el('span', { class: 'gk-wallpaper-check' }, [icon('check', { size: 13 })]) : el('span', {}, [icon('plus', { size: 16 })]),
    el('span', { class: 'gk-wallpaper-tile-label' }, current === 'custom' ? 'Personalizado' : 'Enviar imagem'),
  ]));

  return el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Papéis de parede'),
    el('p', { class: 'gk-modal-sub', style: 'margin:-6px 0 12px;' }, 'Altere o fundo da área de conversa. A escolha é salva na sua conta.'),
    grid,
  ]);
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
  content.appendChild(sectionHeader('Notificações', 'Controle como o G.K.IO te avisa sobre novidades.', 'bell'));
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
  content.appendChild(buildIdleCard());
}

// ============================================================
// Seção: G.K.IO Prime
// ============================================================
function renderPrimeSection(content) {
  content.appendChild(sectionHeader('G.K.IO Prime', 'Customizações e vantagens exclusivas de assinante.', 'diamond'));

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
  content.appendChild(sectionHeader('Administração', 'Gerencie assinaturas Prime e insígnias de qualquer usuário.', 'shield'));

  const searchInput = el('input', { type: 'text', placeholder: 'nome-de-usuario' });
  const searchBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button' }, 'Buscar');
  const resultBox = el('div', {});

  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Buscar usuário por username'),
    el('div', { class: 'gk-field-row' }, [searchInput, searchBtn]),
  ]));
  content.appendChild(resultBox);
  content.appendChild(buildReportsCard({ canDelete: true }));

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
function sectionHeader(title, sub, iconName) {
  return el('div', { class: 'gk-settings-section-header' }, [
    iconName ? el('div', { class: 'gk-settings-header-icon' }, [icon(iconName, { size: 20 })]) : null,
    el('div', {}, [
      el('h2', {}, title),
      el('p', { class: 'gk-modal-sub' }, sub),
    ]),
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
