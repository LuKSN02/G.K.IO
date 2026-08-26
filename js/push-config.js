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
  tokenEndpoint: 'COLE_AQUI_A_URL_DO_WORKER',
};
