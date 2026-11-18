//! The dock: a customizable app bar that can replace the Windows taskbar.
//!
//! Per monitor there are two windows:
//! - `dock-N`: transparent webview drawing icons, menus and tooltips. It is
//!   larger than the bar (room for magnified icons and menus) and
//!   click-through outside the bar (see `overlay`).
//! - `dockbg-N`: a plain native window with real Windows acrylic blur,
//!   sized and rounded to match the bar exactly, placed just under `dock-N`.
//!   Used only by designs that have a glass bar.

pub mod apps;
pub mod icons;
pub mod taskbar;

use crate::config::{Config, ConfigStore, DockBackground, DockDesign, DockPosition, DockTheme, IslandMonitor, PinnedApp};
use crate::overlay::{self, HitRect};
use std::sync::Mutex;
use tauri::{
    window::{Color, Effect, EffectsBuilder},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
};

pub const LABEL_PREFIX: &str = "dock-";
const BG_PREFIX: &str = "dockbg-";
/// Room (logical px) the dock window keeps above/beside the bar for
/// magnified icons, tooltips and menus.
const DOCK_DEPTH: f64 = 320.0;

#[derive(Default)]
pub struct DockState {
    layout: Mutex<Option<(IslandMonitor, DockPosition, bool)>>,
}

fn dock_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(l, _)| l.starts_with(LABEL_PREFIX))
        .map(|(_, w)| w)
        .collect()
}

fn bg_for(app: &AppHandle, dock_label: &str) -> Option<Window> {
    app.get_window(&dock_label.replacen(LABEL_PREFIX, BG_PREFIX, 1))
}

pub fn init(app: &AppHandle, cfg: &Config) {
    app.manage(DockState::default());
    apps::start(app);

    // First run: copy the user's taskbar pins into the dock.
    if !cfg.dock.pins_imported {
        let mut pins = apps::taskbar_pins();
        if pins.is_empty() {
            pins.push(apps::pinned_from_path(r"C:\Windows\explorer.exe"));
        }
        let store = app.state::<ConfigStore>();
        let mut c = store.get();
        c.dock.pinned = pins;
        c.dock.pins_imported = true;
        let _ = store.set(c);
    }
    sync(app, &app.state::<ConfigStore>().get());
}

/// Make windows and the taskbar match the config.
pub fn sync(app: &AppHandle, cfg: &Config) {
    apply_taskbar(app, cfg);
    let state = app.state::<DockState>();
    let mut layout = state.layout.lock().unwrap();
    let wanted = cfg.dock.enabled.then_some((cfg.dock.monitor, cfg.dock.style.position, cfg.dock.hide_taskbar));
    if *layout == wanted {
        return;
    }
    for w in dock_windows(app) {
        if let Some(bg) = bg_for(app, w.label()) {
            let _ = bg.destroy();
        }
        overlay::forget(app, w.label());
        let _ = w.destroy();
    }
    *layout = wanted;
    let Some((which, position, full_screen)) = wanted else { return };
    let monitors = match which {
        IslandMonitor::Primary => app.primary_monitor().ok().flatten().into_iter().collect(),
        IslandMonitor::All => app.available_monitors().unwrap_or_default(),
    };
    for (i, m) in monitors.iter().enumerate() {
        if let Err(e) = create(app, i, m, position, full_screen) {
            log::warn!("could not create dock {i}: {e}");
        }
    }
}

fn create(app: &AppHandle, i: usize, m: &tauri::Monitor, pos: DockPosition, full_screen: bool) -> tauri::Result<()> {
    // With the taskbar hidden the dock sits at the screen edge; otherwise it
    // sits just inside the work area (above the taskbar).
    let area = if full_screen {
        tauri::PhysicalRect { position: *m.position(), size: *m.size() }
    } else {
        *m.work_area()
    };
    let scale = m.scale_factor();
    let depth = (DOCK_DEPTH * scale) as u32;
    let (x, y, w, h) = match pos {
        DockPosition::Bottom => (
            area.position.x,
            area.position.y + area.size.height as i32 - depth as i32,
            area.size.width,
            depth,
        ),
        DockPosition::Left => (area.position.x, area.position.y, depth, area.size.height),
        DockPosition::Right => (
            area.position.x + area.size.width as i32 - depth as i32,
            area.position.y,
            depth,
            area.size.height,
        ),
    };

    // Background (blur) window first so the dock window ends up above it.
    let bg = tauri::window::WindowBuilder::new(app, format!("{BG_PREFIX}{i}"))
        .title("DeskFlow Dock Glass")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    let _ = bg.set_ignore_cursor_events(true);
    #[cfg(windows)]
    if let Ok(h) = bg.hwnd() {
        overlay::no_activate_hwnd(h.0 as isize);
    }

    let label = format!("{LABEL_PREFIX}{i}");
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("dock.html".into()))
        .title("DeskFlow Dock")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    win.set_size(PhysicalSize::new(w, h))?;
    win.set_position(PhysicalPosition::new(x, y))?;
    overlay::make_no_activate(&win);
    win.show()?;
    win.set_ignore_cursor_events(true)?;
    Ok(())
}

/// Hide/show the Windows taskbar per config, remembering its original
/// auto-hide setting so it can be restored exactly.
fn apply_taskbar(app: &AppHandle, cfg: &Config) {
    let d = &cfg.dock;
    if d.enabled && d.hide_taskbar {
        if d.original_taskbar_autohide.is_none() {
            let store = app.state::<ConfigStore>();
            let mut c = store.get();
            c.dock.original_taskbar_autohide = Some(taskbar::is_autohide());
            let _ = store.set(c);
        }
        let reserve = if d.style.auto_hide || d.style.position != DockPosition::Bottom {
            0
        } else {
            let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
            ((d.style.icon_size as f64 + 34.0) * scale) as i32
        };
        taskbar::hide(reserve);
    } else {
        restore_taskbar(app);
    }
}

