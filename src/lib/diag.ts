// Send page errors to DeskFlow's log file (%LOCALAPPDATA%\\DeskFlow\\deskflow.log).
import { invoke } from "@tauri-apps/api/core";

export const diag = (msg: string) => invoke("diag_log", { msg }).catch(() => {});

export function catchErrors() {
  window.addEventListener("error", (e) => diag(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => diag(`rejection: ${String(e.reason)}`));
}
