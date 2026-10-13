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

F5 recarrega, F12 abre o DevTools.
