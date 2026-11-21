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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum IslandMonitor {
    /// Only the main display.
    #[default]
    Primary,
    /// One island on every connected display.
    All,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum IslandSize {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum IslandStyle {
    /// iPhone-style "Liquid Glass": dark glass over real acrylic blur.
    #[default]
    Liquid,
    /// Translucent tinted glass with a light border.
    Glass,
    /// Opaque black, like a phone's island.
    Solid,
    /// Attached to the top edge of the screen, like a laptop notch.
    Notch,
    /// Black with an animated neon gradient border.
    Neon,
    /// Slowly shifting colour gradient.
    Aurora,
    /// Slim, borderless and subtle.
    Minimal,
    /// Light frosted glass with dark text.
    Frost,
}

/// Which live activities the island shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct IslandActivities {
    pub music: bool,
    pub timer: bool,
    pub battery: bool,
    pub network: bool,
    pub downloads: bool,
}

impl Default for IslandActivities {
    fn default() -> Self {
        Self { music: true, timer: true, battery: true, network: true, downloads: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct IslandConfig {
    pub enabled: bool,
    pub monitor: IslandMonitor,
    /// Legacy preset; `scale` is used now (old Small/Large are migrated on load).
    pub size: IslandSize,
    /// Island size in percent (60–170).
    pub scale: u32,
    /// Bend the screen behind the island through the glass (Liquid Glass).
    /// Needs the window to be hidden from screen capture, so it is a
    /// setting of its own.
    pub refraction: bool,
    pub style: IslandStyle,
    /// Gap between the top of the screen and the island, in pixels.
    pub offset_y: u32,
    /// Fade the island out when nothing is happening (hover to reveal).
    pub hide_when_idle: bool,
    pub activities: IslandActivities,
    /// Music player look: "auto" (match the island design) or a theme id.
    pub music_theme: String,
    /// Show the audio-reactive visualizer while music plays.
    pub visualizer: bool,
}

impl Default for IslandConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            monitor: IslandMonitor::Primary,
            size: IslandSize::Medium,
            scale: 100,
            refraction: true,
            style: IslandStyle::Liquid,
            offset_y: 8,
            hide_when_idle: false,
            activities: IslandActivities::default(),
            music_theme: "auto".into(),
            visualizer: true,
        }
    }
}


// ---- Dock ------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DockDesign {
    /// iPhone-style "Liquid Glass" bar over real acrylic blur.
    #[default]
    Liquid,
    /// Floating frosted bar (real acrylic blur).
    Glass,
    /// Flat, quiet, no border.
    Minimal,
    /// Dark bar with a glowing accent outline.
    Neon,
    /// Full-width bar like the classic taskbar.
    Classic,
    /// Each icon sits in its own floating pill.
    Pills,
    /// Full-width, centred icons, Windows 11 look.
    Win11,
    /// Attached to the screen edge with rounded top corners.
    Tab,
    /// Dark pill; every icon sits on its own dark tile.
    Pebble,
    /// Squared frosted rail with dividers between icons.
    Rail,
    /// Transparent with a thin line and underline indicators.
    Underline,
    /// Three capsules: Start/Search, apps, system tray.
    Split,
    /// System tray capsule stacked above the app capsule.
    Stack,
    /// Icons on soft pastel tiles.
    Tiles,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum IconStyle {
    /// The app's own colourful icon.
    #[default]
    Original,
    /// Greyscale.
    Mono,
    /// Single-colour silhouette in the accent colour.
    Silhouette,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DockBackground {
    #[default]
    Glass,
    Solid,
    Transparent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DockPosition {
    #[default]
    Bottom,
    Left,
    Right,
}

/// Everything about how the dock looks. Saved/loaded as a theme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DockStyle {
    pub design: DockDesign,
    pub background: DockBackground,
    /// Icon size in pixels (24-128).
    pub icon_size: u32,
    /// Gap between icons in pixels (0-40).
    pub spacing: u32,
    /// Corner radius of the bar in pixels (0-48).
    pub corner_radius: u32,
    /// 0 = no blur, 100 = strongest glass effect.
    pub blur: u32,
    /// Background opacity, 0-100.
    pub opacity: u32,
    /// Accent colour for this dock; None follows the app accent.
    pub accent: Option<String>,
    /// Hover magnification in percent (100 = off, up to 250).
    pub magnification: u32,
    pub position: DockPosition,
    pub auto_hide: bool,
    pub icon_style: IconStyle,
    /// Thin dividers between icons.
    pub separators: bool,
}

impl Default for DockStyle {
    fn default() -> Self {
        Self {
            design: DockDesign::Liquid,
            background: DockBackground::Glass,
            icon_size: 48,
            spacing: 8,
            corner_radius: 22,
            blur: 70,
            opacity: 60,
            accent: None,
            magnification: 160,
            position: DockPosition::Bottom,
            auto_hide: false,
            icon_style: IconStyle::Original,
            separators: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct PinnedApp {
    pub name: String,
    /// What to launch: an .exe or a .lnk shortcut.
    pub path: String,
    /// The .exe it runs (lower-case), used to match running windows.
    pub target: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DockTheme {
    pub name: String,
    pub style: DockStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DockConfig {
    pub enabled: bool,
    pub monitor: IslandMonitor,
    pub style: DockStyle,
    pub show_running: bool,
    pub show_start: bool,
    pub show_clock: bool,
    /// Wi-Fi, volume and battery icons (with the clock).
    pub show_tray: bool,
    pub show_search: bool,
    /// Hide the Windows taskbar while DeskFlow runs (restored on quit).
    pub hide_taskbar: bool,
    pub pinned: Vec<PinnedApp>,
    /// Set once the user's taskbar pins have been imported.
    pub pins_imported: bool,
    pub themes: Vec<DockTheme>,
    /// The taskbar's own auto-hide setting before DeskFlow changed it.
    pub original_taskbar_autohide: Option<bool>,
}

impl Default for DockConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            monitor: IslandMonitor::Primary,
            style: DockStyle::default(),
            show_running: true,
            show_start: true,
            show_clock: true,
            show_tray: true,
            show_search: false,
            hide_taskbar: false,
            pinned: Vec::new(),
            pins_imported: false,
            themes: Vec::new(),
            original_taskbar_autohide: None,
        }
    }
}

impl DockStyle {
    pub fn validate(&self) -> Result<(), String> {
        let in_range = |v: u32, lo: u32, hi: u32, what: &str| {
            if v < lo || v > hi {
                Err(format!("{what} must be between {lo} and {hi}"))
            } else {
                Ok(())
            }
        };
        in_range(self.icon_size, 24, 128, "Icon size")?;
        in_range(self.spacing, 0, 40, "Spacing")?;
        in_range(self.corner_radius, 0, 48, "Corner radius")?;
        in_range(self.blur, 0, 100, "Blur")?;
        in_range(self.opacity, 0, 100, "Opacity")?;
        in_range(self.magnification, 100, 250, "Magnification")?;
        if let Some(a) = &self.accent {
            if !is_hex_color(a) {
                return Err(format!("Dock accent must look like #7c5cff, got {a:?}"));
            }
        }
        Ok(())
    }
}

pub fn is_hex_color(a: &str) -> bool {
    a.len() == 7 && a.starts_with('#') && a[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ConverterConfig {
    /// Master switch. Off: no hover detection, no right-click entry, no drop zone.
    pub enabled: bool,
    /// Round convert button when hovering a file on the desktop / in Explorer.
    pub hover_button: bool,
    /// How long the mouse must rest on a file before the button appears.
    pub hover_delay_ms: u32,
    /// "Convert with DeskFlow" in the right-click menu.
    pub context_menu: bool,
    /// Floating circle at the screen edge to drop files on.
    pub drop_zone: bool,
}

impl Default for ConverterConfig {
    fn default() -> Self {
        Self { enabled: false, hover_button: true, hover_delay_ms: 600, context_menu: true, drop_zone: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AiConfig {
    /// Run the local API that AI apps use to send tasks and notifications.
    pub api_enabled: bool,
    pub api_port: u16,
    /// Secret apps must send (header X-DeskFlow-Token). Generated on first run.
    pub api_token: String,
    /// Island style for AI tasks: ticker, split, paper, shutters, sidecar,
    /// taskmap, ticket or lifecycle.
    pub style: String,
    /// Do Not Disturb: notifications go to history only (permission
    /// requests still show, since a task is waiting).
    pub dnd: bool,
    pub sound: bool,
    /// AI apps shown in the dock's AI section.
    pub apps: Vec<PinnedApp>,
    pub apps_scanned: bool,
    pub dock_section: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            api_enabled: true,
            api_port: 47821,
            api_token: String::new(),
            style: "ticker".into(),
            dnd: false,
            sound: true,
            apps: Vec::new(),
            apps_scanned: false,
            dock_section: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub general: GeneralConfig,
    pub appearance: AppearanceConfig,
    pub island: IslandConfig,
    pub dock: DockConfig,
    pub converter: ConverterConfig,
    pub ai: AiConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            general: GeneralConfig::default(),
            appearance: AppearanceConfig::default(),
            island: IslandConfig::default(),
            dock: DockConfig::default(),
            converter: ConverterConfig::default(),
            ai: AiConfig::default(),
        }
    }
}

impl Config {
    /// Reject values that would break the app before they are saved.
    pub fn validate(&self) -> Result<(), String> {
        let a = &self.appearance.accent;
        if !is_hex_color(a) {
            return Err(format!("Accent colour must look like #7c5cff, got {a:?}"));
        }
        self.dock.style.validate()?;
        for t in &self.dock.themes {
            t.style.validate()?;
        }
        if self.ai.api_port < 1024 {
            return Err("API port must be 1024 or higher".into());
        }
        if self.island.music_theme.len() > 40 {
            return Err("Unknown music theme".into());
        }
        if !(60..=170).contains(&self.island.scale) {
            return Err("island size must be between 60% and 170%".into());
        }
        if self.island.offset_y > 200 {
            return Err("Island offset must be 200 px or less".into());
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
                Ok(mut c) => {
                    // Old Small / Large presets become a percentage.
                    match c.island.size {
                        IslandSize::Small => c.island.scale = 85,
                        IslandSize::Large => c.island.scale = 115,
                        IslandSize::Medium => {}
                    }
                    c.island.size = IslandSize::Medium;
                    c.island.scale = c.island.scale.clamp(60, 170);
                    c
                }
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

    #[test]
    fn old_size_presets_become_scale_and_converter_starts_off() {
        let dir = temp_dir("migrate");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config.json"), r#"{"island":{"size":"large"},"converter":{"hoverButton":true}}"#).unwrap();
        let (store, first) = ConfigStore::load(&dir);
        assert!(!first);
        let c = store.get();
        assert_eq!(c.island.scale, 115);
        assert_eq!(c.island.size, IslandSize::Medium);
        assert!(!c.converter.enabled);
        assert!(c.validate().is_ok());
    }

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
    fn dock_style_validation() {
        let mut s = DockStyle::default();
        assert!(s.validate().is_ok());
        s.icon_size = 300;
        assert!(s.validate().is_err());
        s.icon_size = 48;
        s.accent = Some("red".into());
        assert!(s.validate().is_err());
        s.accent = Some("#ff0000".into());
        assert!(s.validate().is_ok());
    }

    #[test]
    fn theme_json_round_trips() {
        let t = DockTheme { name: "Mine".into(), style: DockStyle { design: DockDesign::Neon, ..Default::default() } };
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"design\":\"neon\""));
        let back: DockTheme = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
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
