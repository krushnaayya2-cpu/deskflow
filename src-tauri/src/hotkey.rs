//! Global hotkey that opens the settings window from anywhere.

use crate::windows;
use std::{str::FromStr, sync::Mutex};
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The shortcut currently registered for "open settings".
#[derive(Default)]
struct SettingsHotkey(Mutex<Option<Shortcut>>);

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let Some(state) = app.try_state::<SettingsHotkey>() else { return };
            let is_settings = state.0.lock().unwrap().as_ref() == Some(shortcut);
            if is_settings {
                windows::show_settings(app);
            }
        })
        .build()
}

/// Parse a user-facing string like "Ctrl+Alt+D" into a shortcut.
pub fn parse(s: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(s.trim()).map_err(|e| format!("Invalid hotkey {s:?}: {e}"))
}

/// Register `combo` as the settings hotkey, replacing any previous one.
/// If the new combo can't be registered (e.g. another app owns it), the old
/// one stays active and an error is returned.
pub fn register(app: &AppHandle, combo: &str) -> Result<(), String> {
    let new = parse(combo)?;
    if app.try_state::<SettingsHotkey>().is_none() {
        app.manage(SettingsHotkey::default());
    }
    let state = app.state::<SettingsHotkey>();
    let mut current = state.0.lock().unwrap();
    if current.as_ref() == Some(&new) {
        return Ok(());
    }
    let gs = app.global_shortcut();
    gs.register(new)
        .map_err(|e| format!("Couldn't register {combo} (another app may be using it): {e}"))?;
    if let Some(old) = current.take() {
        let _ = gs.unregister(old);
    }
    *current = Some(new);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_common_combos() {
        assert!(parse("Ctrl+Alt+D").is_ok());
        assert!(parse("Shift+Super+F1").is_ok());
        assert!(parse("ctrl+shift+space").is_ok());
        assert!(parse("").is_err());
        assert!(parse("Ctrl+Nope").is_err());
    }
}
