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
    pub album: String,
    pub playing: bool,
    /// App that owns the session, e.g. "Spotify.exe".
    pub app: String,
    /// Playback position in seconds at `updated_at` (unix ms). The UI
    /// extrapolates while playing, so this only changes on real updates.
    pub position: f64,
    pub duration: f64,
    pub updated_at: i64,
    pub shuffle: Option<bool>,
    /// "none" | "track" | "list", when the app supports repeat.
    pub repeat: Option<String>,
    /// Changes when the track changes; the UI then fetches `media_art`.
    pub art_key: String,
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
    /// Album art of the current track: (art_key, data URL).
    art: Mutex<Option<(String, Option<String>)>>,
    /// Keeps the Downloads watcher alive for the life of the app.
    _watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub fn snapshot(app: &AppHandle) -> SystemState {
    app.try_state::<Sources>()
        .map(|s| s.state.lock().unwrap().clone())
        .unwrap_or_default()
}

/// Album art (data URL) for the current track, if the app provides one.
pub fn art(app: &AppHandle) -> Option<String> {
    app.try_state::<Sources>().and_then(|s| s.art.lock().unwrap().as_ref().and_then(|(_, a)| a.clone()))
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
            let mut tick: u64 = 0;
            let (mut battery, mut network) = (None, None);
            loop {
                // Music changes often; battery and network rarely, so they
                // are read every 5 s instead of every second.
                if tick % 5 == 0 {
                    battery = platform::read_battery();
                    network = platform::read_network();
                }
                tick += 1;
                let next = SystemState { media: platform::read_media(), battery: battery.clone(), network: network.clone() };
                // Fetch album art once per track (before announcing it).
                if let Some(m) = &next.media {
                    let sources = app.state::<Sources>();
                    let stale = sources.art.lock().unwrap().as_ref().map(|(k, _)| k != &m.art_key).unwrap_or(true);
                    if stale {
                        let art = platform::read_art();
                        *sources.art.lock().unwrap() = Some((m.art_key.clone(), art));
                    }
                }
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

pub fn media_control(action: &str, value: Option<f64>) -> Result<(), String> {
    platform::media_control(action, value)
}

#[cfg(windows)]
mod platform {
    use super::{Battery, Media, Network};
    use base64::Engine;
    use windows::{
        Media::{
            Control::{
                GlobalSystemMediaTransportControlsSession as Session,
                GlobalSystemMediaTransportControlsSessionManager as SessionManager,
                GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
            },
            MediaPlaybackAutoRepeatMode as Repeat,
        },
        Storage::Streams::{Buffer, DataReader, IInputStream, InputStreamOptions},
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

    fn session() -> Option<Session> {
        manager()?.GetCurrentSession().ok()
    }

    /// 100 ns ticks since 1601 -> unix milliseconds.
    fn filetime_to_unix_ms(t: i64) -> i64 {
        (t - 116_444_736_000_000_000) / 10_000
    }

    pub fn read_media() -> Option<Media> {
        let session = session()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }
        let info = session.GetPlaybackInfo().ok();
        let playing = info
            .as_ref()
            .and_then(|i| i.PlaybackStatus().ok())
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);
        let shuffle = info.as_ref().and_then(|i| i.IsShuffleActive().ok()).and_then(|r| r.Value().ok());
        let repeat = info
            .as_ref()
            .and_then(|i| i.AutoRepeatMode().ok())
            .and_then(|r| r.Value().ok())
            .map(|m| match m {
                Repeat::Track => "track",
                Repeat::List => "list",
                _ => "none",
            }
            .to_string());
        let (mut position, mut duration, mut updated_at) = (0.0, 0.0, 0);
        if let Ok(t) = session.GetTimelineProperties() {
            let secs = |ts: windows::Foundation::TimeSpan| ts.Duration as f64 / 10_000_000.0;
            let start = t.StartTime().map(secs).unwrap_or(0.0);
            duration = (t.EndTime().map(secs).unwrap_or(0.0) - start).max(0.0);
            position = (t.Position().map(secs).unwrap_or(0.0) - start).max(0.0);
            updated_at = t.LastUpdatedTime().map(|d| filetime_to_unix_ms(d.UniversalTime)).unwrap_or(0);
        }
        let artist = props.Artist().map(|a| a.to_string()).unwrap_or_default();
        Some(Media {
            art_key: format!("{title}|{artist}"),
            title,
            artist,
            album: props.AlbumTitle().map(|a| a.to_string()).unwrap_or_default(),
            playing,
            app: session.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default(),
            position,
            duration,
            updated_at,
            shuffle,
            repeat,
        })
    }

    /// Album art of the current track as a data URL.
    pub fn read_art() -> Option<String> {
        let props = session()?.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?.min(4 * 1024 * 1024) as u32;
        if size == 0 {
            return None;
        }
        let input: IInputStream = windows::core::Interface::cast(&stream).ok()?;
        let buf = Buffer::Create(size).ok()?;
        let read = input.ReadAsync(&buf, size, InputStreamOptions::None).ok()?.join().ok()?;
        let len = read.Length().ok()? as usize;
        let mut bytes = vec![0u8; len];
        DataReader::FromBuffer(&read).ok()?.ReadBytes(&mut bytes).ok()?;
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
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

    pub fn media_control(action: &str, value: Option<f64>) -> Result<(), String> {
        init_thread();
        let session = session().ok_or("Nothing is playing")?;
        let op = match action {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "prev" => session.TrySkipPreviousAsync(),
            "shuffle" => {
                let on = session
                    .GetPlaybackInfo()
                    .and_then(|i| i.IsShuffleActive())
                    .and_then(|r| r.Value())
                    .unwrap_or(false);
                session.TryChangeShuffleActiveAsync(!on)
            }
            "repeat" => {
                let cur = session
                    .GetPlaybackInfo()
                    .and_then(|i| i.AutoRepeatMode())
                    .and_then(|r| r.Value())
                    .unwrap_or(Repeat::None);
                let next = match cur {
                    Repeat::None => Repeat::List,
                    Repeat::List => Repeat::Track,
                    _ => Repeat::None,
                };
                session.TryChangeAutoRepeatModeAsync(next)
            }
            "seek" => {
                let start = session.GetTimelineProperties().and_then(|t| t.StartTime()).map(|t| t.Duration).unwrap_or(0);
                session.TryChangePlaybackPositionAsync(start + (value.unwrap_or(0.0) * 10_000_000.0) as i64)
            }
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
    pub fn media_control(_action: &str, _value: Option<f64>) -> Result<(), String> {
        Err("Media controls are only available on Windows".into())
    }
    pub fn read_art() -> Option<String> {
        None
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
