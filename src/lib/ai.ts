// Typed bridge to the AI module (src-tauri/src/ai).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PinnedApp } from "./config";

export type AiStatus = "running" | "permission" | "completed" | "attention";
export interface AiTask {
  id: string;
  app: string;
  tag: string;
  title: string;
  detail: string;
  status: AiStatus;
  step: number | null;
  steps: number | null;
  stepLabels: string[];
  result: string | null;
  decision: string | null;
  updated: number;
}
export interface AiNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  url: string | null;
  at: number;
}
export type HistoryItem = ({ type: "task" } & AiTask) | ({ type: "notification" } & AiNotification);
export interface ApiInfo {
  running: boolean;
  port: number;
  token: string;
}

export const AI_STYLES = [
  { id: "ticker", label: "Ticker", description: "Slim neon pill, sliding headline" },
  { id: "split", label: "Split capsule", description: "App capsule + status capsule" },
  { id: "paper", label: "Paper glass", description: "Light glass with step bar" },
  { id: "shutters", label: "Shutters", description: "Panels slide open for requests" },
  { id: "sidecar", label: "Sidecar", description: "Small island + card beside it" },
  { id: "taskmap", label: "Task map", description: "Milestones with a lock" },
  { id: "ticket", label: "Result ticket", description: "Receipt card below the pill" },
  { id: "lifecycle", label: "Lifecycle", description: "Icon that morphs per state" },
] as const;
export type AiStyle = (typeof AI_STYLES)[number]["id"];

export const getTasks = () => invoke<AiTask[]>("ai_tasks");
export const decide = (id: string, decision: "allow" | "deny") => invoke("ai_decide", { id, decision });
export const dismiss = (id: string) => invoke("ai_dismiss", { id });
export const openTarget = (target: string) => invoke("ai_open", { target });
export const getHistory = () => invoke<HistoryItem[]>("ai_history");
export const clearHistory = () => invoke("ai_clear_history");
export const apiInfo = () => invoke<ApiInfo>("ai_api_info");
export const detectApps = () => invoke<PinnedApp[]>("ai_detect_apps");
export const demo = () => invoke("ai_demo");
export const onTasks = (cb: (t: AiTask[]) => void) => listen<AiTask[]>("ai://tasks", (e) => cb(e.payload));
export const onNotify = (cb: (n: AiNotification) => void) => listen<AiNotification>("ai://notify", (e) => cb(e.payload));
