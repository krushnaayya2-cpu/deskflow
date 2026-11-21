//! Grabs the screen pixels behind an overlay window, so the UI can refract
//! them (the Liquid Glass look bends what is behind the island, which CSS
//! cannot do: inside a transparent window `backdrop-filter` has nothing to
//! work with).
//!
//! Our own overlay windows are marked `WDA_EXCLUDEFROMCAPTURE`, so they do
//! not appear in the grab — otherwise each frame would refract the previous
//! one and smear. That flag also hides those windows from screen recording
//! and screenshots by other apps, so it is only set while refraction is on,
//! and the setting says so.
//!
//! The grab is a StretchBlt straight into a small bitmap (long edge capped
//! at ~256 px), which both costs little and gives the frosted blur for
//! free; the shader samples it with linear filtering.

#[cfg(windows)]
mod imp {
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
            ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
            DIB_RGB_COLORS, HALFTONE, HGDIOBJ, SRCCOPY,
        },
        UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE},
    };

    /// Hide (or stop hiding) a window from screen capture.
    pub fn exclude(hwnd: isize, on: bool) -> bool {
        unsafe {
            SetWindowDisplayAffinity(HWND(hwnd as _), if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }).is_ok()
        }
    }

    /// Screen rectangle (physical px) scaled into a `dw` x `dh` RGBA buffer.
    pub fn grab(x: i32, y: i32, w: i32, h: i32, dw: i32, dh: i32) -> Option<Vec<u8>> {
        if w <= 0 || h <= 0 || dw <= 0 || dh <= 0 {
            return None;
        }
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, dw, dh);
            let old = SelectObject(mem, HGDIOBJ(bmp.0));

            SetStretchBltMode(mem, HALFTONE);
            let ok = if dw == w && dh == h {
                BitBlt(mem, 0, 0, dw, dh, Some(screen), x, y, SRCCOPY).is_ok()
            } else {
                StretchBlt(mem, 0, 0, dw, dh, Some(screen), x, y, w, h, SRCCOPY).as_bool()
            };

            let mut out = vec![0u8; (dw * dh * 4) as usize];
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: dw,
                    // Negative height: top-down rows, the order the web wants.
                    biHeight: -dh,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let got = ok
                && GetDIBits(mem, bmp, 0, dh as u32, Some(out.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS) != 0;

            SelectObject(mem, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);

            if !got {
                return None;
            }
            // BGRA (GDI) -> RGBA, and GDI leaves alpha at 0.
            for px in out.chunks_exact_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }
            Some(out)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn exclude(_hwnd: isize, _on: bool) -> bool {
        false
    }
    pub fn grab(_x: i32, _y: i32, _w: i32, _h: i32, _dw: i32, _dh: i32) -> Option<Vec<u8>> {
        None
    }
}



/// Longest edge of the grabbed image. Enough detail that the bending at
/// the rim is visible; at 256 the background was already mush, so the
/// curve had nothing to show.
const MAX_EDGE: i32 = 512;

/// Target size for a capture of `w` x `h` physical px.
pub fn target_size(w: i32, h: i32, max_edge: i32) -> (i32, i32) {
    let long = w.max(h).max(1);
    if long <= max_edge {
        return (w.max(1), h.max(1));
    }
    let f = max_edge as f64 / long as f64;
    (((w as f64 * f).round() as i32).max(1), ((h as f64 * f).round() as i32).max(1))
}

/// What the UI needs to map the image back onto the window.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    /// PNG data URL of the pixels behind this window.
    pub url: String,
    /// Pixel size of the image.
    pub w: i32,
    pub h: i32,
}

/// Capture what is behind this overlay window (its whole rectangle, so the
/// mapping stays valid while the island morphs inside it).
#[tauri::command]
pub fn capture_behind(window: tauri::WebviewWindow) -> Option<Shot> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let pos = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        let (w, h) = (size.width as i32, size.height as i32);
        let (dw, dh) = target_size(w, h, MAX_EDGE);
        let rgba = imp::grab(pos.x, pos.y, w, h, dw, dh)?;

        let mut png = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png, dw as u32, dh as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            // Speed over size: this runs several times a second.
            enc.set_compression(png::Compression::Fast);
            let mut w = enc.write_header().ok()?;
            w.write_image_data(&rgba).ok()?;
        }
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        let _ = window.app_handle();
        Some(Shot { url: format!("data:image/png;base64,{b64}"), w: dw, h: dh })
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

/// Keep this window out of (or back in) other apps' screen captures.
#[tauri::command]
pub fn set_capture_excluded(window: tauri::WebviewWindow, excluded: bool) -> bool {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        if hwnd == 0 {
            return false;
        }
        imp::exclude(hwnd, excluded)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, excluded);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::target_size;

    #[test]
    fn small_regions_are_not_scaled() {
        assert_eq!(target_size(200, 100, 256), (200, 100));
    }

    #[test]
    fn long_edge_is_capped_and_aspect_kept() {
        assert_eq!(target_size(1000, 500, 256), (256, 128));
        assert_eq!(target_size(500, 1000, 256), (128, 256));
    }

    #[test]
    fn never_collapses_to_zero() {
        let (w, h) = target_size(4000, 3, 256);
        assert!(w >= 1 && h >= 1);
    }
}
