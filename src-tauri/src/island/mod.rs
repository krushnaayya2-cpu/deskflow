//! Dynamic Island: a pill-shaped overlay at the top-centre of the screen.
//!
//! Each island is a small transparent, always-on-top, frameless window
//! (label `island-<n>`, one per monitor when "All monitors" is chosen).
//! The window is larger than the pill so the pill can grow with spring
//! animations; `overlay` makes it click-through except over the pill.
//!
//! Live data (music, battery, network, downloads) comes from `sources`.

pub mod audio;
pub mod sources;

use crate::config::{Config, IslandMonitor};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL_PREFIX: &str = "island-";
/// Logical size of each island window. Big enough for the largest expanded
/// pill at the "Large" size setting plus the top offset.
const WIN_W: f64 = 760.0;
const WIN_H: f64 = 380.0;

/// Event names shared with the UI (src/island).
pub const EV_STATE: &str = "island://state";
pub const EV_EVENT: &str = "island://event";

#[derive(Default)]
pub struct IslandState {
    /// Which monitor setting the current windows were created for.
    layout: Mutex<Option<(IslandMonitor, u32)>>,
}

/// A one-off island notification (download finished, charger plugged in...).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IslandEvent {
    #[serde(rename_all = "camelCase")]
    Download { name: String, path: String },
    #[serde(rename_all = "camelCase")]
    Charging { charging: bool, percent: u8 },
    #[serde(rename_all = "camelCase")]
    Network { connected: bool, name: String, wifi: bool },
    /// Generic notification; later steps (converter, AI apps) use this.
    #[serde(rename_all = "camelCase")]
    Notify { title: String, body: String, path: Option<String> },
}

pub fn emit_event(app: &AppHandle, ev: IslandEvent) {
    let _ = app.emit(EV_EVENT, ev);
}

fn island_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(l, _)| l.starts_with(LABEL_PREFIX))
        .map(|(_, w)| w)
        .collect()
}

/// Called at startup: start data sources and the hover thread, then create
/// windows according to the config.
pub fn init(app: &AppHandle, cfg: &Config) {
    app.manage(IslandState::default());
    sources::start(app);
    sync(app, cfg);
}

/// Create, recreate or close island windows to match the config.
/// Other settings (size, style, activities) are applied live by the UI via
/// the normal `config-changed` event.
pub fn sync(app: &AppHandle, cfg: &Config) {
    let state = app.state::<IslandState>();
    let mut layout = state.layout.lock().unwrap();
    // Windows grow with the island when it's bigger than 100%.
    let wanted = cfg.island.enabled.then_some((cfg.island.monitor, cfg.island.scale.max(100)));
    if *layout == wanted {
        return;
    }
    for w in island_windows(app) {
        crate::overlay::forget(app, w.label());
        let _ = w.destroy();
    }
    *layout = wanted;
    let Some((which, grow)) = wanted else { return };
    let grow = grow as f64 / 100.0;

    let monitors = match which {
        IslandMonitor::Primary => app.primary_monitor().ok().flatten().into_iter().collect(),
        IslandMonitor::All => app.available_monitors().unwrap_or_default(),
    };
    for (i, m) in monitors.iter().enumerate() {
        if let Err(e) = create_window(app, i, m, grow) {
            log::warn!("could not create island window {i}: {e}");
        }
    }
}

fn create_window(app: &AppHandle, i: usize, m: &tauri::Monitor, grow: f64) -> tauri::Result<()> {
    let label = format!("{LABEL_PREFIX}{i}");
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("island.html".into()))
        .title("DeskFlow Island")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .inner_size(WIN_W * grow, WIN_H * grow)
        .resizable(false)
        .additional_browser_args(crate::windows::BROWSER_ARGS)
        .focused(false)
        .visible(false)
        .build()?;

    // Size and position in physical pixels of *this* monitor so mixed-DPI
    // setups line up correctly.
    let scale = m.scale_factor();
    let size = PhysicalSize::new((WIN_W * grow * scale) as u32, (WIN_H * grow * scale) as u32);
    let pos = m.position();
    let x = pos.x + (m.size().width as i32 - size.width as i32) / 2;
    w.set_size(size)?;
    w.set_position(PhysicalPosition::new(x, pos.y))?;
    crate::overlay::make_no_activate(&w);
    w.show()?;
    // After show(): the native window must exist before it can be made
    // click-through.
    w.set_ignore_cursor_events(true)?;
    crate::windows::set_low_memory(&w, true);
    Ok(())
}



// ---- Commands -------------------------------------------------------------

#[tauri::command]
pub fn island_snapshot(app: AppHandle) -> sources::SystemState {
    sources::snapshot(&app)
}

/// Play/pause/next/previous for whatever app is playing media.
#[tauri::command]
pub async fn media_control(action: String, value: Option<f64>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sources::media_control(&action, value))
        .await
        .map_err(|e| e.to_string())?
}

/// Album art for the current track (data URL), if any.
#[tauri::command]
pub fn media_art(app: AppHandle) -> Option<String> {
    sources::art(&app)
}

/// Current output level 0..1, for the audio-reactive visualizers.
#[tauri::command]
pub async fn audio_peak() -> f32 {
    tauri::async_runtime::spawn_blocking(audio::peak).await.unwrap_or(0.0)
}

#[tauri::command]
pub async fn audio_volume() -> f32 {
    tauri::async_runtime::spawn_blocking(audio::volume).await.unwrap_or(0.0)
}

#[tauri::command]
pub async fn audio_set_volume(level: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || audio::set_volume(level))
        .await
        .map_err(|e| e.to_string())?
}

/// Open a file with its default app (used by "Open" buttons).
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Show the file selected in File Explorer.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// "Preview" button in settings: cycle through sample activities so the
/// user can see each style without waiting for a real event.
#[tauri::command]
pub fn island_demo(app: AppHandle, step: u32) {
    let ev = match step % 4 {
        0 => IslandEvent::Download {
            name: "holiday-photos.zip".into(),
            path: String::new(),
        },
        1 => IslandEvent::Charging { charging: true, percent: 64 },
        2 => IslandEvent::Network { connected: true, name: "Home Wi-Fi".into(), wifi: true },
        _ => IslandEvent::Notify {
            title: "DeskFlow".into(),
            body: "This is how notifications will look.".into(),
            path: None,
        },
    };
    emit_event(&app, ev);
}

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    crate::windows::show_settings(&app);
}
