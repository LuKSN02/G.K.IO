@echo off
cd /d "%~dp0"
if not "%1"=="rodando" (
  cmd /k ""%~f0" rodando"
  exit /b
)
call node prepare-web.mjs
cd src-tauri
cargo tauri dev
