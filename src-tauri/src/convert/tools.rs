//! External converters: where to find them and how to install them.
//! Installation uses winget (built into Windows 11) and is only started when
//! the user clicks "Install" in settings or in the convert menu.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    /// Word/PowerPoint/Excel ↔ PDF.
    LibreOffice,
    /// Audio and video.
    Ffmpeg,
    /// PDF → images (pdftoppm).
    Poppler,
}

impl Tool {
    pub const ALL: [Tool; 3] = [Tool::LibreOffice, Tool::Ffmpeg, Tool::Poppler];

    pub fn label(self) -> &'static str {
        match self {
            Tool::LibreOffice => "LibreOffice",
            Tool::Ffmpeg => "FFmpeg",
            Tool::Poppler => "Poppler",
        }
    }

    fn winget_id(self) -> &'static str {
        match self {
            Tool::LibreOffice => "TheDocumentFoundation.LibreOffice",
            Tool::Ffmpeg => "Gyan.FFmpeg",
            Tool::Poppler => "oschwartz10612.Poppler",
        }
    }

    fn exe(self) -> &'static str {
        match self {
            Tool::LibreOffice => "soffice.exe",
            Tool::Ffmpeg => "ffmpeg.exe",
            Tool::Poppler => "pdftoppm.exe",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub tool: Tool,
    pub label: &'static str,
    pub purpose: &'static str,
    pub path: Option<String>,
}

pub fn status() -> Vec<ToolStatus> {
    Tool::ALL
        .iter()
        .map(|t| ToolStatus {
            tool: *t,
            label: t.label(),
            purpose: match t {
                Tool::LibreOffice => "Word, PowerPoint and Excel to PDF; PDF to Word",
                Tool::Ffmpeg => "Video and audio (MP4 to MP3, GIF, WAV…)",
                Tool::Poppler => "PDF pages to JPG images",
            },
            path: find(*t).map(|p| p.display().to_string()),
        })
        .collect()
}

/// Search PATH, the usual install folders and winget's package folders.
pub fn find(tool: Tool) -> Option<PathBuf> {
    let exe = tool.exe();
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(exe);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut fixed: Vec<PathBuf> = Vec::new();
    if tool == Tool::LibreOffice {
        for pf in [env("ProgramFiles"), env("ProgramFiles(x86)")].into_iter().flatten() {
            fixed.push(pf.join(r"LibreOffice\program\soffice.exe"));
        }
    }
    if let Some(local) = env("LOCALAPPDATA") {
        fixed.push(local.join(r"Microsoft\WinGet\Links").join(exe));
    }
    if let Some(p) = fixed.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    // winget portable packages: %LOCALAPPDATA%\Microsoft\WinGet\Packages\<id>_*\...
    let pkgs = env("LOCALAPPDATA")?.join(r"Microsoft\WinGet\Packages");
    std::fs::read_dir(&pkgs)
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(tool.winget_id()))
        .find_map(|e| search(&e.path(), exe, 0))
}

fn search(dir: &Path, exe: &str, depth: u32) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    let entries: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().collect();
    if let Some(e) = entries.iter().find(|e| e.file_name().eq_ignore_ascii_case(exe)) {
        return Some(e.path());
    }
    entries.iter().filter(|e| e.path().is_dir()).find_map(|e| search(&e.path(), exe, depth + 1))
}

/// Install a tool with winget. Blocks until winget finishes.
pub fn install(tool: Tool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("winget")
            .args(["install", "--id", tool.winget_id(), "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| format!("Couldn't start winget ({e}). Install {} manually.", tool.label()))?;
        if find(tool).is_some() {
            return Ok(());
        }
        let msg = String::from_utf8_lossy(&out.stdout);
        let last = msg.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        Err(format!("{} didn't install. {last}", tool.label()))
    }
    #[cfg(not(windows))]
    {
        Err(format!("Install {} with your package manager.", tool.label()))
    }
}
