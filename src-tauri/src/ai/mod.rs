//! AI apps: background tasks and notifications from Claude (or any app),
//! shown in the Dynamic Island, plus the dock's AI section.
//!
//! Apps talk to DeskFlow through a small HTTP API on 127.0.0.1 only (see
//! `server`). A task moves through running → permission → completed /
//! attention; permission answers (Allow / Deny) go back to the app, which
//! waits for them with a long-poll request.

mod server;

use crate::config::{Config, ConfigStore, PinnedApp};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

pub const EV_TASKS: &str = "ai://tasks";
pub const EV_NOTIFY: &str = "ai://notify";
const HISTORY_MAX: usize = 100;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Running,
    Permission,
    Completed,
    Attention,
}

/// A background task as shown on the island.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    /// App name, e.g. "Claude".
    pub app: String,
    /// Optional group/product tag shown above the island (e.g. "PC Customizer").
    pub tag: String,
    /// Headline: "Organizing files", "Move 12 files to Archive?", "12 files organized".
    pub title: String,
    pub detail: String,
    pub status: Status,
    pub step: Option<u32>,
    pub steps: Option<u32>,
    /// Names of the steps, for the Task map style.
    pub step_labels: Vec<String>,
    /// File, folder or URL opened by "View result" / "Review".
    pub result: Option<String>,
    /// "allow" / "deny" once the user has answered a permission request.
    pub decision: Option<String>,
    pub updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub app: String,
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HistoryItem {
    Task(Task),
    Notification(Notification),
}

