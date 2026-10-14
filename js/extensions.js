// ============================================================
// G.K.IO — Temas (CSS) e plugins (JS) do usuário
// Inspirado no sistema de temas/plugins do Dorion: o usuário cola ou
// importa um .css/.js, liga/desliga cada item, e tudo é aplicado na hora.
// Tudo fica só no localStorage do navegador/app — nada vai pro Firebase.
//
// Temas escritos para o Discord (BetterDiscord/Vencord) também funcionam: ao
// detectar um, o app liga a camada de js/discord-compat.js (dá pra forçar
// ligado/desligado por tema nas configurações).
//
// Modo seguro: abrir o app com ?safe=1 na URL não carrega nenhum tema
// nem plugin (útil se um CSS/JS quebrar a interface).
// ============================================================
import { toast } from './state.js';
import { setDiscordCompat, looksLikeDiscordTheme } from './discord-compat.js';

const KEY = 'gkio-extensions';
const MAX_BYTES = 512 * 1024; // trava de sanidade por item

let store = load();
const runtime = new Map(); // id -> { cleanups: [], error: string|null, running: bool }

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && Array.isArray(raw.themes) && Array.isArray(raw.plugins)) {
      // temas salvos antes da camada Discord existir: decide uma vez e guarda
      raw.themes.forEach((t) => { if (typeof t.discord !== 'boolean') t.discord = looksLikeDiscordTheme(t.css || ''); });
      return raw;
    }
  } catch (e) { /* storage indisponível ou JSON inválido */ }
  return { themes: [], plugins: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { toast('Não foi possível salvar (armazenamento cheio ou bloqueado).', 'danger'); }
}
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);

export function isSafeMode() {
  try { return new URLSearchParams(location.search).get('safe') === '1'; } catch (e) { return false; }
}
export function listThemes() { return store.themes.map((t) => ({ ...t })); }
export function listPlugins() { return store.plugins.map((p) => ({ ...p, error: runtime.get(p.id)?.error || null })); }

// ---------- Temas ----------
function styleId(id) { return 'gk-user-theme-' + id; }

function applyTheme(t) {
  document.getElementById(styleId(t.id))?.remove();
  if (!t.enabled || isSafeMode()) return;
  const style = document.createElement('style');
  style.id = styleId(t.id);
  style.setAttribute('data-gk-user-theme', t.name);
  style.textContent = t.css; // @import url(...) funciona nativamente no navegador/Electron
  document.head.appendChild(style); // por último => vence o CSS do app em empates de especificidade
}

// Liga a camada Discord só se houver tema Discord ativo (e fora do modo seguro).
function refreshCompat() {
  setDiscordCompat(!isSafeMode() && store.themes.some((t) => t.enabled && t.discord));
}

export function addTheme(name, css) {
  if (!css.trim()) throw new Error('O CSS está vazio.');
  if (css.length > MAX_BYTES) throw new Error('CSS grande demais (máx. 512 KB).');
  const t = { id: uid(), name: name.trim() || 'Tema sem nome', css, enabled: true, discord: looksLikeDiscordTheme(css) };
  store.themes.push(t); save(); applyTheme(t); refreshCompat();
  return t;
}
export function setThemeEnabled(id, enabled) {
  const t = store.themes.find((x) => x.id === id); if (!t) return;
  t.enabled = enabled; save(); applyTheme(t); refreshCompat();
}
// Força (ou desfaz) o "modo Discord" de um tema — útil se a detecção automática errar.
export function setThemeDiscord(id, discord) {
  const t = store.themes.find((x) => x.id === id); if (!t) return;
  t.discord = !!discord; save(); refreshCompat();
}
export function removeTheme(id) {
  store.themes = store.themes.filter((x) => x.id !== id); save();
  document.getElementById(styleId(id))?.remove();
  refreshCompat();
}

// ---------- Plugins ----------
// Um plugin é o corpo de uma função async que recebe `gkio`:
//   gkio.toast(msg, tipo)        mostra um aviso
//   gkio.onCleanup(fn)           roda fn quando o plugin é desligado/removido
//   gkio.addStyle(css)           injeta CSS (removido junto com o plugin)
//   gkio.storage.get/set(k, v)   armazenamento próprio do plugin
//   gkio.root                    document.documentElement
function makeApi(p, rt) {
  const ns = 'gkio-plugin-' + p.id + ':';
  return {
    version: 1,
    root: document.documentElement,
    toast,
    onCleanup: (fn) => { if (typeof fn === 'function') rt.cleanups.push(fn); },
    addStyle: (css) => {
      const s = document.createElement('style');
      s.setAttribute('data-gk-plugin', p.name);
      s.textContent = String(css);
      document.head.appendChild(s);
      rt.cleanups.push(() => s.remove());
      return s;
    },
    storage: {
      get: (k) => { try { return JSON.parse(localStorage.getItem(ns + k)); } catch (e) { return null; } },
      set: (k, v) => { try { localStorage.setItem(ns + k, JSON.stringify(v)); } catch (e) { /* noop */ } },
    },
  };
}

async function startPlugin(p) {
  stopPlugin(p.id);
  if (!p.enabled || isSafeMode()) return;
  const rt = { cleanups: [], error: null, running: true };
  runtime.set(p.id, rt);
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('gkio', p.code)(makeApi(p, rt));
  } catch (e) {
    rt.error = String(e && e.message ? e.message : e);
    console.error('[G.K.IO plugin ' + p.name + ']', e);
  }
}
function stopPlugin(id) {
  const rt = runtime.get(id);
  if (!rt) return;
  rt.cleanups.splice(0).reverse().forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
  runtime.delete(id);
}

export async function addPlugin(name, code) {
  if (!code.trim()) throw new Error('O código está vazio.');
  if (code.length > MAX_BYTES) throw new Error('Plugin grande demais (máx. 512 KB).');
  const p = { id: uid(), name: name.trim() || 'Plugin sem nome', code, enabled: true };
  store.plugins.push(p); save();
  await startPlugin(p);
  return { ...p, error: runtime.get(p.id)?.error || null };
}
export async function setPluginEnabled(id, enabled) {
  const p = store.plugins.find((x) => x.id === id); if (!p) return;
  p.enabled = enabled; save();
  if (enabled) await startPlugin(p); else stopPlugin(id);
}
export function removePlugin(id) {
  stopPlugin(id);
  store.plugins = store.plugins.filter((x) => x.id !== id); save();
}

// Chamado uma vez no bootstrap do app.
export function initExtensions() {
  if (isSafeMode()) { console.warn('[G.K.IO] modo seguro: temas e plugins desativados.'); return; }
  store.themes.forEach(applyTheme);
  refreshCompat();
  store.plugins.forEach((p) => { startPlugin(p); });
}
