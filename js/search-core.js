// ============================================================
// G.K.IO — Busca de mensagens: funções puras (sem DOM nem Firebase, testáveis em Node)
// ============================================================
export const norm = (str = '') => String(str).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Texto pesquisável de uma mensagem: conteúdo, nome(s) de anexo e pergunta da enquete.
export function searchableText(msg) {
  const names = Array.isArray(msg.attachments) ? msg.attachments.map((a) => a.name) : [msg.attachmentName];
  return [msg.content, ...names, msg.poll?.question].filter(Boolean).join(' ');
}
export function hasAttachment(msg) {
  return !!(msg.attachmentUrl || (Array.isArray(msg.attachments) && msg.attachments.length));
}

// Filtra uma lista de mensagens (já ordenadas ou não) — função pura, usada também pela busca global.
export function filterMessages(messages, { term = '', authorId = '', onlyAttachments = false } = {}) {
  const t = norm(term.trim());
  return messages.filter((m) => {
    if (m.system) return false;
    if (authorId && m.authorId !== authorId) return false;
    if (onlyAttachments && !hasAttachment(m)) return false;
    if (!t) return !!(authorId || onlyAttachments); // sem termo: só lista se houver outro filtro
    return norm(searchableText(m)).includes(t);
  });
}

// Parte o texto em trechos [{ text, match }] marcando onde o termo aparece (ignora maiúsculas e acentos).
export function highlightSegments(text, term) {
  const t = norm(term.trim());
  const chars = [...String(text)];
  if (!t) return [{ text: chars.join(''), match: false }];
  let flat = '';
  const owner = []; // owner[k] = índice do caractere original que gerou flat[k]
  chars.forEach((c, idx) => { const n = norm(c); for (let k = 0; k < n.length; k++) owner.push(idx); flat += n; });
  const out = [];
  let cursor = 0; let from = 0; let pos;
  while ((pos = flat.indexOf(t, from)) !== -1) {
    const startChar = owner[pos];
    const endChar = owner[pos + t.length - 1] + 1;
    if (startChar < cursor) { from = pos + 1; continue; }
    if (startChar > cursor) out.push({ text: chars.slice(cursor, startChar).join(''), match: false });
    out.push({ text: chars.slice(startChar, endChar).join(''), match: true });
    cursor = endChar;
    from = pos + t.length;
  }
  if (cursor < chars.length) out.push({ text: chars.slice(cursor).join(''), match: false });
  return out;
}

