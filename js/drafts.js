// ============================================================
// G.K.IO — Rascunhos por conversa
// O que você digitou e não enviou fica guardado neste aparelho, separado por canal/DM, e volta
// quando você retorna à conversa. Some ao enviar ou ao apagar o texto.
// ============================================================
import { state } from './state.js';

const KEY = 'gkio-drafts';
const MAX = 40;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* cota/privado */ } };
const curKey = () => (state.currentDmId ? `dm:${state.currentDmId}` : state.currentChannelId ? `ch:${state.currentChannelId}` : null);

export function hasDraft(key) { return !!read()[key]?.t; }

export function initDrafts() {
  const ta = document.getElementById('gk-composer-input');
  if (!ta) return;
  let last = null; let switchedAt = 0;
  const save = (key, text) => {
    if (!key) return;
    const all = read();
    if (text.trim()) all[key] = { t: text.slice(0, 4000), at: Date.now() }; else delete all[key];
    const keys = Object.keys(all);
    if (keys.length > MAX) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX).forEach((k) => delete all[k]);
    write(all);
  };
  ta.addEventListener('input', () => save(last || curKey(), ta.value));
  setInterval(() => {
    const key = curKey();
    if (key !== last) {
      last = key; switchedAt = Date.now();
      const d = key ? read()[key] : null;
      if (!ta.value || ta.value === '') { ta.value = d?.t || ''; ta.dispatchEvent(new Event('input')); }
      else if (d?.t && ta.value !== d.t) { ta.value = d.t; ta.dispatchEvent(new Event('input')); } // texto de outra conversa ficou no campo: troca pelo rascunho certo
      return;
    }
    // Campo vazio depois do tempo de troca = mensagem enviada (ou apagada): rascunho some.
    if (key && ta.value === '' && Date.now() - switchedAt > 1500 && read()[key]) save(key, '');
  }, 350);
}
