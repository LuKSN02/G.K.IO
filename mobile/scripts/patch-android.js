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
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.WAKE_LOCK',
];
const features = ['android.hardware.camera', 'android.hardware.microphone'];

let add = '';
for (const p of PERMS) if (!xml.includes(`"${p}"`)) add += `    <uses-permission android:name="${p}" />\n`;
for (const f of features) if (!xml.includes(`"${f}"`)) add += `    <uses-feature android:name="${f}" android:required="false" />\n`;
if (add) xml = xml.replace('</manifest>', add + '</manifest>');

// Canal padrão das notificações push (FCM): é o fallback quando o push chega com o app
// fechado e sem channel_id no payload. O canal em si é criado em js/push.js.
if (!xml.includes('default_notification_channel_id')) {
  xml = xml.replace('</application>', '        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="gkio-messages" />\n    </application>');
}

// Serviço em primeiro plano da captura de tela (obrigatório no Android 10+; tipo mediaProjection no 14+).
const hasNative = fs.existsSync(path.join(__dirname, '..', 'native', 'android'));
if (hasNative && !xml.includes('ScreenCaptureService')) {
  xml = xml.replace('</application>', '        <service android:name=".ScreenCaptureService" android:exported="false" android:foregroundServiceType="mediaProjection" />\n    </application>');
}
// Serviço em primeiro plano da chamada (microfone + som continuam com o app em segundo plano).
if (hasNative && !xml.includes('CallForegroundService')) {
  xml = xml.replace('</application>', '        <service android:name=".CallForegroundService" android:exported="false" android:foregroundServiceType="microphone|mediaPlayback" />\n    </application>');
}
fs.writeFileSync(manifestPath, xml);
console.log('AndroidManifest.xml ajustado.');

// Plugins nativos próprios (captura de tela + modo de áudio de chamada) e a MainActivity que os registra.
const javaDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'io', 'gkio', 'app');
const nativeDir = path.join(__dirname, '..', 'native', 'android');
if (fs.existsSync(nativeDir)) {
  fs.mkdirSync(javaDir, { recursive: true });
  for (const f of fs.readdirSync(nativeDir)) {
    if (f.endsWith('.java')) fs.copyFileSync(path.join(nativeDir, f), path.join(javaDir, f));
  }
  console.log('Plugins nativos copiados para', javaDir);
} else {
  console.warn('AVISO: pasta mobile/native/android não encontrada — APK sairá sem compartilhamento de tela nativo. Suba essa pasta no repositório.');
}

// Versão do app: vem do workflow (APP_VERSION / APP_VERSION_CODE), senão do mobile/package.json. O aviso de atualização compara com isso.
const version = (process.env.APP_VERSION || require('../package.json').version).replace(/^v/i, '');
const [maj = 0, min = 0, pat = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
const versionCode = parseInt(process.env.APP_VERSION_CODE, 10) || (maj * 10000 + min * 100 + pat);
const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, gradle);
console.log(`Versão do app: ${version} (código ${versionCode}).`);

// Assinatura: força o build debug a usar SEMPRE a chave do repositório (mobile/keystore/debug.keystore),
// sem depender do ~/.android do computador/CI. Chave diferente = "conflito" ao atualizar por cima.
const ks = path.join(__dirname, '..', 'keystore', 'debug.keystore').replace(/\\/g, '/');
if (fs.existsSync(ks) && !gradle.includes('gkio-fixed-key')) {
  gradle = gradle.replace(/android\s*\{/, `android {
    // gkio-fixed-key
    signingConfigs {
        debug {
            storeFile file('${ks}')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`);
  fs.writeFileSync(gradlePath, gradle);
  console.log('Assinatura fixa configurada:', ks);
} else if (!fs.existsSync(ks)) {
  console.warn('AVISO: mobile/keystore/debug.keystore não encontrado — o APK sairá com chave aleatória e não atualizará por cima do anterior.');
}
