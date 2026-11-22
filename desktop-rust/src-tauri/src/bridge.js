// Ponte injetada na página: expõe `window.gkioDesktop` com a MESMA interface do app Electron,
// então o site (js/desktop.js, settings-extras.js...) funciona sem nenhuma mudança.
(function () {
  if (window.gkioDesktop || !window.__TAURI__) return;
  const T = window.__TAURI__;
  const inv = (cmd, args) => T.core.invoke(cmd, args || {});
  const sub = (event, map) => (cb) => {
    let un = null; let dead = false;
    T.event.listen(event, (e) => cb(map ? map(e.payload) : e.payload)).then((f) => { if (dead) f(); else un = f; });
    return () => { dead = true; if (un) un(); };
  };
  const ua = navigator.userAgent;
  const platform = /Windows/i.test(ua) ? 'win32' : /Mac OS X/i.test(ua) ? 'darwin' : 'linux';
  window.gkioDesktop = {
    isDesktop: true, runtime: 'tauri', platform,
    getConfig: () => inv('cfg_get'),
    setConfig: (patch) => inv('cfg_set', { patch }),
    setTrayState: (state) => { inv('tray_state', { state }).catch(() => {}); },
    setShortcuts: (map) => inv('shortcuts_set', { map }),
    getCurrentGame: () => inv('game_current'),
    onGame: sub('gkio:game'),
    getUpdateStatus: () => inv('update_status'),
    checkForUpdates: () => inv('update_check'),
    installUpdate: () => { inv('update_install').catch(() => {}); },
    onUpdate: sub('gkio:update'),
    getStreamerMode: () => inv('streamer_current'),
    onStreamer: sub('gkio:streamer', (v) => !!v),
    clearCache: () => inv('cache_clear'),
    openDataFolder: () => { inv('open_data').catch(() => {}); },
    openLogsFolder: () => { inv('open_logs').catch(() => {}); },
    restartInSafeMode: () => { inv('safe_mode').catch(() => {}); },
    fetchText: (url) => inv('fetch_text', { url }),
    listProfiles: () => inv('profiles_list'),
    openProfile: (name) => inv('profiles_open', { name }),
    removeProfile: (name) => inv('profiles_remove', { name }),
    showWindow: () => { inv('show_window_cmd').catch(() => {}); },
    onCommand: sub('gkio:command'),
    onPtt: sub('gkio:ptt', (v) => !!v),
  };

  // Links externos (target=_blank / window.open) abrem no navegador do sistema.
  const openExt = (u) => { try { const url = new URL(u, location.href); if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) inv('open_external', { url: url.href }); } catch (e) { /* noop */ } };
  const realOpen = window.open;
  window.open = function (u, t, f) { if (u) { openExt(u); return null; } return realOpen.call(window, u, t, f); };
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let url; try { url = new URL(a.href, location.href); } catch (er) { return; }
    if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) { e.preventDefault(); inv('open_external', { url: url.href }); }
  }, true);

  // Atalhos de desenvolvedor/recarregar (a barra de menu não existe).
  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F5' || (ctrl && e.key.toLowerCase() === 'r')) { e.preventDefault(); location.reload(); }
    else if (e.key === 'F12' || (ctrl && e.shiftKey && e.key.toLowerCase() === 'i')) { e.preventDefault(); inv('toggle_devtools').catch(() => {}); }
  }, true);

  // Notificações nativas do sistema (o WebView nem sempre mostra as da API web).
  class GkNotification {
    constructor(title, opts) {
      this.title = title; this.body = (opts && opts.body) || ''; this.onclick = null; this.onclose = null;
      inv('notify', { title: String(title || 'G.K.IO'), body: String(this.body || '') }).catch(() => {});
    }
    close() {}
    addEventListener() {} removeEventListener() {}
    static get permission() { return 'granted'; }
    static requestPermission(cb) { const p = Promise.resolve('granted'); if (typeof cb === 'function') cb('granted'); return p; }
  }
  try { window.Notification = GkNotification; } catch (e) { /* noop */ }
})();
