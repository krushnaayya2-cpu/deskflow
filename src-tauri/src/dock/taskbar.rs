//! Hiding and restoring the Windows taskbar, and reserving screen space for
//! the dock.
//!
//! Hiding = switch the taskbar to auto-hide (so maximised windows use the
//! full screen) and hide its windows (`Shell_TrayWnd` and every
//! `Shell_SecondaryTrayWnd`, i.e. all monitors). A watchdog re-hides them if
//! Explorer brings them back (e.g. after Explorer restarts).
//!
//! Space for the dock is reserved by registering each dock window as an
//! AppBar on its own monitor (SHAppBarMessage), the same mechanism the real
//! taskbar uses, so maximised windows stop at the dock on every monitor.
//! Explorer also drops the reservation by itself if DeskFlow dies.
//!
//! The taskbar is restored when the option is turned off, when DeskFlow
//! quits (RunEvent::Exit), when it panics (hook in `diag`), on Ctrl+C /
//! console close, and when Windows logs off or shuts down (WM_ENDSESSION).
//! If DeskFlow is killed outright, the next start restores it (the original
//! auto-hide state is kept in config.json until it has been restored).

use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Mutex,
};

static HIDDEN: AtomicBool = AtomicBool::new(false);
/// Taskbar auto-hide before we touched it: 0 unknown, 1 off, 2 on.
static ORIGINAL: AtomicU8 = AtomicU8::new(0);
/// Dock windows registered as AppBars.
static APPBARS: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Screen edge the dock is attached to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
    Bottom,
}

/// Current auto-hide setting of the real taskbar.
pub fn is_autohide() -> bool {
    platform::get_autohide()
}

/// Hide the taskbar on all monitors. `original_autohide` is what to go back
/// to, kept here too so a crash handler can restore it without the app.
pub fn hide(original_autohide: bool) {
    ORIGINAL.store(if original_autohide { 2 } else { 1 }, Ordering::SeqCst);
    if !HIDDEN.swap(true, Ordering::SeqCst) {
        platform::set_autohide(true);
        platform::install_exit_guards();
        start_watchdog();
    }
    platform::hide_windows();
}

/// Show the taskbar again and restore its original auto-hide setting.
pub fn restore(original_autohide: bool) {
    let was_hidden = HIDDEN.swap(false, Ordering::SeqCst);
    platform::show_windows();
    if was_hidden || !original_autohide {
        platform::set_autohide(original_autohide);
    }
}

/// Last-resort restore for crashes, Ctrl+C and Windows shutting down:
/// release every AppBar and show the taskbar with its original setting.
pub fn emergency_restore() {
    release_all();
    match ORIGINAL.load(Ordering::SeqCst) {
        0 => {}
        o => restore(o == 2),
    }
}

/// Reserve `thickness` physical px along `edge` of the monitor rectangle
/// (left, top, right, bottom) for the dock window `hwnd`.
pub fn reserve(hwnd: isize, edge: Edge, monitor: (i32, i32, i32, i32), thickness: i32) {
    if hwnd == 0 || thickness <= 0 {
        return release(hwnd);
    }
    let mut list = APPBARS.lock().unwrap();
    let new = !list.contains(&hwnd);
    if new {
        list.push(hwnd);
        platform::install_exit_guards();
    }
    platform::appbar_set(hwnd, new, edge, monitor, thickness);
}

/// Give back the space reserved for one dock window.
pub fn release(hwnd: isize) {
    let mut list = APPBARS.lock().unwrap();
    if let Some(i) = list.iter().position(|h| *h == hwnd) {
        list.remove(i);
        platform::appbar_remove(hwnd);
    }
}

/// Give back all reserved space.
pub fn release_all() {
    let list: Vec<isize> = std::mem::take(&mut *APPBARS.lock().unwrap());
    for h in list {
        platform::appbar_remove(h);
    }
}

fn start_watchdog() {
    std::thread::Builder::new()
        .name("taskbar-watchdog".into())
        .spawn(|| {
            while HIDDEN.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                if HIDDEN.load(Ordering::SeqCst) {
                    platform::hide_windows();
                }
            }
        })
        .ok();
}

