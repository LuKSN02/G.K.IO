@echo off
chcp 65001 >nul
title Gerando o instalador do G.K.IO
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

echo.
echo === Instalando dependencias... ===
call npm install
if errorlevel 1 goto erro

echo.
echo === Gerando o instalador (pode demorar alguns minutos)... ===
call npx electron-builder --win nsis --publish never
if errorlevel 1 goto erro

echo.
echo Pronto! O instalador esta na pasta "dist":
dir /b "%~dp0dist\*Setup*.exe"
start "" "%~dp0dist"
pause
exit /b 0

:erro
echo.
echo [ERRO] Algo deu errado. Veja a mensagem acima.
pause
exit /b 1
