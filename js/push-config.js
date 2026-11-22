// ============================================================
// G.K.IO — Configuração do envio de push (FCM via Cloudflare Worker)
// ============================================================
// 1. Siga as instruções no topo de cloudflare-worker/push-server.js
//    pra publicar o Worker.
// 2. Cole a URL dele abaixo.
// ============================================================

export const pushConfig = {
  // URL do seu Cloudflare Worker (push-server), ex:
  // 'https://gkio-push.seu-usuario.workers.dev'
  tokenEndpoint: 'https://gkio-push.trajano-neves01.workers.dev',

  // Chave VAPID (push no navegador, com o site fechado). Console do Firebase →
  // Configurações do projeto → Cloud Messaging → Certificados Web Push → "Gerar par de chaves"
  // → copie a "Chave pública" e cole aqui. Enquanto estiver COLE_AQUI, o push web fica desligado.
  webVapidKey: 'COLE_AQUI_A_CHAVE_VAPID',
};
