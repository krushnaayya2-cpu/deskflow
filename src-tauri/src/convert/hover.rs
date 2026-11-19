//! Hover detection: when the mouse rests on a file on the desktop or in File
//! Explorer, show the round convert button next to the cursor.
//!
//! Every 120 ms we read the cursor position (cheap). Only after it has been
//! still for the configured delay do we ask Windows UI Automation what is
//! under it, and look up the folder of that Explorer window/tab.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU32, Ordering},
};
use tauri::AppHandle;

static ENABLED: AtomicBool = AtomicBool::new(false);
static DELAY_MS: AtomicU32 = AtomicU32::new(600);
/// Set while the round button is showing for the current resting point.
static SHOWN: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(on: bool, delay_ms: u32) {
    ENABLED.store(on, Ordering::SeqCst);
    DELAY_MS.store(delay_ms.clamp(200, 3000), Ordering::SeqCst);
}

pub fn forget_shown() {
    SHOWN.store(false, Ordering::SeqCst);
}

/// Pick the file an Explorer item refers to. Explorer may hide extensions,
/// so "Report" can mean "Report.pdf". Only unambiguous, convertible matches.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn resolve(folders: &[PathBuf], name: &str) -> Option<PathBuf> {
    let mut found = Vec::new();
    for dir in folders {
        let exact = dir.join(name);
        if exact.is_file() && super::kind_of(&exact).is_some() {
            return Some(exact);
        }
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_file() && p.file_stem().map(|s| s.to_string_lossy() == name).unwrap_or(false) && super::kind_of(&p).is_some() {
                found.push(p);
            }
        }
    }
    (found.len() == 1).then(|| found.remove(0))
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("convert-hover".into())
        .spawn(move || platform::run(app))
        .ok();
}

