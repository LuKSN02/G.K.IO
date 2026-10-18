// Copia o site (index.html, css, js, img, plugins, manifest) para mobile/www,
// a pasta que o Capacitor empacota dentro do APK.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'www');
const ITEMS = ['index.html', 'manifest.json', 'css', 'js', 'img', 'plugins'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const item of ITEMS) {
  const from = path.join(root, item);
  if (!fs.existsSync(from)) { console.warn('aviso: não encontrei', item); continue; }
  fs.cpSync(from, path.join(out, item), { recursive: true });
}
console.log('www pronto em', out);
