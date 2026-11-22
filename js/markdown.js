// ============================================================
// G.K.IO — Formatação de texto das mensagens (markdown "estilo Discord")
// ============================================================
// Converte o texto cru de uma mensagem numa lista de nós do DOM,
// aplicando a mesma sintaxe que as pessoas já conhecem do Discord:
//
//   **negrito**      *itálico*      __sublinhado__     ~~riscado~~
//   `código`         ```bloco```    ||spoiler||        > citação
//   -# texto pequeno      # Título   ## Título   ### Título
//   https://link     :emoji_custom:     @menção
//
// Nada aqui usa innerHTML: cada trecho vira um nó de texto ou um
// elemento criado por el(), então o conteúdo escrito pela pessoa nunca
// é interpretado como HTML. É a única forma segura de fazer isso —
// montar a string e injetar abriria XSS no chat inteiro.
//
// O parser é recursivo para permitir aninhamento (**negrito com
// *itálico* dentro**), exceto dentro de `código`, onde o texto é
// sempre literal — igual ao Discord.
// ============================================================
import { el } from './state.js';
import { highlightInto } from './code-highlight.js';

// Mensagens curtas feitas só de emoji aparecem em tamanho grande, como
// no Discord. Construído com try/catch porque \p{...} depende de
// suporte a Unicode property escapes na WebView — se faltar, o app
// segue funcionando sem o "emoji grande".
let EMOJI_ONLY_RE = null;
let PICTOGRAPHIC_RE = null;
try {
  EMOJI_ONLY_RE = new RegExp('^(?:\\s|:[a-z0-9_]{2,32}:|\\p{Extended_Pictographic}|\\uFE0F|\\u200D|[\\u{1F3FB}-\\u{1F3FF}])+$', 'u');
  PICTOGRAPHIC_RE = new RegExp('\\p{Extended_Pictographic}', 'gu');
} catch (e) { /* WebView antiga — sem emoji jumbo, o resto funciona igual */ }

const JUMBO_LIMIT = 3; // até 3 emojis sozinhos = tamanho grande

// ---------- Regras inline, em ordem de prioridade ----------
// A ordem importa: quando duas regras casam na mesma posição, vence a
// que vier primeiro aqui. É isso que faz `**x**` virar negrito em vez
// de dois itálicos vazios.
function inlineRules(parse) {
  return [
    // Código inline: conteúdo literal, sem parse recursivo.
    { re: /`([^`\n]+)`/, build: (m) => el('code', { class: 'gk-md-code' }, m[1]) },
    { re: /\|\|([\s\S]+?)\|\|/, build: (m) => buildSpoiler(parse(m[1])) },
    { re: /\*\*\*([\s\S]+?)\*\*\*/, build: (m) => el('strong', {}, [el('em', {}, parse(m[1]))]) },
    { re: /\*\*([\s\S]+?)\*\*/, build: (m) => el('strong', {}, parse(m[1])) },
    { re: /__([\s\S]+?)__/, build: (m) => el('u', {}, parse(m[1])) },
    { re: /~~([\s\S]+?)~~/, build: (m) => el('s', {}, parse(m[1])) },
    { re: /\*(?!\s)([^*\n]+?)\*/, build: (m) => el('em', {}, parse(m[1])) },
    { re: /_(?!\s)([^_\n]+?)_/, build: (m) => el('em', {}, parse(m[1])) },
  ];
}

// Fonte da regex, não a instância: /g guarda lastIndex no próprio objeto,
// e como parseInline é recursivo uma chamada interna zeraria o índice da
// chamada de fora, prendendo o laço na mesma URL pra sempre. Cada chamada
// cria a sua.
const URL_SOURCE = 'https?:\\/\\/[^\\s<>"\'`]+';

function buildSpoiler(children) {
  return el('span', {
    class: 'gk-md-spoiler',
    role: 'button',
    tabindex: '0',
    title: 'Conteúdo oculto — clique para revelar',
    onclick: (e) => e.currentTarget.classList.add('gk-revealed'),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.classList.add('gk-revealed'); }
    },
  }, children);
}

function buildLink(rawUrl) {
  // Pontuação final quase sempre pertence à frase, não à URL
  // ("veja https://x.com/a." / "(https://x.com/a)").
  let url = rawUrl;
  let trailing = '';
  const match = url.match(/[.,;:!?)\]}]+$/);
  if (match) {
    // Só corta o ")" se ele não fechar um "(" que faz parte da própria URL.
    const closers = match[0];
    const opens = (url.match(/\(/g) || []).length;
    const closes = (url.match(/\)/g) || []).length;
    const cut = closes > opens ? closers : closers.replace(/\)+$/, '');
    if (cut) {
      trailing = url.slice(url.length - cut.length);
      url = url.slice(0, url.length - cut.length);
    }
  }
  const link = el('a', {
    class: 'gk-md-link',
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: url,
  }, prettyUrl(url));
  return trailing ? [link, trailing] : link;
}

