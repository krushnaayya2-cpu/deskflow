//! Running apps for the dock, and actions on their windows.
//!
//! A background thread lists top-level app windows (~1.4x per second),
//! groups them by executable, and emits `dock://running` only when the list
//! changes. Pinned shortcuts are resolved to their target .exe so a pinned
//! app and its running windows share one dock icon.

use crate::config::PinnedApp;
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

pub const EV_RUNNING: &str = "dock://running";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppWindow {
    pub hwnd: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    /// Executable path as Windows reports it.
    pub path: String,
    /// Lower-case path: the key used to match pinned apps.
    pub key: String,
    pub name: String,
    pub windows: Vec<AppWindow>,
    /// One of its windows is in the foreground.
    pub focused: bool,
}

#[derive(Default)]
pub struct AppsState {
    running: Mutex<Vec<RunningApp>>,
}

pub fn start(app: &AppHandle) {
    app.manage(AppsState::default());
    let app = app.clone();
    std::thread::Builder::new()
        .name("dock-apps".into())
        .spawn(move || {
            platform::init_thread();
            loop {
                let mut next = platform::list_running();
                let state = app.state::<AppsState>();
                {
                    let mut cur = state.running.lock().unwrap();
                    // Keep previous order so icons don't jump when focus changes.
                    next.sort_by_key(|a| cur.iter().position(|c| c.key == a.key).unwrap_or(usize::MAX));
                    if *cur != next {
                        *cur = next.clone();
                        drop(cur);
                        let _ = app.emit(EV_RUNNING, &next);
                    }
                }
                std::thread::sleep(Duration::from_millis(700));
            }
        })
        .expect("spawn dock apps thread");
}

pub fn snapshot(app: &AppHandle) -> Vec<RunningApp> {
    app.try_state::<AppsState>()
        .map(|s| s.running.lock().unwrap().clone())
        .unwrap_or_default()
}

/// Friendly names for common apps whose exe names are cryptic.
pub fn known_name(stem: &str) -> Option<&'static str> {
    Some(match stem.to_ascii_lowercase().as_str() {
        "explorer" => "File Explorer",
        "msedge" => "Microsoft Edge",
        "chrome" => "Google Chrome",
        "firefox" => "Firefox",
        "code" => "Visual Studio Code",
        "winword" => "Word",
        "excel" => "Excel",
        "powerpnt" => "PowerPoint",
        "outlook" | "olk" => "Outlook",
        "ms-teams" | "teams" => "Microsoft Teams",
        "windowsterminal" => "Terminal",
        "notepad" => "Notepad",
        "mspaint" => "Paint",
        "systemsettings" => "Settings",
        _ => return None,
    })
}

/// File name without folder or extension; handles `\` on any OS.
pub fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    name.rsplit_once('.').map(|(s, _)| s).filter(|s| !s.is_empty()).unwrap_or(name)
}

/// Name from the file name: "my-app.exe" -> "My-app".
pub fn stem_name(path: &str) -> String {
    let stem = file_stem(path);
    if let Some(k) = known_name(stem) {
        return k.into();
    }
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Shortcuts pinned to the Windows taskbar, to seed the dock on first run.
pub fn taskbar_pins() -> Vec<PinnedApp> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return Vec::new() };
    let dir = std::path::Path::new(&appdata)
        .join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
    let mut out: Vec<PinnedApp> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")))
        .map(|p| pinned_from_path(&p.to_string_lossy()))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Build a pinned entry from an .exe or .lnk path.
pub fn pinned_from_path(path: &str) -> PinnedApp {
    let is_lnk = path.to_ascii_lowercase().ends_with(".lnk");
    let (target, args) = if is_lnk {
        platform::resolve_lnk(path).unwrap_or_default()
    } else {
        (path.to_string(), String::new())
    };
    let name = if is_lnk {
        file_stem(path).to_string()
    } else {
        platform::file_description(path).unwrap_or_else(|| stem_name(path))
    };
    PinnedApp { name, path: path.into(), target: target.to_lowercase(), args }
}

