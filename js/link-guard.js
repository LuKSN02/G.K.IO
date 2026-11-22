// ============================================================
// G.K.IO — Aviso de link suspeito
// Ao clicar num link de mensagem, checa sinais clássicos de golpe e pede confirmação.
// NÃO consulta nenhuma lista de sites maliciosos (isso exigiria um serviço externo): são só
// heurísticas locais — um link "limpo" aqui não significa que seja seguro.
// ============================================================
import { confirmDialog } from './dialogs.js';

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'ow.ly', 'buff.ly', 'rebrand.ly']);
const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'work']);
const BRANDS = ['discord', 'steam', 'google', 'paypal', 'nitro', 'gkio', 'roblox', 'epicgames', 'whatsapp'];
const OFFICIAL = /(^|\.)(discord\.com|discord\.gg|discordapp\.com|steampowered\.com|steamcommunity\.com|google\.com|paypal\.com|roblox\.com|epicgames\.com|whatsapp\.com)$/;
const EXEC_EXT = /\.(exe|scr|bat|cmd|msi|apk|jar|vbs|ps1|lnk|dmg|pkg)(\?|#|$)/i;

export function analyzeLink(href, text = '') {
  let u; try { u = new URL(href); } catch (e) { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const host = u.hostname.toLowerCase(); const why = [];
  if (u.username || u.password) why.push('o endereço tem "usuário@" (truque para esconder o site real)');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) why.push('usa um número de IP em vez de um nome de site');
  if (host.split('.').some((p) => p.startsWith('xn--'))) why.push('usa caracteres que imitam letras comuns (punycode)');
  if (SHORTENERS.has(host)) why.push('é um link encurtado — não dá para ver o destino');
  if (RISKY_TLDS.has(host.split('.').pop())) why.push(`termina em ".${host.split('.').pop()}", comum em golpes`);
  if (EXEC_EXT.test(u.pathname)) why.push('baixa um programa executável');
  if (BRANDS.some((b) => host.includes(b)) && !OFFICIAL.test(host) && host !== 'localhost' && !/gkio/.test(host)) why.push('o nome lembra uma marca conhecida, mas o site não é o oficial');
  const shown = String(text).trim();
  if (/^https?:\/\//i.test(shown)) { try { if (new URL(shown).hostname.toLowerCase() !== host) why.push(`o texto do link mostra "${new URL(shown).hostname}", mas leva para "${host}"`); } catch (e) { /* noop */ } }
  return why;
}

export function initLinkGuard() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="http"]');
    if (!a || a.dataset.gkTrusted || !a.closest('#gk-messages, .gk-thread-body, .gk-event-card, .gk-forum')) return;
    const why = analyzeLink(a.href, a.textContent);
    if (!why.length) return;
    e.preventDefault(); e.stopPropagation();
    confirmDialog({
      title: 'Link suspeito', iconName: 'shield', tone: 'danger', confirmLabel: 'Abrir mesmo assim',
      message: `Este link parece arriscado:\n• ${why.join('\n• ')}\n\nDestino: ${a.href.slice(0, 140)}`,
      onConfirm: () => { window.open(a.href, '_blank', 'noopener,noreferrer'); },
    });
  }, true);
}
