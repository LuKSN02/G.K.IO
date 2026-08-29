// ============================================================
// G.K.IO — Cloudflare Worker: envia notificações push (FCM)
// ============================================================
// Por que um Worker e não uma Cloud Function do Firebase? Porque
// Cloud Functions exigem o plano pago (Blaze) do Firebase — o
// G.K.IO evita essa dependência (mesmo motivo do token-server.js
// do LiveKit). Este Worker faz o mesmo papel, de graça.
//
// Fluxo de cada chamada:
// 1. O client (js/push.js) manda o próprio ID token do Firebase Auth
//    (prova "eu sou de fato este uid") + o fcmToken de quem vai
//    receber a notificação (o client já leu isso do doc público do
//    destinatário no Firestore, algo que qualquer pessoa logada pode
//    ler — ver firestore.rules) + título/corpo/dados da notificação.
// 2. Este Worker valida a ASSINATURA do ID token contra as chaves
//    públicas do Google — nunca confia em nada que o client alegue.
// 3. Gera um access token OAuth2 do Google via Service Account (JWT
//    RS256 assinado "na mão" com a Web Crypto API) e usa esse token
//    pra chamar a API HTTP v1 do FCM, que efetivamente entrega o push.
//
// ---- Deploy (via dashboard da Cloudflare, sem precisar de CLI) ----
// 1. Console do Firebase -> Configurações do projeto -> Contas de
//    serviço -> "Gerar nova chave privada" -> baixa um .json.
//    Nele você vai usar os campos "client_email" e "private_key".
// 2. https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
// 3. Dê um nome (ex: gkio-push) -> Deploy
// 4. "Edit code" -> apague o conteúdo padrão -> cole este arquivo
//    inteiro -> Save and Deploy
// 5. Settings -> Variables and Secrets -> adicione (marcando "Encrypt"
//    nos dois primeiros):
//      FCM_SERVICE_ACCOUNT_EMAIL    -> campo "client_email" do JSON
//      FCM_SERVICE_ACCOUNT_KEY      -> campo "private_key" do JSON
//                                      (cole com as quebras de linha reais,
//                                      não como "\n" escapado)
//      FIREBASE_PROJECT_ID          -> o "projectId" do seu
//                                      js/firebase-config.js (ex: gkio-e0a14)
// 6. Copie a URL do Worker (ex: https://gkio-push.SEU-SUBDOMINIO.workers.dev)
//    e cole em js/push-config.js -> endpoint
// ============================================================

// Em produção, troque '*' pelo domínio onde o G.K.IO fica hospedado.
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!idToken) return json({ error: 'ID token do Firebase ausente.' }, 401, corsHeaders);

    try {
      await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    } catch (e) {
      return json({ error: 'ID token inválido: ' + e.message }, 401, corsHeaders);
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido.' }, 400, corsHeaders); }
    const { token, title, body: msgBody, data } = body || {};
    if (!token || typeof token !== 'string') return json({ error: '"token" (fcmToken do destinatário) é obrigatório.' }, 400, corsHeaders);

    try {
      const accessToken = await getGoogleAccessToken(env);
      const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: String(title || 'G.K.IO'), body: String(msgBody || '') },
            // FCM só aceita strings nos valores de "data" — stringifica tudo.
            data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
            android: { priority: 'high' },
          },
        }),
      });
      if (!fcmRes.ok) {
        const errBody = await fcmRes.json().catch(() => ({}));
        return json({ error: errBody?.error?.message || 'Falha ao enviar push.' }, 502, corsHeaders);
      }
      return json({ ok: true }, 200, corsHeaders);
    } catch (e) {
      return json({ error: 'Falha ao enviar push: ' + e.message }, 500, corsHeaders);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// ============================================================
// OAuth2 do Google via Service Account (JWT RS256 assinado na mão),
// trocado por um access token com escopo do FCM. Cacheado em memória
// do isolate do Worker por ~50min (o token dura 1h) pra não assinar/
// trocar um JWT novo a cada notificação enviada.
// ============================================================
let cachedAccessToken = null;
let cachedAccessTokenAt = 0;

async function getGoogleAccessToken(env) {
  if (cachedAccessToken && Date.now() - cachedAccessTokenAt < 50 * 60_000) return cachedAccessToken;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.FCM_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(env.FCM_SERVICE_ACCOUNT_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error('não foi possível obter access token do Google (confira FCM_SERVICE_ACCOUNT_EMAIL/KEY)');
  const data = await res.json();
  cachedAccessToken = data.access_token;
  cachedAccessTokenAt = Date.now();
  return cachedAccessToken;
}

// Converte o PEM da service account (PKCS8) numa CryptoKey importável.
// Robusto a diferentes formas de colar a chave: aceita tanto quebras de
// linha reais quanto sequências literais "\n"/"\r\n" (comum ao copiar de
// um editor de texto puro), e também aceita quando a pessoa colou a
// LINHA INTEIRA do JSON (ex: "private_key": "-----BEGIN...-----",) em
// vez de só o valor — nesse caso extrai só o que está entre os
// marcadores BEGIN/END e descarta o resto (nome do campo, aspas, vírgula).
async function importPrivateKey(pem) {
  const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  const body = match
    ? match[1]
    : pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '');
  const clean = body
    .replace(/\\r/g, '')
    .replace(/\\n/g, '') // sequência literal "\n" (barra + n) colada como texto
    .replace(/\s/g, '')  // quebras de linha/espaços reais
    .replace(/["',]/g, ''); // aspas/vírgula que sobraram de colar a linha inteira do JSON
  const bytes = b64urlToUint8(clean.replace(/-/g, '+').replace(/_/g, '/'));
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToUint8(str) {
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ============================================================
// Verificação do ID token do Firebase (JWT RS256), contra as
// chaves públicas do Google — idêntica à do token-server.js (LiveKit).
// ============================================================
let cachedKeys = null;
let cachedKeysAt = 0;
async function getGoogleJwks() {
  if (cachedKeys && Date.now() - cachedKeysAt < 3600_000) return cachedKeys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const data = await res.json();
  cachedKeys = data.keys;
  cachedKeysAt = Date.now();
  return cachedKeys;
}
async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('formato inválido');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToUint8(headerB64.replace(/-/g, '+').replace(/_/g, '/'))));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToUint8(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))));

  if (payload.aud !== projectId) throw new Error('aud não confere com FIREBASE_PROJECT_ID');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss não confere');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expirado');
  if (!payload.sub) throw new Error('token sem sub (uid)');

  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('chave de assinatura desconhecida (kid não encontrado)');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    b64urlToUint8(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('assinatura inválida');
  return payload.sub;
}