/// Start-menu shortcuts, for the "Add app" picker in settings.
pub fn installed_apps() -> Vec<PinnedApp> {
    let mut roots = Vec::new();
    if let Some(p) = std::env::var_os("ProgramData") {
        roots.push(std::path::Path::new(&p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Some(p) = std::env::var_os("APPDATA") {
        roots.push(std::path::Path::new(&p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    let mut out = Vec::new();
    for root in roots {
        walk_lnks(&root, 0, &mut out);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    out
}

fn walk_lnks(dir: &std::path::Path, depth: u32, out: &mut Vec<PinnedApp>) {
    if depth > 3 {
        return;
    }
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_lnks(&p, depth + 1, out);
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
            let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let lower = name.to_lowercase();
            // Skip uninstallers, readmes and help links.
            if ["uninstall", "readme", "help", "documentation", "website"].iter().any(|w| lower.contains(w)) {
                continue;
            }
            out.push(PinnedApp { name, path: p.to_string_lossy().into(), target: String::new(), args: String::new() });
        }
    }
}

pub use platform::{activate, close_all, init_thread, open_start_menu};

#[cfg(windows)]
mod platform {
    use super::{stem_name, AppWindow, RunningApp};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use windows::{
        core::{Interface, BOOL, HSTRING, PWSTR},
        Win32::{
            Foundation::{CloseHandle, HWND, LPARAM, WPARAM},
            Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, WIN32_FIND_DATAW},
            System::{
                Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ},
                Threading::{
                    AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess,
                    QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
            UI::{
                Input::KeyboardAndMouse::{keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_LWIN},
                Shell::{IShellLinkW, ShellLink},
                WindowsAndMessaging::{
                    BringWindowToTop, EnumChildWindows, EnumWindows, GetForegroundWindow, GetWindow,
                    GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
                    IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow, ShowWindow, GWL_EXSTYLE,
                    GW_OWNER, SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WS_EX_TOOLWINDOW,
                },
            },
        },
    };

    pub fn init_thread() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
    }

    unsafe extern "system" fn collect(hwnd: HWND, lp: LPARAM) -> BOOL {
        let v = unsafe { &mut *(lp.0 as *mut Vec<HWND>) };
        v.push(hwnd);
        BOOL(1)
    }

    fn top_windows() -> Vec<HWND> {
        let mut v: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut v as *mut _ as isize));
        }
        v
    }

    fn child_windows(parent: HWND) -> Vec<HWND> {
        let mut v: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumChildWindows(Some(parent), Some(collect), LPARAM(&mut v as *mut _ as isize));
        }
        v
    }

    /// A window that would appear on the taskbar.
    fn is_app_window(h: HWND) -> bool {
        unsafe {
            if !IsWindowVisible(h).as_bool() || GetWindowTextLengthW(h) == 0 {
                return false;
            }
            if let Ok(owner) = GetWindow(h, GW_OWNER) {
                if !owner.is_invalid() {
                    return false;
                }
            }
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TOOLWINDOW.0 != 0 {
                return false;
            }
            let mut cloaked: u32 = 0;
            if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok() && cloaked != 0 {
                return false;
            }
            true
        }
    }

    fn title(h: HWND) -> String {
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn pid_of(h: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid
    }

    static PATHS: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);

    fn exe_path(pid: u32) -> Option<String> {
        let mut cache = PATHS.lock().unwrap();
        let cache = cache.get_or_insert_with(HashMap::new);
        if let Some(p) = cache.get(&pid) {
            return Some(p.clone());
        }
        let path = unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(h);
            r.ok()?;
            String::from_utf16_lossy(&buf[..len as usize])
        };
        if cache.len() > 512 {
            cache.clear();
        }
        cache.insert(pid, path.clone());
        Some(path)
    }

    /// Store apps show their window through ApplicationFrameHost; find the
    /// real app process from its child window.
    fn uwp_path(host: HWND, host_pid: u32) -> Option<String> {
        child_windows(host)
            .into_iter()
            .map(pid_of)
            .find(|p| *p != host_pid)
            .and_then(exe_path)
    }

    static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    fn display_name(path: &str) -> String {
        let mut names = NAMES.lock().unwrap();
        let names = names.get_or_insert_with(HashMap::new);
        names
            .entry(path.to_string())
            .or_insert_with(|| {
                let stem = std::path::Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
                super::known_name(stem)
                    .map(String::from)
                    .or_else(|| file_description(path))
                    .unwrap_or_else(|| stem_name(path))
            })
            .clone()
    }

    /// "FileDescription" from the exe's version resource, e.g. "Spotify".
    pub fn file_description(path: &str) -> Option<String> {
        unsafe {
            let wpath = HSTRING::from(path);
            let size = GetFileVersionInfoSizeW(&wpath, None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(&wpath, None, size, data.as_mut_ptr() as *mut _).ok()?;
            let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut len = 0u32;
            if !VerQueryValueW(data.as_ptr() as *const _, &HSTRING::from("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool() || len < 4 {
                return None;
            }
            let lang = *(ptr as *const u16);
            let cp = *((ptr as *const u16).add(1));
            let key = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription");
            if !VerQueryValueW(data.as_ptr() as *const _, &HSTRING::from(key), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
            let s = String::from_utf16_lossy(s).trim_end_matches('\0').trim().to_string();
            (!s.is_empty() && s.len() < 60).then_some(s)
        }
    }

    pub fn list_running() -> Vec<RunningApp> {
        let me = unsafe { GetCurrentProcessId() };
        let fg = unsafe { GetForegroundWindow() };
        let mut apps: Vec<RunningApp> = Vec::new();
        for h in top_windows() {
            if !is_app_window(h) {
                continue;
            }
            let pid = pid_of(h);
            if pid == me {
                continue;
            }
            let Some(mut path) = exe_path(pid) else { continue };
            if path.to_lowercase().ends_with("\\applicationframehost.exe") {
                match uwp_path(h, pid) {
                    Some(p) => path = p,
                    None => continue,
                }
            }
            let key = path.to_lowercase();
            let win = AppWindow { hwnd: h.0 as i64, title: title(h) };
            let focused = h == fg;
            match apps.iter_mut().find(|a| a.key == key) {
                Some(a) => {
                    a.windows.push(win);
                    a.focused |= focused;
                }
                None => apps.push(RunningApp {
                    name: display_name(&path),
                    path,
                    key,
                    windows: vec![win],
                    focused,
                }),
            }
        }
        apps
    }

    fn force_foreground(h: HWND) {
        unsafe {
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            if SetForegroundWindow(h).as_bool() {
                return;
            }
            // Windows only lets the foreground app hand focus away; borrow
            // its input queue briefly so the switch is allowed.
            let fg = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg, None);
            let me = GetCurrentThreadId();
            let _ = AttachThreadInput(me, fg_thread, true);
            let _ = BringWindowToTop(h);
            let _ = SetForegroundWindow(h);
            let _ = AttachThreadInput(me, fg_thread, false);
        }
    }

    /// Dock icon click on a running app: focus it, or minimise it if it's
    /// already in front, or cycle through its windows.
    pub fn activate(key: &str) -> Result<(), String> {
        let apps = list_running();
        let app = apps.iter().find(|a| a.key == key).ok_or("App is not running")?;
        let wins: Vec<HWND> = app.windows.iter().map(|w| HWND(w.hwnd as _)).collect();
        let fg = unsafe { GetForegroundWindow() };
        if let Some(i) = wins.iter().position(|w| *w == fg) {
            if wins.len() == 1 {
                unsafe {
                    let _ = ShowWindow(fg, SW_MINIMIZE);
                }
            } else {
                // Windows are listed front-to-back: bring the next one up.
                force_foreground(wins[(i + 1) % wins.len()]);
            }
        } else {
            force_foreground(wins[0]);
        }
        Ok(())
    }

    pub fn close_all(key: &str) -> Result<(), String> {
        for a in list_running().iter().filter(|a| a.key == key) {
            for w in &a.windows {
                unsafe {
                    let _ = PostMessageW(Some(HWND(w.hwnd as _)), WM_CLOSE, WPARAM(0), LPARAM(0));
                }
            }
        }
        Ok(())
    }

    pub fn open_start_menu() {
        unsafe {
            keybd_event(VK_LWIN.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
            keybd_event(VK_LWIN.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    /// Target exe and arguments of a .lnk shortcut.
    pub fn resolve_lnk(path: &str) -> Option<(String, String)> {
        unsafe {
            init_thread();
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let file: IPersistFile = link.cast().ok()?;
            file.Load(&HSTRING::from(path), STGM_READ).ok()?;
            let mut target = [0u16; 1024];
            let mut fd = WIN32_FIND_DATAW::default();
            link.GetPath(&mut target, &mut fd, 0).ok()?;
            let mut args = [0u16; 1024];
            let _ = link.GetArguments(&mut args);
            let z = |b: &[u16]| String::from_utf16_lossy(&b[..b.iter().position(|c| *c == 0).unwrap_or(b.len())]);
            Some((z(&target), z(&args)))
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::RunningApp;
    pub fn init_thread() {}
    pub fn list_running() -> Vec<RunningApp> {
        Vec::new()
    }
    pub fn file_description(_path: &str) -> Option<String> {
        None
    }
    pub fn activate(_key: &str) -> Result<(), String> {
        Err("Only supported on Windows".into())
    }
    pub fn close_all(_key: &str) -> Result<(), String> {
        Err("Only supported on Windows".into())
    }
    pub fn open_start_menu() {}
    pub fn resolve_lnk(_path: &str) -> Option<(String, String)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_paths() {
        assert_eq!(stem_name(r"C:\Windows\explorer.exe"), "File Explorer");
        assert_eq!(stem_name(r"C:\x\spotify.exe"), "Spotify");
        assert_eq!(stem_name(r"C:\x\Code.exe"), "Visual Studio Code");
    }

    #[test]
    fn pinned_exe_uses_lowercase_target() {
        let p = pinned_from_path(r"C:\Apps\MyTool.exe");
        assert_eq!(p.target, r"c:\apps\mytool.exe");
        assert_eq!(p.name, "MyTool");
    }
}
