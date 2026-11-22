//! G.K.IO Desktop (Rust / Tauri 2) — recria o app Electron com a mesma ponte `window.gkioDesktop`.
mod config;
mod scan;
mod server;
mod shortcuts;

use config::Config;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const BRIDGE: &str = include_str!("bridge.js");
const TRAY_PNG: &[u8] = include_bytes!("../icons/32x32.png");
const DEFAULT_PORT: u16 = 47831;

#[derive(Clone, Copy, PartialEq)]
enum Action { Mute, Deafen, Ptt }

#[derive(Default, Clone)]
struct TrayState { unread: u32, muted: bool, deafened: bool, in_call: bool }

struct AppState {
    cfg: Mutex<Config>,
    cfg_dir: PathBuf,
    cfg_dirty: AtomicBool,
    profile: String,
    safe: bool,
    origin: Mutex<String>,
    quitting: AtomicBool,
    tray: Mutex<TrayState>,
    bindings: Mutex<HashMap<u32, Action>>,
    ptt_held: AtomicBool,
    game: Mutex<Option<scan::Game>>,
    streamer: AtomicBool,
    log_file: PathBuf,
}

type St<'a> = State<'a, Arc<AppState>>;

fn log(st: &AppState, msg: &str) {
    use std::io::Write;
    let _ = std::fs::create_dir_all(st.log_file.parent().unwrap_or(&st.cfg_dir));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&st.log_file) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[{secs}] {msg}");
    }
}
fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

fn blur_options() -> Vec<&'static str> {
    if cfg!(target_os = "windows") { vec!["none", "acrylic", "mica", "tabbed"] }
    else if cfg!(target_os = "macos") { vec!["none", "vibrancy"] }
    else { vec!["none"] }
}
fn port_for(profile: &str) -> u16 {
    if profile.is_empty() { return DEFAULT_PORT; }
    let mut h: u32 = 0; for c in profile.chars() { h = (h.wrapping_mul(31) + c as u32) % 400; }
    47832 + h as u16
}
fn sanitize_profile(s: &str) -> String { s.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').take(32).collect() }

// ---------------- util ----------------
fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> { app.get_webview_window("main") }
fn show_window(app: &AppHandle) {
    if let Some(w) = main_window(app) { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
}
fn toggle_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) { let _ = w.hide(); } else { show_window(app); }
    }
}
fn send<S: Serialize + Clone>(app: &AppHandle, ev: &str, payload: S) { let _ = app.emit(ev, payload); }
async fn tokio_sleep(secs: u64) { let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_secs(secs))).await; }
fn save_cfg(st: &AppState) { let cfg = st.cfg.lock().unwrap().clone(); config::save(&st.cfg_dir, &cfg); st.cfg_dirty.store(false, Ordering::SeqCst); }

fn relaunch_with(args: &[String]) {
    if let Ok(exe) = std::env::current_exe() { let _ = std::process::Command::new(exe).args(args).spawn(); }
}
fn current_args(without: &[&str]) -> Vec<String> {
    std::env::args().skip(1).filter(|a| !without.contains(&a.as_str())).collect()
}

