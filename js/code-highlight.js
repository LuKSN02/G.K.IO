// ============================================================
// G.K.IO — Realce de sintaxe em blocos de código (sem biblioteca, sem CDN)
// Um tokenizador simples: comentários, strings, números e palavras-chave das linguagens
// mais comuns. Não é um parser de verdade — serve para leitura rápida.
// ============================================================
const KW = {
  js: 'const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this super null undefined true false yield static get set',
  py: 'def class return if elif else for while in not and or is import from as with try except finally raise lambda None True False pass break continue yield async await global nonlocal assert del',
  java: 'public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case break continue try catch finally throw throws import package null true false this super abstract enum var',
  c: 'int long double float char void unsigned signed short struct union enum typedef static const extern return if else for while do switch case break continue sizeof NULL true false include define class public private namespace using new delete template auto bool',
  go: 'func package import var const type struct interface map chan go defer return if else for range switch case break continue select nil true false fallthrough',
  rs: 'fn let mut const struct enum impl trait pub use mod match if else for while loop return break continue self Self true false Some None Ok Err as ref move async await where dyn',
  sh: 'if then else elif fi for while do done case esac function return in echo export local cd exit',
  sql: 'select from where group by order having insert into values update set delete create table alter drop join left right inner outer on and or not null as limit distinct union index primary key foreign references',
  json: 'true false null',
  html: '', css: '',
};
const ALIAS = { javascript: 'js', jsx: 'js', mjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js', python: 'py', cpp: 'c', 'c++': 'c', cs: 'c', 'c#': 'c', csharp: 'c', kotlin: 'java', golang: 'go', rust: 'rs', bash: 'sh', shell: 'sh', zsh: 'sh', yml: 'sh', mysql: 'sql', postgres: 'sql', lua: 'sh' };

export function normalizeLang(lang) { const l = String(lang || '').toLowerCase(); return ALIAS[l] || (l in KW ? l : null); }

/** Devolve uma lista de [classe|null, texto]. */
export function tokenize(code, lang) {
  const l = normalizeLang(lang); if (!l) return [[null, code]];
  const kw = new Set(KW[l].split(' ').filter(Boolean));
  const ci = l === 'sql';
  const hashComment = l === 'py' || l === 'sh';
  const parts = [
    ['c', hashComment ? /#[^\n]*/y : l === 'sql' ? /--[^\n]*|\/\*[\s\S]*?\*\//y : l === 'html' ? /<!--[\s\S]*?-->/y : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ['s', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y],
    ['n', /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/y],
    ['w', /[A-Za-z_$][\w$]*/y],
  ];
  const out = []; let i = 0; let plain = '';
  const flush = () => { if (plain) { out.push([null, plain]); plain = ''; } };
  outer: while (i < code.length) {
    for (const [cls, re] of parts) {
      re.lastIndex = i; const m = re.exec(code);
      if (!m) continue;
      if (cls === 'w') {
        const isKw = kw.has(ci ? m[0].toLowerCase() : m[0]);
        const isFn = !isKw && code[i + m[0].length] === '(';
        if (isKw || isFn) { flush(); out.push([isKw ? 'k' : 'f', m[0]]); } else plain += m[0];
      } else { flush(); out.push([cls, m[0]]); }
      i += m[0].length; continue outer;
    }
    plain += code[i++];
  }
  flush(); return out;
}

export function highlightInto(codeEl, code, lang) {
  const toks = tokenize(code, lang);
  if (toks.length === 1 && toks[0][0] === null) { codeEl.textContent = code; return; }
  codeEl.replaceChildren(...toks.map(([c, t]) => {
    if (!c) return document.createTextNode(t);
    const s = document.createElement('span'); s.className = 'gk-hl-' + c; s.textContent = t; return s;
  }));
}
