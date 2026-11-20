//! Watches the monitor layout (monitors added/removed, resolution or display
//! scaling changed) and rebuilds the island and dock windows so they stay
//! centred and sized correctly on every monitor at every DPI.
//!
//! Polling every 2 s is cheap (a handful of Win32 calls) and catches every
//! kind of change, including ones Tauri reports no window event for (a
//! monitor's scaling changing while no DeskFlow window sits on it).

use std::time::Duration;
use tauri::AppHandle;

/// Monitor rectangles plus scale (x1000), in a stable order.
type Signature = Vec<(i32, i32, u32, u32, u32)>;

fn signature(app: &AppHandle) -> Signature {
    let mut v: Signature = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height, (m.scale_factor() * 1000.0) as u32))
        .collect();
    v.sort();
    v
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("display-watch".into()).spawn(move || {
        let mut last = signature(&app);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = signature(&app);
            // An empty list happens briefly while displays reconfigure.
            if now.is_empty() || now == last {
                continue;
            }
            crate::diag::trace(&format!("displays changed: {now:?}"));
            last = now;
            // Native windows (glass) must be created on the UI thread.
            let a = app.clone();
            let _ = app.run_on_main_thread(move || {
                crate::island::rebuild(&a);
                crate::dock::rebuild(&a);
            });
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn signature_order_is_stable() {
        let mut a = vec![(1920, 0, 1920, 1080, 1000), (0, 0, 2880, 1800, 1500)];
        a.sort();
        assert_eq!(a[0].0, 0);
    }
}
