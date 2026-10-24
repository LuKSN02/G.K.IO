// ============================================================
// G.K.IO — DM em grupo: criar, ver membros, renomear, adicionar, remover e sair
// O grupo é um doc em directMessages/{id} com isGroup: true, name, ownerId e
// participantIds (3 a 10 pessoas). Mensagens, digitando, fixadas, enquetes e
// tópicos usam o mesmo caminho das DMs 1:1.
// ============================================================
import {
  auth, dmsCol, dmDoc, addDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp, userDoc, getDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { icon } from './icons.js';
import { isBlocked } from './blocks.js';
import { confirmDangerAction } from './dialogs.js';
import { selectDm } from './chat.js';
import { GROUP_MAX_MEMBERS, groupTitle, goToDmsView } from './dms.js';

const NAME_MAX = 40;
const MIN_OTHERS = 2; // grupo = você + pelo menos 2 pessoas

const nameOf = (u) => u?.displayName || u?.username || 'Usuário';
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));

function openModal() {
  const overlay = document.getElementById('gk-generic-modal-overlay');
  const modal = document.getElementById('gk-generic-modal');
  modal.innerHTML = '';
  modal.classList.remove('gk-modal-wizard');
  return { overlay, modal, close: () => overlay.classList.remove('gk-open') };
}

function personRow(user, { checked = false, disabled = false, onToggle, trailing = null, sub = '' } = {}) {
  const row = el('label', { class: 'gk-group-person' + (disabled ? ' gk-disabled' : '') });
  if (onToggle) {
    const box = el('input', { type: 'checkbox', ...(checked ? { checked: 'true' } : {}), ...(disabled ? { disabled: 'true' } : {}) });
    box.addEventListener('change', () => onToggle(box.checked, box));
    row.appendChild(box);
  }
  row.appendChild(el('div', { class: 'gk-avatar gk-sz-32', 'data-frame': user.frameStyle || 'none' }, [
    el('img', { src: user.avatarUrl || fallbackAvatar(user.username || 'GK'), alt: '' }),
  ]));
  row.appendChild(el('div', { class: 'gk-group-person-info' }, [
    el('div', { class: 'gk-group-person-name' }, nameOf(user)),
    sub ? el('div', { class: 'gk-hint' }, sub) : null,
  ]));
  if (trailing) row.appendChild(trailing);
  return row;
}

// ---------- Criar ----------
export function openCreateGroupModal() {
  const me = auth.currentUser?.uid;
  if (!me) return;
  const { overlay, modal, close } = openModal();
  const friends = [...state.friends.values()].filter((f) => !isBlocked(f.uid)).sort(byName);
  const selected = new Set();
  const maxOthers = GROUP_MAX_MEMBERS - 1;

  const nameInput = el('input', { type: 'text', maxlength: String(NAME_MAX), placeholder: 'Nome do grupo (opcional)', autocomplete: 'off' });
  const filterInput = el('input', { type: 'text', placeholder: 'Buscar amigos…', autocomplete: 'off', 'aria-label': 'Buscar amigos' });
  const counter = el('div', { class: 'gk-hint' });
  const list = el('div', { class: 'gk-group-list' });
  const createBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', disabled: 'true' }, [icon('members', { size: 15 }), ' Criar grupo']);

  const refresh = () => {
    counter.textContent = `${selected.size} de ${maxOthers} selecionados (mínimo ${MIN_OTHERS})`;
    createBtn.disabled = selected.size < MIN_OTHERS;
    list.querySelectorAll('input[type=checkbox]').forEach((b) => {
      const row = b.closest('.gk-group-person');
      b.disabled = !b.checked && selected.size >= maxOthers;
      row.classList.toggle('gk-disabled', b.disabled);
    });
  };
  const renderList = () => {
    const q = filterInput.value.trim().toLowerCase();
    list.replaceChildren();
    const shown = friends.filter((f) => !q || nameOf(f).toLowerCase().includes(q) || (f.username || '').includes(q));
    if (!friends.length) { list.appendChild(el('div', { class: 'gk-empty-state-sm' }, 'Adicione amigos primeiro para criar um grupo.')); return; }
    if (!shown.length) { list.appendChild(el('div', { class: 'gk-empty-state-sm' }, 'Ninguém encontrado.')); return; }
    for (const f of shown) {
      list.appendChild(personRow(f, {
        checked: selected.has(f.uid), sub: '@' + (f.username || ''),
        onToggle: (on) => { if (on) selected.add(f.uid); else selected.delete(f.uid); refresh(); },
      }));
    }
    refresh();
  };
  filterInput.addEventListener('input', renderList);

  createBtn.addEventListener('click', async () => {
    if (createBtn.disabled) return;
    createBtn.disabled = true; createBtn.classList.add('gk-btn-loading');
    try {
      const ids = [me, ...selected];
      const name = nameInput.value.trim().slice(0, NAME_MAX);
      const ref = await addDoc(dmsCol(), {
        participantIds: ids, isGroup: true, name, ownerId: me,
        createdAt: serverTimestamp(), lastMessageAt: serverTimestamp(),
      });
      close();
      if (state.currentView !== 'dms') goToDmsView();
      const members = state.friends ? ids.map((id) => id === me ? state.user : state.friends.get(id)).filter(Boolean) : [];
      selectDm(ref.id, groupTitle({ name }, members, me), `${ids.length} membros`, null, { isGroup: true });
      toast('Grupo criado.');
    } catch (err) {
      toast('Não foi possível criar o grupo. Publique o firestore.rules atualizado e tente de novo.', 'danger');
      createBtn.disabled = false; createBtn.classList.remove('gk-btn-loading');
    }
  });

  modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
    el('div', { class: 'gk-modal-icon' }, [icon('members', { size: 22 })]),
    el('div', {}, [
      el('h2', {}, 'Novo grupo'),
      el('p', { class: 'gk-modal-sub' }, `Converse com até ${GROUP_MAX_MEMBERS} pessoas (você incluso). Só amigos podem entrar.`),
    ]),
  ]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome'), nameInput]));
  modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Participantes'), filterInput, list, counter]));
  modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Cancelar'),
    createBtn,
  ]));
  renderList();
  overlay.classList.add('gk-open');
  setTimeout(() => nameInput.focus(), 50);
}

