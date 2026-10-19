# G.K.IO — MVP

Aplicativo de comunicacao multiplataforma: servidores com canais de texto/voz (estilo Discord), mensagens diretas, chamadas de voz/video e perfis 100% customizaveis (estilo Skype), com identidade visual propria (Ice White / Gray).

Este MVP roda inteiramente no navegador, sem backend proprio — usa o Firebase (Auth + Firestore) para dados/tempo real e o Cloudinary para upload de midia (avatar, banner, anexos).

---

## 1. Estrutura do projeto

```
gkio/
  index.html            - Shell da aplicacao (unica pagina)
  css/
    tokens.css          - Paleta, tipografia, design tokens
    app.css              - Layout e componentes
    landing.css          - Tela inicial (landing) mostrada no navegador antes do login
  js/
    firebase-config.js  - Preencha com suas credenciais do Firebase
    cloudinary-config.js  - Preencha com seu cloud name + upload preset do Cloudinary
    db.js                - Inicializacao do Firebase + referencias de colecoes
    state.js              - Estado global em memoria + utilitarios
    markdown.js            - Formatacao do texto das mensagens (negrito, codigo, citacao, spoiler, links)
    auth.js                - Login, registro, logout, presenca
    landing.js             - Landing page: abre antes do login (so no navegador), botoes Abrir/Baixar
    servers.js              - Servidores, categorias, canais, convites
    chat.js                  - Mensagens (canais e DMs), anexos de midia
    dms.js                    - Amigos e mensagens diretas
    profile.js                  - Edicao de perfil + cartao de perfil publico
    calls.js                     - Chamadas de voz/video via WebRTC
    cloudinary.js                 - Upload de midia (avatar, banner, anexos) via Cloudinary
    app.js                          - Bootstrap, amarra tudo
  firestore.rules       - Regras de seguranca do Firestore
  storage.rules         - (nao usado neste setup - deixado como referencia caso opte por Firebase Storage no plano Blaze no futuro)
```

## 2. Configurando o Firebase (5-10 min)

1. Acesse https://console.firebase.google.com e crie um novo projeto (ex: gkio-app).
2. Authentication -> aba "Sign-in method" -> ative o provedor E-mail/senha.
3. Firestore Database -> "Criar banco de dados" -> modo de producao -> escolha uma regiao proxima (ex: southamerica-east1).
4. Em Configuracoes do projeto -> Geral -> Seus apps, clique em "Adicionar app" -> Web (</>).
5. Copie o objeto firebaseConfig gerado e cole em js/firebase-config.js, substituindo os valores de exemplo.
6. Em Firestore Database -> Regras, cole o conteudo de firestore.rules e publique.

Observacao: o Firebase Storage nao e usado neste setup porque, desde o final de 2024, ele exige o plano pago Blaze mesmo dentro da cota gratuita. O upload de midia (avatar, banner, anexos de mensagem) e feito via Cloudinary — ver secao 2.1 abaixo.

## 2.1. Configurando o Cloudinary (upload de midia, gratuito e sem cartao)

1. Crie uma conta gratuita em https://cloudinary.com/users/register_free (nao pede cartao).
2. No Dashboard, copie o valor de "Cloud name".
3. Va em Settings (icone de engrenagem) -> Upload -> role ate "Upload presets" -> "Add upload preset".
   - Signing Mode: escolha "Unsigned"
   - De um nome para o preset (ex: gkio_unsigned)
   - Salve
4. Abra js/cloudinary-config.js e cole o cloud name e o nome do preset.

## 2.2. Notificações push (só relevante se você empacotar um APK)

No navegador, notificação já funciona sem nada extra (Configurações ->
Notificações -> ativa "Notificações no desktop") enquanto a aba estiver
aberta. Para notificação de verdade num **APK** (chegando com o app
fechado/em segundo plano), é preciso:

1. No projeto Android (Capacitor), instalar o plugin oficial
   `@capacitor/push-notifications` e colocar o `google-services.json`
   do Firebase (Configurações do projeto -> seus apps -> app Android)
   em `android/app/`.
