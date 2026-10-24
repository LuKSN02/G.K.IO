// ============================================================
// G.K.IO — Configurações > Conta
// E-mail, senha, privacidade, usuários bloqueados e exclusão da conta.
// Trocar e-mail / senha / excluir pedem a senha atual (o Firebase exige um
// login recente para essas três operações).
// ============================================================
import {
  auth, db, userDoc, usersCol, serversCol, memberDoc, serverDoc, socialLinksCol, attachmentsCol, friendshipsCol,
  doc, getDoc, getDocs, updateDoc, deleteDoc, query, where,
  updatePassword, verifyBeforeUpdateEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { blockedList, unblockUser, onBlocksChange } from './blocks.js';
import { clearPushToken } from './push.js';
import { stopBackgroundNotifications } from './background-notify.js';

const MIN_PASSWORD = 8;

function friendlyError(err) {
  const map = {
    'auth/wrong-password': 'Senha atual incorreta.',
    'auth/invalid-credential': 'Senha atual incorreta.',
    'auth/invalid-login-credentials': 'Senha atual incorreta.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
    'auth/weak-password': 'A nova senha é fraca demais.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'Este e-mail já está em uso por outra conta.',
    'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de repetir esta ação.',
    'auth/operation-not-allowed': 'O Firebase não permite trocar o e-mail neste projeto (ative “Verificar antes de alterar e-mail” / confira o provedor E-mail/senha).',
    'auth/network-request-failed': 'Sem conexão com a internet.',
  };
  return map[err?.code] || err?.message || 'Não foi possível concluir. Tente novamente.';
}

async function reauth(currentPassword) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Sua conta não tem e-mail/senha.');
  if (!currentPassword) throw new Error('Digite a sua senha atual.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
}

function passwordField(label, id, autocomplete) {
  const input = el('input', { type: 'password', id, autocomplete, placeholder: '••••••••' });
  return { input, field: el('div', { class: 'gk-field' }, [el('label', { for: id }, label), input]) };
}

function runButton(label, iconName, handler, cls = 'gk-btn gk-btn-primary') {
  const btn = el('button', { class: cls, type: 'button' }, [icon(iconName, { size: 15 }), ' ' + label]);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('gk-btn-loading');
    try { await handler(); } catch (err) { toast(friendlyError(err), 'danger'); }
    finally { btn.disabled = false; btn.classList.remove('gk-btn-loading'); }
  });
  return btn;
}

