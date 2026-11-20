//! Commands the frontend calls with `invoke(...)`, plus the shared
//! "apply a new config" logic used by both the UI and the tray menu.

use crate::{
    config::{Config, ConfigStore},
    ai, convert, dock, hotkey, island, tray, windows,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

/// Event broadcast to every window whenever settings change.
pub const CONFIG_CHANGED: &str = "config-changed";

pub fn current_config(app: &AppHandle) -> Config {
    app.state::<ConfigStore>().get()
}

/// Make the Windows startup entry match `enabled`.
pub fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let is_on = launcher.is_enabled().unwrap_or(false);
    match (enabled, is_on) {
        (true, false) => launcher.enable().map_err(|e| e.to_string()),
        (false, true) => launcher.disable().map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}

/// Validate, apply side effects (hotkey, autostart, theme), save, and notify
/// all windows. Side effects run before saving so a failure (e.g. hotkey
/// taken by another app) leaves the saved config unchanged.
pub fn update_config(app: &AppHandle, mut new: Config) -> Result<Config, String> {
    new.validate()?;
    let old = current_config(app);
    // Backend-owned: the UI must never overwrite the remembered taskbar state.
    new.dock.original_taskbar_autohide = old.dock.original_taskbar_autohide;

    if new.general.settings_hotkey != old.general.settings_hotkey {
        hotkey::register(app, &new.general.settings_hotkey)?;
    }
    if new.general.autostart != old.general.autostart {
        apply_autostart(app, new.general.autostart)?;
        tray::sync_autostart_check(app, new.general.autostart);
    }
    if new.appearance.theme != old.appearance.theme {
        windows::apply_theme(app, new.appearance.theme);
    }

    app.state::<ConfigStore>().set(new.clone())?;
    if new.ai.api_enabled != old.ai.api_enabled || new.ai.api_port != old.ai.api_port || new.ai.api_token != old.ai.api_token {
        ai::sync(app, &new);
    }
    // Fix (island/dock not appearing after a settings change): these may
    // create webview windows. `set_config` runs inside WebView2's message
    // callback on the UI thread, and WebView2 cannot create a new webview
    // from inside its own callback: the build waits for the UI thread,
    // which is busy running this command, so it never finished. Queue the
    // work to run on the UI thread right after this command returns.
    let (island_changed, convert_changed, dock_changed) =
        (new.island != old.island, new.converter != old.converter, new.dock != old.dock || new.appearance != old.appearance);
    if island_changed || convert_changed || dock_changed {
        let (a, cfg) = (app.clone(), new.clone());
        let _ = app.run_on_main_thread(move || {
            if island_changed {
                island::sync(&a, &cfg);
            }
            if convert_changed {
                convert::sync(&a, &cfg);
            }
            if dock_changed {
                dock::sync(&a, &cfg);
            }
        });
    }
    let saved = current_config(app);
    let _ = app.emit(CONFIG_CHANGED, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn get_config(store: State<'_, ConfigStore>) -> Config {
    store.get()
}

#[tauri::command]
pub fn set_config(app: AppHandle, config: Config) -> Result<Config, String> {
    update_config(&app, config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    config_dir: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        config_dir: app
            .path()
            .app_config_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

/// Open the folder holding config.json in File Explorer.
#[tauri::command]
pub fn open_config_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err("Only supported on Windows".into())
    }
}
