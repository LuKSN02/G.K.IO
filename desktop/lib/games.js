// Detecção de jogos em execução (equivalente ao "process scanner" do RPC do
// Dorion). A cada poucos segundos lista os processos do sistema e compara
// com a lista embutida (games.json) + jogos personalizados do usuário.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const BUILTIN = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'games.json'), 'utf8')); } catch (e) { return []; }
})();

function listProcesses() {
  return new Promise((resolve) => {
    const done = (err, out) => resolve(err ? [] : String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([]);
        resolve(String(out).split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean));
      });
    } else {
      execFile('ps', ['-A', '-o', 'comm='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => done(err, out));
    }
  });
}

const norm = (s) => path.basename(String(s)).toLowerCase();

function buildIndex(custom) {
  const idx = new Map();
  for (const g of BUILTIN) for (const e of g.exes) idx.set(norm(e), g.name);
  for (const g of custom || []) if (g && g.exe && g.name) idx.set(norm(g.exe), String(g.name).slice(0, 64)); // custom vence
  return idx;
}

// Retorna o nome do jogo detectado (ou null). No Linux o `comm` vem truncado
// em 15 caracteres, então comparamos também pelo prefixo.
async function detect(custom) {
  const idx = buildIndex(custom);
  const procs = await listProcesses();
  for (const p of procs) {
    const n = norm(p);
    if (idx.has(n)) return idx.get(n);
    if (process.platform !== 'win32' && n.length === 15) {
      for (const [k, v] of idx) if (k.startsWith(n)) return v;
    }
  }
  return null;
}

let timer = null;
let current = null; // { name, startedAt }

function start(getCustom, onChange, intervalMs = 15000) {
  stop();
  const tick = async () => {
    const name = await detect(getCustom());
    if ((current && current.name) === name) return;
    current = name ? { name, startedAt: Date.now() } : null;
    onChange(current);
  };
  tick();
  timer = setInterval(tick, intervalMs);
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (current) { current = null; return true; }
  return false;
}
module.exports = { listProcesses, start, stop, detect, getCurrent: () => current, builtinCount: BUILTIN.length };
