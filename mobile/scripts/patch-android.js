// Ajustes no projeto Android gerado por "cap add android":
//  - permissões de microfone/câmera/áudio (chamadas) e de notificação (Android 13+)
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let xml = fs.readFileSync(manifestPath, 'utf8');

const PERMS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
];
const features = ['android.hardware.camera', 'android.hardware.microphone'];

let add = '';
for (const p of PERMS) if (!xml.includes(`"${p}"`)) add += `    <uses-permission android:name="${p}" />\n`;
for (const f of features) if (!xml.includes(`"${f}"`)) add += `    <uses-feature android:name="${f}" android:required="false" />\n`;
if (add) xml = xml.replace('</manifest>', add + '</manifest>');

fs.writeFileSync(manifestPath, xml);
console.log('AndroidManifest.xml ajustado.');

// Versão do app: vem do workflow (APP_VERSION / APP_VERSION_CODE), senão do mobile/package.json. O aviso de atualização compara com isso.
const version = (process.env.APP_VERSION || require('../package.json').version).replace(/^v/i, '');
const [maj = 0, min = 0, pat = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
const versionCode = parseInt(process.env.APP_VERSION_CODE, 10) || (maj * 10000 + min * 100 + pat);
const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, gradle);
console.log(`Versão do app: ${version} (código ${versionCode}).`);
