// ============================================================
// G.K.IO — Configuração do LiveKit (chamadas de voz/vídeo via SFU)
// ============================================================
// 1. Crie uma conta gratuita em https://cloud.livekit.io e um projeto.
// 2. Em Settings do projeto, você vai precisar de 3 valores — mas eles
//    NÃO vão aqui neste arquivo, e sim como variáveis do Cloudflare
//    Worker (ver cloudflare-worker/token-server.js):
//      - API Key
//      - API Secret  (NUNCA cole isso em nenhum arquivo dentro de js/)
//      - WebSocket URL (wss://...)
// 3. Publique o Worker no Cloudflare (passo a passo no topo do arquivo
//    cloudflare-worker/token-server.js) e cole a URL dele abaixo.
// ============================================================

export const livekitConfig = {
  // URL do seu Cloudflare Worker (token-server), ex:
  // 'https://gkio-livekit-token.seu-usuario.workers.dev'
  tokenEndpoint: 'https://gkio-livekit-token.trajano-neves01.workers.dev',
};
