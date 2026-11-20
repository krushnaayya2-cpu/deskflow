//! The dock: a customizable app bar that can replace the Windows taskbar.
//!
//! Per monitor there are two windows:
//! - `dock-N`: transparent webview drawing icons, menus and tooltips. It is
//!   larger than the bar (room for magnified icons and menus) and
//!   click-through outside the bar (see `overlay`).
//! - a small native Win32 window with real acrylic blur (`glass`), sized
//!   and rounded to match the bar exactly, placed just under `dock-N`.
//!   Used only by designs that have a glass bar.

pub mod apps;
pub mod icons;
pub mod taskbar;

use crate::config::{Config, ConfigStore, DockBackground, DockDesign, DockPosition, DockTheme, IslandMonitor, PinnedApp};
use crate::glass;
use crate::overlay::{self, HitRect};
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL_PREFIX: &str = "dock-";
/// Room (logical px) the dock window keeps above/beside the bar for
/// magnified icons, tooltips and menus.
const DOCK_DEPTH: f64 = 320.0;

#[derive(Default)]
pub struct DockState {
    layout: Mutex<Option<(IslandMonitor, DockPosition, bool)>>,
    /// Native glass window per dock window label.
    glass: Mutex<HashMap<String, isize>>,
    /// Bumped on every rebuild so new windows never reuse a label that a
    /// just-destroyed window still holds (Tauri frees labels asynchronously,
    /// and reusing one made window creation fail silently).
    generation: std::sync::atomic::AtomicU32,
}

fn dock_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(l, _)| l.starts_with(LABEL_PREFIX))
        .map(|(_, w)| w)
        .collect()
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
    // Re-resolve pins saved without a target (e.g. older Explorer pins).
    {
        let store = app.state::<ConfigStore>();
        let mut c = store.get();
        let mut changed = false;
        for p in c.dock.pinned.iter_mut().filter(|p| p.target.is_empty()) {
            let fresh = apps::pinned_from_path(&p.path);
            if !fresh.target.is_empty() {
                p.target = fresh.target;
                changed = true;
            }
        }
        if changed {
            let _ = store.set(c);
        }
    }
    sync(app, &app.state::<ConfigStore>().get());
}

/// Rebuild the docks from scratch (monitors or display scaling changed).
pub fn rebuild(app: &AppHandle) {
    let Some(state) = app.try_state::<DockState>() else { return };
    *state.layout.lock().unwrap() = None;
    sync(app, &app.state::<ConfigStore>().get());
}

/// Make windows and the taskbar match the config.
pub fn sync(app: &AppHandle, cfg: &Config) {
    crate::diag::trace(&format!("dock sync: enabled={} hide_taskbar={}", cfg.dock.enabled, cfg.dock.hide_taskbar));
    apply_taskbar(app, cfg);
    let state = app.state::<DockState>();
    let mut layout = state.layout.lock().unwrap();
    let wanted = cfg.dock.enabled.then_some((cfg.dock.monitor, cfg.dock.style.position, cfg.dock.hide_taskbar));
    if *layout == wanted {
        // Same windows; the reserved space may still need updating (icon
        // size or auto-hide changed).
        reserve_space(app, cfg);
        return;
    }
    for (_, h) in state.glass.lock().unwrap().drain() {
        glass::destroy(h);
    }
    // Give the reserved space back first so the new docks are placed from
    // the real work area.
    taskbar::release_all();
    for w in dock_windows(app) {
        overlay::forget(app, w.label());
        let _ = w.destroy();
    }
    *layout = wanted;
    let Some((which, position, full_screen)) = wanted else { return };
    let monitors = match which {
        IslandMonitor::Primary => app.primary_monitor().ok().flatten().into_iter().collect(),
        IslandMonitor::All => app.available_monitors().unwrap_or_default(),
    };
    let gen = state.generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    for (i, m) in monitors.iter().enumerate() {
        if let Err(e) = create(app, gen, i, m, position, full_screen) {
            crate::diag::trace(&format!("dock window {i} failed: {e}"));
        }
    }
    drop(layout);
    reserve_space(app, cfg);
}

