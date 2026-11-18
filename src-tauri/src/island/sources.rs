//! Live data for the Dynamic Island.
//!
//! - Music, battery and network are read once a second on a background
//!   thread (Windows APIs). Only *changes* are sent to the UI, so an idle
//!   system produces no events.
//! - Finished downloads come from a file-system watcher on the Downloads
//!   folder (event-driven, no polling).

use super::{emit_event, IslandEvent, EV_STATE};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    /// App that owns the session, e.g. "Spotify.exe".
    pub app: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub connected: bool,
    pub name: String,
    pub wifi: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemState {
    pub media: Option<Media>,
    /// None on desktops without a battery.
    pub battery: Option<Battery>,
    pub network: Option<Network>,
}

#[derive(Default)]
struct Sources {
    state: Mutex<SystemState>,
    /// Keeps the Downloads watcher alive for the life of the app.
    _watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub fn snapshot(app: &AppHandle) -> SystemState {
    app.try_state::<Sources>()
        .map(|s| s.state.lock().unwrap().clone())
        .unwrap_or_default()
}

pub fn start(app: &AppHandle) {
    app.manage(Sources::default());
    start_poller(app.clone());
    if let Ok(dir) = app.path().download_dir() {
        match watch_downloads(app.clone(), &dir) {
            Ok(w) => *app.state::<Sources>()._watcher.lock().unwrap() = Some(w),
            Err(e) => log::warn!("downloads watcher failed: {e}"),
        }
    }
}

fn start_poller(app: AppHandle) {
    std::thread::Builder::new()
        .name("island-sources".into())
        .spawn(move || {
            platform::init_thread();
            let mut first = true;
            loop {
                let next = SystemState {
                    media: platform::read_media(),
                    battery: platform::read_battery(),
                    network: platform::read_network(),
                };
                let prev = {
                    let sources = app.state::<Sources>();
                    let mut cur = sources.state.lock().unwrap();
                    if *cur == next && !first {
                        drop(cur);
                        std::thread::sleep(Duration::from_secs(1));
                        continue;
                    }
                    std::mem::replace(&mut *cur, next.clone())
                };
                let _ = app.emit(EV_STATE, &next);
                if !first {
                    emit_transitions(&app, &prev, &next);
                }
                first = false;
                std::thread::sleep(Duration::from_secs(1));
            }
        })
        .expect("spawn island sources thread");
}

/// Turn state changes into one-off island notifications.
fn emit_transitions(app: &AppHandle, prev: &SystemState, next: &SystemState) {
    if let (Some(a), Some(b)) = (&prev.battery, &next.battery) {
        if a.charging != b.charging {
            emit_event(app, IslandEvent::Charging { charging: b.charging, percent: b.percent });
        }
    }
    let (a, b) = (prev.network.clone().unwrap_or_default(), next.network.clone().unwrap_or_default());
    if a.connected != b.connected || (b.connected && a.name != b.name) {
        emit_event(app, IslandEvent::Network { connected: b.connected, name: b.name, wifi: b.wifi });
    }
}

/// Partial-download extensions used by browsers while a file is in flight.
fn is_temp_download(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || matches!(ext.as_str(), "crdownload" | "part" | "partial" | "tmp" | "download" | "opdownload")
}

fn watch_downloads(app: AppHandle, dir: &Path) -> notify::Result<notify::RecommendedWatcher> {
    use notify::{
        event::{ModifyKind, RenameMode},
        EventKind, RecursiveMode, Watcher,
    };
    let recent: Mutex<Vec<(PathBuf, std::time::Instant)>> = Mutex::new(Vec::new());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        // A finished download is either a new file or a temp file renamed
        // to its final name.
        let path = match ev.kind {
            EventKind::Create(_) => ev.paths.first().cloned(),
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => ev.paths.first().cloned(),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => ev.paths.get(1).cloned(),
            _ => None,
        };
        let Some(path) = path else { return };
        if is_temp_download(&path) || !path.is_file() {
            return;
        }
        // Browsers often fire several events per file; report each once.
        let mut recent = recent.lock().unwrap();
        recent.retain(|(_, t)| t.elapsed() < Duration::from_secs(15));
        if recent.iter().any(|(p, _)| p == &path) {
            return;
        }
        recent.push((path.clone(), std::time::Instant::now()));
        emit_event(
            &app,
            IslandEvent::Download {
                name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
            },
        );
    })?;
    watcher.watch(dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

pub fn media_control(action: &str) -> Result<(), String> {
    platform::media_control(action)
}

#[cfg(windows)]
mod platform {
    use super::{Battery, Media, Network};
    use windows::{
        Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        },
        Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation},
        Win32::System::{
            Com::{CoInitializeEx, COINIT_MULTITHREADED},
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
        },
    };

    pub fn init_thread() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    thread_local! {
        /// The media session manager is created once per thread and reused.
        static MANAGER: std::cell::RefCell<Option<SessionManager>> = const { std::cell::RefCell::new(None) };
    }

    fn manager() -> Option<SessionManager> {
        MANAGER.with(|m| {
            let mut m = m.borrow_mut();
            if m.is_none() {
                *m = SessionManager::RequestAsync().ok()?.join().ok();
            }
            m.clone()
        })
    }

    pub fn read_media() -> Option<Media> {
        let session = manager()?.GetCurrentSession().ok()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }
        let playing = session
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);
        Some(Media {
            title,
            artist: props.Artist().map(|a| a.to_string()).unwrap_or_default(),
            playing,
            app: session.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default(),
        })
    }

    pub fn read_battery() -> Option<Battery> {
        let mut s = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut s).ok()? };
        // 128 = no system battery, 255 = unknown.
        if s.BatteryFlag == 128 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100 {
            return None;
        }
        Some(Battery { percent: s.BatteryLifePercent, charging: s.ACLineStatus == 1 })
    }

    pub fn read_network() -> Option<Network> {
        let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else {
            return Some(Network::default()); // no connection
        };
        let connected = profile
            .GetNetworkConnectivityLevel()
            .map(|l| l == NetworkConnectivityLevel::InternetAccess)
            .unwrap_or(false);
        Some(Network {
            connected,
            name: profile.ProfileName().map(|n| n.to_string()).unwrap_or_default(),
            wifi: profile.IsWlanConnectionProfile().unwrap_or(false),
        })
    }

    pub fn media_control(action: &str) -> Result<(), String> {
        init_thread();
        let session = manager()
            .ok_or("Media controls unavailable")?
            .GetCurrentSession()
            .map_err(|_| "Nothing is playing".to_string())?;
        let op = match action {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "prev" => session.TrySkipPreviousAsync(),
            other => return Err(format!("Unknown media action {other:?}")),
        };
        op.and_then(|o| o.join()).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Non-Windows stubs so the crate still builds and tests run on Linux CI.
#[cfg(not(windows))]
mod platform {
    use super::{Battery, Media, Network};
    pub fn init_thread() {}
    pub fn read_media() -> Option<Media> {
        None
    }
    pub fn read_battery() -> Option<Battery> {
        None
    }
    pub fn read_network() -> Option<Network> {
        None
    }
    pub fn media_control(_action: &str) -> Result<(), String> {
        Err("Media controls are only available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::is_temp_download;
    use std::path::Path;

    #[test]
    fn skips_partial_downloads() {
        assert!(is_temp_download(Path::new("C:/D/file.zip.crdownload")));
        assert!(is_temp_download(Path::new("C:/D/movie.mp4.part")));
        assert!(is_temp_download(Path::new("C:/D/~$report.docx")));
        assert!(!is_temp_download(Path::new("C:/D/report.pdf")));
        assert!(!is_temp_download(Path::new("C:/D/setup.exe")));
    }
}
