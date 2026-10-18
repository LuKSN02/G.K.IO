// ============================================================
// G.K.IO — Aviso de versão nova do APK (Android)
//
// Cada atualização do projeto gera um APK novo (ver .github/workflows/build-apk.yml)
// e o publica nas Releases do GitHub — este módulo avisa quando existe um
// mais novo que o instalado. O Android sempre pede a confirmação da
// pessoa para instalar; não dá para instalar em silêncio fora da Play Store.
//
// No navegador e no app de desktop não faz nada.
// ============================================================
import { el } from './state.js';
import { isNativeAndroid } from './native-bridge.js';

const REPO = 'luksn02/G.K.IO';
const DISMISS_KEY = 'gkio-apk-update-dismissed';

// "1.6.10" > "1.6.9"; ignora um "v" no começo.
export function compareVersions(a, b) {
  const parse = (v) => String(v || '').replace(/^(android-)?v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
  const x = parse(a); const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Releases do repositório também têm o instalador do PC — pega a mais recente que tenha um .apk.
async function latestApkRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const releases = await res.json();
  for (const r of releases) {
    if (r.draft) continue; // as releases do APK são marcadas como pré-lançamento de propósito (ver build-apk.yml)
    const apk = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
    if (apk) return { version: String(r.tag_name || '').replace(/^(android-)?v/i, ''), url: apk.browser_download_url, page: r.html_url };
  }
  return null;
}

function showBanner(version, url) {
  if (document.getElementById('gk-update-banner')) return;
  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, version); } catch (e) { /* noop */ }
    banner.remove();
  };
  const banner = el('div', { id: 'gk-update-banner', class: 'gk-update-banner', role: 'status' }, [
    el('span', { class: 'gk-update-text' }, `Nova versão do app disponível (${version}).`),
    el('button', { class: 'gk-btn gk-btn-primary', type: 'button', onclick: () => { window.open(url, '_system'); close(); } }, 'Baixar'),
    el('button', { class: 'gk-btn gk-btn-ghost', type: 'button', onclick: close }, 'Depois'),
  ]);
  document.body.appendChild(banner);
}

export async function checkForApkUpdate() {
  if (!isNativeAndroid()) return;
  try {
    const info = await window.Capacitor?.Plugins?.App?.getInfo?.();
    const current = info?.version;
    if (!current) return; // sem plugin App nesta build: não dá para comparar
    const latest = await latestApkRelease();
    if (!latest || compareVersions(latest.version, current) <= 0) return;
    if (localStorage.getItem(DISMISS_KEY) === latest.version) return; // já dispensou esta versão
    showBanner(latest.version, latest.url);
  } catch (e) { /* sem internet / API do GitHub indisponível: tenta de novo na próxima abertura */ }
}
