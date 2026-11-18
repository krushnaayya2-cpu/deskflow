//! Persistent settings, stored as one human-readable JSON file:
//! `%APPDATA%\com.deskflow.app\config.json`.
//!
//! Every field has a default (`#[serde(default)]`), so older or partly edited
//! config files keep loading as new settings are added in later steps.
//! Nothing here is ever sent off the machine.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Bumped when a breaking change to the file layout needs a migration.
pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralConfig {
    /// Launch DeskFlow when the user signs in to Windows.
    pub autostart: bool,
    /// Global shortcut that opens the settings window, e.g. "Ctrl+Alt+D".
    pub settings_hotkey: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            autostart: true,
            settings_hotkey: "Ctrl+Alt+D".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub theme: ThemeMode,
    /// Accent colour as a `#rrggbb` hex string.
    pub accent: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            accent: "#7c5cff".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub general: GeneralConfig,
    pub appearance: AppearanceConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            general: GeneralConfig::default(),
            appearance: AppearanceConfig::default(),
        }
    }
}

impl Config {
    /// Reject values that would break the app before they are saved.
    pub fn validate(&self) -> Result<(), String> {
        let a = &self.appearance.accent;
        let is_hex = a.len() == 7
            && a.starts_with('#')
            && a[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !is_hex {
            return Err(format!("Accent colour must look like #7c5cff, got {a:?}"));
        }
        if self.general.settings_hotkey.trim().is_empty() {
            return Err("The settings hotkey cannot be empty".into());
        }
        Ok(())
    }
}

/// Thread-safe owner of the config and its file location.
pub struct ConfigStore {
    path: PathBuf,
    inner: Mutex<Config>,
}

impl ConfigStore {
    /// Load config from `dir`. Returns the store and `true` if this is the
    /// first run (no config file existed yet).
    pub fn load(dir: &Path) -> (Self, bool) {
        let path = dir.join("config.json");
        let first_run = !path.exists();
        let config = if first_run {
            Config::default()
        } else {
            match fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str::<Config>(&s).map_err(|e| e.to_string()))
            {
                Ok(c) => c,
                Err(e) => {
                    // Keep the broken file for the user rather than silently
                    // overwriting it, then fall back to defaults.
                    log::warn!("config.json unreadable ({e}); backing up and using defaults");
                    let _ = fs::rename(&path, path.with_extension("json.bak"));
                    Config::default()
                }
            }
        };
        let store = Self { path, inner: Mutex::new(config) };
        if first_run {
            let _ = store.persist();
        }
        (store, first_run)
    }

    pub fn get(&self) -> Config {
        self.inner.lock().unwrap().clone()
    }

    /// Replace the whole config and write it to disk.
    pub fn set(&self, config: Config) -> Result<(), String> {
        config.validate()?;
        *self.inner.lock().unwrap() = config;
        self.persist()
    }

    /// Write atomically: write a temp file, then rename over the real one,
    /// so a crash mid-write never leaves a half-written config.
    fn persist(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&*self.inner.lock().unwrap())
            .map_err(|e| e.to_string())?;
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("deskflow-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn first_run_writes_defaults() {
        let dir = temp_dir("first");
        let (store, first) = ConfigStore::load(&dir);
        assert!(first);
        assert_eq!(store.get(), Config::default());
        assert!(dir.join("config.json").exists());
        let (_, first_again) = ConfigStore::load(&dir);
        assert!(!first_again);
    }

    #[test]
    fn partial_file_fills_in_defaults() {
        let dir = temp_dir("partial");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config.json"), r#"{"appearance":{"theme":"dark"}}"#).unwrap();
        let (store, _) = ConfigStore::load(&dir);
        let c = store.get();
        assert_eq!(c.appearance.theme, ThemeMode::Dark);
        assert_eq!(c.appearance.accent, "#7c5cff");
        assert_eq!(c.general.settings_hotkey, "Ctrl+Alt+D");
    }

    #[test]
    fn corrupt_file_is_backed_up() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config.json"), "{ not json").unwrap();
        let (store, _) = ConfigStore::load(&dir);
        assert_eq!(store.get(), Config::default());
        assert!(dir.join("config.json.bak").exists());
    }

    #[test]
    fn set_rejects_bad_accent_and_round_trips() {
        let dir = temp_dir("set");
        let (store, _) = ConfigStore::load(&dir);
        let mut c = store.get();
        c.appearance.accent = "purple".into();
        assert!(store.set(c.clone()).is_err());
        c.appearance.accent = "#00ffaa".into();
        store.set(c.clone()).unwrap();
        let (reloaded, _) = ConfigStore::load(&dir);
        assert_eq!(reloaded.get(), c);
    }
}