// ---------------- bandeja ----------------
fn tray_icon_image(color: Option<[u8; 3]>) -> Image<'static> {
    let base = Image::from_bytes(TRAY_PNG).expect("ícone da bandeja");
    let (w, h) = (base.width(), base.height());
    let mut buf = base.rgba().to_vec();
    if let Some([r, g, b]) = color {
        let rad = (w as f32 * 0.22).round(); let (cx, cy) = (w as f32 - rad - 1.0, rad + 1.0);
        for y in 0..h { for x in 0..w {
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            if d <= rad + 1.5 {
                let i = ((y * w + x) * 4) as usize;
                let (rr, gg, bb) = if d <= rad { (r, g, b) } else { (255, 255, 255) };
                buf[i] = rr; buf[i + 1] = gg; buf[i + 2] = bb; buf[i + 3] = 255;
            }
        } }
    }
    Image::new_owned(buf, w, h)
}
fn tray_color(s: &TrayState) -> Option<[u8; 3]> {
    if s.deafened { Some([120, 120, 130]) } else if s.muted { Some([245, 158, 11]) } else if s.unread > 0 { Some([239, 68, 68]) } else { None }
}
fn build_tray_menu(app: &AppHandle, s: &TrayState) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Abrir G.K.IO", true, None::<&str>)?;
    let mute = MenuItem::with_id(app, "mute", if s.muted { "Desmutar microfone" } else { "Mutar microfone" }, s.in_call, None::<&str>)?;
    let deaf = MenuItem::with_id(app, "deafen", if s.deafened { "Parar de ensurdecer" } else { "Ensurdecer" }, s.in_call, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Recarregar", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Reiniciar app", true, None::<&str>)?;
    let safe = MenuItem::with_id(app, "safe", "Reiniciar em modo seguro", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let (s1, s2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
    Menu::with_items(app, &[&open, &s1, &mute, &deaf, &s2, &reload, &restart, &safe, &quit])
}
fn apply_tray(app: &AppHandle) {
    let st = app.state::<Arc<AppState>>();
    let enabled = st.cfg.lock().unwrap().tray_enabled;
    if !enabled { let _ = app.remove_tray_by_id("main"); return; }
    let ts = st.tray.lock().unwrap().clone();
    let tooltip = if ts.unread > 0 { format!("G.K.IO — {} não lida(s)", ts.unread) } else { "G.K.IO".to_string() };
    let menu = match build_tray_menu(app, &ts) { Ok(m) => m, Err(_) => return };
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_icon(Some(tray_icon_image(tray_color(&ts)))); let _ = t.set_tooltip(Some(tooltip)); let _ = t.set_menu(Some(menu));
        return;
    }
    let res = TrayIconBuilder::with_id("main").icon(tray_icon_image(tray_color(&ts))).tooltip(tooltip).menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show_window(app),
            "mute" => send(app, "gkio:command", "toggle-mute"),
            "deafen" => send(app, "gkio:command", "toggle-deafen"),
            "reload" => { if let Some(w) = main_window(app) { let _ = w.eval("location.reload()"); } }
            "restart" => { app.state::<Arc<AppState>>().quitting.store(true, Ordering::SeqCst); relaunch_with(&current_args(&[])); app.exit(0); }
            "safe" => { app.state::<Arc<AppState>>().quitting.store(true, Ordering::SeqCst); let mut a = current_args(&["--safe"]); a.push("--safe".into()); relaunch_with(&a); app.exit(0); }
            "quit" => { app.state::<Arc<AppState>>().quitting.store(true, Ordering::SeqCst); app.exit(0); }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev { toggle_window(tray.app_handle()); }
        })
        .build(app);
    if let Err(e) = res { log(&st, &format!("tray: {e}")); }
}
fn apply_badge(app: &AppHandle) {
    let st = app.state::<Arc<AppState>>();
    let n = st.tray.lock().unwrap().unread;
    if let Some(w) = main_window(app) {
        let _ = w.set_badge_count(if n > 0 { Some(n as i64) } else { None });
        if cfg!(windows) {
            let base = if st.profile.is_empty() { "G.K.IO".to_string() } else { format!("G.K.IO ({})", st.profile) };
            let _ = w.set_title(&if n > 0 { format!("({n}) {base}") } else { base });
        }
    }
}

// ---------------- atalhos globais ----------------
fn apply_shortcuts(app: &AppHandle, map: &Value) -> Value {
    let st = app.state::<Arc<AppState>>();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    st.bindings.lock().unwrap().clear();
    st.ptt_held.store(false, Ordering::SeqCst);
    let mut result = json!({ "mute": false, "deafen": false, "ptt": false });
    if !st.cfg.lock().unwrap().global_shortcuts { return result; }
    let reg = |name: &str, action: Action| {
        let Some(acc) = map.get(name).and_then(|v| v.as_str()).and_then(shortcuts::to_accelerator) else { return false };
        let Ok(sc) = acc.parse::<Shortcut>() else { return false };
        if gs.register(sc).is_ok() { st.bindings.lock().unwrap().insert(sc.id(), action); true } else { false }
    };
    result["mute"] = json!(reg("mute", Action::Mute));
    result["deafen"] = json!(reg("deafen", Action::Deafen));
    if map.get("pttEnabled").and_then(|v| v.as_bool()).unwrap_or(false) { result["ptt"] = json!(reg("ptt", Action::Ptt)); }
    result
}

