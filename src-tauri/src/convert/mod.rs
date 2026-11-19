//! Hover-to-convert: options per file type, a background job queue, and the
//! small "convert" window (round button → radial menu → progress ring).
//!
//! Ways in: hovering a file on the desktop / in File Explorer (`hover`),
//! "Convert with DeskFlow" in the right-click menu (`shell_menu`), the
//! floating drop zone, or "Convert files…" in settings.

mod hover;
pub mod ops;
pub mod shell_menu;
pub mod tools;

use crate::config::Config;
use crate::island::{emit_event, IslandEvent};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tools::Tool;

pub const WINDOW: &str = "convert";
pub const DROPZONE: &str = "dropzone";
const WIN_SIZE: f64 = 360.0;
pub const EV_JOB: &str = "convert://job";
pub const EV_PENDING: &str = "convert://pending";

// ---- Options ------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Pdf,
    Word,
    Slides,
    Sheet,
    Video,
    Audio,
}

pub fn kind_of(path: &std::path::Path) -> Option<Kind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tif" | "tiff" => Kind::Image,
        "pdf" => Kind::Pdf,
        "doc" | "docx" | "odt" | "rtf" => Kind::Word,
        "ppt" | "pptx" | "odp" => Kind::Slides,
        "xls" | "xlsx" | "ods" | "csv" => Kind::Sheet,
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "flv" | "m4v" => Kind::Video,
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "wma" | "opus" => Kind::Audio,
        _ => return None,
    })
}

/// Every extension DeskFlow can convert (used for the right-click menu).
#[cfg_attr(not(windows), allow(dead_code))]
pub const SUPPORTED_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "pdf", "doc", "docx", "odt", "rtf", "ppt", "pptx", "odp",
    "xls", "xlsx", "ods", "csv", "mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "m4v", "mp3", "wav", "flac", "m4a",
    "aac", "ogg", "wma", "opus",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvOption {
    pub id: &'static str,
    pub label: String,
    /// Icon hint for the UI.
    pub icon: &'static str,
    /// External tool it needs, if any.
    pub tool: Option<Tool>,
    pub available: bool,
}

fn opt(id: &'static str, label: &str, icon: &'static str, tool: Option<Tool>) -> ConvOption {
    ConvOption { id, label: label.into(), icon, available: tool.map(|t| tools::find(t).is_some()).unwrap_or(true), tool }
}

pub fn options_for(files: &[PathBuf]) -> Vec<ConvOption> {
    let kinds: Vec<Option<Kind>> = files.iter().map(|f| kind_of(f)).collect();
    let Some(Some(kind)) = kinds.first().copied() else { return vec![] };
    if kinds.iter().any(|k| *k != Some(kind)) {
        return vec![];
    }
    let all_ext = |e: &[&str]| {
        files.iter().all(|f| f.extension().and_then(|x| x.to_str()).map(|x| e.contains(&x.to_ascii_lowercase().as_str())).unwrap_or(false))
    };
    let many = files.len() > 1;
    let mut v = Vec::new();
    match kind {
        Kind::Image => {
            if !all_ext(&["png"]) { v.push(opt("png", "PNG", "image", None)); }
            if !all_ext(&["jpg", "jpeg"]) { v.push(opt("jpg", "JPG", "image", None)); }
            if !all_ext(&["webp"]) { v.push(opt("webp", "WebP", "image", None)); }
            v.push(opt("img-pdf", if many { "One PDF" } else { "PDF" }, "pdf", None));
        }
        Kind::Pdf => {
            v.push(opt("pdf-docx", "Word", "doc", Some(Tool::LibreOffice)));
            v.push(opt("pdf-jpg", "JPG", "image", Some(Tool::Poppler)));
            v.push(opt("pdf-compress", "Compress", "compress", None));
            if many { v.push(opt("pdf-merge", "Merge", "merge", None)); }
        }
        Kind::Word | Kind::Slides | Kind::Sheet => v.push(opt("office-pdf", "PDF", "pdf", Some(Tool::LibreOffice))),
        Kind::Video => {
            v.push(opt("mp3", "MP3", "audio", Some(Tool::Ffmpeg)));
            if !all_ext(&["mp4"]) { v.push(opt("mp4", "MP4", "video", Some(Tool::Ffmpeg))); }
            v.push(opt("gif", "GIF", "image", Some(Tool::Ffmpeg)));
            v.push(opt("wav", "WAV", "audio", Some(Tool::Ffmpeg)));
        }
        Kind::Audio => {
            if !all_ext(&["mp3"]) { v.push(opt("mp3", "MP3", "audio", Some(Tool::Ffmpeg))); }
            if !all_ext(&["wav"]) { v.push(opt("wav", "WAV", "audio", Some(Tool::Ffmpeg))); }
            if !all_ext(&["m4a"]) { v.push(opt("m4a", "M4A", "audio", Some(Tool::Ffmpeg))); }
        }
    }
    v
}

