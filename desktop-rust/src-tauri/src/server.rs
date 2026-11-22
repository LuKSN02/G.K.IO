//! Servidor estático mínimo em 127.0.0.1 (como o do app Electron). Rodar em http://localhost — e não em
//! tauri:// — mantém Firebase Auth, IndexedDB e a lista de origens permitidas do Worker de voz funcionando.
use std::path::{Component, Path, PathBuf};

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "html" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8",
        "json" | "webmanifest" => "application/json", "png" => "image/png", "svg" => "image/svg+xml", "ico" => "image/x-icon",
        "webp" => "image/webp", "woff2" => "font/woff2", "wasm" => "application/wasm", "jpg" | "jpeg" => "image/jpeg",
        "mp3" => "audio/mpeg", "ogg" => "audio/ogg", "wav" => "audio/wav", _ => "application/octet-stream",
    }
}

/// Resolve o caminho pedido dentro de `root`, recusando qualquer tentativa de sair da pasta.
pub fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let path = url_path.split(['?', '#']).next().unwrap_or("/");
    let decoded: String = {
        let b = path.as_bytes(); let mut out = Vec::with_capacity(b.len()); let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' && i + 2 < b.len() {
                if let Ok(v) = u8::from_str_radix(&path[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
            }
            out.push(b[i]); i += 1;
        }
        String::from_utf8(out).ok()?
    };
    let rel = if decoded == "/" { "/index.html".to_string() } else { decoded };
    let mut full = root.to_path_buf();
    for c in Path::new(rel.trim_start_matches('/')).components() {
        match c { Component::Normal(p) => full.push(p), Component::CurDir => {}, _ => return None }
    }
    Some(full)
}

/// Sobe o servidor numa thread. Tenta a porta preferida e cai para uma livre. Devolve a porta.
pub fn start(root: PathBuf, preferred: u16) -> Result<u16, String> {
    let server = tiny_http::Server::http(format!("127.0.0.1:{preferred}")).or_else(|_| tiny_http::Server::http("127.0.0.1:0"))
        .map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("sem porta")?;
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let url = req.url().to_string();
            // só para o autoteste (GKIO_SELFTEST=<arquivo>): a página manda um relatório por /__t?...
            if let (Some(q), Ok(f)) = (url.strip_prefix("/__t?"), std::env::var("GKIO_SELFTEST")) {
                use std::io::Write;
                if let Ok(mut fh) = std::fs::OpenOptions::new().create(true).append(true).open(format!("{f}.page")) { let _ = writeln!(fh, "{q}"); }
                let _ = req.respond(tiny_http::Response::from_string("ok")); continue;
            }
            match resolve(&root, &url).and_then(|p| std::fs::read(&p).ok().map(|d| (p, d))) {
                Some((p, data)) => {
                    let _ = req.respond(tiny_http::Response::from_data(data)
                        .with_header(tiny_http::Header::from_bytes("Content-Type", mime(&p)).unwrap())
                        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-cache").unwrap()));
                }
                None => { let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404)); }
            }
        }
    });
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_traversal() {
        let root = Path::new("/srv/web");
        assert!(resolve(root, "/../etc/passwd").is_none());
        assert!(resolve(root, "/%2e%2e/etc/passwd").is_none());
        assert_eq!(resolve(root, "/").unwrap(), root.join("index.html"));
        assert_eq!(resolve(root, "/js/a%20b.js?v=3").unwrap(), root.join("js").join("a b.js"));
    }
}