// ---------------- janela ----------------
fn effect_from(name: &str) -> Option<tauri::window::Effect> {
    use tauri::window::Effect as E;
    match name { "acrylic" => Some(E::Acrylic), "mica" => Some(E::Mica), "tabbed" => Some(E::Tabbed), "vibrancy" => Some(E::UnderWindowBackground), _ => None }
}
/// Retorna true se não precisa reiniciar.
fn apply_blur(app: &AppHandle, name: &str) -> bool {
    let Some(w) = main_window(app) else { return true };
    let eff = if blur_options().contains(&name) { name } else { "none" };
    let cfg = match effect_from(eff) { Some(e) => Some(tauri::utils::config::WindowEffectsConfig { effects: vec![e], state: None, radius: None, color: None, interactive: false }), None => None };
    let _ = w.set_effects(cfg);
    true
}

fn create_window(app: &AppHandle) -> Result<(), String> {
    let st = app.state::<Arc<AppState>>();
    let cfg = st.cfg.lock().unwrap().clone();
    let origin = st.origin.lock().unwrap().clone();
    let url = format!("{}/index.html{}", origin, if st.safe { "?safe=1" } else { "" });
    let parsed: tauri::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let title = if st.profile.is_empty() { "G.K.IO".to_string() } else { format!("G.K.IO ({})", st.profile) };
    let w = cfg.window.clone();
    let hidden = (std::env::args().any(|a| a == "--hidden") || (std::env::args().any(|a| a == "--autostart") && cfg.start_minimized)) && cfg.tray_enabled;
    let origin2 = origin.clone();
    let app2 = app.clone();
    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
        .title(title).inner_size(w.width.unwrap_or(1280.0), w.height.unwrap_or(800.0)).min_inner_size(420.0, 600.0)
        .visible(false).transparent(cfg.blur != "none" && blur_options().contains(&cfg.blur.as_str()))
        .initialization_script(BRIDGE)
        .on_navigation(move |u| {
            if u.as_str().starts_with(&origin2) || u.scheme() == "about" || u.scheme() == "blob" { return true; }
            if matches!(u.scheme(), "http" | "https") { let _ = tauri_plugin_opener::OpenerExt::opener(&app2).open_url(u.as_str(), None::<&str>); }
            false
        })
        .on_page_load(move |win, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if !hidden && !win.is_visible().unwrap_or(false) { let _ = win.show(); }
            }
        });
    if let (Some(x), Some(y)) = (w.x, w.y) { b = b.position(x as f64, y as f64); }
    {
        let dir = st.cfg_dir.join("webview"); let _ = std::fs::create_dir_all(&dir);
        #[cfg(any(windows, target_os = "linux"))] { b = b.data_directory(dir); }
        #[cfg(not(any(windows, target_os = "linux")))] { let _ = dir; }
    }
    if !cfg.proxy.is_empty() { if let Ok(p) = cfg.proxy.parse::<tauri::Url>() { b = b.proxy_url(p); } }
    let win = b.build().map_err(|e| e.to_string())?;
    if w.maximized || cfg.start_maximized { let _ = win.maximize(); }
    if cfg.blur != "none" { apply_blur(app, &cfg.blur); }
    Ok(())
}

