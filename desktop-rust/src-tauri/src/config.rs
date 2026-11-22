//! Configuração do app (JSON simples na pasta de dados do perfil), com valores padrão e "merge" raso.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomGame { pub exe: String, pub name: String }
impl Default for CustomGame { fn default() -> Self { Self { exe: String::new(), name: String::new() } } }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState { pub width: Option<f64>, pub height: Option<f64>, pub x: Option<i32>, pub y: Option<i32>, pub maximized: bool }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub tray_enabled: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub open_on_startup: bool,
    pub global_shortcuts: bool,
    pub game_activity: bool,
    pub custom_games: Vec<CustomGame>,
    pub blur: String,
    pub auto_update: bool,
    pub streamer_mode: String,
    pub hardware_accel: bool,
    pub start_maximized: bool,
    pub auto_clear_cache: bool,
    pub proxy: String,
    pub remote_url: String,
    pub window: WindowState,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            tray_enabled: true, close_to_tray: true, start_minimized: false, open_on_startup: false,
            global_shortcuts: true, game_activity: true, custom_games: vec![], blur: "none".into(), auto_update: true,
            streamer_mode: "auto".into(), hardware_accel: true, start_maximized: false, auto_clear_cache: false,
            proxy: String::new(), remote_url: String::new(), window: WindowState::default(),
        }
    }
}

pub fn file(dir: &Path) -> PathBuf { dir.join("desktop-config.json") }
pub fn load(dir: &Path) -> Config {
    std::fs::read_to_string(file(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
pub fn save(dir: &Path, cfg: &Config) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(s) = serde_json::to_string_pretty(cfg) { let _ = std::fs::write(file(dir), s); }
}

/// Aplica um `patch` vindo do site (só campos conhecidos e validados). Devolve os nomes dos campos alterados.
pub fn apply_patch(cfg: &mut Config, patch: &serde_json::Value, blur_ok: &[&str]) -> Vec<String> {
    let mut changed = vec![];
    let Some(p) = patch.as_object() else { return changed };
    macro_rules! b { ($key:literal, $field:ident) => { if let Some(v) = p.get($key).and_then(|v| v.as_bool()) { cfg.$field = v; changed.push($key.to_string()); } }; }
    b!("startMaximized", start_maximized); b!("hardwareAccel", hardware_accel); b!("autoClearCache", auto_clear_cache);
    b!("trayEnabled", tray_enabled); b!("closeToTray", close_to_tray); b!("startMinimized", start_minimized);
    b!("openOnStartup", open_on_startup); b!("globalShortcuts", global_shortcuts); b!("gameActivity", game_activity); b!("autoUpdate", auto_update);
    if let Some(v) = p.get("remoteUrl").and_then(|v| v.as_str()) { cfg.remote_url = v.trim().to_string(); changed.push("remoteUrl".into()); }
    if let Some(v) = p.get("streamerMode").and_then(|v| v.as_str()) {
        if ["auto", "on", "off"].contains(&v) { cfg.streamer_mode = v.into(); changed.push("streamerMode".into()); }
    }
    if let Some(v) = p.get("proxy").and_then(|v| v.as_str()) {
        let t = v.trim(); let ok = t.is_empty() || (t.len() <= 200 && ["http://", "https://", "socks4://", "socks5://", "socks://"].iter().any(|s| t.to_lowercase().starts_with(s)) && !t.contains(char::is_whitespace));
        if ok { cfg.proxy = t.into(); changed.push("proxy".into()); }
    }
    if let Some(v) = p.get("blur").and_then(|v| v.as_str()) { if blur_ok.contains(&v) { cfg.blur = v.into(); changed.push("blur".into()); } }
    if let Some(arr) = p.get("customGames").and_then(|v| v.as_array()) {
        cfg.custom_games = arr.iter().take(50).filter_map(|g| {
            let exe: String = g.get("exe")?.as_str()?.trim().chars().take(80).collect();
            let name: String = g.get("name")?.as_str()?.trim().chars().take(64).collect();
            if exe.is_empty() || name.is_empty() { None } else { Some(CustomGame { exe, name }) }
        }).collect();
        changed.push("customGames".into());
    }
    changed
}
