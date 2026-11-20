// Typed bridge to the Rust config store. Mirrors src-tauri/src/config.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ThemeMode = "system" | "dark" | "light";

export type IslandActivity = "music" | "timer" | "battery" | "network" | "downloads";

export type IslandDesign = "liquid" | "glass" | "solid" | "notch" | "neon" | "aurora" | "minimal" | "frost";

export interface IslandConfig {
  enabled: boolean;
  monitor: "primary" | "all";
  size: "small" | "medium" | "large";
  /** Island size in percent (60–170). */
  scale: number;
  style: IslandDesign;
  offsetY: number;
  hideWhenIdle: boolean;
  activities: Record<IslandActivity, boolean>;
  musicTheme: string;
  visualizer: boolean;
}

export type DockDesign =
  | "liquid" | "glass" | "minimal" | "neon" | "classic" | "pills" | "win11"
  | "tab" | "pebble" | "rail" | "underline" | "split" | "stack" | "tiles";
export type IconStyle = "original" | "mono" | "silhouette";
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
  iconStyle: IconStyle;
  separators: boolean;
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
  showTray: boolean;
  showSearch: boolean;
  hideTaskbar: boolean;
  pinned: PinnedApp[];
  pinsImported: boolean;
  themes: DockTheme[];
  originalTaskbarAutohide: boolean | null;
}

export interface ConverterConfig {
  hoverButton: boolean;
  hoverDelayMs: number;
  enabled: boolean;
  contextMenu: boolean;
  dropZone: boolean;
}

export interface AiConfig {
  apiEnabled: boolean;
  apiPort: number;
  apiToken: string;
  style: string;
  dnd: boolean;
  sound: boolean;
  apps: PinnedApp[];
  appsScanned: boolean;
  dockSection: boolean;
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
  converter: ConverterConfig;
  ai: AiConfig;
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

export interface PerfStats {
  memoryMb: number;
  workingSetMb: number;
  privateMb: number;
  cpuPercent: number;
  processes: number;
  startupSecs: number;
}
export const getPerfStats = () => invoke<PerfStats>("perf_stats");
