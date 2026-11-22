// "Traduzir mensagem": usa o serviço gratuito MyMemory (sem chave; limite diário baixo). O texto da
// mensagem é enviado a esse serviço só quando a pessoa pede.
import { el, toast } from './state.js';

const done = new Map(); // msgId -> { text, lang }
const target = () => (navigator.language || 'pt-BR').toLowerCase().startsWith('pt') ? 'pt-BR' : (navigator.language || 'en').slice(0, 2);

/** Quebra em pedaços de até ~450 caracteres, respeitando frases. */
export function chunkText(text, max = 450) {
  const out = []; let cur = '';
  for (const part of String(text).split(/(?<=[.!?\n])\s+/)) {
    if ((cur + ' ' + part).trim().length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (part.length > max) { for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max)); continue; }
    cur = (cur + ' ' + part).trim();
  }
  if (cur) out.push(cur);
  return out;
}

async function translateText(text, to) {
  const parts = chunkText(text); const res = [];
  for (const p of parts) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${encodeURIComponent('autodetect|' + to)}`);
    if (!r.ok) throw new Error('serviço indisponível');
    const j = await r.json();
    if (j.responseStatus && Number(j.responseStatus) !== 200) throw new Error(j.responseDetails || 'falhou');
    res.push(j.responseData?.translatedText || '');
  }
  return res.join(' ');
}

function apply() {
  for (const [id, t] of done) {
    const row = document.querySelector(`#gk-messages .gk-msg-row[data-msg-id="${CSS.escape(id)}"]`);
    if (!row || row.querySelector('.gk-translation')) continue;
    const line = row.querySelector('.gk-msg-line');
    const box = el('div', { class: 'gk-translation' }, [el('small', {}, `Tradução (${t.lang})`), el('div', {}, t.text), el('button', { type: 'button', class: 'gk-translation-x', onclick: () => { done.delete(id); box.remove(); } }, 'Ocultar')]);
    (line || row).after(box);
  }
}
let timer = null;
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 120); }).observe(document.body, { childList: true, subtree: true });

export async function translateMessage(msg) {
  if (!msg?.content) { toast('Essa mensagem não tem texto.'); return; }
  if (done.has(msg.id)) { done.delete(msg.id); document.querySelector(`.gk-msg-row[data-msg-id="${CSS.escape(msg.id)}"] .gk-translation`)?.remove(); return; }
  const lang = target();
  toast('Traduzindo…');
  try { done.set(msg.id, { text: await translateText(msg.content, lang), lang }); apply(); }
  catch (e) { toast('Não consegui traduzir: ' + (e.message || e), 'danger'); }
}
