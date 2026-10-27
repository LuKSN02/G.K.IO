// ============================================================
// G.K.IO — Configuração do GIPHY (busca de GIFs)
// ============================================================
// A chave abaixo é a "chave pública de demonstração" oficial da
// GIPHY (usada em tutoriais e apps de teste) — funciona, mas é
// compartilhada e tem limite de uso menor.
//
// Para produção, crie sua própria chave gratuita em:
// https://developers.giphy.com/dashboard/
// (Create an App > SDK ou API, sem custo, aprovação é rápida)
// e cole o valor abaixo.
// ============================================================

// Para usar a SUA chave sem editar o código: no console do navegador (ou do app),
//   localStorage.setItem('gkio-giphy-key', 'SUA_CHAVE')
// e recarregue. Para valer para todo mundo, troque DEFAULT_KEY abaixo.
const DEFAULT_KEY = 'dc6zaTOxFJmzC';

export const giphyConfig = {
  get apiKey() {
    try { return (localStorage.getItem('gkio-giphy-key') || '').trim() || DEFAULT_KEY; } catch (e) { return DEFAULT_KEY; }
  },
  get isDemoKey() { return this.apiKey === 'dc6zaTOxFJmzC'; },
};
