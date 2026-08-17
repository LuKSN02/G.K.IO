// ============================================================
// G.K.IO — Perfil do usuário: edição e cartão público
// ============================================================
import { userDoc, socialLinksCol, getDoc, getDocs } from './db.js';
import { state, el, fallbackAvatar } from './state.js';
import { openOrCreateDm } from './dms.js';
import { startDmCall } from './calls.js';
import { uploadToCloudinary } from './cloudinary.js';
import { openSettingsModal } from './settings.js';

export const SOCIAL_ICONS = {
  instagram: '📷', twitter: '🐦', x: '✕', github: '💻', youtube: '▶️',
  twitch: '🎮', discord: '🗨️', tiktok: '🎵', linkedin: '💼', website: '🔗',
};

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
  modal.innerHTML = '';

  modal.appendChild(el('div', {
    class: 'gk-profile-banner',
    style: user.bannerUrl ? `background-image:url(${user.bannerUrl})` : '',
  }, [
    el('div', { class: 'gk-profile-avatar-wrap' }, [
      el('img', { src: user.avatarUrl || fallbackAvatar(user.username) }),
    ]),
  ]));

  const body = el('div', { class: 'gk-profile-body' }, [
    el('div', { class: 'gk-profile-name' }, user.displayName || user.username),
    el('div', { class: 'gk-profile-handle' }, '@' + user.username + ' · ' + statusText(user.statusPresence)),
  ]);

  if (user.bio) body.appendChild(el('div', { class: 'gk-profile-bio' }, user.bio));

  if (links.length) {
    const linksBox = el('div', { class: 'gk-profile-links' });
    for (const link of links) {
      linksBox.appendChild(el('a', { class: 'gk-profile-link', href: link.url, target: '_blank', rel: 'noopener' }, [
        el('span', {}, SOCIAL_ICONS[link.platform] || '🔗'),
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
      }, '📞'),
    ]));
  } else {
    body.appendChild(el('button', {
      class: 'gk-btn gk-btn-ghost gk-btn-block',
      onclick: () => { overlay.classList.remove('gk-open'); openSettingsModal('perfil'); },
    }, 'Editar perfil'));
  }

  modal.appendChild(body);
  overlay.classList.add('gk-open');
}

function statusText(s) {
  return { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' }[s] || 'Offline';
}