// ---------------- comandos (chamados pelo site via window.gkioDesktop) ----------------
fn cfg_json(app: &AppHandle, st: &AppState) -> Value {
    let cfg = st.cfg.lock().unwrap().clone();
    let mut v = serde_json::to_value(&cfg).unwrap_or(json!({}));
    if let Some(o) = v.as_object_mut() {
        o.remove("window");
        o.insert("packaged".into(), json!(!cfg!(debug_assertions)));
        o.insert("version".into(), json!(app.package_info().version.to_string()));
        o.insert("blurOptions".into(), json!(blur_options()));
        o.insert("builtinGames".into(), json!(scan::builtin_count()));
        o.insert("profile".into(), json!(st.profile));
        o.insert("streamerActive".into(), json!(streamer_on(st)));
        o.insert("dataPath".into(), json!(st.cfg_dir.to_string_lossy()));
        o.insert("runtime".into(), json!("tauri"));
    }
    v
}
fn streamer_on(st: &AppState) -> bool {
    match st.cfg.lock().unwrap().streamer_mode.as_str() { "on" => true, "auto" => st.streamer.load(Ordering::SeqCst), _ => false }
}
#[tauri::command] fn cfg_get(app: AppHandle, st: St) -> Value { cfg_json(&app, &st) }
#[tauri::command]
fn cfg_set(app: AppHandle, st: St, patch: Value) -> Value {
    let changed = { let mut cfg = st.cfg.lock().unwrap(); config::apply_patch(&mut cfg, &patch, &blur_options()) };
    save_cfg(&st);
    apply_tray(&app); apply_login_item(&app, &st);
    let has = |k: &str| changed.iter().any(|c| c == k);
    if has("globalShortcuts") { /* o site chama setShortcuts logo em seguida; limpamos já */ if !st.cfg.lock().unwrap().global_shortcuts { let _ = app.global_shortcut().unregister_all(); } }
    if has("gameActivity") || has("customGames") { scan_now(&app); }
    if has("streamerMode") { scan_now(&app); send(&app, "gkio:streamer", streamer_on(&st)); }
    let needs_restart = has("hardwareAccel") || (has("blur") && { let b = st.cfg.lock().unwrap().blur.clone(); !apply_blur(&app, &b) });
    let mut v = cfg_json(&app, &st);
    if let Some(o) = v.as_object_mut() { o.insert("needsRestart".into(), json!(needs_restart)); }
    v
}
#[tauri::command]
fn tray_state(app: AppHandle, st: St, state: Value) {
    { let mut t = st.tray.lock().unwrap();
      t.unread = state.get("unread").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
      t.muted = state.get("muted").and_then(|v| v.as_bool()).unwrap_or(false);
      t.deafened = state.get("deafened").and_then(|v| v.as_bool()).unwrap_or(false);
      t.in_call = state.get("inCall").and_then(|v| v.as_bool()).unwrap_or(false); }
    apply_tray(&app); apply_badge(&app);
}
#[tauri::command] fn shortcuts_set(app: AppHandle, map: Value) -> Value { apply_shortcuts(&app, &map) }
#[tauri::command] fn show_window_cmd(app: AppHandle) { show_window(&app) }
#[tauri::command] fn game_current(st: St) -> Value { match st.game.lock().unwrap().clone() { Some(g) => json!(g), None => Value::Null } }
#[tauri::command] fn streamer_current(st: St) -> bool { streamer_on(&st) }
// ---- Atualização automática (tauri-plugin-updater) ----
// Só ativa quando existe um arquivo "updater.json" ({"pubkey": "...", "endpoints": ["https://.../latest.json"]})
// ao lado do site (pasta de recursos). Sem ele, o estado fica "unavailable" e nada acontece.
static UPD_STATE: std::sync::Mutex<Option<Value>> = std::sync::Mutex::new(None);
static UPD_READY: std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = std::sync::Mutex::new(None);
static UPD_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn upd_set(app: &AppHandle, v: Value) { *UPD_STATE.lock().unwrap() = Some(v.clone()); send(app, "gkio:update", v); }
fn upd_config(app: &AppHandle) -> Option<(String, Vec<url::Url>)> {
    let res = app.path().resource_dir().ok()?;
    let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()))?;
    let file = [res.join("updater.json"), res.join("_up_").join("updater.json"), exe.join("updater.json")].into_iter().find(|p| p.is_file())?;
    let v: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let pubkey = v.get("pubkey")?.as_str()?.trim().to_string();
    if pubkey.is_empty() || pubkey.starts_with("COLE") { return None; }
    let eps: Vec<url::Url> = v.get("endpoints")?.as_array()?.iter().filter_map(|e| e.as_str()).filter_map(|e| url::Url::parse(e).ok()).filter(|u| u.scheme() == "https").collect();
    if eps.is_empty() { return None; }
    Some((pubkey, eps))
}
fn upd_initial(app: &AppHandle) -> Value {
    if cfg!(debug_assertions) { return json!({ "state": "dev" }); }
    if upd_config(app).is_none() { return json!({ "state": "unavailable", "message": "Atualização automática ainda não configurada — baixe o instalador novo quando sair." }); }
    json!({ "state": "idle" })
}
#[tauri::command]
fn update_status(app: AppHandle) -> Value {
    if let Some(v) = UPD_STATE.lock().unwrap().clone() { return v; }
    upd_initial(&app)
}
async fn upd_run(app: AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    if cfg!(debug_assertions) { upd_set(&app, json!({ "state": "dev" })); return; }
    let Some((pubkey, eps)) = upd_config(&app) else { upd_set(&app, upd_initial(&app)); return; };
    if UPD_BUSY.swap(true, Ordering::SeqCst) { return; }
    upd_set(&app, json!({ "state": "checking" }));
    let res: Result<(), String> = async {
        let updater = app.updater_builder().pubkey(pubkey).endpoints(eps).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
        match updater.check().await.map_err(|e| e.to_string())? {
            None => { upd_set(&app, json!({ "state": "none" })); }
            Some(update) => {
                let ver = update.version.clone();
                upd_set(&app, json!({ "state": "downloading", "version": ver, "percent": 0 }));
                let (a2, v2) = (app.clone(), ver.clone());
                let mut got: u64 = 0; let mut last: i64 = -1;
                let bytes = update.download(move |chunk, total| {
                    got += chunk as u64;
                    if let Some(t) = total { if t > 0 { let pct = (got * 100 / t) as i64; if pct != last { last = pct; upd_set(&a2, json!({ "state": "downloading", "version": v2, "percent": pct })); } } }
                }, || {}).await.map_err(|e| e.to_string())?;
                *UPD_READY.lock().unwrap() = Some((update, bytes));
                upd_set(&app, json!({ "state": "ready", "version": ver }));
            }
        }
        Ok(())
    }.await;
    if let Err(e) = res { upd_set(&app, json!({ "state": "error", "message": e.chars().take(200).collect::<String>() })); }
    UPD_BUSY.store(false, Ordering::SeqCst);
}
#[tauri::command]
async fn update_check(app: AppHandle) -> Value {
    upd_run(app.clone()).await;
    update_status(app)
}
#[tauri::command]
fn update_install(app: AppHandle, st: St) {
    let ready = UPD_READY.lock().unwrap().take();
    if let Some((update, bytes)) = ready {
        st.quitting.store(true, Ordering::SeqCst);
        save_cfg(&st);
        match update.install(bytes) {
            Ok(()) => { app.restart(); }
            Err(e) => { st.quitting.store(false, Ordering::SeqCst); upd_set(&app, json!({ "state": "error", "message": e.to_string() })); }
        }
    }
}
#[tauri::command]
fn cache_clear(app: AppHandle) -> bool {
    // Só cache do navegador (não toca em localStorage/IndexedDB, senão você perderia o login).
    if let Some(w) = main_window(&app) {
        let _ = w.eval("(async()=>{try{const k=await caches.keys();await Promise.all(k.map(x=>caches.delete(x)));const r=(await navigator.serviceWorker?.getRegistrations?.())||[];await Promise.all(r.map(x=>x.unregister()))}catch(e){}})()");
    }
    true
}
#[tauri::command]
fn open_data(app: AppHandle, st: St) { let _ = tauri_plugin_opener::OpenerExt::opener(&app).open_path(st.cfg_dir.to_string_lossy(), None::<&str>); }
#[tauri::command]
fn open_logs(app: AppHandle, st: St) { let d = st.log_file.parent().unwrap_or(&st.cfg_dir).to_path_buf(); let _ = std::fs::create_dir_all(&d); let _ = tauri_plugin_opener::OpenerExt::opener(&app).open_path(d.to_string_lossy(), None::<&str>); }
#[tauri::command]
fn safe_mode(app: AppHandle, st: St) { st.quitting.store(true, Ordering::SeqCst); let mut a = current_args(&["--safe"]); a.push("--safe".into()); relaunch_with(&a); app.exit(0); }
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("URL inválida".into()); }
    tauri_plugin_opener::OpenerExt::opener(&app).open_url(url, None::<&str>).map_err(|e| e.to_string())
}
#[tauri::command]
fn toggle_devtools(app: AppHandle) { if let Some(w) = main_window(&app) { if w.is_devtools_open() { w.close_devtools(); } else { w.open_devtools(); } } }
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title.chars().take(120).collect::<String>()).body(body.chars().take(400).collect::<String>()).show();
}
#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    if !url.to_lowercase().starts_with("https://") { return Err("Só URLs https:// são aceitas.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(10)).build();
        let resp = agent.get(&url).call().map_err(|e| match e { ureq::Error::Status(c, _) => format!("Servidor respondeu {c}"), o => o.to_string() })?;
        use std::io::Read;
        let mut buf = Vec::new();
        resp.into_reader().take(512 * 1024 + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        if buf.len() > 512 * 1024 { return Err("Arquivo grande demais (máx. 512 KB).".into()); }
        String::from_utf8(buf).map_err(|_| "O arquivo não é texto UTF-8.".to_string())
    }).await.map_err(|e| e.to_string())?
}

