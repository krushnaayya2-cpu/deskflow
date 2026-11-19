//! Live resource usage of DeskFlow (the app plus its WebView2 helper
//! processes), shown in Settings → About so performance can be checked
//! without Task Manager.

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    /// Working set of all DeskFlow processes, in MB.
    pub memory_mb: f64,
    /// Private (committed) memory, in MB.
    pub private_mb: f64,
    /// CPU use since the previous call, as % of the whole machine.
    pub cpu_percent: f64,
    pub processes: u32,
    /// Seconds from process start to the end of setup.
    pub startup_secs: f64,
}

static STARTUP: std::sync::OnceLock<f64> = std::sync::OnceLock::new();

/// Record how long startup took (call once, at the end of setup).
pub fn mark_started(since: std::time::Instant) {
    let _ = STARTUP.set(since.elapsed().as_secs_f64());
}

#[tauri::command]
pub async fn perf_stats() -> PerfStats {
    let mut s = tauri::async_runtime::spawn_blocking(imp::sample).await.unwrap_or_default();
    s.startup_secs = STARTUP.get().copied().unwrap_or(0.0);
    s
}

#[cfg(windows)]
mod imp {
    use super::PerfStats;
    use std::{collections::HashMap, sync::Mutex, time::Instant};
    use windows::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::{
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
            ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX},
            Threading::{GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    };

    static LAST: Mutex<Option<(Instant, u64)>> = Mutex::new(None);

    /// This process and every process it (transitively) started.
    fn family() -> Vec<u32> {
        let me = unsafe { GetCurrentProcessId() };
        let mut parent: HashMap<u32, u32> = HashMap::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return vec![me] };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    parent.insert(e.th32ProcessID, e.th32ParentProcessID);
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        let mut out = vec![me];
        let mut i = 0;
        while i < out.len() {
            let p = out[i];
            out.extend(parent.iter().filter(|(c, pp)| **pp == p && **c != p && !out.contains(c)).map(|(c, _)| *c).collect::<Vec<_>>());
            i += 1;
        }
        out
    }

    fn ft(f: FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    pub fn sample() -> PerfStats {
        let pids = family();
        let (mut ws, mut private, mut cpu_ticks) = (0u64, 0u64, 0u64);
        for pid in &pids {
            unsafe {
                let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, *pid) else { continue };
                let mut m = PROCESS_MEMORY_COUNTERS_EX { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32, ..Default::default() };
                if GetProcessMemoryInfo(h, &mut m as *mut _ as *mut PROCESS_MEMORY_COUNTERS, m.cb).is_ok() {
                    ws += m.WorkingSetSize as u64;
                    private += m.PrivateUsage as u64;
                }
                let (mut c, mut e, mut k, mut u) = Default::default();
                if GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u).is_ok() {
                    cpu_ticks += ft(k) + ft(u);
                }
                let _ = CloseHandle(h);
            }
        }
        let now = Instant::now();
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
        let mut last = LAST.lock().unwrap();
        let cpu = match *last {
            Some((t, ticks)) if cpu_ticks >= ticks => {
                let wall = now.duration_since(t).as_secs_f64();
                if wall > 0.0 { (cpu_ticks - ticks) as f64 / 1e7 / wall / cores * 100.0 } else { 0.0 }
            }
            _ => 0.0,
        };
        *last = Some((now, cpu_ticks));
        PerfStats {
            memory_mb: ws as f64 / 1_048_576.0,
            private_mb: private as f64 / 1_048_576.0,
            cpu_percent: cpu,
            processes: pids.len() as u32,
            startup_secs: 0.0,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::PerfStats;
    pub fn sample() -> PerfStats {
        PerfStats { processes: 1, ..Default::default() }
    }
}