// Links longos quebram o layout da mensagem — mostramos uma versão
// legível (sem "https://", sem querystring gigante) e deixamos a URL
// completa no title e no href.
function prettyUrl(url) {
  let label = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (label.length > 62) label = label.slice(0, 59) + '…';
  return label;
}

// ---------- Parse inline recursivo ----------
// URLs saem primeiro, antes de qualquer regra de markdown: sem isso, um
// link como https://site.com/a_b_c teria o "_b_" comido como itálico e
// chegaria quebrado no href.
// #canal clicável — o resolvedor é registrado por mention-extras.js (depende do servidor aberto).
let channelResolver = null;
export function setChannelResolver(fn) { channelResolver = fn; }
const channelRe = /(?<![^\s])#([a-z0-9_-]{2,80})/;

function parseInline(text, resolveEmoji, resolveMention) {
  const out = [];
  const urlRe = new RegExp(URL_SOURCE, 'g');
  let last = 0;
  let m;
  while ((m = urlRe.exec(text))) {
    if (m.index > last) out.push(...parseMarkup(text.slice(last, m.index), resolveEmoji, resolveMention));
    const built = buildLink(m[0]);
    if (Array.isArray(built)) out.push(...built);
    else out.push(built);
    last = urlRe.lastIndex;
  }
  if (last < text.length) out.push(...parseMarkup(text.slice(last), resolveEmoji, resolveMention));
  return out;
}

function parseMarkup(text, resolveEmoji, resolveMention) {
  const parse = (inner) => parseInline(inner, resolveEmoji, resolveMention);
  const rules = inlineRules(parse);
  const emojiRe = /:([a-z0-9_]{2,32}):/;
  const mentionRe = /@([a-zA-Z0-9_-]{2,32})/;
  const out = [];
  let rest = text;

  while (rest) {
    let best = null;

    for (const rule of rules) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: () => rule.build(m) };
      }
      if (best && best.index === 0) break; // não dá pra achar nada mais cedo
    }

    // Emoji personalizado só conta como match se o nome existir de fato
    // na biblioteca — senão, ":abc:" continua sendo texto normal.
    const em = emojiRe.exec(rest);
    if (em) {
      const emoji = resolveEmoji(em[1]);
      if (emoji && (best === null || em.index < best.index)) {
        best = {
          index: em.index,
          length: em[0].length,
          node: () => el('img', { class: 'gk-inline-emoji', src: emoji.url, title: `:${em[1]}:`, alt: `:${em[1]}:` }),
        };
      }
    }

    // @menção — mesma lógica: só vira chip destacado se o nome bater com
    // alguém que o resolvedor conhece (membro do servidor, amigo, ou a
    // outra pessoa da DM aberta); senão "@algo" fica como texto puro.
    const men = mentionRe.exec(rest);
    if (men) {
      const hit = resolveMention(men[1]);
      if (hit && (best === null || men.index < best.index)) {
        best = {
          index: men.index,
          length: men[0].length,
          node: () => el('span', { class: 'gk-mention' + (hit.special ? ' gk-mention-special' : ''), title: `@${hit.username}` }, `@${hit.name}`),
        };
      }
    }

    if (channelResolver) {
      const chm = channelRe.exec(rest);
      if (chm) {
        const hit = channelResolver(chm[1]);
        if (hit && (best === null || chm.index < best.index)) {
          best = { index: chm.index, length: chm[0].length, node: () => el('span', { class: 'gk-mention gk-chan-chip', role: 'link', title: 'Ir para o canal', onclick: hit.go }, '#' + hit.name) };
        }
      }
    }

    if (!best) { out.push(rest); break; }
    if (best.index > 0) out.push(rest.slice(0, best.index));
    const built = best.node();
    if (Array.isArray(built)) out.push(...built);
    else out.push(built);
    rest = rest.slice(best.index + best.length);
  }

  return out;
}