// perfis
fn profiles_file(app: &AppHandle) -> PathBuf { app.path().app_data_dir().unwrap_or_default().join("profiles.json") }
fn read_profiles(app: &AppHandle) -> Vec<String> {
    std::fs::read_to_string(profiles_file(app)).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("profiles").and_then(|p| p.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())).unwrap_or_default()
}
fn write_profiles(app: &AppHandle, list: &[String]) {
    let f = profiles_file(app); let _ = std::fs::create_dir_all(f.parent().unwrap_or(&f));
    let _ = std::fs::write(f, json!({ "profiles": list }).to_string());
}
#[tauri::command] fn profiles_list(app: AppHandle, st: St) -> Value { json!({ "current": st.profile, "profiles": read_profiles(&app) }) }
#[tauri::command]
fn profiles_open(app: AppHandle, name: String) -> Result<bool, String> {
    let n = if name == "default" { String::new() } else { sanitize_profile(&name) };
    if name != "default" && n.is_empty() { return Err("Nome inválido (use letras, números, - e _).".into()); }
    if !n.is_empty() { let mut l = read_profiles(&app); if !l.contains(&n) { l.push(n.clone()); write_profiles(&app, &l); } }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    if !n.is_empty() { cmd.arg(format!("--profile={n}")); }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(true)
}
#[tauri::command]
fn profiles_remove(app: AppHandle, name: String) -> bool { let l: Vec<String> = read_profiles(&app).into_iter().filter(|p| *p != name).collect(); write_profiles(&app, &l); true }
#[tauri::command]
fn selftest_report(app: AppHandle, report: String) { if let Ok(p) = std::env::var("GKIO_SELFTEST") { let _ = std::fs::write(p, report); app.exit(0); } }