export function renderAccountSection(content, { sectionHeader, toggleRow }) {
  content.appendChild(sectionHeader('Conta', 'E-mail, senha, privacidade e segurança da sua conta.', 'lock'));
  const fbUser = auth.currentUser;

  // ---------- Resumo ----------
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Sua conta'),
    el('div', { class: 'gk-field' }, [
      el('label', {}, 'E-mail'),
      el('div', {}, [fbUser?.email || '—', fbUser?.emailVerified ? '  ✓ confirmado' : '  (não confirmado)']),
    ]),
    el('div', { class: 'gk-field' }, [el('label', {}, 'Nome de usuário'), el('div', {}, '@' + (state.user?.username || ''))]),
  ]));

  // ---------- Alterar e-mail ----------
  const newEmail = el('input', { type: 'email', id: 'gk-acc-new-email', autocomplete: 'email', placeholder: 'novo@email.com' });
  const emailPass = passwordField('Senha atual', 'gk-acc-email-pass', 'current-password');
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Alterar e-mail'),
    el('div', { class: 'gk-field' }, [el('label', { for: 'gk-acc-new-email' }, 'Novo e-mail'), newEmail]),
    emailPass.field,
    el('div', { class: 'gk-hint', style: 'margin-bottom:12px;' }, 'Enviamos um link de confirmação para o novo endereço. O e-mail só muda depois que você clicar nele.'),
    el('div', { class: 'gk-settings-save-row' }, [runButton('Enviar confirmação', 'send', async () => {
      const email = newEmail.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Digite um e-mail válido.');
      if (email === (fbUser.email || '').toLowerCase()) throw new Error('Esse já é o seu e-mail atual.');
      await reauth(emailPass.input.value);
      await verifyBeforeUpdateEmail(fbUser, email);
      emailPass.input.value = ''; newEmail.value = '';
      toast('Enviamos um link de confirmação para ' + email + '.');
    })]),
  ]));

  // ---------- Alterar senha ----------
  const curPass = passwordField('Senha atual', 'gk-acc-cur-pass', 'current-password');
  const newPass = passwordField('Nova senha', 'gk-acc-new-pass', 'new-password');
  const newPass2 = passwordField('Repita a nova senha', 'gk-acc-new-pass2', 'new-password');
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Alterar senha'),
    curPass.field, newPass.field, newPass2.field,
    el('div', { class: 'gk-hint', style: 'margin-bottom:12px;' }, `Use ao menos ${MIN_PASSWORD} caracteres.`),
    el('div', { class: 'gk-settings-save-row' }, [runButton('Alterar senha', 'key', async () => {
      if (newPass.input.value.length < MIN_PASSWORD) throw new Error(`A nova senha precisa ter ao menos ${MIN_PASSWORD} caracteres.`);
      if (newPass.input.value !== newPass2.input.value) throw new Error('As senhas novas não são iguais.');
      if (newPass.input.value === curPass.input.value) throw new Error('A nova senha precisa ser diferente da atual.');
      await reauth(curPass.input.value);
      await updatePassword(fbUser, newPass.input.value);
      curPass.input.value = ''; newPass.input.value = ''; newPass2.input.value = '';
      toast('Senha alterada.');
    })]),
  ]));

  // ---------- Privacidade ----------
  const privacy = { ...(state.user?.privacy || {}) };
  const savePrivacy = async (patch) => {
    const next = { ...privacy, ...patch };
    try {
      await updateDoc(userDoc(auth.currentUser.uid), { privacy: next });
      Object.assign(privacy, patch);
      state.user.privacy = next;
    } catch (err) { toast(friendlyError(err), 'danger'); }
  };
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Privacidade'),
    toggleRow('Esconder o jogo que estou jogando', !!privacy.hideActivity, (v) => savePrivacy({ hideActivity: v })),
    toggleRow('Esconder meus links no perfil', !!privacy.hideLinks, (v) => savePrivacy({ hideLinks: v })),
  ]));

  // ---------- Bloqueados ----------
  const blockedBody = el('div', {});
  async function renderBlocked() {
    blockedBody.replaceChildren(el('div', { class: 'gk-hint' }, 'Carregando…'));
    const ids = blockedList();
    if (!ids.length) { blockedBody.replaceChildren(el('div', { class: 'gk-hint' }, 'Você não bloqueou ninguém.')); return; }
    const users = await Promise.all(ids.map(async (uid) => {
      try { const s = await getDoc(userDoc(uid)); return { uid, ...(s.exists() ? s.data() : { username: 'conta-removida' }) }; }
      catch (e) { return { uid, username: 'desconhecido' }; }
    }));
    blockedBody.replaceChildren(...users.map((u) => el('div', { class: 'gk-friend-card', style: 'margin-bottom:8px;' }, [
      el('div', { class: 'gk-avatar gk-sz-40' }, [el('img', { src: u.avatarUrl || fallbackAvatar(u.username || 'GK') })]),
      el('div', { class: 'gk-friend-info' }, [
        el('div', { class: 'gk-friend-name' }, u.displayName || u.username),
        el('div', { class: 'gk-friend-sub' }, '@' + (u.username || '')),
      ]),
      el('div', { class: 'gk-friend-actions' }, [
        el('button', {
          class: 'gk-btn gk-btn-ghost', type: 'button',
          onclick: async () => { try { await unblockUser(u.uid); toast('Usuário desbloqueado.'); } catch (e) { toast(friendlyError(e), 'danger'); } },
        }, 'Desbloquear'),
      ]),
    ])));
  }
  content.appendChild(el('div', { class: 'gk-settings-card' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Usuários bloqueados'),
    blockedBody,
  ]));
  renderBlocked();
  // Re-renderiza a lista quando algo muda e enquanto a aba ainda está na tela.
  const off = onBlocksChange(() => { if (blockedBody.isConnected) renderBlocked(); else off(); });

  // ---------- Zona de perigo ----------
  const delPass = passwordField('Senha atual', 'gk-acc-del-pass', 'current-password');
  const confirmInput = el('input', { type: 'text', id: 'gk-acc-del-confirm', placeholder: 'EXCLUIR', autocomplete: 'off' });
  const delBox = el('div', { style: 'display:none; margin-top:12px;' }, [
    el('div', { class: 'gk-hint', style: 'margin-bottom:10px;' },
      'Isto apaga o seu perfil, links, amizades e arquivos indexados, e tira você de todos os servidores. Mensagens que você já enviou continuam nas conversas. Não dá para desfazer.'),
    delPass.field,
    el('div', { class: 'gk-field' }, [el('label', { for: 'gk-acc-del-confirm' }, 'Digite EXCLUIR para confirmar'), confirmInput]),
    runButton('Excluir minha conta para sempre', 'trash', async () => {
      if (confirmInput.value.trim() !== 'EXCLUIR') throw new Error('Digite EXCLUIR (em maiúsculas) para confirmar.');
      await reauth(delPass.input.value);
      await deleteMyAccount();
    }, 'gk-btn gk-btn-danger'),
  ]);
  const openBtn = el('button', { class: 'gk-btn gk-btn-danger', type: 'button' }, [icon('trash', { size: 15 }), ' Excluir conta…']);
  openBtn.addEventListener('click', () => { delBox.style.display = 'block'; openBtn.style.display = 'none'; });
  content.appendChild(el('div', { class: 'gk-settings-card gk-danger-zone' }, [
    el('div', { class: 'gk-settings-card-title' }, 'Zona de perigo'),
    openBtn, delBox,
  ]));
}

