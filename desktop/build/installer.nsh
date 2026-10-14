; ============================================================
; G.K.IO — instalador personalizado (estilo Discord)
;  - instala por usuário em %LocalAppData%\Programs\G.K.IO (sem pedir admin)
;  - sem assistente "Avançar > Avançar": uma janelinha de progresso
;  - mostra um splash de marca antes de instalar
;  - abre o G.K.IO sozinho quando termina
; Este arquivo é incluído pelo electron-builder (build.nsis.include).
; ============================================================

!macro customInit
  ; Em atualização automática (electron-updater roda o instalador com /S)
  ; não mostramos splash nenhum — a troca de versão é silenciosa.
  ${IfNot} ${Silent}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\gkio-splash.bmp" "${BUILD_RESOURCES_DIR}\splash.bmp"
    ; delay(ms) fade-in(ms) fade-out(ms) cor-transparente arquivo-sem-extensão
    advsplash::show 1800 500 400 -1 "$PLUGINSDIR\gkio-splash"
    Pop $0
  ${EndIf}
!macroend
