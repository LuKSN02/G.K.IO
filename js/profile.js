// ============================================================
// G.K.IO — Perfil do usuário: edição e cartão público
// ============================================================
import { userDoc, socialLinksCol, getDoc, getDocs } from './db.js';
import { state, el, fallbackAvatar, effectiveStatus, currentActivity, activeCustomStatus, profileCosmetics, hexToRgba } from './state.js';
import { openOrCreateDm } from './dms.js';
import { startDmCall } from './calls.js';
import { uploadToCloudinary } from './cloudinary.js';
import { openSettingsModal } from './settings.js';
import { icon } from './icons.js';
import { refreshTopbarProfile } from './topbar.js';

export const SOCIAL_ICONS = {
  instagram: 'instagram', twitter: 'x', x: 'x', github: 'github', youtube: 'youtube',
  twitch: 'twitch', discord: 'discord', tiktok: 'tiktok', linkedin: 'link', website: 'link',
};

// Catálogo de insígnias — customBadges guarda só os ids (ex: ['og','beta']),
// atribuídos manualmente pelo console do Firebase (ver firestore.rules:
// nenhum desses campos é editável pelo próprio usuário).
export const BADGE_CATALOG = {
  og: { icon: 'trophy', label: 'Veterano' },
  booster: { icon: 'bolt', label: 'Booster' },
  beta: { icon: 'flask', label: 'Beta Tester' },
  founder: { icon: 'crown', label: 'Fundador' },
};

