//! Conversão do formato de atalho do G.K.IO ("Ctrl+Shift+M", "Alt+Space") para o do plugin de atalhos globais.

/// "Ctrl+Shift+M" -> "Control+Shift+KeyM". Devolve None se a tecla não for suportada.
pub fn to_accelerator(combo: &str) -> Option<String> {
    let combo = combo.trim();
    if combo.is_empty() { return None; }
    let mut parts: Vec<&str> = combo.split('+').collect();
    let key = parts.pop()?.trim();
    let mut out: Vec<String> = vec![];
    for m in parts {
        out.push(match m.trim() { "Ctrl" | "Control" => "Control".into(), "Meta" | "Cmd" | "Super" => "Super".into(), "Alt" => "Alt".into(), "Shift" => "Shift".into(), _ => return None });
    }
    let k = if key.len() == 1 && key.chars().all(|c| c.is_ascii_alphabetic()) { format!("Key{}", key.to_uppercase()) }
        else if key.len() == 1 && key.chars().all(|c| c.is_ascii_digit()) { format!("Digit{key}") }
        else if is_fkey(key) || NAMED.contains(&key) || is_numpad(key) { key.to_string() }
        else { return None };
    out.push(k);
    Some(out.join("+"))
}
fn is_fkey(k: &str) -> bool { k.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()).map(|n| (1..=24).contains(&n)).unwrap_or(false) }
fn is_numpad(k: &str) -> bool { k.strip_prefix("Numpad").map(|r| r.len() == 1 && r.chars().all(|c| c.is_ascii_digit())).unwrap_or(false) }
const NAMED: &[&str] = &["Space", "Enter", "Tab", "Backquote", "Minus", "Equal", "Comma", "Period", "Slash", "Semicolon", "Quote",
    "BracketLeft", "BracketRight", "Backslash", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete"];

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts() {
        assert_eq!(to_accelerator("Ctrl+Shift+M").as_deref(), Some("Control+Shift+KeyM"));
        assert_eq!(to_accelerator("Alt+Space").as_deref(), Some("Alt+Space"));
        assert_eq!(to_accelerator("Ctrl+1").as_deref(), Some("Control+Digit1"));
        assert_eq!(to_accelerator("F9").as_deref(), Some("F9"));
        assert_eq!(to_accelerator("Meta+Numpad5").as_deref(), Some("Super+Numpad5"));
        assert_eq!(to_accelerator(""), None);
        assert_eq!(to_accelerator("Ctrl+@"), None);
        assert_eq!(to_accelerator("Foo+M"), None);
    }
    #[test]
    fn parses_in_plugin() {
        use std::str::FromStr;
        for c in ["Ctrl+Shift+M", "Alt+Space", "Ctrl+1", "F9", "Ctrl+Backquote", "Meta+Numpad5", "Ctrl+ArrowUp"] {
            let a = to_accelerator(c).unwrap();
            assert!(tauri_plugin_global_shortcut::Shortcut::from_str(&a).is_ok(), "{a}");
        }
    }
}
