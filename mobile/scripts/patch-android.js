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
