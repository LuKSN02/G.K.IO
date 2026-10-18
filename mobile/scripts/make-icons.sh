#!/usr/bin/env bash
# Troca o ícone padrão do Capacitor pelo logo do G.K.IO (img/favicon-512.png).
# Usa ícones PNG "clássicos" (remove o ícone adaptativo para o logo não ser cortado).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="../img/favicon-512.png"
RES="android/app/src/main/res"
[ -d "$RES" ] || { echo "Rode 'cap add android' antes."; exit 1; }
if command -v magick >/dev/null 2>&1; then IM="magick"; else IM="convert"; fi

for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d="${pair%%:*}"; s="${pair##*:}"
  mkdir -p "$RES/mipmap-$d"
  $IM "$SRC" -resize "${s}x${s}" "$RES/mipmap-$d/ic_launcher.png"
  $IM "$SRC" -resize "${s}x${s}" "$RES/mipmap-$d/ic_launcher_round.png"
  rm -f "$RES/mipmap-$d/ic_launcher_foreground.png"
done
rm -rf "$RES/mipmap-anydpi-v26"
echo "Ícones do G.K.IO aplicados."
