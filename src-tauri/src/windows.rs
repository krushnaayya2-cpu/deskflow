//! Helpers for DeskFlow's windows (only Settings in step 1).

use crate::config::ThemeMode;
use tauri::{AppHandle, Manager, Theme};

/// Window label of the settings window (declared in tauri.conf.json).
pub const SETTINGS: &str = "settings";

/// Show, restore and focus the settings window.
pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Apply light/dark to native window chrome so the Mica backdrop tint
/// matches the UI. `System` follows the Windows setting.
pub fn apply_theme(app: &AppHandle, mode: ThemeMode) {
    let theme = match mode {
        ThemeMode::System => None,
        ThemeMode::Dark => Some(Theme::Dark),
        ThemeMode::Light => Some(Theme::Light),
    };
    for w in app.webview_windows().values() {
        let _ = w.set_theme(theme);
    }
}
