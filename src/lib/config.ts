// Typed bridge to the Rust config store. Mirrors src-tauri/src/config.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ThemeMode = "system" | "dark" | "light";

export type IslandActivity = "music" | "timer" | "battery" | "network" | "downloads";

export type IslandDesign = "glass" | "solid" | "notch" | "neon" | "aurora" | "minimal" | "frost";

export interface IslandConfig {
  enabled: boolean;
  monitor: "primary" | "all";
  size: "small" | "medium" | "large";
  style: IslandDesign;
  offsetY: number;
  hideWhenIdle: boolean;
  activities: Record<IslandActivity, boolean>;
  musicTheme: string;
  visualizer: boolean;
}

export type DockDesign = "glass" | "minimal" | "neon" | "classic" | "pills" | "win11";
export type DockPosition = "bottom" | "left" | "right";

export interface DockStyle {
  design: DockDesign;
  background: "glass" | "solid" | "transparent";
  iconSize: number;
  spacing: number;
  cornerRadius: number;
  blur: number;
  opacity: number;
  accent: string | null;
  magnification: number;
  position: DockPosition;
  autoHide: boolean;
}

export interface PinnedApp {
  name: string;
  path: string;
  target: string;
  args: string;
}

export interface DockTheme {
  name: string;
  style: DockStyle;
}

export interface DockConfig {
  enabled: boolean;
  monitor: "primary" | "all";
  style: DockStyle;
  showRunning: boolean;
  showStart: boolean;
  showClock: boolean;
  hideTaskbar: boolean;
  pinned: PinnedApp[];
  pinsImported: boolean;
  themes: DockTheme[];
  originalTaskbarAutohide: boolean | null;
}

export interface Config {
  version: number;
  general: {
    autostart: boolean;
    settingsHotkey: string;
  };
  appearance: {
    theme: ThemeMode;
    accent: string;
  };
  island: IslandConfig;
  dock: DockConfig;
}

export interface AppInfo {
  version: string;
  configDir: string;
}

export const getConfig = () => invoke<Config>("get_config");
export const setConfig = (config: Config) => invoke<Config>("set_config", { config });
export const getAppInfo = () => invoke<AppInfo>("get_app_info");
export const openConfigFolder = () => invoke<void>("open_config_folder");

/** Fires whenever any window (or the tray menu) changes settings. */
export const onConfigChanged = (cb: (c: Config) => void): Promise<UnlistenFn> =>
  listen<Config>("config-changed", (e) => cb(e.payload));