// ---------- Exclusão da conta ----------
// Ordem: valida → limpa dados do Firestore (ainda autenticado) → apaga o
// login. Cada passo de limpeza é "melhor esforço"; só donos de servidor
// bloqueiam a exclusão (o servidor ficaria sem dono).
export async function deleteMyAccount() {
  const user = auth.currentUser;
  const uid = user.uid;

  const owned = await getDocs(query(serversCol(), where('ownerId', '==', uid)));
  if (!owned.empty) {
    const names = owned.docs.map((d) => `“${d.data().name || 'sem nome'}”`).join(', ');
    throw new Error(`Você é dono de ${names}. Exclua o servidor (ou ele ficará sem dono) antes de apagar a conta.`);
  }

  const tryStep = async (label, fn) => { try { await fn(); } catch (e) { console.warn('[excluir conta]', label, e.message); } };

  // Sai de todos os servidores.
  for (const [serverId, srv] of state.servers) {
    if (!(srv.memberIds || []).includes(uid)) continue;
    await tryStep('membro ' + serverId, () => deleteDoc(memberDoc(serverId, uid)));
    await tryStep('memberIds ' + serverId, () => updateDoc(serverDoc(serverId), { memberIds: srv.memberIds.filter((x) => x !== uid) }));
  }
  // Amizades: as regras só deixam "atualizar", então são encerradas.
  await tryStep('amizades', async () => {
    const snap = await getDocs(query(friendshipsCol(), where('userIds', 'array-contains', uid)));
    await Promise.all(snap.docs.map((d) => updateDoc(doc(db, 'friendships', d.id), { status: 'declined' })));
  });
  await tryStep('links', async () => {
    const snap = await getDocs(socialLinksCol(uid));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  });
  await tryStep('anexos', async () => {
    const snap = await getDocs(query(attachmentsCol(), where('uid', '==', uid)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  });
  await tryStep('push', () => clearPushToken());
  stopBackgroundNotifications();
  // Perfil: se as regras novas ainda não foram publicadas isto falha — e aí não seguimos
  // para o apagar do login, senão a conta some e o perfil fica órfão para sempre.
  await deleteDoc(userDoc(uid));
  await deleteUser(user);
  toast('Conta excluída.');
}
