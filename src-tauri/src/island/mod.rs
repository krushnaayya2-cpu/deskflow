//! Dynamic Island: a pill-shaped overlay at the top-centre of the screen.
//!
//! Each island is a small transparent, always-on-top, frameless window
//! (label `island-<n>`, one per monitor when "All monitors" is chosen).
//! The window is larger than the pill so the pill can grow with spring
//! animations, and it ignores the mouse everywhere except over the pill: a
//! light background thread compares the cursor with the pill's rectangle
//! (reported by the UI) and toggles click-through accordingly.
//!
//! Live data (music, battery, network, downloads) comes from `sources`.

pub mod sources;

use crate::config::{Config, IslandMonitor};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL_PREFIX: &str = "island-";
/// Logical size of each island window. Big enough for the largest expanded
/// pill at the "Large" size setting plus the top offset.
const WIN_W: f64 = 560.0;
const WIN_H: f64 = 320.0;

/// Event names shared with the UI (src/island).
pub const EV_HOVER: &str = "island://hover";
pub const EV_STATE: &str = "island://state";
pub const EV_EVENT: &str = "island://event";

/// Rectangle of the pill inside its window, in logical (CSS) pixels.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Default)]
pub struct IslandState {
    /// Pill rectangle per island window label.
    rects: Mutex<HashMap<String, HitRect>>,
    /// Whether the cursor was over each island at the last check.
    hovered: Mutex<HashMap<String, bool>>,
    /// Which monitor setting the current windows were created for.
    layout: Mutex<Option<IslandMonitor>>,
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
    start_hover_thread(app.clone());
    sync(app, cfg);
}

/// Create, recreate or close island windows to match the config.
/// Other settings (size, style, activities) are applied live by the UI via
/// the normal `config-changed` event.
pub fn sync(app: &AppHandle, cfg: &Config) {
    let state = app.state::<IslandState>();
    let mut layout = state.layout.lock().unwrap();
    let wanted = cfg.island.enabled.then_some(cfg.island.monitor);
    if *layout == wanted {
        return;
    }
    for w in island_windows(app) {
        let _ = w.destroy();
    }
    state.rects.lock().unwrap().clear();
    state.hovered.lock().unwrap().clear();
    *layout = wanted;
    let Some(which) = wanted else { return };

    let monitors = match which {
        IslandMonitor::Primary => app.primary_monitor().ok().flatten().into_iter().collect(),
        IslandMonitor::All => app.available_monitors().unwrap_or_default(),
    };
    for (i, m) in monitors.iter().enumerate() {
        if let Err(e) = create_window(app, i, m) {
            log::warn!("could not create island window {i}: {e}");
        }
    }
}

fn create_window(app: &AppHandle, i: usize, m: &tauri::Monitor) -> tauri::Result<()> {
    let label = format!("{LABEL_PREFIX}{i}");
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("island.html".into()))
        .title("DeskFlow Island")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .inner_size(WIN_W, WIN_H)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;

    // Size and position in physical pixels of *this* monitor so mixed-DPI
    // setups line up correctly.
    let scale = m.scale_factor();
    let size = PhysicalSize::new((WIN_W * scale) as u32, (WIN_H * scale) as u32);
    let pos = m.position();
    let x = pos.x + (m.size().width as i32 - size.width as i32) / 2;
    w.set_size(size)?;
    w.set_position(PhysicalPosition::new(x, pos.y))?;
    make_no_activate(&w);
    w.show()?;
    // After show(): the native window must exist before it can be made
    // click-through.
    w.set_ignore_cursor_events(true)?;
    Ok(())
}

/// Clicking the island must not steal keyboard focus from the user's app,
/// and it shouldn't show up in Alt+Tab.
#[cfg(windows)]
fn make_no_activate(w: &WebviewWindow) {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    };
    if let Ok(h) = w.hwnd() {
        let hwnd = HWND(h.0 as _);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize,
            );
        }
    }
}

#[cfg(not(windows))]
fn make_no_activate(_w: &WebviewWindow) {}

/// Every 40 ms compare the cursor with each pill. Only on a change do we
/// toggle click-through and tell the UI, so idle cost is a cursor read.
fn start_hover_thread(app: AppHandle) {
    thread::Builder::new()
        .name("island-hover".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(40));
            let windows = island_windows(&app);
            if windows.is_empty() {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let Ok(cursor) = app.cursor_position() else { continue };
            let state = app.state::<IslandState>();
            let rects = state.rects.lock().unwrap().clone();
            let mut hovered = state.hovered.lock().unwrap();
            for w in windows {
                let label = w.label().to_string();
                let Some(r) = rects.get(&label) else { continue };
                let (Ok(origin), Ok(scale)) = (w.outer_position(), w.scale_factor()) else {
                    continue;
                };
                let lx = (cursor.x - origin.x as f64) / scale;
                let ly = (cursor.y - origin.y as f64) / scale;
                let inside = lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
                if hovered.get(&label).copied() != Some(inside) {
                    hovered.insert(label.clone(), inside);
                    let _ = w.set_ignore_cursor_events(!inside);
                    let _ = w.emit_to(label.as_str(), EV_HOVER, inside);
                }
            }
        })
        .expect("spawn island hover thread");
}

// ---- Commands -------------------------------------------------------------

/// The UI reports where the pill currently is so hover detection matches it.
#[tauri::command]
pub fn island_set_hit_rect(window: WebviewWindow, rect: HitRect) {
    if let Some(state) = window.try_state::<IslandState>() {
        state.rects.lock().unwrap().insert(window.label().to_string(), rect);
    }
}

#[tauri::command]
pub fn island_snapshot(app: AppHandle) -> sources::SystemState {
    sources::snapshot(&app)
}

/// Play/pause/next/previous for whatever app is playing media.
#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sources::media_control(&action))
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
