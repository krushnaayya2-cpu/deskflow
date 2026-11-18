// Typed bridge to the dock backend (src-tauri/src/dock).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DockTheme, PinnedApp } from "./config";

export interface AppWindow {
  hwnd: number;
  title: string;
}
export interface RunningApp {
  path: string;
  key: string;
  name: string;
  windows: AppWindow[];
  focused: boolean;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const getRunning = () => invoke<RunningApp[]>("dock_running");
export const onRunning = (cb: (a: RunningApp[]) => void) => listen<RunningApp[]>("dock://running", (e) => cb(e.payload));
export const getIcon = (path: string, hwnd?: number) => invoke<string | null>("dock_icon", { path, hwnd: hwnd ?? null });
export const activate = (key: string) => invoke("dock_activate", { key });
export const launch = (path: string) => invoke("dock_launch", { path });
export const closeApp = (key: string) => invoke("dock_close", { key });
export const startMenu = () => invoke("dock_start_menu");
export const shell = (which: "search" | "quick" | "calendar") => invoke("dock_shell", { which });
export const setBar = (rect: Rect | null, radius: number) => invoke("dock_set_bar", { rect, radius });
export const setHitRects = (rects: Rect[]) => invoke("overlay_set_hit_rects", { rects });
export const installedApps = () => invoke<PinnedApp[]>("dock_installed_apps");
export const makePin = (path: string) => invoke<PinnedApp>("dock_make_pin", { path });
export const exportTheme = (theme: DockTheme) => invoke<boolean>("dock_export_theme", { theme });
export const importTheme = () => invoke<DockTheme | null>("dock_import_theme");
export const revealPath = (path: string) => invoke("reveal_path", { path });
export const onHover = (cb: (inside: boolean) => void) => listen<boolean>("overlay://hover", (e) => cb(e.payload));
