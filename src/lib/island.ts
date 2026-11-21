// Typed bridge to the Dynamic Island backend (src-tauri/src/island).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Media {
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  app: string;
  position: number;
  duration: number;
  updatedAt: number;
  shuffle: boolean | null;
  repeat: "none" | "track" | "list" | null;
  artKey: string;
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

/** Place the native acrylic glass behind the pill (null hides it). */
export const setIslandGlass = (rect: { x: number; y: number; w: number; h: number } | null, radius: number) =>
  invoke("island_set_glass", { rect, radius });
/** The screen behind this window, small, for the refraction shader. */
export const captureBehind = () => invoke<{ url: string; w: number; h: number } | null>("capture_behind");
/** Keep this window out of other apps' screen captures. */
export const setCaptureExcluded = (excluded: boolean) => invoke<boolean>("set_capture_excluded", { excluded });
/** Native acrylic available (Windows 10 1803+)? */
export const glassSupported = () => invoke<boolean>("glass_supported");
export const getSnapshot = () => invoke<SystemState>("island_snapshot");
export const setHitRect = (rect: { x: number; y: number; w: number; h: number }) =>
  invoke("overlay_set_hit_rects", { rects: [rect] });
export const mediaControl = (action: "toggle" | "next" | "prev" | "shuffle" | "repeat" | "seek", value?: number) =>
  invoke("media_control", { action, value: value ?? null });
export const mediaArt = () => invoke<string | null>("media_art");
export const audioPeak = () => invoke<number>("audio_peak");
export const audioVolume = () => invoke<number>("audio_volume");
export const setAudioVolume = (level: number) => invoke("audio_set_volume", { level });

/** Position now, extrapolated from the last timeline update while playing. */
export function livePosition(m: Media, now = Date.now()) {
  const p = m.position + (m.playing && m.updatedAt ? (now - m.updatedAt) / 1000 : 0);
  return m.duration ? Math.min(Math.max(p, 0), m.duration) : Math.max(p, 0);
}
export const openPath = (path: string) => invoke("open_path", { path });
export const revealPath = (path: string) => invoke("reveal_path", { path });
export const openSettings = () => invoke("open_settings");
export const islandDemo = (step: number) => invoke("island_demo", { step });

export const onHover = (cb: (inside: boolean) => void) => listen<boolean>("overlay://hover", (e) => cb(e.payload));
export const onState = (cb: (s: SystemState) => void) => listen<SystemState>("island://state", (e) => cb(e.payload));
export const onEvent = (cb: (e: IslandEvent) => void) => listen<IslandEvent>("island://event", (e) => cb(e.payload));
