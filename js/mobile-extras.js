// ============================================================
// Celular: gesto de voltar (deslizar da borda esquerda) e convite para
// instalar o G.K.IO na tela inicial.
// ============================================================

// ---------- Deslizar da borda esquerda = voltar da conversa ----------
(function edgeSwipe() {
  let sx = 0, sy = 0, st = 0, on = false;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    on = e.touches.length === 1 && t.clientX <= 22 && document.documentElement.dataset.mnav === 'chat';
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!on) return; on = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
    if (dx > 80 && dy < 60 && Date.now() - st < 700) document.getElementById('gk-mobile-back-btn')?.click();
  }, { passive: true });
})();

// ---------- Convite de instalação (PWA) ----------
(function installPrompt() {
  const KEY = 'gkio-install-dismissed';
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const set = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* noop */ } };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone || window.gkioDesktop || (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')) return;
  const last = Number(get() || 0);
  if (last && Date.now() - last < 14 * 24 * 3600 * 1000) return; // recusou: não insiste por 14 dias

  let deferred = null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function show(withButton) {
    if (document.getElementById('gk-install-banner') || window.innerWidth > 900) return;
    const b = document.createElement('div');
    b.id = 'gk-install-banner'; b.className = 'gk-install-banner';
    const img = document.createElement('img'); img.src = 'img/logo.png?v=2'; img.alt = '';
    const txt = document.createElement('div'); txt.className = 'gk-install-txt';
    const t = document.createElement('b'); t.textContent = 'Instale o G.K.IO';
    const s = document.createElement('small');
    s.textContent = withButton ? 'Abra mais rápido, direto da tela inicial.' : 'Toque em Compartilhar e depois em "Adicionar à Tela de Início".';
    txt.append(t, s);
    b.append(img, txt);
    if (withButton) {
      const go = document.createElement('button'); go.type = 'button'; go.className = 'gk-btn gk-btn-primary'; go.textContent = 'Instalar';
      go.addEventListener('click', async () => { if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* noop */ } deferred = null; } b.remove(); set(); });
      b.appendChild(go);
    }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'gk-install-x'; x.setAttribute('aria-label', 'Dispensar'); x.textContent = '×';
    x.addEventListener('click', () => { b.remove(); set(); });
    b.appendChild(x);
    document.body.appendChild(b);
  }
  const ready = () => document.getElementById('gk-app') && getComputedStyle(document.getElementById('gk-app')).display !== 'none';
  const whenReady = (fn) => { const iv = setInterval(() => { if (ready()) { clearInterval(iv); setTimeout(fn, 8000); } }, 1000); };

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; whenReady(() => show(true)); });
  window.addEventListener('appinstalled', () => { document.getElementById('gk-install-banner')?.remove(); set(); });
  if (isIos) whenReady(() => show(false));
})();