// ---------------- varredura de processos (jogo / streamer) ----------------
fn scan_now(app: &AppHandle) {
    let st = app.state::<Arc<AppState>>();
    let procs = scan::process_names();
    let cfg = st.cfg.lock().unwrap().clone();
    // jogo
    let found = if cfg.game_activity { scan::match_game(&procs, &cfg.custom_games) } else { None };
    let mut g = st.game.lock().unwrap();
    if g.as_ref().map(|x| &x.name) != found.as_ref() {
        *g = found.map(|name| scan::Game { name, started_at: now_ms() });
        let payload = match g.clone() { Some(x) => json!(x), None => Value::Null };
        drop(g); send(app, "gkio:game", payload);
    } else { drop(g); }
    // streamer
    let now = cfg.streamer_mode == "auto" && scan::streamer_running(&procs);
    if st.streamer.swap(now, Ordering::SeqCst) != now { send(app, "gkio:streamer", streamer_on(&st)); }
}
fn apply_login_item(app: &AppHandle, st: &AppState) {
    if cfg!(debug_assertions) { return; }
    use tauri_plugin_autostart::ManagerExt;
    let want = st.cfg.lock().unwrap().open_on_startup;
    let al = app.autolaunch();
    let _ = if want { al.enable() } else { al.disable() };
}

