# Atualização automática (uma vez só)

O app já tem o atualizador pronto. Ele só liga quando `src-tauri/updater.json` tem a chave pública.
As atualizações são **assinadas**: o app só instala o que foi assinado com a sua chave privada.

## 1. Gerar a chave (no PowerShell, dentro de desktop-rust\src-tauri)
    cargo tauri signer generate -w "$HOME\.tauri\gkio.key"
Ele pede uma senha (pode deixar vazia ou escolher uma) e mostra a **chave pública**.
- `gkio.key` = chave PRIVADA. Nunca compartilhe nem coloque no site/GitHub. Guarde um backup:
  se perder, os apps já instalados não aceitam mais atualização assinada com outra chave.
- `gkio.key.pub` = chave pública.

## 2. Colocar a chave pública no app
Abra `src-tauri\updater.json` e troque `COLE_AQUI_A_CHAVE_PUBLICA` pelo conteúdo de `gkio.key.pub`.
Confira também o `endpoints` (já aponta para as Releases de luksn02/G.K.IO).

## 3. Guardar a chave privada no GitHub
No repositório: Settings > Secrets and variables > Actions > New repository secret:
- `TAURI_SIGNING_PRIVATE_KEY` = conteúdo do arquivo `gkio.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = a senha (vazio se não usou)

## 4. Publicar uma versão
1. Aumente `"version"` em `src-tauri/tauri.conf.json` (ex.: 1.0.1) e `version` em `src-tauri/Cargo.toml`.
2. Faça commit/push e crie a tag: `git tag desktop-v1.0.1 && git push origin desktop-v1.0.1`
3. O GitHub compila Windows/Linux/Mac, assina e cria a Release com o `latest.json`.
4. Os apps instalados (com a chave pública no passo 2) acham a versão nova em até 4 h, baixam e avisam
   "pronta para instalar" em Configurações > Aparência > App desktop > Instalar e reiniciar.

Importante: a versão que você usa hoje (sem chave) não se atualiza. Instale uma vez a primeira versão
gerada depois do passo 2; dali em diante ela se atualiza sozinha.
