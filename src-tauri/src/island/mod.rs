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

use crate::config::{Config, ConfigStore, IslandMonitor};
use crate::glass;
use crate::overlay::HitRect;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL_PREFIX: &str = "island-";
/// Logical size of each island window at 100%. It is the island's
/// *envelope*: room for the largest shape (the full music player, 640x196)
/// plus its glow. The window scales with the Size setting, so it never clips
/// the island and never keeps a big empty margin at small sizes.
///
/// Why the window is not resized on every animation frame: resizing a
/// native window and its WebView2 surface is not synchronised with
/// compositing on Windows, so per-frame resizes flicker and drop frames.
/// Instead the window holds the envelope, is click-through outside the
/// pill (see `overlay`), and is resized and re-centred in one step whenever
/// the size setting, monitor layout or display scaling changes.
const WIN_W: f64 = 760.0;
const WIN_H: f64 = 380.0;

/// Event names shared with the UI (src/island).
pub const EV_STATE: &str = "island://state";
pub const EV_EVENT: &str = "island://event";

#[derive(Default)]
pub struct IslandState {
    /// Which monitor setting the current windows were created for.
    layout: Mutex<Option<IslandMonitor>>,
    /// Bumped on every rebuild so a new window never reuses the label of one
    /// that is still being destroyed. Reusing labels was the cause of the
    /// island vanishing after a size change: Tauri frees a destroyed
    /// window's label asynchronously, so creating `island-0` right after
    /// destroying `island-0` failed.
    generation: AtomicU32,
    /// Native acrylic window behind each island window (label -> HWND).
    glass: Mutex<HashMap<String, isize>>,
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

/// Island windows sorted by monitor index (labels are `island-<gen>-<i>`).
fn island_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut v: Vec<(usize, WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter(|(l, _)| l.starts_with(LABEL_PREFIX))
        .map(|(l, w)| (monitor_index(&l), w))
        .collect();
    v.sort_by_key(|(i, _)| *i);
    v.into_iter().map(|(_, w)| w).collect()
}

fn monitor_index(label: &str) -> usize {
    label.rsplit('-').next().and_then(|n| n.parse().ok()).unwrap_or(0)
}

fn monitors_for(app: &AppHandle, which: IslandMonitor) -> Vec<tauri::Monitor> {
    match which {
        IslandMonitor::Primary => app.primary_monitor().ok().flatten().into_iter().collect(),
        IslandMonitor::All => app.available_monitors().unwrap_or_default(),
    }
}

/// Called at startup: start data sources and the hover thread, then create
/// windows according to the config.
pub fn init(app: &AppHandle, cfg: &Config) {
    app.manage(IslandState::default());
    sources::start(app);
    sync(app, cfg);
}

/// Throw the windows away and build them again (monitors were added or
/// removed, or display scaling changed).
pub fn rebuild(app: &AppHandle) {
    let Some(state) = app.try_state::<IslandState>() else { return };
    *state.layout.lock().unwrap() = None;
    sync(app, &app.state::<ConfigStore>().get());
}

/// Create, recreate, resize or close island windows to match the config.
/// Size changes resize the existing windows in place; only turning the
/// island on/off or changing which monitors it is on recreates them.
pub fn sync(app: &AppHandle, cfg: &Config) {
    let state = app.state::<IslandState>();
    let mut layout = state.layout.lock().unwrap();
    let wanted = cfg.island.enabled.then_some(cfg.island.monitor);
    let grow = cfg.island.scale as f64 / 100.0;
    if *layout == wanted {
        drop(layout);
        relayout(app, cfg);
        return;
    }
    for (_, h) in state.glass.lock().unwrap().drain() {
        glass::destroy(h);
    }
    for w in island_windows(app) {
        crate::overlay::forget(app, w.label());
        let _ = w.destroy();
    }
    *layout = wanted;
    let Some(which) = wanted else { return };
    let gen = state.generation.fetch_add(1, Ordering::SeqCst);
    for (i, m) in monitors_for(app, which).iter().enumerate() {
        if let Err(e) = create_window(app, gen, i, m, grow) {
            crate::diag::trace(&format!("island window {i} failed: {e}"));
        }
    }
}

/// Resize and re-centre the existing windows for the current size setting.
fn relayout(app: &AppHandle, cfg: &Config) {
    let monitors = monitors_for(app, cfg.island.monitor);
    let windows = island_windows(app);
    if windows.len() != monitors.len() && cfg.island.enabled {
        return rebuild(app);
    }
    let grow = cfg.island.scale as f64 / 100.0;
    for (w, m) in windows.iter().zip(monitors.iter()) {
        if let Err(e) = place(w, m, grow) {
            crate::diag::trace(&format!("island relayout {}: {e}", w.label()));
        }
    }
}

/// Size the window to the envelope for this monitor's DPI and centre it at
/// the top of the monitor (physical pixels, so mixed-DPI setups line up).
fn place(w: &WebviewWindow, m: &tauri::Monitor, grow: f64) -> tauri::Result<()> {
    let scale = m.scale_factor();
    let size = PhysicalSize::new((WIN_W * grow * scale).round() as u32, (WIN_H * grow * scale).round() as u32);
    let pos = m.position();
    let x = pos.x + (m.size().width as i32 - size.width as i32) / 2;
    w.set_size(size)?;
    w.set_position(PhysicalPosition::new(x, pos.y))?;
    crate::diag::trace(&format!(
        "island {}: {}x{} at {},{} (monitor {}x{} @{})",
        w.label(),
        size.width,
        size.height,
        x,
        pos.y,
        m.size().width,
        m.size().height,
        scale
    ));
    Ok(())
}

fn create_window(app: &AppHandle, gen: u32, i: usize, m: &tauri::Monitor, grow: f64) -> tauri::Result<()> {
    let label = format!("{LABEL_PREFIX}{gen}-{i}");
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("island.html".into()))
        .title("DeskFlow Island")
        // Truly transparent, frameless, no DWM shadow or resize frame: any
        // of these paints a rectangle behind the rounded pill.
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
    place(&w, m, grow)?;
    crate::overlay::make_no_activate(&w);
    w.show()?;
    // After show(): the native window must exist before it can be made
    // click-through.
    w.set_ignore_cursor_events(true)?;
    crate::windows::set_low_memory(&w, true);
    Ok(())
}

