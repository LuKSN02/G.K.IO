// ============================================================
// G.K.IO — Formatação de texto das mensagens (markdown "estilo Discord")
// ============================================================
// Converte o texto cru de uma mensagem numa lista de nós do DOM,
// aplicando a mesma sintaxe que as pessoas já conhecem do Discord:
//
//   **negrito**      *itálico*      __sublinhado__     ~~riscado~~
//   `código`         ```bloco```    ||spoiler||        > citação
//   https://link     :emoji_custom:
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
function parseInline(text, resolveEmoji) {
  const out = [];
  const urlRe = new RegExp(URL_SOURCE, 'g');
  let last = 0;
  let m;
  while ((m = urlRe.exec(text))) {
    if (m.index > last) out.push(...parseMarkup(text.slice(last, m.index), resolveEmoji));
    const built = buildLink(m[0]);
    if (Array.isArray(built)) out.push(...built);
    else out.push(built);
    last = urlRe.lastIndex;
  }
  if (last < text.length) out.push(...parseMarkup(text.slice(last), resolveEmoji));
  return out;
}

function parseMarkup(text, resolveEmoji) {
  const parse = (inner) => parseInline(inner, resolveEmoji);
  const rules = inlineRules(parse);
  const emojiRe = /:([a-z0-9_]{2,32}):/;
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
function parseLines(segment, resolveEmoji) {
  const lines = segment.split('\n');
  const out = [];
  let buffer = [];   // linhas normais acumuladas
  let quote = [];    // linhas de citação acumuladas

  const flushText = () => {
    if (!buffer.length) return;
    out.push(...parseInline(buffer.join('\n'), resolveEmoji));
    buffer = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(el('blockquote', { class: 'gk-md-quote' }, parseInline(quote.join('\n'), resolveEmoji)));
    quote = [];
  };

  for (const line of lines) {
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushText(); quote.push(q[1]); }
    else { flushQuote(); buffer.push(line); }
  }
  flushQuote();
  flushText();
  return out;
}

// ---------- Blocos de código ``` ``` ----------
function buildCodeBlock(code, lang) {
  const block = el('pre', { class: 'gk-md-block' }, [
    el('code', {}, code.replace(/^\n/, '').replace(/\n$/, '')),
  ]);
  if (lang) block.appendChild(el('span', { class: 'gk-md-block-lang' }, lang));
  return block;
}

/**
 * Converte o texto de uma mensagem em nós do DOM prontos pra inserir.
 * @param {string} text
 * @param {(name: string) => {url: string}|null} resolveEmoji busca um emoji personalizado pelo nome
 * @returns {Array<Node|string>}
 */
export function renderRichText(text, resolveEmoji = () => null) {
  if (!text) return [];

  const nodes = [];
  const blockRe = /```(?:([a-zA-Z0-9+#._-]{1,20})\n)?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = blockRe.exec(text))) {
    if (m.index > last) nodes.push(...parseLines(text.slice(last, m.index), resolveEmoji));
    nodes.push(buildCodeBlock(m[2], m[1]));
    last = blockRe.lastIndex;
  }
  if (last < text.length) nodes.push(...parseLines(text.slice(last), resolveEmoji));

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