// ---- Jobs -------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdate {
    pub id: u64,
    pub label: String,
    /// "queued" | "running" | "done" | "error"
    pub state: &'static str,
    /// 0..1, or -1 when the tool doesn't report progress.
    pub progress: f64,
    pub outputs: Vec<String>,
    pub error: Option<String>,
}

struct Job {
    id: u64,
    files: Vec<PathBuf>,
    option: String,
}

#[derive(Default)]
pub struct ConvertState {
    tx: Mutex<Option<mpsc::Sender<Job>>>,
    next_id: Mutex<u64>,
    /// Files waiting in the convert window, and its mode ("button"/"menu").
    pending: Mutex<(Vec<PathBuf>, &'static str)>,
    /// Bumped whenever the window is shown, to cancel delayed clean-ups.
    generation: Mutex<u64>,
    /// Files collected from several "--convert" launches (multi-select).
    incoming: Mutex<Vec<PathBuf>>,
}

pub fn init(app: &AppHandle, cfg: &Config) {
    app.manage(ConvertState::default());
    let (tx, rx) = mpsc::channel::<Job>();
    *app.state::<ConvertState>().tx.lock().unwrap() = Some(tx);
    let worker_app = app.clone();
    std::thread::Builder::new()
        .name("convert-worker".into())
        .spawn(move || {
            for job in rx {
                run_job(&worker_app, job);
            }
        })
        .expect("spawn convert worker");
    sync(app, cfg);
}

/// Apply converter settings (right-click menu, drop zone).
pub fn sync(app: &AppHandle, cfg: &Config) {
    let on = cfg.converter.enabled;
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    if on && cfg.converter.context_menu {
        let _ = shell_menu::install(&exe);
    } else {
        let _ = shell_menu::uninstall();
    }
    hover::set_enabled(on && cfg.converter.hover_button, cfg.converter.hover_delay_ms);
    if on && cfg.converter.hover_button {
        // The hover thread only exists once the feature is used.
        static HOVER: std::sync::Once = std::sync::Once::new();
        let app = app.clone();
        HOVER.call_once(move || hover::start(app));
    }
    if !on {
        if let Some(w) = app.get_webview_window(WINDOW) {
            let _ = w.destroy();
        }
    }
    let dz = app.get_webview_window(DROPZONE);
    match (on && cfg.converter.drop_zone, dz) {
        (true, None) => create_dropzone(app),
        (false, Some(w)) => {
            let _ = w.destroy();
        }
        _ => {}
    }
}

fn job_label(option: &str, files: &[PathBuf]) -> String {
    let name = files.first().and_then(|f| f.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let what = options_for(files).into_iter().find(|o| o.id == option).map(|o| o.label).unwrap_or_else(|| option.into());
    if files.len() > 1 { format!("{} files → {what}", files.len()) } else { format!("{name} → {what}") }
}

pub fn enqueue(app: &AppHandle, files: Vec<PathBuf>, option: String) -> Result<u64, String> {
    let state = app.state::<ConvertState>();
    let id = {
        let mut n = state.next_id.lock().unwrap();
        *n += 1;
        *n
    };
    let _ = app.emit(EV_JOB, JobUpdate { id, label: job_label(&option, &files), state: "queued", progress: 0.0, outputs: vec![], error: None });
    state.tx.lock().unwrap().as_ref().ok_or("Converter not ready")?.send(Job { id, files, option }).map_err(|e| e.to_string())?;
    Ok(id)
}

fn run_job(app: &AppHandle, job: Job) {
    let label = job_label(&job.option, &job.files);
    let emit = |state: &'static str, progress: f64, outputs: Vec<String>, error: Option<String>| {
        let _ = app.emit(EV_JOB, JobUpdate { id: job.id, label: label.clone(), state, progress, outputs, error });
    };
    let indeterminate = matches!(job.option.as_str(), "office-pdf" | "pdf-docx" | "pdf-jpg");
    emit("running", if indeterminate { -1.0 } else { 0.0 }, vec![], None);
    let profile = app
        .path()
        .app_local_data_dir()
        .map(|d| d.join("libreoffice-profile"))
        .unwrap_or_else(|_| std::env::temp_dir().join("deskflow-lo"));

    let n = job.files.len().max(1) as f64;
    let result: Result<Vec<PathBuf>, String> = (|| {
        let per_file = |i: usize, f: &dyn Fn(&PathBuf, &dyn Fn(f64)) -> Result<PathBuf, String>| {
            let p = &job.files[i];
            let report = |x: f64| emit("running", (i as f64 + x) / n, vec![], None);
            f(p, &report)
        };
        let each = |f: &dyn Fn(&PathBuf, &dyn Fn(f64)) -> Result<PathBuf, String>| -> Result<Vec<PathBuf>, String> {
            (0..job.files.len()).map(|i| per_file(i, f)).collect()
        };
        let report_all = |x: f64| emit("running", x, vec![], None);
        match job.option.as_str() {
            ext @ ("png" | "jpg" | "webp") if kind_of(&job.files[0]) == Some(Kind::Image) => each(&|p, _| ops::image_to(p, ext)),
            "img-pdf" => Ok(vec![ops::images_to_pdf(&job.files, &report_all)?]),
            "pdf-merge" => Ok(vec![ops::merge_pdfs(&job.files, &report_all)?]),
            "pdf-compress" => each(&|p, _| ops::compress_pdf(p)),
            "pdf-jpg" => each(&|p, _| ops::pdf_to_jpg(p)),
            "pdf-docx" => each(&|p, _| ops::office(p, "docx:MS Word 2007 XML", "docx", true, &profile)),
            "office-pdf" => each(&|p, _| ops::office(p, "pdf", "pdf", false, &profile)),
            "mp3" => each(&|p, r| ops::ffmpeg(p, "mp3", &["-vn", "-c:a", "libmp3lame", "-q:a", "2"], r)),
            "wav" => each(&|p, r| ops::ffmpeg(p, "wav", &["-vn", "-c:a", "pcm_s16le"], r)),
            "m4a" => each(&|p, r| ops::ffmpeg(p, "m4a", &["-vn", "-c:a", "aac", "-b:a", "192k"], r)),
            "mp4" => each(&|p, r| {
                ops::ffmpeg(p, "mp4", &["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"], r)
            }),
            "gif" => each(&|p, r| ops::ffmpeg(p, "gif", &["-vf", "fps=12,scale=480:-1:flags=lanczos", "-loop", "0"], r)),
            other => Err(format!("Unknown conversion {other:?}")),
        }
    })();

    match result {
        Ok(outs) => {
            let outs: Vec<String> = outs.iter().map(|p| p.display().to_string()).collect();
            emit("done", 1.0, outs.clone(), None);
            let first = outs.first().cloned();
            let name = first.as_deref().and_then(|p| std::path::Path::new(p).file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            emit_event(
                app,
                IslandEvent::Notify {
                    title: "Converted".into(),
                    body: if outs.len() > 1 { format!("{} files saved next to the originals", outs.len()) } else { name },
                    path: first,
                },
            );
        }
        Err(e) => {
            emit("error", 0.0, vec![], Some(e.clone()));
            emit_event(app, IslandEvent::Notify { title: "Conversion failed".into(), body: e, path: None });
        }
    }
}

// ---- Convert window -----------------------------------------------------------------

/// Show the convert window centred on a screen point (physical px).
/// `mode` is "button" (small round button) or "menu" (radial menu).
pub fn show_at(app: &AppHandle, files: Vec<PathBuf>, mode: &'static str, at: Option<(f64, f64)>) {
    let state = app.state::<ConvertState>();
    *state.pending.lock().unwrap() = (files, mode);
    *state.generation.lock().unwrap() += 1;
    let (x, y) = at.or_else(|| app.cursor_position().ok().map(|p| (p.x, p.y))).unwrap_or((400.0, 400.0));
    let scale = app.monitor_from_point(x, y).ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let half = WIN_SIZE * scale / 2.0;
    let pos = PhysicalPosition::new((x - half) as i32, (y - half) as i32);

    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.set_position(pos);
        let _ = w.show();
        let _ = w.emit_to(WINDOW, EV_PENDING, ());
        return;
    }
    let built = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("convert.html".into()))
        .title("DeskFlow Convert")
        .inner_size(WIN_SIZE, WIN_SIZE)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .additional_browser_args(crate::windows::BROWSER_ARGS)
        .focused(false)
        .visible(false)
        .build();
    match built {
        Ok(w) => {
            let _ = w.set_position(pos);
            crate::overlay::make_no_activate(&w);
            let _ = w.show();
            let _ = w.set_ignore_cursor_events(true);
        }
        Err(e) => log::warn!("convert window: {e}"),
    }
}