/// Called on quit and when the option is turned off.
pub fn restore_taskbar(app: &AppHandle) {
    let Some(store) = app.try_state::<ConfigStore>() else { return };
    let mut c = store.get();
    if let Some(orig) = c.dock.original_taskbar_autohide.take() {
        taskbar::restore(orig);
        let _ = store.set(c);
    }
}

/// Does this design draw a glass bar that should get real blur?
fn wants_blur(cfg: &Config) -> bool {
    let s = &cfg.dock.style;
    s.background == DockBackground::Glass && s.blur > 0 && s.design != DockDesign::Pills
}

// ---- Commands -------------------------------------------------------------

/// The dock UI reports where its bar is (logical px inside the dock window)
/// so the blur window can be placed and rounded to match.
#[tauri::command]
pub fn dock_set_bar(app: AppHandle, window: WebviewWindow, rect: Option<HitRect>, radius: f64) -> Result<(), String> {
    let Some(bg) = bg_for(&app, window.label()) else { return Ok(()) };
    let cfg = app.state::<ConfigStore>().get();
    let Some(r) = rect.filter(|_| wants_blur(&cfg)) else {
        let _ = bg.hide();
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let (w, h) = ((r.w * scale).round() as u32, (r.h * scale).round() as u32);
    bg.set_size(PhysicalSize::new(w, h)).map_err(|e| e.to_string())?;
    bg.set_position(PhysicalPosition::new(origin.x + (r.x * scale) as i32, origin.y + (r.y * scale) as i32))
        .map_err(|e| e.to_string())?;

    // Tint: dark or light following the app theme; more blur = less tint.
    let dark = !matches!(cfg.appearance.theme, crate::config::ThemeMode::Light);
    let (cr, cg, cb) = if dark { (18, 18, 26) } else { (245, 245, 250) };
    let tint = ((100 - cfg.dock.style.blur) as f64 * 1.6 + 20.0).min(220.0) as u8;
    bg.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).color(Color(cr, cg, cb, tint)).build())
        .map_err(|e| e.to_string())?;
    platform::round_and_order(&bg, &window, w, h, (radius * scale) as i32);
    bg.show().map_err(|e| e.to_string())?;
    let _ = bg.set_ignore_cursor_events(true);
    Ok(())
}

#[tauri::command]
pub fn dock_running(app: AppHandle) -> Vec<apps::RunningApp> {
    apps::snapshot(&app)
}

#[tauri::command]
pub async fn dock_icon(path: String, hwnd: Option<i64>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || icons::icon_data_url(&path, hwnd))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn dock_activate(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apps::activate(&key))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dock_launch(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dock_close(key: String) -> Result<(), String> {
    apps::close_all(&key)
}

#[tauri::command]
pub fn dock_start_menu() {
    apps::open_start_menu();
}

/// Start-menu apps for the "Add app" picker.
#[tauri::command]
pub async fn dock_installed_apps() -> Vec<PinnedApp> {
    tauri::async_runtime::spawn_blocking(apps::installed_apps).await.unwrap_or_default()
}

/// Turn a path (exe or shortcut) into a pinned entry with its target resolved.
#[tauri::command]
pub async fn dock_make_pin(path: String) -> PinnedApp {
    tauri::async_runtime::spawn_blocking(move || {
        apps::init_thread();
        apps::pinned_from_path(&path)
    })
    .await
    .unwrap_or_default()
}

/// Save a theme to a .json file the user picks.
#[tauri::command]
pub async fn dock_export_theme(app: AppHandle, theme: DockTheme) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_name = format!("{}.deskflow-theme.json", sanitize(&theme.name));
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("DeskFlow theme", &["json"])
        .set_file_name(file_name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Load a theme from a .json file the user picks (validated).
#[tauri::command]
pub async fn dock_import_theme(app: AppHandle) -> Result<Option<DockTheme>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app.dialog().file().add_filter("DeskFlow theme", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut theme: DockTheme =
        serde_json::from_str(&text).map_err(|e| format!("That file isn't a DeskFlow theme: {e}"))?;
    theme.style.validate()?;
    if theme.name.trim().is_empty() {
        theme.name = path.file_stem().map(|s| s.to_string_lossy().replace(".deskflow-theme", "")).unwrap_or_else(|| "Imported".into());
    }
    Ok(Some(theme))
}

fn sanitize(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == ' ' { c } else { '_' }).collect();
    if s.trim().is_empty() { "theme".into() } else { s.trim().to_string() }
}

#[cfg(windows)]
mod platform {
    use tauri::{WebviewWindow, Window};
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn},
        UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE},
    };

    /// Clip the blur window to the bar's rounded shape and keep it directly
    /// under the dock window.
    pub fn round_and_order(bg: &Window, dock: &WebviewWindow, w: u32, h: u32, radius: i32) {
        let (Ok(b), Ok(d)) = (bg.hwnd(), dock.hwnd()) else { return };
        let (b, d) = (HWND(b.0 as _), HWND(d.0 as _));
        unsafe {
            let rgn = CreateRoundRectRgn(0, 0, w as i32 + 1, h as i32 + 1, radius * 2, radius * 2);
            SetWindowRgn(b, Some(rgn), true);
            let _ = SetWindowPos(b, Some(d), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::{WebviewWindow, Window};
    pub fn round_and_order(_bg: &Window, _dock: &WebviewWindow, _w: u32, _h: u32, _radius: i32) {}
}
