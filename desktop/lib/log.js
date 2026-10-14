// Log em arquivo (userData/logs/main.log), com rotação simples. Equivalente
// ao logger.rs do Dorion — útil para pedir ajuda quando algo dá errado.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let file = null;
function init() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'main.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, path.join(dir, 'main.old.log'));
  } catch (e) { file = null; }
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  if (file) { try { fs.appendFileSync(file, line); } catch (e) { /* noop */ } }
  if (!app.isPackaged) process.stdout.write(line);
}
module.exports = { init, log };