#[cfg(windows)]
mod platform {
    use super::Edge;
    use std::sync::Once;
    use windows::{
        core::{w, BOOL, PCWSTR},
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
            System::{Console::SetConsoleCtrlHandler, LibraryLoader::GetModuleHandleW},
            UI::{
                Shell::{
                    SHAppBarMessage, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABM_GETSTATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE,
                    ABM_SETPOS, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA,
                },
                WindowsAndMessaging::{
                    CreateWindowExW, DefWindowProcW, DispatchMessageW, FindWindowExW, FindWindowW, GetMessageW,
                    IsWindowVisible, RegisterClassExW, ShowWindow, TranslateMessage, MSG, SW_HIDE, SW_SHOWNOACTIVATE,
                    WINDOW_EX_STYLE, WM_ENDSESSION, WM_QUERYENDSESSION, WM_USER, WNDCLASSEXW, WS_POPUP,
                },
            },
        },
    };

    fn bars() -> Vec<HWND> {
        let mut out = Vec::new();
        unsafe {
            if let Ok(h) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
                out.push(h);
            }
            let mut prev: Option<HWND> = None;
            while let Ok(h) = FindWindowExW(None, prev, w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) {
                out.push(h);
                prev = Some(h);
            }
        }
        out
    }

    fn abd(hwnd: HWND) -> APPBARDATA {
        APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
    }

    pub fn get_autohide() -> bool {
        let mut d = abd(bars().first().copied().unwrap_or_default());
        unsafe { SHAppBarMessage(ABM_GETSTATE, &mut d) as u32 & ABS_AUTOHIDE != 0 }
    }

    pub fn set_autohide(on: bool) {
        let mut d = abd(bars().first().copied().unwrap_or_default());
        d.lParam = LPARAM((if on { ABS_AUTOHIDE } else { ABS_ALWAYSONTOP }) as isize);
        unsafe {
            SHAppBarMessage(ABM_SETSTATE, &mut d);
        }
    }

    pub fn hide_windows() {
        for h in bars() {
            unsafe {
                if IsWindowVisible(h).as_bool() {
                    let _ = ShowWindow(h, SW_HIDE);
                }
            }
        }
    }

    pub fn show_windows() {
        for h in bars() {
            unsafe {
                let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
            }
        }
    }

    /// Register (if `new`) and position an AppBar. Explorer may shrink the
    /// rectangle to make room for other bars (e.g. the visible taskbar).
    pub fn appbar_set(hwnd: isize, new: bool, edge: Edge, monitor: (i32, i32, i32, i32), thickness: i32) {
        let mut d = abd(HWND(hwnd as _));
        unsafe {
            if new {
                d.uCallbackMessage = WM_USER + 0x4446; // ignored by the webview window
                SHAppBarMessage(ABM_NEW, &mut d);
            }
            d.uEdge = match edge {
                Edge::Bottom => ABE_BOTTOM,
                Edge::Left => ABE_LEFT,
                Edge::Right => ABE_RIGHT,
            };
            let (l, t, r, b) = monitor;
            d.rc = RECT { left: l, top: t, right: r, bottom: b };
            SHAppBarMessage(ABM_QUERYPOS, &mut d);
            // QUERYPOS moved the far side in; re-apply our thickness from it.
            match edge {
                Edge::Bottom => d.rc.top = d.rc.bottom - thickness,
                Edge::Left => d.rc.right = d.rc.left + thickness,
                Edge::Right => d.rc.left = d.rc.right - thickness,
            }
            SHAppBarMessage(ABM_SETPOS, &mut d);
        }
    }

    pub fn appbar_remove(hwnd: isize) {
        let mut d = abd(HWND(hwnd as _));
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &mut d);
        }
    }

    // ---- Exit guards ---------------------------------------------------------

    unsafe extern "system" fn console_handler(_ctrl: u32) -> BOOL {
        // Ctrl+C, Ctrl+Break, console closed, logoff, shutdown.
        super::emergency_restore();
        BOOL(0) // let the default handler end the process
    }

    unsafe extern "system" fn session_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        match msg {
            WM_QUERYENDSESSION => LRESULT(1),
            WM_ENDSESSION => {
                if wp.0 != 0 {
                    super::emergency_restore();
                }
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(h, msg, wp, lp) },
        }
    }

    /// Once per process: a console control handler, plus a hidden top-level
    /// window on its own thread that hears WM_ENDSESSION (logoff/shutdown),
    /// which GUI apps otherwise never see through Tauri.
    pub fn install_exit_guards() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            unsafe {
                let _ = SetConsoleCtrlHandler(Some(console_handler), true);
            }
            let _ = std::thread::Builder::new().name("session-watch".into()).spawn(|| unsafe {
                let Ok(hinst) = GetModuleHandleW(None) else { return };
                let class = w!("DeskFlowSessionWatch");
                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    lpfnWndProc: Some(session_proc),
                    hInstance: hinst.into(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassExW(&wc);
                let Ok(_h) = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    class,
                    w!("DeskFlow session watch"),
                    WS_POPUP,
                    0,
                    0,
                    0,
                    0,
                    None,
                    None,
                    Some(hinst.into()),
                    None,
                ) else {
                    return;
                };
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            });
        });
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Edge;
    pub fn get_autohide() -> bool {
        false
    }
    pub fn set_autohide(_on: bool) {}
    pub fn hide_windows() {}
    pub fn show_windows() {}
    pub fn appbar_set(_hwnd: isize, _new: bool, _edge: Edge, _monitor: (i32, i32, i32, i32), _thickness: i32) {}
    pub fn appbar_remove(_hwnd: isize) {}
    pub fn install_exit_guards() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve_and_release_track_windows() {
        reserve(11, Edge::Bottom, (0, 0, 100, 100), 10);
        reserve(11, Edge::Bottom, (0, 0, 100, 100), 12);
        reserve(22, Edge::Left, (0, 0, 100, 100), 10);
        assert_eq!(APPBARS.lock().unwrap().len(), 2);
        release(11);
        assert_eq!(*APPBARS.lock().unwrap(), vec![22]);
        release_all();
        assert!(APPBARS.lock().unwrap().is_empty());
    }
}
