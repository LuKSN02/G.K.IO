# G.K.IO Desktop — versão em Rust (Tauri 2)

Mesmo app do desktop atual (pasta `desktop/`, Electron), mas com o núcleo em **Rust** e o navegador do próprio
sistema (WebView2 no Windows, WebKit no Linux/macOS) em vez de embutir o Chromium. O site **não muda**: a ponte
`window.gkioDesktop` tem a mesma interface, então configurações, atalhos, bandeja, jogo em execução etc.
continuam funcionando.

| | Electron (`desktop/`) | Rust/Tauri (`desktop-rust/`) |
|---|---|---|
| Executável | ~100 MB+ (Chromium) | ~9 MB (+ WebView2, que o Windows 10/11 já traz) |
| Memória | alta | bem menor |

## O que tem (igual ao Electron)
Bandeja com estados (não lidas / mutado / ensurdecido) · fechar para a bandeja · iniciar minimizado · iniciar com o
sistema · instância única · atalhos globais de mutar/ensurdecer/**push-to-talk** (com soltar de verdade, sem
dependência extra) · detecção de jogo ("Jogando X", 37 jogos + os seus) · modo streamer (detecta OBS etc.) ·
perfis lado a lado (`--profile=nome`) · modo seguro · proxy · efeitos de janela (Mica/Acrylic no Windows,
vibrancy no macOS) · lembra posição/tamanho da janela · notificações nativas · links externos no navegador ·
limpar cache sem perder o login · pastas de dados/logs.

## Como gerar o instalador (Windows)
1. Instale **Rust** (https://rustup.rs) e o **Node.js** (https://nodejs.org). O instalador do Rust pede o
   "Microsoft C++ Build Tools" — aceite.
2. Dê dois cliques em **`gerar-instalador.bat`**. Na primeira vez baixa o `tauri-cli` e compila tudo (uns 5–15 min).
3. O instalador (`.exe`) abre numa pasta ao final (`src-tauri\target\release\bundle\nsis`).

Para testar sem instalar: `rodar-em-desenvolvimento.bat`.

Linux/macOS: `node prepare-web.mjs && cd src-tauri && cargo tauri build`. No Linux precisa de
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`.
O arquivo `.github/workflows/desktop-rust.yml` gera os três sistemas no GitHub sem instalar nada.

## Diferenças em relação ao Electron
- **Login:** é outro app, então você entra de novo uma vez. Os dados ficam em `%APPDATA%\io.gkio.rust`.
- **Atualização automática:** ainda **não** configurada (precisa de uma chave de assinatura). Hoje o app mostra
  "indisponível" e você instala o instalador novo por cima. Dá para ligar com o `tauri-plugin-updater` depois.
- **Compartilhar tela:** no Windows (WebView2) e macOS funciona pelo seletor do sistema; no Linux (WebKitGTK) depende
  do portal PipeWire e pode não funcionar. O Electron tinha um menu próprio de telas.
- **PTT global em Wayland** não funciona (limitação do Linux, igual ao Electron).
- **Efeitos de janela:** a lista de opções mostra Mica/Acrylic/Tabbed no Windows sem checar a versão; no Windows 10
  podem não ter efeito.
- O ícone ainda é o do site (`img/favicon-512.png`).

## Como funciona por dentro
`src-tauri/src/lib.rs` (janela, bandeja, atalhos, comandos) · `config.rs` (configuração validada) · `scan.rs`
(jogos/streamer) · `server.rs` (servidor local em `http://localhost:47831`, o mesmo endereço do Electron — por isso
Firebase e o Worker de voz aceitam o app) · `bridge.js` (injetado na página; cria `window.gkioDesktop`).
Testes: `cd src-tauri && cargo test`.
