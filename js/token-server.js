// ============================================================
// G.K.IO — Cloudflare Worker: gera tokens de acesso ao LiveKit
// ============================================================
// Este Worker é o ÚNICO lugar do projeto que conhece o
// LIVEKIT_API_SECRET — ele NUNCA deve existir em nenhum arquivo
// do client (pasta js/), pois quem tiver essa secret consegue
// entrar em qualquer sala como qualquer pessoa.
//
// Fluxo de cada chamada a este Worker:
// 1. O client manda o próprio ID token do Firebase Auth (prova
//    "eu sou de fato este uid" — emitido e assinado pelo Google)
//    + o nome da sala do LiveKit que quer entrar.
// 2. Este Worker valida a ASSINATURA do ID token contra as chaves
//    públicas do Google — nunca confia em nada que o client alegue
//    sobre sua própria identidade.
// 3. Gera um token JWT assinado do LiveKit, usando como "identity"
//    o uid validado no passo 2 (nunca um valor vindo do client).
//
// ---- Deploy (via dashboard da Cloudflare, sem precisar de CLI) ----
// 1. https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
// 2. Dê um nome (ex: gkio-livekit-token) -> Deploy
// 3. "Edit code" -> apague o conteúdo padrão -> cole este arquivo inteiro -> Save and Deploy
// 4. Settings -> Variables and Secrets -> adicione (marcando "Encrypt" nos dois primeiros):
//      LIVEKIT_API_KEY      -> "API Key" do seu projeto em https://cloud.livekit.io
//      LIVEKIT_API_SECRET   -> "API Secret" do mesmo projeto
//      LIVEKIT_URL          -> URL wss:// do seu projeto LiveKit (ex: wss://gkio-xxxx.livekit.cloud)
//      FIREBASE_PROJECT_ID  -> o "projectId" do seu js/firebase-config.js (ex: gkio-e0a14)
// 5. Copie a URL do Worker (ex: https://gkio-livekit-token.SEU-SUBDOMINIO.workers.dev)
//    e cole em js/livekit-config.js -> tokenEndpoint
// ============================================================

// Em produção, troque '*' pelo domínio onde o G.K.IO fica hospedado
// (ex: 'https://gkio.seudominio.com'), para nenhum outro site poder
// chamar este Worker usando a sessão de alguém.
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

    let uid;
    try {
      uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    } catch (e) {
      return json({ error: 'ID token inválido: ' + e.message }, 401, corsHeaders);
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido.' }, 400, corsHeaders); }
    const { room, name, metadata } = body || {};
    if (!room || typeof room !== 'string') return json({ error: '"room" é obrigatório.' }, 400, corsHeaders);

    try {
      const token = await createLiveKitToken({
        apiKey: env.LIVEKIT_API_KEY,
        apiSecret: env.LIVEKIT_API_SECRET,
        identity: uid, // sempre o uid validado — nunca algo vindo do client
        name: (name || uid).toString().slice(0, 128),
        room,
        metadata,
      });
      return json({ token, url: env.LIVEKIT_URL }, 200, corsHeaders);
    } catch (e) {
      return json({ error: 'Falha ao gerar token: ' + e.message }, 500, corsHeaders);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// ============================================================
// Geração do token do LiveKit (JWT HS256) — feita "na mão" com a
// Web Crypto API, sem depender do pacote npm livekit-server-sdk
// (que não é o alvo recomendado para rodar em Workers).
// ============================================================
async function createLiveKitToken({ apiKey, apiSecret, identity, name, room, metadata }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: apiKey,
    sub: identity,
    name,
    nbf: now - 5, // pequena margem para relógios ligeiramente dessincronizados
    exp: now + 60 * 60 * 6, // token válido por 6h — dá pra reconectar sem pedir de novo
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  };
  if (metadata) payload.metadata = String(metadata);

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;
}
function b64url(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function b64urlBytes(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================
// Verificação do ID token do Firebase (JWT RS256), contra as
// chaves públicas do Google — garante que o uid é de fato quem
// diz ser, sem precisar chamar nenhuma API paga do Firebase Admin.
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
function b64urlToUint8(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('formato inválido');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToUint8(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToUint8(payloadB64)));

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
    'RSASSA-PKCS1-v1_5', cryptoKey, b64urlToUint8(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('assinatura inválida');

  return payload.sub; // uid do Firebase, confiável
}