function primeDurationLabel(ts) {
  if (!ts || !ts.toDate) return 'Assinante Prime.';
  const days = Math.max(0, Math.floor((Date.now() - ts.toDate().getTime()) / 86400000));
  if (days < 1) return 'Assinante Prime há menos de um dia.';
  if (days < 30) return `Assinante Prime há ${days} ${days === 1 ? 'dia' : 'dias'}.`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Assinante Prime há ${months} ${months === 1 ? 'mês' : 'meses'}.`;
  const years = Math.floor(months / 12);
  return `Assinante Prime há ${years} ${years === 1 ? 'ano' : 'anos'}.`;
}

// A edição de perfil (avatar, banner, bio, links) agora mora dentro da
// aba de Configurações (ver settings.js, seção "Perfil"), para reunir
// tudo num único lugar organizado por seções.
export async function uploadProfileImage(file, folder) {
  const { url } = await uploadToCloudinary(file, `${folder}/${state.user.uid}`);
  return url;
}

export function refreshMiniProfile() {
  applyWallpaper();
  refreshTopbarProfile();
}

// Papel de parede da conta — persiste no doc do usuário (ver
// renderAparenciaSection em settings.js), então acompanha entre
// dispositivos como avatar/banner. 'custom' usa a URL enviada pela
// própria pessoa; os demais são só CSS (ver css/app.css).
export function applyWallpaper() {
  const app = document.getElementById('gk-app');
  if (!app) return;
  const wallpaper = state.user?.wallpaper || 'none';
  app.dataset.wallpaper = wallpaper;
  if (wallpaper === 'custom' && state.user?.wallpaperUrl) {
    app.style.setProperty('--gk-wallpaper-custom-url', `url('${state.user.wallpaperUrl}')`);
  }
}

// ---------- Cartão de perfil público ----------
export async function openProfileCard(uid) {
  const snap = await getDoc(userDoc(uid));
  if (!snap.exists()) return;
  const user = { uid, ...snap.data() };
  const linksSnap = await getDocs(socialLinksCol(uid));
  const links = linksSnap.docs.map((d) => d.data());

  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.className = 'gk-modal gk-profile-modal';
  modal.setAttribute('data-prime', user.role === 'prime' ? 'true' : 'false');
  modal.innerHTML = '';
  modal.removeAttribute('style');
  modal.removeAttribute('data-theme');

  // Cosméticos Prime: cores do tema, efeito animado e placa de nome.
  const cosmetics = profileCosmetics(user);
  const privacy = user.privacy || {};
  if (cosmetics.theme) {
    modal.setAttribute('data-theme', 'custom');
    modal.style.setProperty('--gk-pt-primary', cosmetics.theme.primary);
    modal.style.setProperty('--gk-pt-accent', cosmetics.theme.accent);
    modal.style.setProperty('--gk-pt-soft', hexToRgba(cosmetics.theme.primary, 0.22));
  }

  const bannerEl = el('div', {
    class: 'gk-profile-banner',
    style: (user.bannerUrl && user.bannerType !== 'video') ? `background-image:url(${user.bannerUrl})` : '',
  }, [
    el('div', { class: 'gk-profile-avatar-wrap', 'data-frame': user.frameStyle || 'none' }, [
      el('img', { src: user.avatarUrl || fallbackAvatar(user.username) }),
    ]),
  ]);
  // Sem autoplay/muted no HTML: quem decide quando toca (e com som) é
  // playBannerVideoWhileOpen(), depois que o cartão estiver visível.
  let bannerVideo = null;
  if (user.bannerUrl && user.bannerType === 'video') {
    bannerVideo = el('video', {
      src: user.bannerUrl, class: 'gk-profile-banner-video',
      loop: 'true', playsinline: 'true', preload: 'auto',
    });
    bannerEl.prepend(bannerVideo);
  }
  modal.appendChild(bannerEl);
  if (cosmetics.effect !== 'none') {
    modal.appendChild(el('div', { class: 'gk-profile-fx', 'data-fx': cosmetics.effect },
      Array.from({ length: 14 }, () => el('i'))));
  }

  const body = el('div', { class: 'gk-profile-body' }, [
    el('div', { class: 'gk-profile-name-wrap', 'data-nameplate': cosmetics.nameplate }, [
      el('div', { class: 'gk-profile-name' }, user.displayName || user.username),
    ]),
    el('div', { class: 'gk-profile-handle' }, [
      el('span', {}, '@' + user.username),
      user.pronouns ? el('span', { class: 'gk-profile-pronouns' }, user.pronouns) : null,
      el('span', { class: 'gk-profile-status-dot', 'data-status': effectiveStatus(user) }),
      el('span', {}, statusText(effectiveStatus(user))),
    ]),
  ]);

  const customStatus = activeCustomStatus(user);
  if (customStatus) {
    body.appendChild(el('div', { class: 'gk-profile-custom-status' }, [
      customStatus.emoji ? el('span', { class: 'gk-profile-custom-status-emoji' }, customStatus.emoji) : null,
      customStatus.text ? el('span', {}, customStatus.text) : null,
    ]));
  }

  const activity = privacy.hideActivity && uid !== state.user.uid ? null : currentActivity(user);
  if (activity) {
    body.appendChild(el('div', { class: 'gk-profile-activity' }, [
      icon('gamepad', { size: 14 }),
      el('span', {}, [el('small', {}, 'Jogando'), el('b', {}, activity.name)]),
    ]));
  }

  const metaChips = [];
  if (user.role === 'prime') {
    metaChips.push(el('span', { class: 'gk-prime-chip', title: primeDurationLabel(user.primeSince) }, [icon('diamond', { size: 12 }), ' G.K.IO Prime']));
  }
  if (user.tag) metaChips.push(el('span', { class: 'gk-author-tag' }, user.tag));
  if (metaChips.length) body.appendChild(el('div', { class: 'gk-profile-meta-row' }, metaChips));

  if (user.customBadges && user.customBadges.length) {
    const badgesRow = el('div', { class: 'gk-profile-badges-row' });
    for (const key of user.customBadges) {
      const b = BADGE_CATALOG[key];
      if (!b) continue;
      badgesRow.appendChild(el('span', { class: 'gk-profile-badge-chip', title: b.label }, [icon(b.icon, { size: 13 }), ` ${b.label}`]));
    }
    if (badgesRow.children.length) body.appendChild(badgesRow);
  }

  if (user.bio) body.appendChild(el('div', { class: 'gk-profile-bio' }, user.bio));

  if (links.length && !(privacy.hideLinks && uid !== state.user.uid)) {
    const linksBox = el('div', { class: 'gk-profile-links' });
    for (const link of links) {
      linksBox.appendChild(el('a', { class: 'gk-profile-link', href: link.url, target: '_blank', rel: 'noopener' }, [
        el('span', {}, [icon(SOCIAL_ICONS[link.platform] || 'link', { size: 14 })]),
        el('span', {}, link.url.replace(/^https?:\/\//, '')),
      ]));
    }
    body.appendChild(linksBox);
  }

  if (uid !== state.user.uid) {
    body.appendChild(el('div', { class: 'gk-profile-actions' }, [
      el('button', {
        class: 'gk-btn gk-btn-primary gk-btn-block',
        onclick: () => { overlay.classList.remove('gk-open'); openOrCreateDm(uid); },
      }, 'Enviar mensagem'),
      el('button', {
        class: 'gk-btn gk-btn-ghost',
        onclick: () => { overlay.classList.remove('gk-open'); openOrCreateDm(uid).then(() => startDmCall()); },
      }, [icon('phoneCall', { size: 16 })]),
    ]));
  } else {
    body.appendChild(el('div', { class: 'gk-profile-actions' }, [
      el('button', {
        class: 'gk-btn gk-profile-edit-btn gk-btn-block',
        onclick: () => { overlay.classList.remove('gk-open'); openSettingsModal('perfil'); },
      }, [icon('edit', { size: 14 }), ' Editar perfil']),
    ]));
  }

  modal.appendChild(body);
  overlay.classList.add('gk-open');
  if (bannerVideo) playBannerVideoWhileOpen(bannerVideo, overlay, modal);
}

// O banner em vídeo toca COM som só enquanto o cartão de perfil está
// aberto. Ao fechar (clique fora, botões, Esc) ou quando outro modal
// ocupa o lugar, o vídeo é pausado e descarregado. Antes ele ficava
// tocando o áudio "solto" depois de sair do perfil: o modal só era
// escondido, e um <video> escondido (ou removido do DOM) continua
// tocando até ser pausado de verdade.
function playBannerVideoWhileOpen(video, overlay, modal) {
  const observer = new MutationObserver(() => {
    if (!video.isConnected || !overlay.classList.contains('gk-open')) stop();
  });
  function stop() {
    observer.disconnect();
    clearInterval(watchdog);
    try { video.pause(); } catch (e) { /* noop */ }
    video.muted = true;
    video.removeAttribute('src');
    video.load(); // solta o recurso de mídia
  }
  observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  observer.observe(modal, { childList: true });
  // Rede de segurança: se o cartão sumir por qualquer outro caminho
  // (display:none, aba em segundo plano...), o som para em até meio segundo.
  const watchdog = setInterval(() => {
    const hidden = !video.isConnected || !overlay.classList.contains('gk-open') || document.hidden;
    if (hidden) stop();
  }, 400);

  video.muted = false;
  const playing = video.play();
  if (playing && playing.catch) {
    // O navegador pode bloquear som automático: nesse caso toca mudo em vez de não tocar.
    playing.catch(() => { video.muted = true; video.play().catch(() => {}); });
  }
}

function statusText(s) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[s] || 'Offline';
}