// ---- Commands -------------------------------------------------------------

/// The island reports its pill (logical px inside the window) while it
/// morphs, so a native acrylic window can blur the desktop behind it.
/// `rect: None` hides the glass (design without glass, or island hidden).
#[tauri::command]
pub fn island_set_glass(app: AppHandle, window: WebviewWindow, rect: Option<HitRect>, radius: f64) -> Result<(), String> {
    let state = app.state::<IslandState>();
    let mut map = state.glass.lock().unwrap();
    let Some(r) = rect else {
        if let Some(h) = map.get(window.label()) {
            glass::hide(*h);
        }
        return Ok(());
    };
    let h = match map.get(window.label()) {
        Some(h) => *h,
        None => match glass::create() {
            Some(h) => {
                map.insert(window.label().to_string(), h);
                h
            }
            None => return Ok(()),
        },
    };
    let cfg = app.state::<ConfigStore>().get();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let above = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let above = 0;
    glass::show(
        h,
        above,
        origin.x + (r.x * scale).round() as i32,
        origin.y + (r.y * scale).round() as i32,
        (r.w * scale).round() as i32,
        (r.h * scale).round() as i32,
        (radius * scale).round() as i32,
        glass::inset_for(scale),
        // Light, thin tint: the CSS layer on top adds the dark glass colour.
        glass::tint(crate::windows::is_dark(cfg.appearance.theme), 85),
    );
    Ok(())
}

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
    // Deferred: creating a webview inside a WebView2 callback never finishes
    // (see commands::update_config).
    let a = app.clone();
    let _ = app.run_on_main_thread(move || crate::windows::show_settings(&a));
}
