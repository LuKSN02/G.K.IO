fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "cfg_get",
            "cfg_set",
            "tray_state",
            "shortcuts_set",
            "game_current",
            "streamer_current",
            "update_status",
            "update_check",
            "update_install",
            "cache_clear",
            "open_data",
            "open_logs",
            "safe_mode",
            "fetch_text",
            "profiles_list",
            "profiles_open",
            "profiles_remove",
            "open_external",
            "toggle_devtools",
            "notify",
            "selftest_report",
            "show_window_cmd",
        ])),
    ).expect("falha no tauri-build");
}
