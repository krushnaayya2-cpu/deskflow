//! DeskFlow's local API (127.0.0.1 only). Every request must carry the token
//! from Settings → AI Apps in an `X-DeskFlow-Token` header (or
//! `Authorization: Bearer …`), so web pages can't talk to it.
//!
//!   GET    /v1/health
//!   POST   /v1/notify                 {app, title, body, url}
//!   POST   /v1/tasks                  {id?, app, tag, title, detail, status, step, steps, stepLabels, result}
//!                                      -> {id}
//!   GET    /v1/tasks/{id}/decision?timeout=60
//!                                      -> {decision: "allow" | "deny" | null}
//!   DELETE /v1/tasks/{id}
//!   POST   /v1/hooks/claude-code      Claude Code hook payload (stdin of a hook)

use super::{notify, remove_task, upsert_task, wait_decision, Notification, Task};
use std::{io::Read, sync::Arc, time::Duration};
use tauri::AppHandle;
use tiny_http::{Header, Method, Request, Response, Server};

pub struct Handle {
    pub port: u16,
    pub token: String,
    server: Arc<Server>,
}

impl Handle {
    pub fn stop(self) {
        self.server.unblock();
    }
}

pub fn start(app: AppHandle, port: u16, token: String) -> Result<Handle, String> {
    let server = Arc::new(Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?);
    let srv = server.clone();
    let tok = token.clone();
    std::thread::Builder::new()
        .name("ai-api".into())
        .spawn(move || {
            for req in srv.incoming_requests() {
                let app = app.clone();
                let tok = tok.clone();
                // One thread per request: decision requests long-poll.
                std::thread::spawn(move || handle(&app, &tok, req));
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Handle { port, token, server })
}

fn json(status: u16, body: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

fn authorized(req: &Request, token: &str) -> bool {
    req.headers().iter().any(|h| {
        let v = h.value.as_str();
        (h.field.equiv("X-DeskFlow-Token") && v == token)
            || (h.field.equiv("Authorization") && v.strip_prefix("Bearer ").map(|t| t == token).unwrap_or(false))
    })
}

fn handle(app: &AppHandle, token: &str, mut req: Request) {
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let path = path.trim_end_matches('/').to_string();
    let method = req.method().clone();

    if path == "/v1/health" {
        let _ = req.respond(json(200, serde_json::json!({ "ok": true, "app": "DeskFlow", "version": env!("CARGO_PKG_VERSION") })));
        return;
    }
    if !authorized(&req, token) {
        let _ = req.respond(json(401, serde_json::json!({ "error": "missing or wrong X-DeskFlow-Token" })));
        return;
    }
    let mut body = String::new();
    if matches!(method, Method::Post) {
        let _ = req.as_reader().take(256 * 1024).read_to_string(&mut body);
    }
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let resp = match (method, parts.as_slice()) {
        (Method::Post, ["v1", "notify"]) => match serde_json::from_str::<Notification>(&body) {
            Ok(n) => {
                notify(app, n);
                json(200, serde_json::json!({ "ok": true }))
            }
            Err(e) => json(400, serde_json::json!({ "error": e.to_string() })),
        },
        (Method::Post, ["v1", "tasks"]) => match serde_json::from_str::<Task>(&body) {
            Ok(t) => json(200, serde_json::json!({ "id": upsert_task(app, t) })),
            Err(e) => json(400, serde_json::json!({ "error": e.to_string() })),
        },
        (Method::Get, ["v1", "tasks", id, "decision"]) => {
            let secs = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("timeout="))
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(60)
                .min(600);
            let d = wait_decision(app, id, Duration::from_secs(secs));
            json(200, serde_json::json!({ "decision": d }))
        }
        (Method::Post, ["v1", "hooks", "claude-code"]) => match serde_json::from_str::<serde_json::Value>(&body) {
            Ok(v) => json(200, super::claude_hook(app, &v)),
            Err(e) => json(400, serde_json::json!({ "error": e.to_string() })),
        },
        (Method::Delete, ["v1", "tasks", id]) => {
            remove_task(app, id);
            json(200, serde_json::json!({ "ok": true }))
        }
        _ => json(404, serde_json::json!({ "error": "not found" })),
    };
    let _ = req.respond(resp);
}
