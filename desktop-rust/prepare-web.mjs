// Copia só o que o app precisa do site para desktop-rust/web (vira a pasta "web" dentro do instalador).
// Mesma lista do app Electron: index.html, manifest.json, css/, js/, img/.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Pasta do site: 1o argumento (node prepare-web.mjs "C:\\caminho\\do\\site"), senao a pasta acima desta.
const root = process.argv[2] ? resolve(process.argv[2]) : join(here, '..');
console.log('Procurando o site em:', root);
const out = join(here, 'web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'manifest.json', 'css', 'js', 'img']) {
  const from = join(root, item);
  if (!existsSync(from)) { console.error('Faltando no site:', item, '\nDica: passe a pasta do site: node prepare-web.mjs "C:\\caminho\\do\\G.K.IO"'); process.exit(1); }
  cpSync(from, join(out, item), { recursive: true });
}
console.log('Site copiado para', out);
