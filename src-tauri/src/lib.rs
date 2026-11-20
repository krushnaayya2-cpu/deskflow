//! DeskFlow backend entry point.
//!
//! Wires up the always-running tray app (JSON config, start with Windows,
//! global settings hotkey, settings window) and the Dynamic Island. Later
//! steps add modules (dock, converter, organizer, ai) next to these.

mod ai;
mod commands;
mod config;
mod diag;
mod displays;
mod convert;
mod dock;
mod glass;
mod hotkey;
mod island;
mod overlay;
mod perf;
mod tray;
mod windows;

use config::ConfigStore;
use tauri::{Manager, RunEvent};

/// Command-line flag the autostart entry passes, so we can tell a login
/// launch (stay quietly in the tray) from a manual launch.
pub const AUTOSTART_FLAG: &str = "--autostart";

pub fn run() {
    let started = std::time::Instant::now();
    diag::init();
    let app = tauri::Builder::default()
        // Must be first: a second launch just focuses the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // "Convert with DeskFlow" launches us with --convert <file>.
            if args.iter().any(|a| a == "--convert") {
                convert::handle_args(app, &args);
            } else {
                windows::show_settings(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(hotkey::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_app_info,
            commands::open_config_folder,
            perf::perf_stats,
            diag::diag_log,
            ai::ai_tasks,
            ai::ai_decide,
            ai::ai_dismiss,
            ai::ai_open,
            ai::ai_history,
            ai::ai_clear_history,
            ai::ai_api_info,
            ai::ai_detect_apps,
            ai::ai_demo,
            convert::convert_pending,
            convert::convert_expand,
            convert::convert_start,
            convert::convert_close,
            convert::convert_open,
            convert::convert_pick,
            convert::convert_tools,
            convert::convert_install,
            overlay::overlay_set_hit_rects,
            island::island_snapshot,
            island::island_set_glass,
            glass::glass_supported,
            island::island_demo,
            island::media_control,
            island::media_art,
            island::audio_peak,
            island::audio_volume,
            island::audio_set_volume,
            island::open_path,
            island::reveal_path,
            island::open_settings,
            dock::dock_set_bar,
            dock::dock_running,
            dock::dock_icon,
            dock::dock_activate,
            dock::dock_launch,
            dock::dock_close,
            dock::dock_start_menu,
            dock::dock_shell,
            dock::dock_installed_apps,
            dock::dock_make_pin,
            dock::dock_export_theme,
            dock::dock_import_theme,
        ])
        .setup(move |app| {
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
            diag::trace("tray::create");
            tray::create(handle, &cfg)?;
            windows::apply_theme(handle, cfg.appearance.theme);
            // Before any window exists: the island and dock pages ask for AI
            // tasks as soon as they load, and a command that finds no state
            // aborts the whole app.
            diag::trace("ai::init");
            ai::init(handle, &cfg);
            diag::trace("overlay::init");
            overlay::init(handle);
            diag::trace("island::init");
            island::init(handle, &cfg);
            diag::trace("dock::init");
            dock::init(handle, &cfg);
            diag::trace("convert::init");
            convert::init(handle, &cfg);
            let args: Vec<String> = std::env::args().collect();
            convert::handle_args(handle, &args);
            displays::start(handle);
            perf::mark_started(started);
            diag::trace("started");

            // Show settings on the very first manual launch so the user sees
            // something; otherwise DeskFlow starts silently in the tray.
            let from_login = std::env::args().any(|a| a == AUTOSTART_FLAG);
            let from_convert = std::env::args().any(|a| a == "--convert");
            if first_run && !from_login && !from_convert {
                windows::show_settings(handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start DeskFlow");

    app.run(|app, event| match event {
        // Only an explicit Quit (which passes an exit code) ends the process.
        RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        // Never leave the Windows taskbar hidden after DeskFlow exits.
        // Never leave the dock's reserved space behind either.
        RunEvent::Exit => {
            dock::restore_taskbar(app);
            dock::taskbar::release_all();
        }
        _ => {}
    });
}
