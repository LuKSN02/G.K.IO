# G.K.IO Desktop (Electron)

Casca desktop do G.K.IO, com recursos inspirados no Dorion.

## Rodar / gerar o instalador
```
cd desktop
npm install
npm start            # abre o app
npm run dist:win     # instalador .exe (rode no Windows)  |  dist:linux  |  dist:mac
```
O app serve a pasta do projeto em `http://localhost:47831` (domínio já autorizado no Firebase Auth).
Para apontar para uma versão hospedada, defina `remoteUrl` em `desktop-config.json` (pasta de dados do app).

## Recursos
- Ícone na bandeja com estados: bolinha vermelha (não lidas), laranja (mutado), cinza (ensurdecido); menu com mutar/ensurdecer/recarregar/reiniciar/sair
- Fechar a janela minimiza para a bandeja; iniciar minimizado; iniciar com o sistema (app instalado)
- Instância única, janela lembra tamanho/posição, contador de não lidas no ícone (macOS/Linux) e no título (Windows)
- Atalhos globais de mutar/ensurdecer (os mesmos definidos em Configurações > Áudio & Vídeo)
- Push-to-talk global via `uiohook-napi` (dependência opcional; sem ela o PTT funciona só com a janela em foco; não funciona em Wayland; o global ignora modificadores)
- Compartilhar tela: menu para escolher tela/janela
- Tudo configurável em Configurações > Aparência > App desktop

- **Jogo em execução (RPC):** detecta ~37 jogos pelo nome do processo (`games.json`) + jogos que você adicionar em Configurações, e grava `activity` no seu perfil ("Jogando X" no cartão de perfil e na lista de membros). **Publique o `firestore.rules` novo** — ele libera o campo `activity`.
- **Efeito de janela:** Windows 11 (acrílico/mica/mica abas), macOS (vibrancy), Linux (só transparente, aplica após reiniciar). Em Windows 10 não há efeito.
- **Atualização automática:** `electron-updater` + GitHub Releases. Edite `build.publish` em `package.json` (owner/repo — hoje `luksn02/G.K.IO`). Para lançar: aumente a versão em `desktop/package.json`, crie a tag `vX.Y.Z` e dê push; o workflow `.github/workflows/release-desktop.yml` gera e publica os instaladores. A versão *portable* do Windows não se atualiza sozinha (use o instalador NSIS).

- **Modo streamer:** detecta OBS/Streamlabs/XSplit etc. (ou liga manualmente) e borra e-mails e códigos de convite; notificações sem prévia
- **Perfis:** várias contas lado a lado, cada uma com login/cache/config próprios (`--profile=nome`)
- **Manutenção:** limpar cache (sem apagar o login), limpar ao abrir, proxy, desligar aceleração de hardware, iniciar maximizado, abrir pasta de dados/logs, reiniciar em modo seguro (`--safe`, também na bandeja)
- **Importar tema/plugin por URL** (https, até 512 KB)

F5 recarrega, F12 abre o DevTools.

## Instalador estilo Discord
O instalador do Windows (`G.K.IO-Setup-<versão>.exe`) funciona como o do Discord:
- **Um clique, sem assistente:** nada de "Avançar > Avançar"; abre uma janelinha de progresso e pronto
- **Instala só para o usuário** (`%LocalAppData%\Programs\G.K.IO`) — **não pede administrador**
- **Splash de marca** (`build/splash.bmp`) antes de instalar; na atualização automática (silenciosa) ele não aparece
- Cria atalho na área de trabalho e no menu Iniciar e **abre o G.K.IO sozinho** ao terminar
- Desinstalar não apaga seus dados (login/config)

**Gerar:** dê dois cliques em `desktop/gerar-instalador.bat` (precisa do Node.js). O arquivo sai em `desktop/dist/`.

**Personalizar:** troque `build/icon.ico` (ícone do app/instalador) e `build/splash.bmp` (460×300, BMP 24 bits); o comportamento fica em `build.nsis` no `package.json` e em `build/installer.nsh`.
