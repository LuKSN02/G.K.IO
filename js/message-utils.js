// ============================================================
// G.K.IO — Utilidades compartilhadas das mensagens
// ============================================================

// Texto curto que descreve uma mensagem: usado na citação de resposta, na
// lista de fixadas e no corpo do push.
export function messagePreview(msg, max = 120) {
  const clip = (t) => {
    const s = String(t).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };
  if (msg.poll) return clip('📊 Enquete: ' + msg.poll.question);
  if (msg.sticker && !msg.content) return '🏷️ Figurinha';
  if (msg.content) return clip(msg.content);
  if (Array.isArray(msg.attachments) && msg.attachments.length > 1) return `📎 ${msg.attachments.length} anexos`;
  switch (msg.attachmentType) {
    case 'audio': return '🎤 Mensagem de voz';
    case 'image': return '🖼️ Imagem';
    case 'gif': return '🎞️ GIF';
    case 'video': return '🎬 Vídeo';
    default: return msg.attachmentUrl ? '📎 ' + (msg.attachmentName || 'Anexo') : '';
  }
}

// 75 -> "1:15"
export function formatDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// uids das pessoas @mencionadas no texto (o autocomplete escreve "@username").
// `members` = Map(uid -> { user }) do cache de membros do servidor.
export function extractMentionedUids(text, members) {
  if (!text || !members) return [];
  const names = new Set();
  for (const m of text.matchAll(/@([a-zA-Z0-9_-]{2,32})/g)) names.add(m[1].toLowerCase());
  if (!names.size) return [];
  const uids = [];
  for (const [uid, member] of members) {
    const username = member?.user?.username?.toLowerCase();
    if (username && names.has(username)) uids.push(uid);
  }
  return uids;
}

// 272000 ms -> "4:32" · 5400000 -> "1 h 30 min" · 200000000 -> "2 d 7 h"
export function formatLong(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 3600) return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  if (total < 86400) return `${Math.floor(total / 3600)} h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')} min`;
  return `${Math.floor(total / 86400)} d ${Math.floor((total % 86400) / 3600)} h`;
}
