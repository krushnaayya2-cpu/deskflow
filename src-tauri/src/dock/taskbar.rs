//! Hiding and restoring the Windows taskbar.
//!
//! Hiding = switch the taskbar to auto-hide (so maximised windows use the
//! full screen) and hide its window. A watchdog re-hides it if Explorer
//! brings it back (e.g. after Explorer restarts). Optionally the bottom of
//! the screen is reserved for the dock so maximised windows don't go under
//! it. Everything is undone when DeskFlow quits or the option is turned off,
//! and the taskbar's original auto-hide setting is restored.

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

static HIDDEN: AtomicBool = AtomicBool::new(false);
/// Pixels reserved at the bottom of the primary screen (0 = none).
static RESERVE: AtomicI32 = AtomicI32::new(0);

/// Current auto-hide setting of the real taskbar.
pub fn is_autohide() -> bool {
    platform::get_autohide()
}

/// Hide the taskbar. `reserve_px` keeps that many physical pixels at the
/// bottom of the primary screen free for the dock (0 for none).
pub fn hide(reserve_px: i32) {
    RESERVE.store(reserve_px, Ordering::SeqCst);
    if !HIDDEN.swap(true, Ordering::SeqCst) {
        platform::set_autohide(true);
        start_watchdog();
    }
    platform::hide_windows();
    platform::reserve_bottom(reserve_px);
}

/// Show the taskbar again and restore its original auto-hide setting.
pub fn restore(original_autohide: bool) {
    let was_hidden = HIDDEN.swap(false, Ordering::SeqCst);
    RESERVE.store(0, Ordering::SeqCst);
    platform::show_windows();
    if was_hidden || !original_autohide {
        platform::set_autohide(original_autohide);
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
                    platform::reserve_bottom(RESERVE.load(Ordering::SeqCst));
                }
            }
        })
        .ok();
}

#[cfg(windows)]
mod platform {
    use windows::{
        core::{w, PCWSTR},
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            UI::{
                Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA},
                WindowsAndMessaging::{
                    FindWindowExW, FindWindowW, GetSystemMetrics, IsWindowVisible, ShowWindow,
                    SystemParametersInfoW, SM_CXSCREEN, SM_CYSCREEN, SPIF_SENDCHANGE, SPI_GETWORKAREA,
                    SPI_SETWORKAREA, SW_HIDE, SW_SHOWNOACTIVATE,
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

    fn abd() -> APPBARDATA {
        APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: bars().first().copied().unwrap_or_default(),
            ..Default::default()
        }
    }

    pub fn get_autohide() -> bool {
        let mut d = abd();
        unsafe { SHAppBarMessage(ABM_GETSTATE, &mut d) as u32 & ABS_AUTOHIDE != 0 }
    }

    pub fn set_autohide(on: bool) {
        let mut d = abd();
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

    /// Shrink the primary work area so maximised windows stop above the dock.
    pub fn reserve_bottom(px: i32) {
        unsafe {
            let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
            let want = RECT { left: 0, top: 0, right: w, bottom: h - px.max(0) };
            let mut cur = RECT::default();
            let _ = SystemParametersInfoW(SPI_GETWORKAREA, 0, Some(&mut cur as *mut _ as *mut _), Default::default());
            if cur != want {
                let mut r = want;
                let _ = SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&mut r as *mut _ as *mut _), SPIF_SENDCHANGE);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn get_autohide() -> bool {
        false
    }
    pub fn set_autohide(_on: bool) {}
    pub fn hide_windows() {}
    pub fn show_windows() {}
    pub fn reserve_bottom(_px: i32) {}
}
