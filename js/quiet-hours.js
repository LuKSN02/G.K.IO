// ============================================================
// G.K.IO — Não perturbe com horário
// Entre "de" e "até" (hora local) o app não toca som nem mostra aviso do sistema, e quem manda
// mensagem não dispara push para você. A configuração fica no aparelho (prefs) e é copiada
// para o seu perfil (campo quietHours, com o fuso) só para o envio de push respeitá-la.
// ============================================================
export const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Math.min(1439, (+m[1]) * 60 + (+m[2])) : 0; };

/** q = { on, from, to } em minutos desde 00:00; offset = Date.getTimezoneOffset() de quem recebe. */
export function inQuiet(q, offset = new Date().getTimezoneOffset(), nowMs = Date.now()) {
  if (!q || !q.on || q.from === q.to) return false;
  const local = (((Math.floor(nowMs / 60000) - offset) % 1440) + 1440) % 1440;
  return q.from < q.to ? (local >= q.from && local < q.to) : (local >= q.from || local < q.to);
}

export function quietFromPrefs(p) { return { on: !!p.quiet, from: toMin(p.quietFrom || '22:00'), to: toMin(p.quietTo || '07:00') }; }

export async function syncQuietToProfile(p) {
  try {
    const { auth, userDoc, updateDoc } = await import('./db.js');
    if (!auth.currentUser) return;
    await updateDoc(userDoc(auth.currentUser.uid), { quietHours: { ...quietFromPrefs(p), off: new Date().getTimezoneOffset() } });
  } catch (e) { /* best-effort */ }
}