// ---------------- entrada ----------------
pub fn run() {
    let profile = sanitize_profile(&std::env::args().find(|a| a.starts_with("--profile=")).map(|a| a[10..].to_string()).unwrap_or_default());
    let safe = std::env::args().any(|a| a == "--safe");
    let mut builder = tauri::Builder::default();
    if profile.is_empty() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, sc, ev| {
            let st = app.state::<Arc<AppState>>();
            let action = st.bindings.lock().unwrap().get(&sc.id()).copied();
            match (action, ev.state()) {
                (Some(Action::Mute), ShortcutState::Pressed) => send(app, "gkio:command", "toggle-mute"),
                (Some(Action::Deafen), ShortcutState::Pressed) => send(app, "gkio:command", "toggle-deafen"),
                (Some(Action::Ptt), ShortcutState::Pressed) => { if !st.ptt_held.swap(true, Ordering::SeqCst) { send(app, "gkio:ptt", true); } }
                (Some(Action::Ptt), ShortcutState::Released) => { if st.ptt_held.swap(false, Ordering::SeqCst) { send(app, "gkio:ptt", false); } }
                _ => {}
            }
        }).build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let base = handle.path().app_data_dir().map_err(|e| e.to_string())?;
            let cfg_dir = if profile.is_empty() { base.clone() } else { base.join("profiles").join(&profile) };
            let cfg = config::load(&cfg_dir);
            if !cfg.hardware_accel { std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu"); }
            let st = Arc::new(AppState {
                cfg: Mutex::new(cfg.clone()), cfg_dir: cfg_dir.clone(), cfg_dirty: AtomicBool::new(false), profile: profile.clone(), safe,
                origin: Mutex::new(String::new()), quitting: AtomicBool::new(false), tray: Mutex::new(TrayState::default()),
                bindings: Mutex::new(HashMap::new()), ptt_held: AtomicBool::new(false), game: Mutex::new(None), streamer: AtomicBool::new(false),
                log_file: cfg_dir.join("logs").join("gkio.log"),
            });
            app.manage(st.clone());
            log(&st, &format!("start {} {} perfil={} {}", handle.package_info().version, std::env::consts::OS, if profile.is_empty() { "default" } else { &profile }, if safe { "safe" } else { "" }));

            // pasta com o site: <recursos>/web (instalado) ou a raiz do repositório (desenvolvimento)
            let web_root = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..") }
                else {
                    let res = handle.path().resource_dir().map_err(|e| e.to_string())?;
                    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default();
                    let cands = [
                        res.join("web"), res.join("_up_").join("web"),
                        exe_dir.join("web"), exe_dir.join("_up_").join("web"),
                        exe_dir.join("..").join("..").join("..").join("web"),
                    ];
                    cands.iter().find(|c| c.join("index.html").is_file()).cloned().unwrap_or_else(|| res.join("web"))
                };
            let origin = if !cfg.remote_url.is_empty() { cfg.remote_url.trim_end_matches('/').to_string() } else {
                let root = std::env::var("GKIO_WEB_ROOT").map(PathBuf::from).unwrap_or(web_root);
                let port = server::start(root, port_for(&profile)).map_err(|e| format!("servidor local: {e}"))?;
                format!("http://localhost:{port}")
            };
            *st.origin.lock().unwrap() = origin;
            if cfg.auto_clear_cache { /* o cache do WebView é limpo pelo próprio navegador ao pedir; mantemos só o do app */ }

            create_window(&handle)?;
            apply_tray(&handle); apply_login_item(&handle, &st);
            // salvar a posição/tamanho da janela
            if let Some(w) = main_window(&handle) {
                let h2 = handle.clone();
                w.on_window_event(move |ev| {
                    let st = h2.state::<Arc<AppState>>();
                    match ev {
                        WindowEvent::CloseRequested { api, .. } => {
                            let (tray, close_tray) = { let c = st.cfg.lock().unwrap(); (c.tray_enabled, c.close_to_tray) };
                            save_cfg(&st);
                            if !st.quitting.load(Ordering::SeqCst) && tray && close_tray { api.prevent_close(); if let Some(w) = main_window(&h2) { let _ = w.hide(); } }
                        }
                        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                            if let Some(w) = main_window(&h2) {
                                if w.is_minimized().unwrap_or(false) { return; }
                                let mut c = st.cfg.lock().unwrap();
                                let max = w.is_maximized().unwrap_or(false);
                                c.window.maximized = max;
                                if !max {
                                    if let (Ok(size), Ok(pos), Ok(sf)) = (w.inner_size(), w.outer_position(), w.scale_factor()) {
                                        c.window.width = Some(size.width as f64 / sf); c.window.height = Some(size.height as f64 / sf);
                                        c.window.x = Some(pos.x); c.window.y = Some(pos.y);
                                    }
                                }
                                st.cfg_dirty.store(true, Ordering::SeqCst);
                            }
                        }
                        _ => {}
                    }
                });
            }
            // thread de fundo: grava a config suja e varre processos
            let h3 = handle.clone();
            std::thread::spawn(move || {
                let mut tick: u32 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let st = h3.state::<Arc<AppState>>();
                    if st.cfg_dirty.load(Ordering::SeqCst) { save_cfg(&st); }
                    if tick % 3 == 0 { scan_now(&h3); }
                    tick = tick.wrapping_add(1);
                }
            });
            let h4 = handle.clone(); std::thread::spawn(move || scan_now(&h4));
            // verificação automática: 8 s depois de abrir e a cada 4 h (se "autoUpdate" estiver ligado)
            { let hu = handle.clone();
              tauri::async_runtime::spawn(async move {
                  tokio_sleep(8).await;
                  loop {
                      let on = hu.state::<Arc<AppState>>().cfg.lock().unwrap().auto_update;
                      if on { upd_run(hu.clone()).await; }
                      tokio_sleep(4 * 60 * 60).await;
                  }
              }); }
            // teste automático (só quando GKIO_SELFTEST=<arquivo> estiver definido)
            if std::env::var("GKIO_SELFTEST").is_ok() {
                let h5 = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(6));
                    if let Some(w) = main_window(&h5) { let _ = w.eval(SELFTEST_JS); }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cfg_get, cfg_set, tray_state, shortcuts_set, game_current, streamer_current, update_status, update_check, update_install,
            cache_clear, open_data, open_logs, safe_mode, fetch_text, profiles_list, profiles_open, profiles_remove, open_external,
            toggle_devtools, notify, selftest_report, show_window_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o G.K.IO Desktop");
}