// ---------- Gerenciar ----------
export function openGroupInfoModal(dmId, seed = null) {
  const me = auth.currentUser?.uid;
  const dm = state.dms.get(dmId);
  if (!me || !dm?.isGroup) return;
  const { overlay, modal, close } = openModal();

  // Cópia local: o doc só chega de volta pelo listener, então o modal se atualiza por conta própria.
  // `seed` reabre o modal com os dados locais já alterados (os diálogos de confirmação usam o mesmo
  // elemento de modal, então ele precisa ser redesenhado depois deles).
  let ids = [...(seed?.ids || dm.participantIds)];
  let name = seed ? seed.name : (dm.name || '');
  let ownerId = seed ? seed.ownerId : (dm.ownerId || '');
  const iAmOwner = () => ownerId === me;

  const users = new Map((dm.members || []).map((m) => [m.uid, m]));
  const loadUser = async (uid) => {
    if (users.has(uid)) return users.get(uid);
    const f = state.friends.get(uid);
    if (f) { users.set(uid, f); return f; }
    try {
      const s = await getDoc(userDoc(uid));
      const u = s.exists() ? { uid, ...s.data() } : { uid, username: 'conta-removida', displayName: 'Conta removida' };
      users.set(uid, u); return u;
    } catch (e) { return { uid, username: 'desconhecido' }; }
  };

  const save = async (patch, okMsg) => {
    try { await updateDoc(dmDoc(dmId), patch); if (okMsg) toast(okMsg); return true; }
    catch (err) { toast('Não foi possível salvar. Confira se você ainda faz parte do grupo e se o firestore.rules foi publicado.', 'danger'); return false; }
  };

  async function render() {
    const people = await Promise.all(ids.map(loadUser));
    modal.innerHTML = '';
    modal.appendChild(el('div', { class: 'gk-modal-icon-header' }, [
      el('div', { class: 'gk-modal-icon' }, [icon('members', { size: 22 })]),
      el('div', {}, [
        el('h2', {}, groupTitle({ name }, people, me)),
        el('p', { class: 'gk-modal-sub' }, `${ids.length} de ${GROUP_MAX_MEMBERS} membros`),
      ]),
    ]));

    if (iAmOwner()) {
      const nameInput = el('input', { type: 'text', value: name, maxlength: String(NAME_MAX), placeholder: 'Nome do grupo', 'aria-label': 'Nome do grupo' });
      const saveName = el('button', { class: 'gk-btn gk-btn-ghost', type: 'button' }, 'Salvar nome');
      saveName.addEventListener('click', async () => {
        const next = nameInput.value.trim().slice(0, NAME_MAX);
        if (await save({ name: next }, 'Nome atualizado.')) { name = next; render(); }
      });
      modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Nome do grupo'), el('div', { class: 'gk-field-row' }, [nameInput, saveName])]));
    }

    const list = el('div', { class: 'gk-group-list' });
    for (const u of [...people].sort((a, b) => (a.uid === ownerId ? -1 : b.uid === ownerId ? 1 : byName(a, b)))) {
      let trailing = null;
      if (u.uid === ownerId) trailing = el('span', { class: 'gk-group-owner', title: 'Dono do grupo' }, [icon('crown', { size: 13 }), ' dono']);
      else if (iAmOwner()) {
        trailing = el('button', {
          class: 'gk-friend-action-btn gk-friend-action-decline', type: 'button', title: 'Remover do grupo',
          onclick: (e) => {
            e.preventDefault();
            confirmDangerAction('Remover do grupo?', `"${nameOf(u)}" deixa de ver as conversas do grupo daqui para frente.`, async () => {
              if (await save({ participantIds: arrayRemove(u.uid) }, 'Pessoa removida.')) { ids = ids.filter((x) => x !== u.uid); openGroupInfoModal(dmId, { ids, name, ownerId }); }
            }, { confirmLabel: 'Remover', iconName: 'close' });
          },
        }, [icon('close', { size: 14 })]);
      }
      list.appendChild(personRow(u, { trailing, sub: u.uid === me ? 'Você' : '@' + (u.username || '') }));
    }
    modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Membros'), list]));

    // Adicionar (só o dono; só amigos que ainda não estão no grupo)
    if (iAmOwner() && ids.length < GROUP_MAX_MEMBERS) {
      const candidates = [...state.friends.values()].filter((f) => !ids.includes(f.uid) && !isBlocked(f.uid)).sort(byName);
      const picked = new Set();
      const addBtn = el('button', { class: 'gk-btn gk-btn-primary', type: 'button', disabled: 'true' }, [icon('plus', { size: 14 }), ' Adicionar selecionados']);
      const room = GROUP_MAX_MEMBERS - ids.length;
      const addList = el('div', { class: 'gk-group-list' }, candidates.length
        ? candidates.map((f) => personRow(f, {
          sub: '@' + (f.username || ''),
          onToggle: (on, box) => {
            if (on && picked.size >= room) { box.checked = false; toast(`O grupo comporta mais ${room} pessoa(s).`, 'danger'); return; }
            if (on) picked.add(f.uid); else picked.delete(f.uid);
            addBtn.disabled = !picked.size;
          },
        }))
        : [el('div', { class: 'gk-empty-state-sm' }, 'Todos os seus amigos já estão aqui.')]);
      addBtn.addEventListener('click', async () => {
        const add = [...picked];
        if (await save({ participantIds: arrayUnion(...add) }, 'Pessoas adicionadas.')) { ids = [...ids, ...add]; render(); }
      });
      modal.appendChild(el('div', { class: 'gk-field' }, [el('label', {}, 'Adicionar amigos'), addList, el('div', { class: 'gk-settings-save-row' }, [addBtn])]));
    }

    modal.appendChild(el('div', { class: 'gk-modal-actions' }, [
      el('button', {
        class: 'gk-btn gk-btn-danger', type: 'button',
        onclick: () => confirmLeave(),
      }, [icon('close', { size: 14 }), ' Sair do grupo']),
      el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: close }, 'Concluído'),
    ]));
  }

  function confirmLeave() {
    const others = ids.filter((x) => x !== me);
    confirmDangerAction(
      'Sair do grupo?',
      iAmOwner() && others.length ? 'Você é o dono: a posse passa para outra pessoa do grupo.' : 'Você deixa de ver as conversas deste grupo.',
      async () => {
        const patch = { participantIds: arrayRemove(me) };
        if (iAmOwner() && others.length) patch.ownerId = others[0];
        if (await save(patch)) { toast('Você saiu do grupo.'); goToDmsView(); }
      },
      { confirmLabel: 'Sair', iconName: 'close' },
    );
  }

  overlay.classList.add('gk-open');
  render();
}
