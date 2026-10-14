// BetterNsfwTag — versão nativa para o G.K.IO
// Baseado no plugin de mesmo nome do DevilBro (BetterDiscord), reescrito para a
// API de plugins do G.K.IO: não usa BDFDB nem os internos do React do Discord.
// Mostra uma tag "NSFW" ao lado do nome dos canais marcados como +18
// (Configurações do servidor > Canais > botão "18+", ou ao criar o canal).
gkio.addStyle(`
  /* usa o ::after do <span> do nome (o ::after da linha é o ponto de "não lida") */
  .gk-channel[data-nsfw="true"] > span:last-child::after {
    content: "NSFW";
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--gk-danger, #D64545);
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: .4px;
    line-height: 14px;
    vertical-align: middle;
  }
`);