const SELFTEST_JS: &str = r#"(async()=>{
const beacon=(m)=>{new Image().src='/__t?'+encodeURIComponent(m)};
beacon('alive tauri='+typeof window.__TAURI__+' bridge='+typeof window.gkioDesktop+' origin='+location.origin);
const r={};try{const d=window.gkioDesktop;r.platform=d&&d.platform;
r.cfg=await d.getConfig();r.set=await d.setConfig({closeToTray:false,blur:'bogus',proxy:'ftp://x'});
r.closeToTrayAfter=(await d.getConfig()).closeToTray;r.blurAfter=(await d.getConfig()).blur;r.proxyAfter=(await d.getConfig()).proxy;
r.sc=await d.setShortcuts({mute:'Ctrl+Shift+M',deafen:'Ctrl+Shift+D',ptt:'F9',pttEnabled:true});
r.upd=await d.getUpdateStatus();r.profiles=await d.listProfiles();r.streamer=await d.getStreamerMode();r.game=await d.getCurrentGame();
d.setTrayState({unread:3,muted:true,deafened:false,inCall:true});
let ev=null;const un=d.onCommand((c)=>{ev=c});
try{await d.fetchText('http://x')}catch(e){r.fetchHttpErr=String(e)}
r.cache=await d.clearCache();
}catch(e){r.error=String(e&&e.message||e)}
beacon('report '+JSON.stringify(r));
})()"#;
