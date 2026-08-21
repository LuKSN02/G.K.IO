// ============================================================
// G.K.IO — Templates de servidor
// Usados na criação (ver openCreateServerModal / createServer em
// servers.js). Cada template só define categorias + canais iniciais;
// tudo pode ser renomeado/reorganizado depois no painel de
// Configurações do servidor, igual um servidor criado do zero.
// ============================================================

export const SERVER_TEMPLATES = {
  custom: {
    label: 'Criar do zero',
    icon: '✨',
    desc: 'Só o essencial — você organiza o resto depois.',
    categories: [
      {
        name: 'Geral',
        channels: [
          { name: 'geral', type: 'text' },
          { name: 'Sala de Voz', type: 'voice' },
        ],
      },
    ],
  },

  gaming: {
    label: 'Gaming',
    icon: '🎮',
    desc: 'Pra clã, guild ou grupo fixo de jogo.',
    categories: [
      {
        name: 'INFORMAÇÕES',
        channels: [
          { name: 'regras', type: 'text' },
          { name: 'anúncios', type: 'text' },
        ],
      },
      {
        name: 'TEXTO',
        channels: [
          { name: 'geral', type: 'text' },
          { name: 'clipes-e-memes', type: 'text' },
        ],
      },
      {
        name: 'VOZ',
        channels: [
          { name: 'Sala 1', type: 'voice' },
          { name: 'Sala 2', type: 'voice' },
        ],
      },
    ],
  },

  estudos: {
    label: 'Grupo de Estudos',
    icon: '📚',
    desc: 'Pra turma, cursinho ou grupo de TCC.',
    categories: [
      {
        name: 'GERAL',
        channels: [
          { name: 'avisos', type: 'text' },
          { name: 'geral', type: 'text' },
        ],
      },
      {
        name: 'MATERIAIS',
        channels: [
          { name: 'duvidas', type: 'text' },
          { name: 'materiais-de-apoio', type: 'text' },
        ],
      },
      {
        name: 'VOZ',
        channels: [
          { name: 'Sala de Estudos', type: 'voice' },
        ],
      },
    ],
  },
};