// ---------- Citações (> texto), agrupando linhas seguidas ----------
function parseLines(segment, resolveEmoji, resolveMention) {
  const lines = segment.split('\n');
  const out = [];
  let buffer = [];   // linhas normais acumuladas
  let quote = [];    // linhas de citação acumuladas

  const flushText = () => {
    if (!buffer.length) return;
    out.push(...parseInline(buffer.join('\n'), resolveEmoji, resolveMention));
    buffer = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(el('blockquote', { class: 'gk-md-quote' }, parseInline(quote.join('\n'), resolveEmoji, resolveMention)));
    quote = [];
  };

  for (const line of lines) {
    const q = line.match(/^>\s?(.*)$/);
    const sub = line.match(/^-#\s+(\S.*)$/);          // -# texto pequeno e apagado
    const hd = line.match(/^(#{1,3})\s+(\S.*)$/);     // # / ## / ### título
    if (sub || hd) {
      flushQuote(); flushText();
      if (sub) out.push(el('div', { class: 'gk-md-sub' }, parseInline(sub[1], resolveEmoji, resolveMention)));
      else out.push(el('div', { class: 'gk-md-h gk-md-h' + hd[1].length }, parseInline(hd[2], resolveEmoji, resolveMention)));
    }
    else if (q) { flushText(); quote.push(q[1]); }
    else { flushQuote(); buffer.push(line); }
  }
  flushQuote();
  flushText();
  return out;
}

// ---------- Blocos de código ``` ``` ----------
function buildCodeBlock(code, lang) {
  const codeEl = el('code', {}, '');
  highlightInto(codeEl, code.replace(/^\n/, '').replace(/\n$/, ''), lang);
  const block = el('pre', { class: 'gk-md-block' }, [codeEl]);
  if (lang) block.appendChild(el('span', { class: 'gk-md-block-lang' }, lang));
  return block;
}

/**
 * Converte o texto de uma mensagem em nós do DOM prontos pra inserir.
 * @param {string} text
 * @param {(name: string) => {url: string}|null} resolveEmoji busca um emoji personalizado pelo nome
 * @param {(username: string) => {uid: string, name: string, username: string}|null} resolveMention busca quem é @username no contexto atual (servidor/DM)
 * @returns {Array<Node|string>}
 */
// Fórmulas: $$ ... $$ (KaTeX, carregado só quando aparece uma — se falhar, mostra o texto cru).
let katexPromise = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js';
    s.onload = () => resolve(window.katex); s.onerror = () => { katexPromise = null; reject(new Error('katex')); };
    document.head.appendChild(s);
  });
  return katexPromise;
}
function buildMath(tex) {
  const span = el('span', { class: 'gk-md-math', title: tex }, '$$' + tex + '$$');
  loadKatex().then((k) => { try { k.render(tex, span, { displayMode: true, throwOnError: false }); } catch (e) { /* mantém o texto */ } }).catch(() => {});
  return span;
}
function withMath(seg, resolveEmoji, resolveMention) {
  const out = []; const re = /\$\$([^$]{1,400}?)\$\$/g; let last = 0; let m;
  while ((m = re.exec(seg))) {
    if (m.index > last) out.push(...parseLines(seg.slice(last, m.index), resolveEmoji, resolveMention));
    out.push(buildMath(m[1].trim())); last = re.lastIndex;
  }
  if (last < seg.length) out.push(...parseLines(seg.slice(last), resolveEmoji, resolveMention));
  return out;
}

export function renderRichText(text, resolveEmoji = () => null, resolveMention = () => null) {
  if (!text) return [];

  const nodes = [];
  const blockRe = /```(?:([a-zA-Z0-9+#._-]{1,20})\n)?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = blockRe.exec(text))) {
    if (m.index > last) nodes.push(...withMath(text.slice(last, m.index), resolveEmoji, resolveMention));
    nodes.push(buildCodeBlock(m[2], m[1]));
    last = blockRe.lastIndex;
  }
  if (last < text.length) nodes.push(...withMath(text.slice(last), resolveEmoji, resolveMention));

  return nodes.length ? nodes : [text];
}

/**
 * True quando a mensagem é só emoji (nativo e/ou personalizado) em
 * pequena quantidade — o chat mostra esses em tamanho grande.
 */
export function isEmojiOnly(text) {
  if (!EMOJI_ONLY_RE || !text) return false;
  const trimmed = text.trim();
  if (!trimmed || !EMOJI_ONLY_RE.test(trimmed)) return false;
  const custom = (trimmed.match(/:[a-z0-9_]{2,32}:/g) || []).length;
  const native = (trimmed.replace(/:[a-z0-9_]{2,32}:/g, '').match(PICTOGRAPHIC_RE) || []).length;
  const total = custom + native;
  return total > 0 && total <= JUMBO_LIMIT;
}
