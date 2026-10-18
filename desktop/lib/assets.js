// Resolve arquivos de imagem do app tanto em desenvolvimento quanto instalado.
// Instalado, o electron-builder copia a pasta img/ para <resources>/web/img
// (ver "extraResources" no package.json) — o caminho antigo "../../img" só
// existe com o código-fonte ao lado, e era por isso que o ícone da bandeja
// ficava invisível no app instalado.
const path = require('path');
const fs = require('fs');

function candidates(name) {
  const list = [];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'web', 'img', name));
  list.push(path.join(__dirname, '..', '..', 'img', name));      // dev: desktop/lib -> raiz/img
  list.push(path.join(__dirname, '..', 'build', 'icon.png'));    // último recurso
  return list;
}

function imgPath(name) {
  return candidates(name).find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

module.exports = { imgPath };
