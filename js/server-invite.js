// ============================================================
// G.K.IO — Convite para servidor, direto na DM (estilo Discord)
//  · openInviteFriendsModal(serverId): lista de amigos com botão "Convidar".
//    Cada convite cria um código de uso único (7 dias) e manda na DM da pessoa
//    como uma mensagem com `serverInvite`.
//  · buildServerInviteCard(msg): o cartão que aparece na conversa, com o
//    botão "Ir para o Servidor" (ou "Entrar", se a pessoa ainda não está nele).
// Os códigos continuam existindo por baixo (as regras do Firestore exigem a
// prova do convite para entrar em servidor privado); só não são mais digitados.
// ============================================================
import {
  auth, addDoc, updateDoc, getDoc, serverTimestamp,
  dmsCol, dmDoc, dmMessagesCol, serverDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { resetGenericModal } from './dialogs.js';
import { createInvite, selectServer, goToServerPickerView, joinServerByInviteCode } from './servers.js';
import { notifyDmMessage } from './push.js';
import { bannerGradient, buildServerTagChip, buildServerHighlights } from './server-profile.js';

const INVITE_SECONDS = 7 * 24 * 3600; // 7 dias
const INVITE_USES = 1;

// ---------------------------------------------------------------
// Enviar o convite para a DM de uma pessoa (cria a DM se não existir)
// ---------------------------------------------------------------
async function findOrCreateDm(otherUid) {
  const existing = [...state.dms.values()].find((dm) => !dm.isGroup && dm.other && dm.other.uid === otherUid);
  if (existing) return existing.id;
  const ref = await addDoc(dmsCol(), {
    participantIds: [auth.currentUser.uid, otherUid],
    isGroup: false, createdAt: serverTimestamp(), lastMessageAt: serverTimestamp(),
  });
  return ref.id;
}

export async function sendServerInvite(serverId, otherUid) {
  const server = state.servers.get(serverId);
  if (!server) throw new Error('Servidor não encontrado.');
  const me = auth.currentUser.uid;
  const dmId = await findOrCreateDm(otherUid);
  const code = await createInvite(serverId, { expiresInSeconds: INVITE_SECONDS, maxUses: INVITE_USES });
  const name = server.name || 'Servidor';
  await addDoc(dmMessagesCol(dmId), {
    authorId: me,
    authorName: state.user.displayName || state.user.username,
    authorAvatar: state.user.avatarUrl || '',
    authorRole: state.user.role || 'free',
    authorTag: state.user.tag || '',
    authorFrameStyle: state.user.frameStyle || 'none',
    createdAt: serverTimestamp(),
    content: '',
    serverInvite: { serverId, code, serverName: name, iconUrl: server.iconUrl || '', bannerUrl: server.bannerUrl || '' },
  });
  await updateDoc(dmDoc(dmId), {
    lastMessageAt: serverTimestamp(), lastMessageAuthorId: me, lastMessagePreview: `✉️ Convite para ${name}`,
  });
  try { notifyDmMessage(otherUid, { authorName: state.user.displayName || state.user.username, preview: `Convidou você para ${name}`, dmId }); } catch { /* push é opcional */ }
}

// ---------------------------------------------------------------
// Modal "Convidar amigos para {servidor}"
// ---------------------------------------------------------------
export function openInviteFriendsModal(serverId = state.currentServerId) {
  const server = serverId ? state.servers.get(serverId) : null;
  if (!server) { toast('Abra um servidor para convidar pessoas.', 'danger'); return; }

  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = resetGenericModal();
  modal.innerHTML = '';
  modal.classList.add('gk-invite-modal');
  const close = () => overlay.classList.remove('gk-open');

  const members = state.serverMembersCache.get(serverId); // Map(uid -> ...) quando já carregado
  const search = el('input', { type: 'text', class: 'gk-invite-search', placeholder: 'Procurar amigos', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Procurar amigos' });
  const list = el('div', { class: 'gk-invite-friends' });

  const friends = [...state.friends.values()].sort((a, b) =>
    String(a.displayName || a.username || '').localeCompare(String(b.displayName || b.username || ''), 'pt-BR'));

  function row(f) {
    const label = f.displayName || f.username || 'Usuário';
    const inServer = !!(members && members.has(f.uid)) || (server.memberIds || []).includes(f.uid);
    const btn = el('button', { class: 'gk-btn gk-btn-sm ' + (inServer ? 'gk-btn-ghost' : 'gk-btn-primary'), type: 'button' }, inServer ? 'Já está aqui' : 'Convidar');
    if (inServer) btn.disabled = true;
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        await sendServerInvite(serverId, f.uid);
        btn.textContent = 'Enviado'; btn.classList.remove('gk-btn-primary'); btn.classList.add('gk-btn-ghost', 'gk-sent');
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Convidar';
        toast(err.message || 'Não foi possível enviar o convite.', 'danger');
      }
    });
    return el('div', { class: 'gk-invite-friend', 'data-name': (label + ' ' + (f.username || '')).toLowerCase() }, [
      el('img', { class: 'gk-invite-friend-avatar', src: f.avatarUrl || fallbackAvatar(label), alt: '' }),
      el('div', { class: 'gk-invite-friend-name' }, [el('b', {}, label), f.username ? el('span', {}, '@' + f.username) : null]),
      btn,
    ]);
  }

  const empty = el('div', { class: 'gk-invite-empty' }, friends.length
    ? 'Nenhum amigo encontrado.'
    : 'Você ainda não tem amigos para convidar. Adicione alguém em Mensagens diretas e volte aqui.');
  friends.forEach((f) => list.appendChild(row(f)));
  if (!friends.length) list.appendChild(empty);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll('.gk-invite-friend').forEach((n) => {
      const hit = !q || n.dataset.name.includes(q);
      n.style.display = hit ? '' : 'none'; if (hit) shown++;
    });
    empty.style.display = shown || !friends.length ? 'none' : 'block';
    if (!list.contains(empty) && !shown) list.appendChild(empty);
  });

  modal.append(
    el('h2', {}, 'Convidar amigos'),
    el('p', { class: 'gk-modal-sub' }, [`Para `, el('b', {}, server.name || 'o servidor'), '. O convite chega na conversa privada da pessoa e vale por 7 dias, para um uso.']),
    friends.length ? el('div', { class: 'gk-invite-search-wrap' }, [icon('search', { size: 15 }), search]) : null,
    list,
    el('div', { class: 'gk-modal-actions' }, [el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Fechar')]),
  );
  overlay.classList.add('gk-open');
  if (friends.length) setTimeout(() => search.focus(), 50);
}

// ---------------------------------------------------------------
// Cartão do convite dentro da conversa
// ---------------------------------------------------------------
const num = new Intl.NumberFormat('pt-BR');

export function buildServerInviteCard(msg) {
  const inv = msg.serverInvite || {};
  const mine = msg.authorId === auth.currentUser?.uid;
  const iconEl = el('div', { class: 'gk-sinv-icon' });
  const nameEl = el('div', { class: 'gk-sinv-name' }, inv.serverName || 'Servidor');
  const metaEl = el('div', { class: 'gk-sinv-meta' });
  const banner = el('div', { class: 'gk-sinv-banner' });
  const extras = el('div', { class: 'gk-sinv-extras' });
  const btn = el('button', { class: 'gk-sinv-btn', type: 'button' }, 'Carregando…');
  btn.disabled = true;

  const paintIcon = (url, name) => {
    iconEl.replaceChildren(url
      ? el('img', { src: url, alt: '' })
      : el('span', {}, (name || '?').slice(0, 2).toUpperCase()));
  };
  const paintBanner = (url) => {
    if (url && /^https?:\/\//i.test(url)) banner.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
  };
  paintIcon(inv.iconUrl, inv.serverName); paintBanner(inv.bannerUrl);

  const isMember = () => state.servers.has(inv.serverId);
  const setButton = () => {
    btn.disabled = false;
    btn.textContent = isMember() ? 'Ir para o Servidor' : (mine ? 'Convite enviado' : 'Entrar no Servidor');
    if (!isMember() && mine) btn.disabled = true; // quem enviou e saiu do servidor não "aceita" o próprio convite
  };

  // Dados atuais do servidor (nome, ícone, banner, quantidade de membros).
  (async () => {
    try {
      const snap = await getDoc(serverDoc(inv.serverId));
      if (!snap.exists()) { metaEl.textContent = 'Este servidor não existe mais.'; btn.textContent = 'Indisponível'; return; }
      const s = snap.data();
      nameEl.textContent = s.name || inv.serverName || 'Servidor';
      paintIcon(s.iconUrl, s.name); paintBanner(s.bannerUrl);
      if (!s.bannerUrl && s.bannerColor && bannerGradient(s.bannerColor)) banner.style.background = bannerGradient(s.bannerColor);
      const tagChip = buildServerTagChip(s.serverTag); if (tagChip) nameEl.append(' ', tagChip);
      extras.replaceChildren(...[
        s.description ? el('div', { class: 'gk-sinv-desc' }, String(s.description).slice(0, 200)) : null,
        buildServerHighlights(s, { maxGames: 4 }),
      ].filter(Boolean));
      const n = (s.memberIds || []).length;
      metaEl.replaceChildren(el('span', { class: 'gk-sinv-dot' }), `${num.format(n)} ${n === 1 ? 'membro' : 'membros'}`);
      setButton();
    } catch {
      metaEl.textContent = '';
      setButton();
    }
  })();

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const go = () => { goToServerPickerView(); selectServer(inv.serverId); };
    if (isMember()) { go(); return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const id = await joinServerByInviteCode(inv.code);
      goToServerPickerView(); selectServer(id || inv.serverId);
    } catch (err) {
      toast(err.message || 'Não foi possível entrar com este convite.', 'danger');
      btn.disabled = false; btn.textContent = 'Entrar no Servidor';
    }
  });

  return el('div', { class: 'gk-sinv' }, [
    el('div', { class: 'gk-sinv-label' }, mine ? 'Você enviou um convite para entrar em um servidor' : 'Você foi convidado para entrar em um servidor'),
    el('div', { class: 'gk-sinv-card' }, [
      banner,
      el('div', { class: 'gk-sinv-body' }, [iconEl, el('div', { class: 'gk-sinv-info' }, [nameEl, metaEl])]),
      extras,
      btn,
    ]),
  ]);
}
