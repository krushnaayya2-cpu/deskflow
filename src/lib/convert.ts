// Typed bridge to the converter backend (src-tauri/src/convert).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Tool = "libreoffice" | "ffmpeg" | "poppler";
export interface ConvOption {
  id: string;
  label: string;
  icon: string;
  tool: Tool | null;
  available: boolean;
}
export interface Pending {
  files: string[];
  mode: "button" | "menu";
  options: ConvOption[];
}
export interface JobUpdate {
  id: number;
  label: string;
  state: "queued" | "running" | "done" | "error";
  progress: number;
  outputs: string[];
  error: string | null;
}
export interface ToolStatus {
  tool: Tool;
  label: string;
  purpose: string;
  path: string | null;
}

export const getPending = () => invoke<Pending>("convert_pending");
export const expand = () => invoke("convert_expand");
export const start = (files: string[], option: string) => invoke<number>("convert_start", { files, option });
export const closeConvert = () => invoke("convert_close");
export const openFiles = (files: string[]) => invoke("convert_open", { files });
export const pickFiles = () => invoke("convert_pick");
export const toolStatus = () => invoke<ToolStatus[]>("convert_tools");
export const installTool = (tool: Tool) => invoke("convert_install", { tool });
export const setHitRects = (rects: { x: number; y: number; w: number; h: number }[]) => invoke("overlay_set_hit_rects", { rects });
export const onPending = (cb: () => void) => listen("convert://pending", () => cb());
export const onJob = (cb: (j: JobUpdate) => void) => listen<JobUpdate>("convert://job", (e) => cb(e.payload));
export const onHover = (cb: (inside: boolean) => void) => listen<boolean>("overlay://hover", (e) => cb(e.payload));
