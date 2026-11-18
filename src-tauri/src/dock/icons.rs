//! App icons for the dock, as PNG data URLs.
//!
//! Uses the shell's "jumbo" (256 px) icon when the app has one, otherwise the
//! 48 px version, so icons stay sharp when magnified. Results are cached in
//! memory for the session.

use base64::Engine;
use std::{collections::HashMap, sync::Mutex};

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// Data URL (`data:image/png;base64,...`) for a file's icon. `hwnd` is a
/// fallback for apps whose exe has no usable icon (some Store apps).
pub fn icon_data_url(path: &str, hwnd: Option<i64>) -> Option<String> {
    let key = format!("{}|{}", path.to_lowercase(), hwnd.unwrap_or(0));
    if let Some(hit) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&key) {
        return hit.clone();
    }
    let rgba = platform::file_icon(path).or_else(|| hwnd.and_then(platform::window_icon));
    let url = rgba.and_then(|(w, h, px)| encode_png(w, h, &px)).map(|png| {
        format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
    });
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, url.clone());
    url
}

fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

/// Bounding box of non-transparent pixels: (max_x, max_y).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn content_extent(w: u32, h: u32, rgba: &[u8]) -> (u32, u32) {
    let (mut mx, mut my) = (0, 0);
    for y in 0..h {
        for x in 0..w {
            if rgba[((y * w + x) * 4 + 3) as usize] > 8 {
                mx = mx.max(x + 1);
                my = my.max(y + 1);
            }
        }
    }
    (mx, my)
}

#[cfg(windows)]
mod platform {
    use super::content_extent;
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::{HWND, LPARAM, WPARAM},
            Graphics::Gdi::{
                CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
            UI::{
                Controls::{IImageList, ILD_TRANSPARENT},
                Shell::{SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX, SHIL_EXTRALARGE, SHIL_JUMBO},
                WindowsAndMessaging::{
                    DestroyIcon, GetClassLongPtrW, GetIconInfo, SendMessageTimeoutW, GCLP_HICON, HICON, ICONINFO,
                    ICON_BIG, SMTO_ABORTIFHUNG, WM_GETICON,
                },
            },
        },
    };

    type Rgba = (u32, u32, Vec<u8>);

    /// Copy an HICON's pixels out as RGBA.
    fn hicon_rgba(icon: HICON) -> Option<Rgba> {
        unsafe {
            let mut ii = ICONINFO::default();
            GetIconInfo(icon, &mut ii).ok()?;
            let result = (|| {
                let mut bm = BITMAP::default();
                if GetObjectW(HGDIOBJ(ii.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
                    return None;
                }
                let (w, h) = (bm.bmWidth as u32, bm.bmHeight as u32);
                if w == 0 || h == 0 {
                    return None;
                }
                let mut bmi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w as i32,
                        biHeight: -(h as i32), // top-down rows
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut px = vec![0u8; (w * h * 4) as usize];
                let dc = CreateCompatibleDC(None);
                let lines = GetDIBits(dc, ii.hbmColor, 0, h, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
                let _ = DeleteDC(dc);
                if lines == 0 {
                    return None;
                }
                // BGRA -> RGBA. Icons without an alpha channel are opaque.
                let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
                for p in px.chunks_exact_mut(4) {
                    p.swap(0, 2);
                    if !has_alpha {
                        p[3] = 255;
                    }
                }
                Some((w, h, px))
            })();
            let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
            result
        }
    }

    fn from_image_list(list: i32, index: i32) -> Option<Rgba> {
        unsafe {
            let il: IImageList = SHGetImageList(list).ok()?;
            let icon = il.GetIcon(index, ILD_TRANSPARENT.0).ok()?;
            let out = hicon_rgba(icon);
            let _ = DestroyIcon(icon);
            out
        }
    }

    pub fn file_icon(path: &str) -> Option<Rgba> {
        crate::dock::apps::init_thread();
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                &HSTRING::from(path),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info as *mut SHFILEINFOW),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_SYSICONINDEX,
            )
        };
        if ok == 0 {
            return None;
        }
        // Many apps only ship small icons; the jumbo list then holds a tiny
        // icon in the corner of a 256 px canvas. Use the 48 px one instead.
        if let Some((w, h, px)) = from_image_list(SHIL_JUMBO as i32, info.iIcon) {
            let (cx, cy) = content_extent(w, h, &px);
            if cx > 64 || cy > 64 {
                return Some((w, h, px));
            }
        }
        from_image_list(SHIL_EXTRALARGE as i32, info.iIcon)
    }

    /// The icon a window shows in its title bar (shared; not destroyed).
    pub fn window_icon(hwnd: i64) -> Option<Rgba> {
        unsafe {
            let h = HWND(hwnd as _);
            let mut res = 0usize;
            let _ = SendMessageTimeoutW(h, WM_GETICON, WPARAM(ICON_BIG as usize), LPARAM(0), SMTO_ABORTIFHUNG, 200, Some(&mut res as *mut usize));
            if res == 0 {
                res = GetClassLongPtrW(h, GCLP_HICON);
            }
            (res != 0).then(|| hicon_rgba(HICON(res as _))).flatten()
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn file_icon(_path: &str) -> Option<(u32, u32, Vec<u8>)> {
        None
    }
    pub fn window_icon(_hwnd: i64) -> Option<(u32, u32, Vec<u8>)> {
        None
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn extent_and_png() {
        let mut px = vec![0u8; 4 * 4 * 4];
        px[((2 * 4 + 1) * 4 + 3) as usize] = 255; // pixel (1,2)
        assert_eq!(super::content_extent(4, 4, &px), (2, 3));
        assert!(super::encode_png(4, 4, &px).is_some());
    }
}
