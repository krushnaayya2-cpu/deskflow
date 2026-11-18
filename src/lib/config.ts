// Typed bridge to the Rust config store. Mirrors src-tauri/src/config.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ThemeMode = "system" | "dark" | "light";

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
