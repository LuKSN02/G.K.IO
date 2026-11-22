// Notas privadas sobre outras pessoas — só você vê (users/{seuUid}/privateNotes/{uidDaPessoa}).
import { auth, db, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from './db.js';
import { el, toast } from './state.js';

const ref = (target) => doc(db, 'users', auth.currentUser.uid, 'privateNotes', target);

export function buildNoteBox(targetUid) {
  if (!auth.currentUser || targetUid === auth.currentUser.uid) return null;
  const ta = el('textarea', { class: 'gk-note-input', rows: '2', maxlength: '500', placeholder: 'Clique para adicionar uma nota (só você vê)' });
  let saved = '';
  getDoc(ref(targetUid)).then((s) => { saved = s.exists() ? (s.data().text || '') : ''; ta.value = saved; }).catch(() => {});
  const save = async () => {
    const v = ta.value.trim();
    if (v === saved) return;
    try {
      if (v) await setDoc(ref(targetUid), { text: v, updatedAt: serverTimestamp() }); else await deleteDoc(ref(targetUid));
      saved = v;
    } catch { toast('Não foi possível salvar a nota.', 'danger'); }
  };
  ta.addEventListener('blur', save);
  return el('div', { class: 'gk-note-box' }, [el('div', { class: 'gk-note-label' }, 'NOTA PRIVADA'), ta]);
}