2. Seguir as instruções no topo de `cloudflare-worker/push-server.js`
   para publicar o Worker que efetivamente dispara o push via FCM
   (mesmo motivo do Worker do LiveKit: Cloud Functions do Firebase
   exigem o plano pago Blaze, isso aqui não).
3. Colar a URL do Worker publicado em `js/push-config.js`.
4. Publicar as `firestore.rules` atualizadas (o campo `fcmToken` no
   doc do usuário precisa estar liberado pela regra).

Sem isso configurado, o app funciona normalmente — só não envia push;
`js/push.js` detecta a ausência de configuração e não faz nada (fica
em silêncio, sem quebrar o resto do app).

## 3. Rodando localmente

Como o app usa ES Modules (script type="module") e importa o SDK do Firebase, ele precisa ser servido por HTTP (abrir o index.html direto como file:// nao funciona).

```bash
# Opcao 1 - Python
cd gkio
python3 -m http.server 8080
# acesse http://localhost:8080

# Opcao 2 - Node
npx serve gkio
```

## 4. O que ja funciona

- Cadastro/login com e-mail e senha, com perfil criado automaticamente.
- Perfil 100% funcional: avatar, banner, bio e links de redes sociais, refletidos em tempo real no cartao de perfil publico (clique em qualquer avatar/nome).
- DMs: pedidos de amizade, lista de conversas, chat em tempo real com texto e anexos de midia.
- Servidores: criacao, convite por codigo, categorias e canais de texto/voz.
- Chat de canal: em tempo real, agrupado por autor, com anexos.
- Chamadas de voz/video em DM: peer-to-peer via WebRTC, sinalizacao por Firestore.
- Canais de voz em servidor: conexao em malha (mesh) entre participantes, boa para grupos pequenos (2-5 pessoas).
- Presenca: online / ausente / nao perturbe / offline, refletida no anel do avatar.
- Notificacoes push (FCM) em builds APK via Capacitor, com deep-link pra DM ao tocar na notificacao (ver secao 2.2).

## 5. Limitacoes conhecidas deste MVP (e como evoluir)

| Limitacao | Por que | Proximo passo |
|---|---|---|
| Canais de voz usam malha P2P | Sem SFU nao escala alem de ~5 pessoas | Adicionar um SFU (LiveKit ou mediasoup) como backend dedicado |
| Chamadas so com STUN publico | Sem TURN, redes com NAT restritivo podem falhar | Subir um coturn (self-hosted) ou usar TURN gerenciado |
| Sem cargos/permissoes granular | Fora do escopo do MVP | Colecao roles + bitmask de permissoes |
| Sem compartilhamento de tela | Fora do escopo do MVP | getDisplayMedia() + troca de track no RTCPeerConnection existente |
| Regras do Firestore sao um ponto de partida | Priorizam simplicidade para o MVP | Validacao de schema por campo + Firebase App Check antes de um lancamento mais amplo |
| Push de canal so abre o servidor, nao o canal exato | Selecionar canal depende do listener de canais (async) ja estar carregado | Guardar nome/id do canal direto no payload e aguardar o snapshot antes de chamar selectChannel |
| Push so cobre DM e canal de texto | Escopo inicial | Notificar tambem em @mencoes, reacoes, chamada recebida |

## 6. Identidade visual

Os tokens de design (cores, tipografia, raio de borda) ficam centralizados em css/tokens.css. Para ajustar a paleta ou o accent color da marca, basta editar as variaveis CSS no topo do arquivo.

## Conversa (v1.3.0)
- **Responder** (botão de seta ao passar o mouse na mensagem): citação clicável acima da resposta; Esc cancela. Quem é respondido conta como mencionado.
- **Fixar mensagens** (alfinete): em canais, quem gerencia canais; em DMs, os dois. O botão de alfinete no topo lista todas as fixadas da conversa.
- **Silenciar / só @menções** (sino no topo): por canal, por servidor e por DM. Afeta som, notificação do app, push e o ponto de "não lida". Fica salvo na conta (`notifPrefs`).
- **Mensagens de voz** (microfone no composer): até 5 min, sobem pelo Cloudinary.
- **Enquetes** (ícone de barras no composer): escolha única ou múltipla; o autor pode encerrar.

> **Importante:** estes recursos usam campos novos (`pinned`, `votes`, `pollClosed`, `notifPrefs`, `lastMentionedUids`).
> Publique o `firestore.rules` atualizado no console do Firebase (Firestore > Regras > Publicar), senão fixar, votar e silenciar dão erro de permissão.

## Moderação (v1.4.0)
- **Moderar** (botão na aba Membros): **castigo** (60 s a 1 semana — a pessoa não envia mensagens nos canais), **expulsar** e **banir** (com motivo). Quem foi banido não volta nem por convite até ser desbanido.
- **Hierarquia:** ninguém modera o dono nem a si mesmo; administradores só o dono modera. A permissão do cargo "Moderar membros" libera tudo isso.
- **Modo lento** (seletor "Lento: …" em cada canal de texto, em Configurações do servidor > Canais): tempo mínimo entre duas mensagens da mesma pessoa. Quem gerencia canais é isento.
- **Aba Moderação:** lista de banidos (com "Desbanir") e **log de auditoria** (expulsões, banimentos, castigos, cargos, canais, modo lento, mensagens apagadas por moderador). O log só acrescenta e lê — ninguém edita nem apaga.

> **Importante:** publique o `firestore.rules` atualizado (Firestore > Regras > Publicar). É ele que barra banidos de voltar e mensagens durante o castigo.
> O **modo lento** é aplicado pelo app (composer): um cliente adulterado consegue burlá-lo. O **castigo** e o **banimento** são garantidos pelas regras do Firestore.

## Convites e entrada (v1.5.0)
- **Convites com validade e limite de usos** (aba Convites): validade de 30 min a 7 dias (ou nunca) e limite de 1 a 100 usos (ou sem limite). A lista mostra usos, prazo e quem criou; dá para **revogar**. Quem só é membro vê apenas os próprios convites; quem gerencia o servidor vê todos.
- **Boas-vindas** (aba Boas-vindas): mensagem automática no canal escolhido quando alguém entra (`{usuario}` e `{servidor}` são substituídos) e **cargo automático** para quem entra.
- O cargo automático só aceita **cargos sem permissões** (etiqueta/cor) — assim, ninguém entra com poderes por engano. Se o cargo ganhar permissões ou for excluído, deixa de ser automático.

> **Importante:** publique o `firestore.rules` atualizado. Ele protege o contador de usos (só sobe de 1 em 1, em convite válido), permite revogar e libera o cargo automático.
> **Limite honesto:** a validade e o limite do convite são conferidos pelo **app** de quem entra. Hoje qualquer conta logada ainda consegue entrar num servidor sabendo o ID dele (as regras não exigem convite). Tornar servidores privados de verdade é um próximo passo.

## Servidor privado de verdade (v1.6.0)
- **Privado** (o padrão de todo servidor criado pelo app): as regras do Firestore só deixam entrar quem usar um **convite válido** — que existe, é daquele servidor, está no prazo e não esgotou. O uso do convite é contado **no mesmo lote** da entrada, então o limite vale mesmo com várias pessoas entrando ao mesmo tempo.
- **Público:** aparece em Comunidades e qualquer pessoa entra sem convite. O dono alterna entre os dois em **Convites > Privacidade**.
- Ninguém consegue "varrer" a lista de convites atrás de códigos: só dá para listar os que você criou (ou, se gerencia o servidor, os do servidor). Convites só podem ser criados por quem já é membro do servidor.

### Como publicar sem trancar ninguém para fora
1. **Primeiro** publique o app novo (Release `v1.6.0`) e espere seus amigos atualizarem. Versões antigas entram em servidor privado do jeito antigo, que as regras novas recusam.
2. **Depois** publique o `firestore.rules` (Firestore > Regras > Publicar). Antes disso, copie as regras atuais para um arquivo — se algo der errado, é só publicar as antigas de volta.
3. **Teste com uma segunda conta:** (a) entrar num servidor privado com um convite válido → deve entrar; (b) tentar de novo com o convite já esgotado → deve recusar; (c) entrar num servidor público pela aba Comunidades → deve entrar.

> Esta é a única parte do projeto que mexe na regra de entrada de todo servidor. Não consegui testar as regras com o emulador do Firestore; o app foi testado com o Firebase simulado.

