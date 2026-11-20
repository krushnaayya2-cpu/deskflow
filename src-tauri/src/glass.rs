//! Native acrylic "glass": a tiny Win32 popup with the acrylic blur-behind
//! accent policy, clipped to a rounded rectangle and placed directly under a
//! transparent webview window (the dock bar or the Dynamic Island).
//!
//! Why native: CSS `backdrop-filter` inside a transparent WebView2 window
//! only sees the webview's own (empty) pixels, never the desktop, so it
//! can't blur what is behind the window. Acrylic is composited by DWM.
//!
//! Corner fix: GDI regions are 1-bit (no anti-aliasing), so a region the
//! exact size of the CSS shape leaks jagged, square-looking pixels outside
//! the CSS shape's anti-aliased edge. `show` therefore insets the region by
//! `inset` physical pixels on every side (and shrinks the radius to match),
//! so the region's stair-stepped edge always sits *under* the CSS border.

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
    /// directly beneath `above` (the webview window it backs). The region is
    /// inset by `inset` px so no aliased corner pixel shows (see module docs).
    #[allow(clippy::too_many_arguments)]
    pub fn show(hwnd: isize, above: isize, x: i32, y: i32, w: i32, h: i32, radius: i32, inset: i32, tint: (u8, u8, u8, u8)) {
        let me = HWND(hwnd as _);
        let i = inset.max(0).min(w / 2).min(h / 2);
        let (w, h) = (w - 2 * i, h - 2 * i);
        // A pill can't have a radius larger than half its short side.
        let r = (radius - i).max(0).min(w.min(h) / 2);
        if w <= 0 || h <= 0 {
            return hide(hwnd);
        }
        unsafe {
            set_acrylic(me, tint);
            let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
            SetWindowRgn(me, Some(rgn), true);
            let _ = SetWindowPos(me, Some(HWND(above as _)), x + i, y + i, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    /// Acrylic blur-behind works from Windows 10 1803 (build 17134).
    pub fn supported() -> bool {
        use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
            .ok()
            .and_then(|b| b.parse::<u32>().ok())
            .map(|b| b >= 17134)
            .unwrap_or(false)
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
    pub fn show(_: isize, _: isize, _: i32, _: i32, _: i32, _: i32, _: i32, _: i32, _: (u8, u8, u8, u8)) {}
    pub fn supported() -> bool {
        false
    }
    pub fn hide(_: isize) {}
    pub fn destroy(_: isize) {}
}

pub use imp::*;

/// Inset (physical px) that keeps the aliased region inside a CSS shape
/// drawn with a 1px border at this display scale.
pub fn inset_for(scale: f64) -> i32 {
    (scale * 1.5).ceil() as i32
}

/// Glass tint (r, g, b, alpha) for dark or light mode. `strength` is 0-100:
/// more blur means less tint.
pub fn tint(dark: bool, strength: u32) -> (u8, u8, u8, u8) {
    let (r, g, b) = if dark { (18, 18, 26) } else { (245, 245, 250) };
    (r, g, b, ((100 - strength.min(100)) as f64 * 1.6 + 20.0).min(220.0) as u8)
}

/// Whether native acrylic can be used here (Windows 10 1803+).
#[tauri::command]
pub fn glass_supported() -> bool {
    supported()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inset_grows_with_scale() {
        assert_eq!(inset_for(1.0), 2);
        assert_eq!(inset_for(1.25), 2);
        assert_eq!(inset_for(1.5), 3);
        assert_eq!(inset_for(2.0), 3);
    }

    #[test]
    fn tint_is_lighter_with_more_blur() {
        assert!(tint(true, 90).3 < tint(true, 10).3);
        assert_eq!(tint(false, 50).0, 245);
    }
}
