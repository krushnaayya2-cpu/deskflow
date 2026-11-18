// Typed bridge to the Dynamic Island backend (src-tauri/src/island).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Media {
  title: string;
  artist: string;
  playing: boolean;
  app: string;
}
export interface Battery {
  percent: number;
  charging: boolean;
}
export interface Network {
  connected: boolean;
  name: string;
  wifi: boolean;
}
export interface SystemState {
  media: Media | null;
  battery: Battery | null;
  network: Network | null;
}

/** One-off notifications from the backend (mirrors IslandEvent in Rust). */
export type IslandEvent =
  | { kind: "download"; name: string; path: string }
  | { kind: "charging"; charging: boolean; percent: number }
  | { kind: "network"; connected: boolean; name: string; wifi: boolean }
  | { kind: "notify"; title: string; body: string; path: string | null };

export const getSnapshot = () => invoke<SystemState>("island_snapshot");
export const setHitRect = (rect: { x: number; y: number; w: number; h: number }) =>
  invoke("island_set_hit_rect", { rect });
export const mediaControl = (action: "toggle" | "next" | "prev") => invoke("media_control", { action });
export const openPath = (path: string) => invoke("open_path", { path });
export const revealPath = (path: string) => invoke("reveal_path", { path });
export const openSettings = () => invoke("open_settings");
export const islandDemo = (step: number) => invoke("island_demo", { step });

export const onHover = (cb: (inside: boolean) => void) => listen<boolean>("island://hover", (e) => cb(e.payload));
export const onState = (cb: (s: SystemState) => void) => listen<SystemState>("island://state", (e) => cb(e.payload));
export const onEvent = (cb: (e: IslandEvent) => void) => listen<IslandEvent>("island://event", (e) => cb(e.payload));
