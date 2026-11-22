@echo off
cd /d "%~dp0"
if not "%1"=="rodando" (
  cmd /k ""%~f0" rodando"
  exit /b
)
title Gerando o instalador do G.K.IO (Rust)
echo Pasta: %cd%
echo Tudo que aparecer aqui tambem e salvo em log-instalador.txt
echo.
call :principal > log-instalador.txt 2>&1
type log-instalador.txt
echo.
echo ===== FIM. Se deu erro, me mande o arquivo log-instalador.txt desta pasta =====
goto :eof

:principal
where node
if errorlevel 1 echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org & goto :eof
where cargo
if errorlevel 1 echo [ERRO] Rust nao encontrado. Instale em https://rustup.rs e reabra o terminal & goto :eof
echo === Copiando o site ===
call node prepare-web.mjs
if errorlevel 1 echo [ERRO] prepare-web falhou & goto :eof
cargo tauri --version
if errorlevel 1 (
  echo === Instalando tauri-cli, so na primeira vez, demora ===
  cargo install tauri-cli --version "^2" --locked
  if errorlevel 1 echo [ERRO] tauri-cli falhou & goto :eof
)
echo === Gerando o instalador ===
cd src-tauri
cargo tauri build
if errorlevel 1 echo [ERRO] build falhou & goto :eof
echo PRONTO. Instalador em src-tauri\target\release\bundle\nsis
start "" "%~dp0src-tauri\target\release\bundle\nsis"
goto :eof
