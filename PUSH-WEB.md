# Push no navegador (site fechado) — 3 passos

1. Firebase Console → Configurações do projeto → Cloud Messaging → "Certificados Web Push" → Gerar par de chaves.
   Copie a chave pública e cole em `js/push-config.js` no campo `webVapidKey`.
2. Cloudflare → seu Worker gkio-push → Edit code → cole o conteúdo novo de `js/push-server.js` → Save and Deploy.
3. Firebase → Firestore → Regras → cole o `firestore.rules` novo → Publicar.

Depois: Configurações → Notificações → ligue "Avisos mesmo com o site fechado (push)".
Obs.: no app Electron não existe push de navegador (lá o aviso é pela bandeja/overlay). No Android o push já funcionava.
