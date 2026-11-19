//! DeskFlow's windows: the settings window and the shared WebView2 options.

use crate::config::{ConfigStore, ThemeMode};
use tauri::{
    utils::{config::WindowEffectsConfig, WindowEffect},
    AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder,
};

pub const SETTINGS: &str = "settings";

/// Browser arguments shared by every DeskFlow webview. They must be identical
/// for all windows so they share one WebView2 browser process; same-site
/// pages also share one renderer, which saves tens of MB per window.
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --process-per-site --disable-background-networking";

fn theme_of(mode: ThemeMode) -> Option<Theme> {
    match mode {
        ThemeMode::System => None,
        ThemeMode::Dark => Some(Theme::Dark),
        ThemeMode::Light => Some(Theme::Light),
    }
}

/// Show (creating it on demand) and focus the settings window.
///
/// The window is only created when needed and destroyed when closed, so it
/// costs no memory while DeskFlow sits in the tray.
pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let theme = app.try_state::<ConfigStore>().map(|s| s.get().appearance.theme).unwrap_or_default();
    let built = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("DeskFlow Settings")
        .inner_size(920.0, 640.0)
        .min_inner_size(720.0, 520.0)
        .center()
        .transparent(true)
        .effects(WindowEffectsConfig { effects: vec![WindowEffect::Mica], ..Default::default() })
        .theme(theme_of(theme))
        .additional_browser_args(BROWSER_ARGS)
        .focused(true)
        .build();
    if let Err(e) = built {
        log::warn!("could not open settings: {e}");
    }
}

/// Apply light/dark to native window chrome so the Mica backdrop tint
/// matches the UI. `System` follows the Windows setting.
pub fn apply_theme(app: &AppHandle, mode: ThemeMode) {
    for w in app.webview_windows().values() {
        let _ = w.set_theme(theme_of(mode));
    }
}

/// Ask WebView2 to keep a window's memory low (trimming caches) while it is
/// idle, or to return to normal. Used for the island and dock: low while the
/// mouse is elsewhere, normal while hovered.
#[cfg(windows)]
pub fn set_low_memory(w: &tauri::WebviewWindow, low: bool) {
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(c) = core.cast::<ICoreWebView2_19>() {
                let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                let _ = c.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_low_memory(_w: &tauri::WebviewWindow, _low: bool) {}
