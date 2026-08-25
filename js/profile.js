// ============================================================
// G.K.IO — Perfil do usuário: edição e cartão público
// ============================================================
import { userDoc, socialLinksCol, getDoc, getDocs } from './db.js';
import { state, el, fallbackAvatar } from './state.js';
import { openOrCreateDm } from './dms.js';
import { startDmCall } from './calls.js';
import { uploadToCloudinary } from './cloudinary.js';
import { openSettingsModal } from './settings.js';
import { icon } from './icons.js';

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
  document.getElementById('gk-mini-avatar').src = state.user.avatarUrl || fallbackAvatar(state.user.username);
  document.getElementById('gk-mini-avatar-wrap').setAttribute('data-status', state.user.statusPresence || 'online');
  document.getElementById('gk-mini-avatar-wrap').setAttribute('data-frame', state.user.frameStyle || 'none');
  document.getElementById('gk-mini-name').textContent = state.user.displayName || state.user.username;
  document.getElementById('gk-mini-status').textContent = state.user.bio || '@' + state.user.username;
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

  const bannerEl = el('div', {
    class: 'gk-profile-banner',
    style: (user.bannerUrl && user.bannerType !== 'video') ? `background-image:url(${user.bannerUrl})` : '',
  }, [
    el('div', { class: 'gk-profile-avatar-wrap', 'data-frame': user.frameStyle || 'none' }, [
      el('img', { src: user.avatarUrl || fallbackAvatar(user.username) }),
    ]),
  ]);
  if (user.bannerUrl && user.bannerType === 'video') {
    bannerEl.prepend(el('video', {
      src: user.bannerUrl, class: 'gk-profile-banner-video',
      autoplay: 'true', loop: 'true', muted: 'true', playsinline: 'true',
    }));
  }
  modal.appendChild(bannerEl);

  const body = el('div', { class: 'gk-profile-body' }, [
    el('div', { class: 'gk-profile-name' }, user.displayName || user.username),
    el('div', { class: 'gk-profile-handle' }, [
      el('span', {}, '@' + user.username),
      el('span', { class: 'gk-profile-status-dot', 'data-status': user.statusPresence || 'offline' }),
      el('span', {}, statusText(user.statusPresence)),
    ]),
  ]);

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

  if (links.length) {
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
}

function statusText(s) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[s] || 'Offline';
}
