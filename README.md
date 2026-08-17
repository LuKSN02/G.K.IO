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
  js/
    firebase-config.js  - Preencha com suas credenciais do Firebase
    cloudinary-config.js  - Preencha com seu cloud name + upload preset do Cloudinary
    db.js                - Inicializacao do Firebase + referencias de colecoes
    state.js              - Estado global em memoria + utilitarios
    auth.js                - Login, registro, logout, presenca
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

## 5. Limitacoes conhecidas deste MVP (e como evoluir)

| Limitacao | Por que | Proximo passo |
|---|---|---|
| Canais de voz usam malha P2P | Sem SFU nao escala alem de ~5 pessoas | Adicionar um SFU (LiveKit ou mediasoup) como backend dedicado |
| Chamadas so com STUN publico | Sem TURN, redes com NAT restritivo podem falhar | Subir um coturn (self-hosted) ou usar TURN gerenciado |
| Sem cargos/permissoes granular | Fora do escopo do MVP | Colecao roles + bitmask de permissoes |
| Sem compartilhamento de tela | Fora do escopo do MVP | getDisplayMedia() + troca de track no RTCPeerConnection existente |
| Regras do Firestore sao um ponto de partida | Priorizam simplicidade para o MVP | Validacao de schema por campo + Firebase App Check antes de um lancamento mais amplo |

## 6. Identidade visual

Os tokens de design (cores, tipografia, raio de borda) ficam centralizados em css/tokens.css. Para ajustar a paleta ou o accent color da marca, basta editar as variaveis CSS no topo do arquivo.
