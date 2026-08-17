// ============================================================
// G.K.IO — Configuração do Cloudinary (upload de mídia gratuito)
// ============================================================
// 1. Crie uma conta gratuita em https://cloudinary.com/users/register_free
//    (não pede cartão de crédito).
// 2. No painel (Dashboard), copie o valor de "Cloud name".
// 3. Vá em Settings (engrenagem) -> Upload -> role até "Upload presets"
//    -> "Add upload preset".
//    - Signing Mode: escolha "Unsigned"
//    - Dê um nome para o preset (ex: "gkio_unsigned")
//    - Salve.
// 4. Cole os dois valores abaixo.
// ============================================================

export const cloudinaryConfig = {
  cloudName: 'pftithob',
  uploadPreset: 'gkio unsigned',
};
