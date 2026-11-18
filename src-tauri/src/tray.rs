//! System tray icon and its menu.

use crate::{commands, config::Config, windows};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

const OPEN: &str = "open";
const AUTOSTART: &str = "autostart";
const QUIT: &str = "quit";

/// Kept in app state so settings changes can update the menu's checkmark.
pub struct TrayState {
    autostart: CheckMenuItem<Wry>,
}

pub fn create(app: &AppHandle, cfg: &Config) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN, "Open DeskFlow Settings", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        AUTOSTART,
        "Start with Windows",
        true,
        cfg.general.autostart,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, QUIT, "Quit DeskFlow", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::with_id("deskflow")
        .icon(app.default_window_icon().cloned().expect("bundle icon missing"))
        .tooltip("DeskFlow")
        .menu(&menu)
        // Left click opens settings; right click shows the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN => windows::show_settings(app),
            AUTOSTART => {
                let mut cfg = commands::current_config(app);
                cfg.general.autostart = !cfg.general.autostart;
                if let Err(e) = commands::update_config(app, cfg) {
                    log::warn!("autostart toggle failed: {e}");
                }
                // Re-sync in case the change failed and the item auto-toggled.
                sync_autostart_check(app, commands::current_config(app).general.autostart);
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::show_settings(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayState { autostart });
    Ok(())
}

/// Update the "Start with Windows" checkmark.
pub fn sync_autostart_check(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.autostart.set_checked(enabled);
    }
}
