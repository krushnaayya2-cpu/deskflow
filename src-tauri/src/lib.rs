//! DeskFlow backend entry point.
//!
//! Wires up the always-running tray app (JSON config, start with Windows,
//! global settings hotkey, settings window) and the Dynamic Island. Later
//! steps add modules (dock, converter, organizer, ai) next to these.

mod commands;
mod config;
mod hotkey;
mod island;
mod tray;
mod windows;

use config::ConfigStore;
use tauri::{Manager, RunEvent, WindowEvent};

/// Command-line flag the autostart entry passes, so we can tell a login
/// launch (stay quietly in the tray) from a manual launch.
pub const AUTOSTART_FLAG: &str = "--autostart";

pub fn run() {
    let app = tauri::Builder::default()
        // Must be first: a second launch just focuses the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_settings(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(hotkey::plugin())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_app_info,
            commands::open_config_folder,
            island::island_set_hit_rect,
            island::island_snapshot,
            island::island_demo,
            island::media_control,
            island::open_path,
            island::reveal_path,
            island::open_settings,
        ])
        .setup(|app| {
            let handle = app.handle();
            let dir = app.path().app_config_dir()?;
            let (store, first_run) = ConfigStore::load(&dir);
            let cfg = store.get();
            app.manage(store);

            // Make the Windows "Run" entry match the saved setting.
            if let Err(e) = commands::apply_autostart(handle, cfg.general.autostart) {
                log::warn!("could not sync autostart: {e}");
            }
            if let Err(e) = hotkey::register(handle, &cfg.general.settings_hotkey) {
                log::warn!("could not register settings hotkey: {e}");
            }
            tray::create(handle, &cfg)?;
            windows::apply_theme(handle, cfg.appearance.theme);
            island::init(handle, &cfg);

            // Show settings on the very first manual launch so the user sees
            // something; otherwise DeskFlow starts silently in the tray.
            let from_login = std::env::args().any(|a| a == AUTOSTART_FLAG);
            if first_run && !from_login {
                windows::show_settings(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing settings only hides it; DeskFlow keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == windows::SETTINGS {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start DeskFlow");

    app.run(|_app, event| {
        // Only an explicit Quit (which passes an exit code) ends the process.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