#[derive(Default)]
pub struct AiState {
    tasks: Mutex<Vec<Task>>,
    decided: Condvar,
    history: Mutex<Vec<HistoryItem>>,
    server: Mutex<Option<server::Handle>>,
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn init(app: &AppHandle, cfg: &Config) {
    app.manage(AiState::default());
    // First run: create the API token and look for AI apps.
    let store = app.state::<ConfigStore>();
    let mut c = store.get();
    let mut changed = false;
    if c.ai.api_token.is_empty() {
        c.ai.api_token = uuid::Uuid::new_v4().simple().to_string();
        changed = true;
    }
    if !c.ai.apps_scanned {
        c.ai.apps = detect_apps();
        c.ai.apps_scanned = true;
        changed = true;
    }
    if changed {
        let _ = store.set(c);
    }
    let _ = cfg;
    sync(app, &app.state::<ConfigStore>().get());
}

/// Start/stop/restart the API server to match the config.
pub fn sync(app: &AppHandle, cfg: &Config) {
    let state = app.state::<AiState>();
    let mut srv = state.server.lock().unwrap();
    let want = cfg.ai.api_enabled.then(|| (cfg.ai.api_port, cfg.ai.api_token.clone()));
    let have = srv.as_ref().map(|h| (h.port, h.token.clone()));
    if want == have {
        return;
    }
    if let Some(h) = srv.take() {
        h.stop();
    }
    if let Some((port, token)) = want {
        match server::start(app.clone(), port, token) {
            Ok(h) => *srv = Some(h),
            Err(e) => log::warn!("AI API could not start on port {port}: {e}"),
        }
    }
}

/// Known AI apps among the Start menu shortcuts.
pub fn detect_apps() -> Vec<PinnedApp> {
    const NAMES: &[&str] = &[
        "claude", "chatgpt", "gemini", "copilot", "ollama", "perplexity", "lm studio", "cursor", "deepseek", "grok", "msty",
        "poe", "jan", "windsurf",
    ];
    let mut out: Vec<PinnedApp> = crate::dock::apps::installed_apps()
        .into_iter()
        .filter(|a| {
            let n = a.name.to_lowercase();
            NAMES.iter().any(|k| n == *k || n.starts_with(&format!("{k} ")) || n.split_whitespace().any(|w| w == *k))
        })
        .filter(|a| !a.name.to_lowercase().contains("uninstall"))
        .collect();
    out.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    for a in out.iter_mut() {
        *a = crate::dock::apps::pinned_from_path(&a.path);
    }
    out
}

fn emit_tasks(app: &AppHandle) {
    let tasks = app.state::<AiState>().tasks.lock().unwrap().clone();
    let _ = app.emit(EV_TASKS, &tasks);
}

fn push_history(app: &AppHandle, item: HistoryItem) {
    let state = app.state::<AiState>();
    let mut h = state.history.lock().unwrap();
    // A task's latest state replaces its earlier entry.
    if let HistoryItem::Task(t) = &item {
        h.retain(|x| !matches!(x, HistoryItem::Task(o) if o.id == t.id));
    }
    h.insert(0, item);
    h.truncate(HISTORY_MAX);
}

/// Create or update a task. Returns its id.
pub fn upsert_task(app: &AppHandle, mut t: Task) -> String {
    if t.id.is_empty() {
        t.id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    }
    if t.app.is_empty() {
        t.app = "AI".into();
    }
    t.updated = now();
    let state = app.state::<AiState>();
    {
        let mut tasks = state.tasks.lock().unwrap();
        match tasks.iter_mut().find(|x| x.id == t.id) {
            Some(x) => {
                // A new permission request clears an earlier answer.
                if t.status == Status::Permission && x.status != Status::Permission {
                    x.decision = None;
                }
                let decision = x.decision.clone();
                *x = Task { decision: t.decision.clone().or(decision), ..t.clone() };
            }
            None => tasks.push(t.clone()),
        }
        // Keep the list short: finished tasks older than 10 minutes go.
        let cutoff = now().saturating_sub(10 * 60 * 1000);
        tasks.retain(|x| matches!(x.status, Status::Running | Status::Permission) || x.updated > cutoff);
    }
    if matches!(t.status, Status::Completed | Status::Attention | Status::Permission) {
        push_history(app, HistoryItem::Task(t.clone()));
    }
    emit_tasks(app);
    t.id
}

pub fn notify(app: &AppHandle, mut n: Notification) {
    if n.id.is_empty() {
        n.id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    }
    n.at = now();
    push_history(app, HistoryItem::Notification(n.clone()));
    let dnd = app.state::<ConfigStore>().get().ai.dnd;
    if !dnd {
        let _ = app.emit(EV_NOTIFY, &n);
    }
}

pub fn remove_task(app: &AppHandle, id: &str) {
    app.state::<AiState>().tasks.lock().unwrap().retain(|t| t.id != id);
    emit_tasks(app);
}

/// Wait (up to `timeout`) for the user's answer to a permission request.
pub fn wait_decision(app: &AppHandle, id: &str, timeout: Duration) -> Option<String> {
    let state = app.state::<AiState>();
    let tasks = state.tasks.lock().unwrap();
    let (tasks, _) = state
        .decided
        .wait_timeout_while(tasks, timeout, |ts| ts.iter().find(|t| t.id == id).map(|t| t.decision.is_none()).unwrap_or(false))
        .unwrap();
    tasks.iter().find(|t| t.id == id).and_then(|t| t.decision.clone())
}

// ---- Claude Code hooks ------------------------------------------------------

fn short(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= n {
        s
    } else {
        format!("{}…", s.chars().take(n - 1).collect::<String>())
    }
}

/// Turn a Claude Code hook event into an island task. For PermissionRequest
/// this waits for Allow / Deny and returns the decision in the JSON shape
/// Claude Code expects on the hook's stdout; `{}` leaves Claude's own prompt.
pub fn claude_hook(app: &AppHandle, v: &serde_json::Value) -> serde_json::Value {
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("");
    let session = get("session_id");
    let id = format!("cc-{}", session.chars().take(8).collect::<String>());
    let cwd = get("cwd");
    let project = cwd.rsplit(['\\', '/']).find(|s| !s.is_empty()).unwrap_or("").to_string();
    let existing = app.state::<AiState>().tasks.lock().unwrap().iter().find(|t| t.id == id).cloned();
    let base = Task {
        id: id.clone(),
        app: "Claude".into(),
        tag: if project.is_empty() { "Claude Code".into() } else { format!("Claude Code · {project}") },
        title: existing
            .as_ref()
            .filter(|t| matches!(t.status, Status::Running | Status::Completed))
            .map(|t| t.title.trim_start_matches("Done: ").to_string())
            .unwrap_or_else(|| "Working".into()),
        detail: project.clone(),
        ..Default::default()
    };
    match get("hook_event_name") {
        "UserPromptSubmit" => {
            let prompt = get("prompt");
            let title = if prompt.is_empty() { "Working".into() } else { short(prompt, 48) };
            upsert_task(app, Task { title, status: Status::Running, ..base });
        }
        "PreToolUse" | "PostToolUse" => {
            // Keep the headline; just make sure the task shows as running.
            if existing.map(|t| t.status != Status::Running).unwrap_or(true) {
                upsert_task(app, Task { status: Status::Running, ..base });
            }
        }
        "PermissionRequest" => {
            let tool = get("tool_name");
            let input = v.get("tool_input");
            let what = input
                .and_then(|i| i.get("command").or_else(|| i.get("file_path")).or_else(|| i.get("url")))
                .and_then(|x| x.as_str())
                .map(|x| short(x, 40))
                .unwrap_or_default();
            let title = if what.is_empty() { format!("Allow {tool}?") } else { format!("{tool}: {what}") };
            let running_title = base.title.clone();
            upsert_task(app, Task { title, status: Status::Permission, ..base.clone() });
            let d = wait_decision(app, &id, Duration::from_secs(55));
            upsert_task(app, Task { title: running_title, status: Status::Running, ..base });
            return match d.as_deref() {
                Some(b @ ("allow" | "deny")) => serde_json::json!({
                    "hookSpecificOutput": {
                        "hookEventName": "PermissionRequest",
                        "decision": if b == "allow" {
                            serde_json::json!({ "behavior": "allow" })
                        } else {
                            serde_json::json!({ "behavior": "deny", "message": "Denied from DeskFlow" })
                        }
                    }
                }),
                _ => serde_json::json!({}),
            };
        }
        "Notification" => {
            let msg = get("message");
            // Permission prompts are handled by PermissionRequest; other notices
            // ("waiting for your input") need the user.
            if !msg.to_lowercase().contains("permission") {
                upsert_task(app, Task { title: short(if msg.is_empty() { "Claude needs your input" } else { msg }, 60), status: Status::Attention, ..base });
            }
        }
        "Stop" => {
            let title = format!("Done: {}", base.title);
            upsert_task(app, Task { title: short(&title, 60), status: Status::Completed, result: (!cwd.is_empty()).then(|| cwd.to_string()), ..base });
        }
        "SessionEnd" => remove_task(app, &id),
        _ => {}
    }
    serde_json::json!({})
}

// ---- Commands -------------------------------------------------------------

#[tauri::command]
pub fn ai_tasks(app: AppHandle) -> Vec<Task> {
    app.state::<AiState>().tasks.lock().unwrap().clone()
}

/// Allow / Deny from the island.
#[tauri::command]
pub fn ai_decide(app: AppHandle, id: String, decision: String) -> Result<(), String> {
    if decision != "allow" && decision != "deny" {
        return Err("decision must be allow or deny".into());
    }
    let state = app.state::<AiState>();
    {
        let mut tasks = state.tasks.lock().unwrap();
        let t = tasks.iter_mut().find(|t| t.id == id).ok_or("Task not found")?;
        t.decision = Some(decision.clone());
        // Show it continuing while the app picks the answer up.
        t.status = if decision == "allow" { Status::Running } else { Status::Attention };
        if decision == "deny" {
            t.title = "Request denied".into();
        } else {
            t.detail = "Continuing…".into();
        }
        t.updated = now();
    }
    state.decided.notify_all();
    emit_tasks(&app);
    Ok(())
}

#[tauri::command]
pub fn ai_dismiss(app: AppHandle, id: String) {
    remove_task(&app, &id);
}

/// "View result" / "Review": open the file, folder or link the app gave.
#[tauri::command]
pub fn ai_open(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if target.starts_with("http://") || target.starts_with("https://") {
        app.opener().open_url(target, None::<&str>).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(target, None::<&str>).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn ai_history(app: AppHandle) -> Vec<HistoryItem> {
    app.state::<AiState>().history.lock().unwrap().clone()
}

#[tauri::command]
pub fn ai_clear_history(app: AppHandle) {
    app.state::<AiState>().history.lock().unwrap().clear();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfo {
    running: bool,
    port: u16,
    token: String,
}

#[tauri::command]
pub fn ai_api_info(app: AppHandle) -> ApiInfo {
    let cfg = app.state::<ConfigStore>().get();
    let running = app.state::<AiState>().server.lock().unwrap().is_some();
    ApiInfo { running, port: cfg.ai.api_port, token: cfg.ai.api_token }
}

#[tauri::command]
pub async fn ai_detect_apps() -> Vec<PinnedApp> {
    tauri::async_runtime::spawn_blocking(detect_apps).await.unwrap_or_default()
}

/// "Preview" in settings: play a sample task through every state.
#[tauri::command]
pub fn ai_demo(app: AppHandle) {
    std::thread::spawn(move || {
        let id = "demo".to_string();
        let base = Task {
            id: id.clone(),
            app: "Claude".into(),
            tag: "PC Customizer".into(),
            step_labels: vec!["Scan".into(), "Sort".into(), "Archive".into()],
            steps: Some(3),
            ..Default::default()
        };
        upsert_task(&app, Task { title: "Organizing files".into(), status: Status::Running, step: Some(1), ..base.clone() });
        std::thread::sleep(Duration::from_secs(3));
        upsert_task(&app, Task { title: "Sorting files".into(), status: Status::Running, step: Some(2), ..base.clone() });
        std::thread::sleep(Duration::from_secs(3));
        upsert_task(&app, Task { title: "Move 12 files to Archive?".into(), status: Status::Permission, step: Some(3), ..base.clone() });
        let d = wait_decision(&app, &id, Duration::from_secs(60));
        std::thread::sleep(Duration::from_millis(1500));
        let finished = match d.as_deref() {
            Some("allow") => Task { title: "12 files organized".into(), status: Status::Completed, step: Some(3), result: dirs_desktop(), ..base },
            _ => Task { title: "Archive unavailable".into(), detail: "The request was denied or timed out".into(), status: Status::Attention, step: Some(2), ..base },
        };
        upsert_task(&app, finished);
        std::thread::sleep(Duration::from_secs(8));
        remove_task(&app, &id);
    });
}

fn dirs_desktop() -> Option<String> {
    std::env::var_os("USERPROFILE").map(|p| std::path::Path::new(&p).join("Desktop").display().to_string())
}
