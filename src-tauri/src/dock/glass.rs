//! Native acrylic "glass" window that sits directly under the dock bar.
//!
//! A tiny Win32 popup with the acrylic blur-behind accent policy, clipped to
//! the bar's rounded rectangle. Created on the main (UI) thread.

#[cfg(windows)]
mod imp {
    use std::sync::Once;
    use windows::{
        core::{s, w, BOOL, PCWSTR},
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, WPARAM},
            Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn},
            System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, ShowWindow,
                MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WM_MOUSEACTIVATE, WNDCLASSEXW,
                WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
            },
        },
    };

    const CLASS: PCWSTR = w!("DeskFlowDockGlass");

    unsafe extern "system" fn wndproc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_MOUSEACTIVATE {
            return LRESULT(MA_NOACTIVATE as isize);
        }
        unsafe { DefWindowProcW(h, msg, wp, lp) }
    }

    fn register() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| unsafe {
            let hinst = GetModuleHandleW(None).unwrap_or_default();
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: hinst.into(),
                lpszClassName: CLASS,
                ..Default::default()
            };
            RegisterClassExW(&wc);
        });
    }

    pub fn create() -> Option<isize> {
        register();
        unsafe {
            let hinst = GetModuleHandleW(None).ok()?;
            let h = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
                CLASS,
                w!("DeskFlow Dock Glass"),
                WS_POPUP,
                0,
                0,
                1,
                1,
                None,
                None,
                Some(hinst.into()),
                None,
            )
            .ok()?;
            Some(h.0 as isize)
        }
    }

    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        gradient: u32,
        animation: u32,
    }

    #[repr(C)]
    struct CompositionData {
        attribute: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }

    type SetWca = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;

    /// Acrylic blur with a tint (ARGB as r, g, b, a).
    fn set_acrylic(h: HWND, (r, g, b, a): (u8, u8, u8, u8)) {
        unsafe {
            let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else { return };
            let Some(f) = GetProcAddress(user32, s!("SetWindowCompositionAttribute")) else { return };
            let f: SetWca = std::mem::transmute(f);
            let mut policy = AccentPolicy {
                state: 4, // ACCENT_ENABLE_ACRYLICBLURBEHIND
                flags: 2,
                gradient: (a as u32) << 24 | (b as u32) << 16 | (g as u32) << 8 | r as u32,
                animation: 0,
            };
            let mut data = CompositionData {
                attribute: 19, // WCA_ACCENT_POLICY
                data: &mut policy as *mut _ as *mut _,
                size: std::mem::size_of::<AccentPolicy>(),
            };
            f(h, &mut data);
        }
    }

    /// Place the glass at (x, y, w, h) in physical pixels, rounded, tinted,
    /// directly beneath `above` (the dock window).
    pub fn show(hwnd: isize, above: isize, x: i32, y: i32, w: i32, h: i32, radius: i32, tint: (u8, u8, u8, u8)) {
        let me = HWND(hwnd as _);
        unsafe {
            set_acrylic(me, tint);
            let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, radius * 2, radius * 2);
            SetWindowRgn(me, Some(rgn), true);
            let _ = SetWindowPos(me, Some(HWND(above as _)), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    pub fn hide(hwnd: isize) {
        unsafe {
            let _ = ShowWindow(HWND(hwnd as _), SW_HIDE);
        }
    }

    pub fn destroy(hwnd: isize) {
        unsafe {
            let _ = DestroyWindow(HWND(hwnd as _));
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn create() -> Option<isize> {
        None
    }
    #[allow(clippy::too_many_arguments)]
    pub fn show(_: isize, _: isize, _: i32, _: i32, _: i32, _: i32, _: i32, _: (u8, u8, u8, u8)) {}
    pub fn hide(_: isize) {}
    pub fn destroy(_: isize) {}
}

pub use imp::*;