#[cfg(windows)]
mod platform {
    use super::{resolve, DELAY_MS, ENABLED, SHOWN};
    use std::{path::PathBuf, sync::atomic::Ordering, time::{Duration, Instant}};
    use tauri::{AppHandle, Manager};
    use windows::{
        core::{Interface, PWSTR},
        Win32::{
            Foundation::{HWND, POINT},
            System::{
                Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IServiceProvider, CLSCTX_ALL, COINIT_MULTITHREADED},
                Variant::VARIANT,
            },
            UI::{
                Accessibility::{CUIAutomation, IUIAutomation, UIA_DataItemControlTypeId, UIA_ListItemControlTypeId},
                Shell::{
                    FOLDERID_Desktop, FOLDERID_PublicDesktop, IFolderView, IPersistFolder2, IShellBrowser, IShellWindows,
                    IWebBrowser2, SHGetKnownFolderPath, SHGetPathFromIDListW, ShellWindows, KNOWN_FOLDER_FLAG, SID_STopLevelBrowser,
                },
                WindowsAndMessaging::{GetAncestor, GetClassNameW, GetCursorPos, WindowFromPoint, GA_ROOT},
            },
        },
    };

    fn class_of(h: HWND) -> String {
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn known(id: &windows::core::GUID) -> Option<PathBuf> {
        unsafe {
            let p: PWSTR = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None).ok()?;
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as _));
            s.map(PathBuf::from)
        }
    }

    /// Folders shown in an Explorer window (one per tab on Windows 11).
    fn explorer_folders(root: HWND) -> Vec<PathBuf> {
        let mut out = Vec::new();
        unsafe {
            let Ok(sw) = CoCreateInstance::<_, IShellWindows>(&ShellWindows, None, CLSCTX_ALL) else { return out };
            let n = sw.Count().unwrap_or(0);
            for i in 0..n {
                let Ok(disp) = sw.Item(&VARIANT::from(i)) else { continue };
                let Ok(wb) = disp.cast::<IWebBrowser2>() else { continue };
                if wb.HWND().map(|h| h.0) != Ok(root.0 as isize) {
                    continue;
                }
                let path = (|| -> windows::core::Result<PathBuf> {
                    let sp: IServiceProvider = wb.cast()?;
                    let sb: IShellBrowser = sp.QueryService(&SID_STopLevelBrowser)?;
                    let fv: IFolderView = sb.QueryActiveShellView()?.cast()?;
                    let pf: IPersistFolder2 = fv.GetFolder()?;
                    let pidl = pf.GetCurFolder()?;
                    let mut buf = [0u16; 260];
                    let ok = SHGetPathFromIDListW(pidl, &mut buf).as_bool();
                    CoTaskMemFree(Some(pidl as _));
                    if !ok {
                        return Err(windows::core::Error::empty());
                    }
                    let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
                    Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
                })();
                if let Ok(p) = path {
                    out.push(p);
                }
            }
        }
        out
    }

    /// Name of the file item under the point, if any.
    fn item_name(uia: &IUIAutomation, pt: POINT) -> Option<String> {
        unsafe {
            let mut el = uia.ElementFromPoint(pt).ok()?;
            let walker = uia.ControlViewWalker().ok()?;
            // The point may be on the item's text cell; walk up a little.
            for _ in 0..3 {
                let ct = el.CurrentControlType().ok()?;
                if ct == UIA_ListItemControlTypeId || ct == UIA_DataItemControlTypeId {
                    let name = el.CurrentName().ok()?.to_string();
                    return (!name.is_empty()).then_some(name);
                }
                el = walker.GetParentElement(&el).ok()?;
            }
            None
        }
    }

    pub fn run(app: AppHandle) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let uia: Option<IUIAutomation> = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL).ok() };
        let Some(uia) = uia else { return };
        let mut last = POINT::default();
        let mut still_since = Instant::now();
        let mut checked = false;
        let mut anchor: Option<POINT> = None;
        loop {
            std::thread::sleep(Duration::from_millis(120));
            if !ENABLED.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(600));
                continue;
            }
            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }
            // Hide the button once the mouse wanders away from it.
            if let Some(a) = anchor {
                let (dx, dy) = ((pt.x - a.x) as f64, (pt.y - a.y) as f64);
                if (dx * dx + dy * dy).sqrt() > 110.0 && SHOWN.load(Ordering::SeqCst) {
                    let mode = app.state::<super::super::ConvertState>().pending.lock().unwrap().1;
                    if mode == "button" {
                        super::super::hide(&app);
                    }
                    anchor = None;
                }
            }
            if (pt.x - last.x).abs() > 3 || (pt.y - last.y).abs() > 3 {
                last = pt;
                still_since = Instant::now();
                checked = false;
                continue;
            }
            if checked || still_since.elapsed() < Duration::from_millis(DELAY_MS.load(Ordering::SeqCst) as u64) || SHOWN.load(Ordering::SeqCst) {
                continue;
            }
            checked = true;
            let root = unsafe { GetAncestor(WindowFromPoint(pt), GA_ROOT) };
            let class = class_of(root);
            let folders: Vec<PathBuf> = match class.as_str() {
                "Progman" | "WorkerW" => [known(&FOLDERID_Desktop), known(&FOLDERID_PublicDesktop)].into_iter().flatten().collect(),
                "CabinetWClass" => explorer_folders(root),
                _ => continue,
            };
            let Some(name) = item_name(&uia, pt) else { continue };
            let Some(file) = resolve(&folders, &name) else { continue };
            SHOWN.store(true, Ordering::SeqCst);
            anchor = Some(pt);
            // Button sits just below-right of the cursor.
            super::super::show_at(&app, vec![file], "button", Some(((pt.x + 34) as f64, (pt.y + 34) as f64)));
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn run(_app: tauri::AppHandle) {
        let _ = (&super::SHOWN, &super::DELAY_MS, &super::ENABLED);
    }
}

#[cfg(test)]
mod tests {
    use super::resolve;

    #[test]
    fn resolves_hidden_extensions_unambiguously() {
        let d = std::env::temp_dir().join(format!("df-hover-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("Report.pdf"), b"x").unwrap();
        std::fs::write(d.join("Photo.png"), b"x").unwrap();
        std::fs::write(d.join("Photo.jpg"), b"x").unwrap();
        std::fs::write(d.join("notes.txt"), b"x").unwrap();
        let f = [d.clone()];
        assert_eq!(resolve(&f, "Report.pdf"), Some(d.join("Report.pdf")));
        assert_eq!(resolve(&f, "Report"), Some(d.join("Report.pdf")));
        assert_eq!(resolve(&f, "Photo"), None); // ambiguous
        assert_eq!(resolve(&f, "notes"), None); // not convertible
    }
}
