//! Detecção de jogos em execução e de programas de transmissão (modo streamer), via lista de processos.
use crate::config::CustomGame;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Deserialize)]
struct BuiltinGame { name: String, exes: Vec<String> }

const GAMES_JSON: &str = include_str!("../games.json");
const STREAM_APPS: &[&str] = &[
    "obs64.exe", "obs32.exe", "obs.exe", "obs", "obs-studio", "streamlabs desktop.exe", "streamlabs obs.exe", "slobs.exe",
    "xsplit.core.exe", "twitchstudio.exe", "twitch studio.exe", "prismlivestudio.exe", "vmix64.exe", "tiktok live studio.exe",
];

pub fn builtin_count() -> usize { serde_json::from_str::<Vec<BuiltinGame>>(GAMES_JSON).map(|v| v.len()).unwrap_or(0) }

pub fn norm(s: &str) -> String { s.rsplit(['/', '\\']).next().unwrap_or(s).to_lowercase() }

pub fn process_names() -> Vec<String> {
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()));
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().map(|p| p.name().to_string_lossy().to_string()).collect()
}

fn index(custom: &[CustomGame]) -> HashMap<String, String> {
    let mut idx = HashMap::new();
    if let Ok(list) = serde_json::from_str::<Vec<BuiltinGame>>(GAMES_JSON) {
        for g in list { for e in g.exes { idx.insert(norm(&e), g.name.clone()); } }
    }
    for g in custom { idx.insert(norm(&g.exe), g.name.chars().take(64).collect()); } // personalizado vence
    idx
}

/// Nome do jogo detectado (ou None). No Linux o nome do processo vem truncado em 15 caracteres, então
/// comparamos também pelo prefixo.
pub fn match_game(procs: &[String], custom: &[CustomGame]) -> Option<String> {
    let idx = index(custom);
    for p in procs {
        let n = norm(p);
        if let Some(name) = idx.get(&n) { return Some(name.clone()); }
        if !cfg!(windows) && n.chars().count() == 15 {
            if let Some((_, v)) = idx.iter().find(|(k, _)| k.starts_with(&n)) { return Some(v.clone()); }
        }
    }
    None
}
pub fn streamer_running(procs: &[String]) -> bool { procs.iter().any(|p| STREAM_APPS.contains(&norm(p).as_str())) }

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Game { pub name: String, pub started_at: u64 }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_builtin_and_custom() {
        let procs = vec!["explorer.exe".to_string(), "C:\\Games\\VALORANT-Win64-Shipping.exe".to_string()];
        assert_eq!(match_game(&procs, &[]).as_deref(), Some("VALORANT"));
        let custom = vec![CustomGame { exe: "meujogo.exe".into(), name: "Meu Jogo".into() }];
        assert_eq!(match_game(&["MeuJogo.EXE".to_string()], &custom).as_deref(), Some("Meu Jogo"));
        assert_eq!(match_game(&["chrome".to_string()], &[]), None);
    }
    #[test]
    fn linux_truncated_prefix() { if !cfg!(windows) { assert_eq!(match_game(&["valorant-win64-".to_string()], &[]).as_deref(), Some("VALORANT")); } }
    #[test]
    fn streamer() { assert!(streamer_running(&["OBS64.exe".to_string()])); assert!(!streamer_running(&["chrome".to_string()])); }
}
