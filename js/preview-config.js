// ============================================================
// G.K.IO — Pré-visualização de links (cards com título/descrição/imagem)
// ============================================================
// O navegador não deixa o app ler outros sites (CORS), então os cards de
// link precisam de um mini-servidor. Use o Cloudflare Worker de
// js/preview-server.js (gratuito, igual ao do push/LiveKit) e cole a URL aqui:
//   endpoint: 'https://gkio-link-preview.seu-usuario.workers.dev'
// Sem endpoint: links de imagem aparecem direto e links do YouTube têm
// card (o YouTube libera isso); os demais ficam como link comum.
// ============================================================
export const previewConfig = {
  endpoint: '',
};