/// Reserve room for each dock on its monitor (an AppBar), so maximised
/// windows stop at the dock instead of going under it. Nothing is reserved
/// while the dock auto-hides.
fn reserve_space(app: &AppHandle, cfg: &Config) {
    let d = &cfg.dock;
    let monitors = app.available_monitors().unwrap_or_default();
    for w in dock_windows(app) {
        #[cfg(windows)]
        let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        #[cfg(not(windows))]
        let hwnd = w.label().len() as isize;
        if !d.enabled || d.style.auto_hide {
            taskbar::release(hwnd);
            continue;
        }
        // The monitor this dock window is on.
        let Ok(p) = w.outer_position() else { continue };
        let Some(m) = monitors.iter().find(|m| {
            let (mp, ms) = (m.position(), m.size());
            p.x >= mp.x && p.x < mp.x + ms.width as i32 && p.y >= mp.y && p.y < mp.y + ms.height as i32
        }) else {
            continue;
        };
        let (mp, ms) = (m.position(), m.size());
        let edge = match d.style.position {
            DockPosition::Bottom => taskbar::Edge::Bottom,
            DockPosition::Left => taskbar::Edge::Left,
            DockPosition::Right => taskbar::Edge::Right,
        };
        let thickness = ((d.style.icon_size as f64 + 34.0) * m.scale_factor()) as i32;
        crate::diag::trace(&format!("dock {} reserves {thickness}px ({:?})", w.label(), d.style.position));
        taskbar::reserve(hwnd, edge, (mp.x, mp.y, mp.x + ms.width as i32, mp.y + ms.height as i32), thickness);
    }
}

fn create(app: &AppHandle, gen: u32, i: usize, m: &tauri::Monitor, pos: DockPosition, full_screen: bool) -> tauri::Result<()> {
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

    let label = format!("{LABEL_PREFIX}{gen}-{i}");
    if let Some(h) = glass::create() {
        app.state::<DockState>().glass.lock().unwrap().insert(label.clone(), h);
    }

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("dock.html".into()))
        .title("DeskFlow Dock")
        .inner_size(w as f64 / scale, h as f64 / scale)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .additional_browser_args(crate::windows::BROWSER_ARGS)
        .focused(false)
        .visible(false)
        .build()?;
    win.set_size(PhysicalSize::new(w, h))?;
    win.set_position(PhysicalPosition::new(x, y))?;
    crate::diag::trace(&format!("dock {label}: {w}x{h} at {x},{y} (full_screen={full_screen})"));
    overlay::make_no_activate(&win);
    win.show()?;
    win.set_ignore_cursor_events(true)?;
    crate::windows::set_low_memory(&win, true);
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
        let original = app.state::<ConfigStore>().get().dock.original_taskbar_autohide.unwrap_or(false);
        taskbar::hide(original);
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
    if s.design == DockDesign::Liquid {
        return s.blur > 0;
    }
    s.background == DockBackground::Glass
        && s.blur > 0
        && !matches!(s.design, DockDesign::Pills | DockDesign::Split | DockDesign::Underline | DockDesign::Tiles)
}

// ---- Commands -------------------------------------------------------------

/// The dock UI reports where its bar is (logical px inside the dock window)
/// so the blur window can be placed and rounded to match.
#[tauri::command]
pub fn dock_set_bar(app: AppHandle, window: WebviewWindow, rect: Option<HitRect>, radius: f64) -> Result<(), String> {
    let Some(glass_hwnd) = app.state::<DockState>().glass.lock().unwrap().get(window.label()).copied() else {
        return Ok(());
    };
    let cfg = app.state::<ConfigStore>().get();
    let Some(r) = rect.filter(|_| wants_blur(&cfg)) else {
        glass::hide(glass_hwnd);
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    // Tint: dark or light following the app theme (System = Windows' own
    // app theme); more blur = less tint.
    let tint = glass::tint(crate::windows::is_dark(cfg.appearance.theme), cfg.dock.style.blur as u32);
    #[cfg(windows)]
    let above = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let above = 0;
    glass::show(
        glass_hwnd,
        above,
        origin.x + (r.x * scale).round() as i32,
        origin.y + (r.y * scale).round() as i32,
        (r.w * scale).round() as i32,
        (r.h * scale).round() as i32,
        (radius * scale).round() as i32,
        glass::inset_for(scale),
        tint,
    );
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

/// Open Windows Search, Quick Settings or the calendar/notification panel.
#[tauri::command]
pub fn dock_shell(which: String) {
    apps::shell_shortcut(&which);
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
