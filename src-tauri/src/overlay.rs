//! Click-through overlay windows (Dynamic Island, dock).
//!
//! These windows are bigger than what they draw (room for animations and
//! menus) and must let clicks fall through to the desktop everywhere except
//! over their visible parts. The UI reports those parts as rectangles; a light
//! background thread compares the cursor with them every 40 ms and toggles
//! click-through. It only does work when the hover state changes.

use serde::Deserialize;
use std::{collections::HashMap, sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Window label prefixes that get hover tracking.
pub const PREFIXES: &[&str] = &["island-", "dock-"];
/// Sent to a window whenever the cursor enters or leaves its rectangles.
pub const EV_HOVER: &str = "overlay://hover";

/// Rectangle in logical (CSS) pixels inside the window.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }

    /// Distance from a point to the rectangle (0 inside).
    fn distance(&self, x: f64, y: f64) -> f64 {
        let dx = (self.x - x).max(0.0).max(x - (self.x + self.w));
        let dy = (self.y - y).max(0.0).max(y - (self.y + self.h));
        (dx * dx + dy * dy).sqrt()
    }
}

/// How long to wait before the next check: fast near an overlay (smooth
/// hover), slow when the cursor is far away (near-zero idle CPU).
fn next_delay(nearest_px: f64) -> Duration {
    Duration::from_millis(if nearest_px < 120.0 { 30 } else if nearest_px < 500.0 { 80 } else { 180 })
}

#[derive(Default)]
pub struct OverlayState {
    rects: Mutex<HashMap<String, Vec<HitRect>>>,
    hovered: Mutex<HashMap<String, bool>>,
}

pub fn init(app: &AppHandle) {
    app.manage(OverlayState::default());
    start_thread(app.clone());
}

/// Forget a window's rectangles (when it is closed or recreated).
pub fn forget(app: &AppHandle, label: &str) {
    if let Some(s) = app.try_state::<OverlayState>() {
        s.rects.lock().unwrap().remove(label);
        s.hovered.lock().unwrap().remove(label);
    }
}

pub fn is_overlay(label: &str) -> bool {
    PREFIXES.iter().any(|p| label.starts_with(p))
}

fn start_thread(app: AppHandle) {
    thread::Builder::new()
        .name("overlay-hover".into())
        .spawn(move || {
            let mut delay = Duration::from_millis(100);
            loop {
            thread::sleep(delay);
            let windows: Vec<WebviewWindow> = app
                .webview_windows()
                .into_iter()
                .filter(|(l, _)| is_overlay(l))
                .map(|(_, w)| w)
                .collect();
            if windows.is_empty() {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let Ok(cursor) = app.cursor_position() else { continue };
            let state = app.state::<OverlayState>();
            let rects = state.rects.lock().unwrap().clone();
            let mut hovered = state.hovered.lock().unwrap();
            let mut nearest = f64::MAX;
            for w in windows {
                let label = w.label().to_string();
                let Some(rs) = rects.get(&label) else { continue };
                let (Ok(origin), Ok(scale)) = (w.outer_position(), w.scale_factor()) else {
                    continue;
                };
                let lx = (cursor.x - origin.x as f64) / scale;
                let ly = (cursor.y - origin.y as f64) / scale;
                let inside = rs.iter().any(|r| r.contains(lx, ly));
                nearest = rs.iter().map(|r| r.distance(lx, ly) * scale).fold(nearest, f64::min);
                if hovered.get(&label).copied() != Some(inside) {
                    hovered.insert(label.clone(), inside);
                    let _ = w.set_ignore_cursor_events(!inside);
                    let _ = w.emit_to(label.as_str(), EV_HOVER, inside);
                    crate::windows::set_low_memory(&w, !inside);
                }
            }
            delay = next_delay(nearest);
            }
        })
        .expect("spawn overlay hover thread");
}

/// The UI reports where its visible, clickable parts are.
#[tauri::command]
pub fn overlay_set_hit_rects(window: WebviewWindow, rects: Vec<HitRect>) {
    if let Some(state) = window.try_state::<OverlayState>() {
        state.rects.lock().unwrap().insert(window.label().to_string(), rects);
    }
}

/// Make a window not take keyboard focus when clicked, and hide it from
/// Alt+Tab. Used for the island and dock.
pub fn make_no_activate(w: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        no_activate_hwnd(h.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = w;
}

#[cfg(windows)]
pub fn no_activate_hwnd(hwnd: isize) {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    };
    {
        let hwnd = HWND(hwnd as _);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize,
            );
        }
    }
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn no_activate_hwnd(_hwnd: isize) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_and_delay() {
        let r = HitRect { x: 10.0, y: 10.0, w: 100.0, h: 20.0 };
        assert_eq!(r.distance(50.0, 20.0), 0.0);
        assert_eq!(r.distance(0.0, 20.0), 10.0);
        assert_eq!(next_delay(0.0), Duration::from_millis(30));
        assert_eq!(next_delay(1000.0), Duration::from_millis(180));
    }
}