/// Hide the convert window; destroy it if unused for two minutes so it
/// costs no memory between conversions.
pub fn hide(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let _ = w.hide();
    hover::forget_shown();
    let state = app.state::<ConvertState>();
    let gen = *state.generation.lock().unwrap();
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        let state = app.state::<ConvertState>();
        if *state.generation.lock().unwrap() == gen {
            if let Some(w) = app.get_webview_window(WINDOW) {
                if !w.is_visible().unwrap_or(false) {
                    crate::overlay::forget(&app, WINDOW);
                    let _ = w.destroy();
                }
            }
        }
    });
}

fn create_dropzone(app: &AppHandle) {
    let Ok(Some(m)) = app.primary_monitor() else { return };
    let scale = m.scale_factor();
    let size = 78.0;
    let area = m.work_area();
    let x = area.position.x + area.size.width as i32 - ((size + 14.0) * scale) as i32;
    let y = area.position.y + (area.size.height as i32) / 2 - ((size / 2.0) * scale) as i32;
    let built = WebviewWindowBuilder::new(app, DROPZONE, WebviewUrl::App("convert.html?dropzone".into()))
        .title("DeskFlow Drop Zone")
        .inner_size(size, size)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .additional_browser_args(crate::windows::BROWSER_ARGS)
        .focused(false)
        .build();
    if let Ok(w) = built {
        let _ = w.set_position(PhysicalPosition::new(x, y));
        crate::overlay::make_no_activate(&w);
        crate::windows::set_low_memory(&w, true);
    }
}

