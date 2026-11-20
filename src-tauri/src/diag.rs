//! Tiny crash log: startup steps and panics go to
//! %LOCALAPPDATA%\\DeskFlow\\deskflow.log (kept under 64 KB), so a failed
//! start can be diagnosed without a debugger.

use std::{fs::OpenOptions, io::Write, path::PathBuf};

fn path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).or_else(|| std::env::temp_dir().into())?;
    let dir = base.join("DeskFlow");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("deskflow.log"))
}

pub fn trace(msg: &str) {
    let Some(p) = path() else { return };
    if std::fs::metadata(&p).map(|m| m.len() > 64 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} [{}] {msg}", std::process::id());
    }
}

pub fn init() {
    trace(&format!("launch v{} args={:?}", env!("CARGO_PKG_VERSION"), std::env::args().skip(1).collect::<Vec<_>>()));
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        trace(&format!("PANIC: {info}"));
        // The release build aborts on panic, so RunEvent::Exit never runs:
        // bring the Windows taskbar back here.
        crate::dock::taskbar::emergency_restore();
        prev(info);
    }));
}

/// Errors from the web pages (island, dock, settings) end up in the same log.
#[tauri::command]
pub fn diag_log(window: tauri::WebviewWindow, msg: String) {
    trace(&format!("[{}] {}", window.label(), msg.chars().take(600).collect::<String>()));
}