/// Files passed on the command line by the right-click menu. Several files
/// selected together arrive as several launches; gather them for a moment
/// and open one menu for all of them.
pub fn handle_args(app: &AppHandle, args: &[String]) {
    let Some(i) = args.iter().position(|a| a == "--convert") else { return };
    if !app.state::<crate::config::ConfigStore>().get().converter.enabled {
        return;
    }
    let files: Vec<PathBuf> = args[i + 1..].iter().map(PathBuf::from).filter(|p| p.is_file()).collect();
    if files.is_empty() {
        return;
    }
    let state = app.state::<ConvertState>();
    let first = {
        let mut inc = state.incoming.lock().unwrap();
        let was_empty = inc.is_empty();
        inc.extend(files);
        was_empty
    };
    if first {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            let files = std::mem::take(&mut *app.state::<ConvertState>().incoming.lock().unwrap());
            show_at(&app, files, "menu", None);
        });
    }
}

// ---- Commands -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    files: Vec<String>,
    mode: &'static str,
    options: Vec<ConvOption>,
}

#[tauri::command]
pub fn convert_pending(app: AppHandle) -> Pending {
    let (files, mode) = app.state::<ConvertState>().pending.lock().unwrap().clone();
    Pending { options: options_for(&files), files: files.iter().map(|p| p.display().to_string()).collect(), mode }
}

#[tauri::command]
pub fn convert_expand(app: AppHandle) {
    app.state::<ConvertState>().pending.lock().unwrap().1 = "menu";
    hover::forget_shown();
}

#[tauri::command]
pub fn convert_start(app: AppHandle, files: Vec<String>, option: String) -> Result<u64, String> {
    enqueue(&app, files.into_iter().map(PathBuf::from).collect(), option)
}

#[tauri::command]
pub fn convert_close(app: AppHandle) {
    hide(&app);
}

/// Open the radial menu for some files (drop zone, settings, tests).
#[tauri::command]
pub fn convert_open(app: AppHandle, files: Vec<String>) {
    let files: Vec<PathBuf> = files.into_iter().map(PathBuf::from).filter(|p| p.is_file()).collect();
    if !files.is_empty() {
        show_at(&app, files, "menu", None);
    }
}

/// "Convert files…" in settings: pick files, then open the menu.
#[tauri::command]
pub async fn convert_pick(app: AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_files() else { return };
    let files: Vec<PathBuf> = picked.into_iter().filter_map(|f| f.into_path().ok()).collect();
    if !files.is_empty() {
        let center = app.primary_monitor().ok().flatten().map(|m| {
            let (p, s) = (m.position(), m.size());
            (p.x as f64 + s.width as f64 / 2.0, p.y as f64 + s.height as f64 / 2.0)
        });
        show_at(&app, files, "menu", center);
    }
}

#[tauri::command]
pub fn convert_tools() -> Vec<tools::ToolStatus> {
    tools::status()
}

#[tauri::command]
pub async fn convert_install(tool: Tool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tools::install(tool)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_depend_on_file_types() {
        let ids = |f: &[&str]| options_for(&f.iter().map(PathBuf::from).collect::<Vec<_>>()).into_iter().map(|o| o.id).collect::<Vec<_>>();
        assert_eq!(ids(&["a.png"]), vec!["jpg", "webp", "img-pdf"]);
        assert!(ids(&["a.pdf", "b.pdf"]).contains(&"pdf-merge"));
        assert!(!ids(&["a.pdf"]).contains(&"pdf-merge"));
        assert_eq!(ids(&["a.docx"]), vec!["office-pdf"]);
        assert!(ids(&["a.mp4"]).contains(&"mp3"));
        assert!(ids(&["a.png", "b.pdf"]).is_empty());
        assert!(ids(&["notes.txt"]).is_empty());
    }
}
