// Music player themes for the Dynamic Island, modelled on the user's
// reference designs. Each theme is pure data: surface, border, glow, colours
// and which visualizer / decoration to draw.
import type { CSSProperties } from "react";

export type VizKind = "bars" | "mirror" | "pixels" | "lines" | "dots" | "particles" | "ribbon" | "chrome";
export type Deco = "none" | "orbit" | "rain" | "brackets" | "sheen";
export type BtnStyle = "ring" | "glass" | "solid" | "plain";

export interface MusicTheme {
  id: string;
  label: string;
  /** Background of the shell (always a gradient so a gradient border can layer on it). */
  bg: string;
  /** Border: a CSS colour, or a gradient (drawn as a gradient border). */
  border: string;
  borderWidth?: number;
  glow: string;
  fg: string;
  muted: string;
  /** Gradient stops for visualizer, progress bar and highlights. */
  colors: [string, string, string];
  viz: VizKind;
  btn: BtnStyle;
  deco: Deco;
  mono?: boolean;
  /** Small caps label shown in the full player (e.g. "AUDIO REACTIVE"). */
  tag?: string;
  light?: boolean;
}

const solid = (c: string) => `linear-gradient(${c},${c})`;

export const MUSIC_THEMES: MusicTheme[] = [
  {
    id: "spectrum", label: "Spectrum", tag: "AUDIO REACTIVE",
    bg: "linear-gradient(180deg,#0b0d1c,#05060d)", border: "linear-gradient(90deg,#22d3ee,#6366f1,#e879f9)",
    glow: "0 0 22px #22d3ee55, 0 0 46px #a855f744", fg: "#f5f7ff", muted: "rgba(220,225,255,0.6)",
    colors: ["#22d3ee", "#6366f1", "#e879f9"], viz: "mirror", btn: "glass", deco: "none",
  },
  {
    id: "cosmic", label: "Cosmic Dust",
    bg: "linear-gradient(180deg,#1c0709,#090203)", border: "linear-gradient(90deg,#7a2d22,#f3b39a,#7a2d22)",
    glow: "0 0 34px #ff3b3b44, 0 0 70px #ff6b4a22", fg: "#fff3ee", muted: "rgba(255,210,195,0.6)",
    colors: ["#e11d48", "#ff8a65", "#ffe2cc"], viz: "particles", btn: "glass", deco: "none",
  },
  {
    id: "pixel", label: "Pixel Pulse", mono: true,
    bg: "linear-gradient(180deg,#161616,#0c0c0c)", border: "#2e2e2e", borderWidth: 2,
    glow: "0 0 26px #ff9a1a33, 0 10px 30px rgba(0,0,0,0.6)", fg: "#ffb347", muted: "rgba(255,170,70,0.65)",
    colors: ["#ff8a00", "#ffa62b", "#ffc46b"], viz: "pixels", btn: "plain", deco: "brackets",
  },
  {
    id: "aurora", label: "Aurora Flow",
    bg: "linear-gradient(135deg,rgba(18,48,36,0.92),rgba(6,24,18,0.94))", border: "rgba(170,255,210,0.28)",
    glow: "0 12px 40px #10b98140, 0 0 22px #34d39933", fg: "#effff6", muted: "rgba(200,240,220,0.62)",
    colors: ["#14b8a6", "#34d399", "#fde68a"], viz: "ribbon", btn: "glass", deco: "none",
  },
  {
    id: "chrome", label: "Liquid Chrome", light: true,
    bg: "linear-gradient(180deg,#f6f7f9,#dde0e6)", border: "linear-gradient(180deg,#ffffff,#9097a3,#ffffff)", borderWidth: 2.5,
    glow: "0 16px 34px rgba(0,0,0,0.2), inset 0 2px 8px #ffffff", fg: "#121318", muted: "rgba(30,32,40,0.55)",
    colors: ["#aab1bd", "#ffffff", "#c3c9d3"], viz: "chrome", btn: "plain", deco: "sheen",
  },
  {
    id: "orbit", label: "Neon Orbit",
    bg: "linear-gradient(180deg,#0b1026,#05070f)", border: "linear-gradient(90deg,#22d3ee,#818cf8,#c084fc)",
    glow: "0 0 24px #22d3ee44, 0 0 40px #a855f744", fg: "#f2f6ff", muted: "rgba(210,220,255,0.6)",
    colors: ["#22d3ee", "#818cf8", "#c084fc"], viz: "bars", btn: "ring", deco: "orbit",
  },
  {
    id: "emerald", label: "Emerald Rain",
    bg: "linear-gradient(180deg,#062b1e,#03140e)", border: "rgba(52,211,153,0.6)",
    glow: "0 0 28px #10b98155, inset 0 0 22px #10b9811a", fg: "#ecfff7", muted: "rgba(180,240,215,0.62)",
    colors: ["#059669", "#34d399", "#a7f3d0"], viz: "dots", btn: "ring", deco: "rain",
  },
  {
    id: "mono", label: "Mono Wave",
    bg: "linear-gradient(180deg,#161618,#0a0a0b)", border: "rgba(255,255,255,0.24)",
    glow: "0 0 18px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.12)", fg: "#ffffff", muted: "rgba(255,255,255,0.55)",
    colors: ["#6b7280", "#ffffff", "#9ca3af"], viz: "lines", btn: "ring", deco: "none",
  },
  {
    id: "holo", label: "Holographic",
    bg: "linear-gradient(120deg,rgba(88,28,135,0.82),rgba(49,46,129,0.78),rgba(131,24,67,0.72))", border: "linear-gradient(90deg,#f9a8d4,#a5f3fc,#c4b5fd,#f9a8d4)",
    glow: "0 0 30px #c084fc55, 0 0 60px #22d3ee22", fg: "#fdf4ff", muted: "rgba(245,225,255,0.68)",
    colors: ["#f472b6", "#a78bfa", "#22d3ee"], viz: "bars", btn: "glass", deco: "sheen",
  },
  {
    id: "ice", label: "Ice Glass", light: true,
    bg: "linear-gradient(180deg,rgba(238,244,255,0.95),rgba(214,226,248,0.93))", border: "rgba(255,255,255,0.95)", borderWidth: 1.5,
    glow: "0 16px 36px rgba(70,110,200,0.28)", fg: "#13213d", muted: "rgba(60,80,120,0.65)",
    colors: ["#93c5fd", "#3b82f6", "#60a5fa"], viz: "lines", btn: "solid", deco: "none",
  },
  {
    id: "solar", label: "Solar Flare",
    bg: "linear-gradient(180deg,#220d05,#0e0503)", border: "rgba(251,146,60,0.55)",
    glow: "0 0 32px #f9731655, 0 0 60px #dc262633", fg: "#fff4e8", muted: "rgba(255,210,170,0.62)",
    colors: ["#dc2626", "#f97316", "#fde047"], viz: "particles", btn: "ring", deco: "none",
  },
  {
    id: "abyss", label: "Abyss Blue",
    bg: "linear-gradient(180deg,#040b16,#02050b)", border: "linear-gradient(90deg,#1d4ed8,#22d3ee,#1d4ed8)",
    glow: "0 0 22px #0ea5e944", fg: "#eef6ff", muted: "rgba(170,200,240,0.6)",
    colors: ["#1d4ed8", "#22d3ee", "#38bdf8"], viz: "lines", btn: "ring", deco: "none",
  },
  {
    id: "blood", label: "Blood Moon",
    bg: "linear-gradient(180deg,#160405,#080203)", border: "rgba(239,68,68,0.55)",
    glow: "0 0 28px #dc262655", fg: "#fff1f1", muted: "rgba(255,190,190,0.6)",
    colors: ["#7f1d1d", "#ef4444", "#fca5a5"], viz: "bars", btn: "ring", deco: "none",
  },
  {
    id: "plasma", label: "Dark Plasma",
    bg: "linear-gradient(180deg,#0e0616,#050308)", border: "linear-gradient(90deg,#ec4899,#a855f7,#6366f1)",
    glow: "0 0 26px #d946ef44", fg: "#fdf2ff", muted: "rgba(240,200,255,0.6)",
    colors: ["#ec4899", "#d946ef", "#6366f1"], viz: "lines", btn: "ring", deco: "none",
  },
  {
    id: "phantom", label: "Phantom Green",
    bg: "linear-gradient(180deg,#0d100b,#050605)", border: "rgba(132,204,22,0.5)",
    glow: "0 0 26px #84cc1644, 0 10px 30px rgba(0,0,0,0.55)", fg: "#f6ffe8", muted: "rgba(210,240,170,0.6)",
    colors: ["#3f6212", "#84cc16", "#d9f99d"], viz: "dots", btn: "ring", deco: "none",
  },
  {
    id: "void", label: "Void Pulse",
    bg: "linear-gradient(180deg,#0b0616,#040209)", border: "rgba(139,92,246,0.6)",
    glow: "0 0 28px #7c3aed55", fg: "#f6f2ff", muted: "rgba(210,195,255,0.6)",
    colors: ["#5b21b6", "#8b5cf6", "#c4b5fd"], viz: "dots", btn: "ring", deco: "none",
  },
];

/** Fallback when "Match island design" is chosen: accent-coloured bars. */
export function autoTheme(accent: string, fg: string, muted: string): MusicTheme {
  return {
    id: "auto", label: "Match island design", bg: "", border: "", glow: "", fg, muted,
    colors: [accent, "#22d3ee", accent], viz: "bars", btn: "solid", deco: "none",
  };
}

export const findTheme = (id: string) => MUSIC_THEMES.find((t) => t.id === id);

/** Shell styles for a theme (gradient borders layered via padding-box/border-box). */
export function shellStyle(t: MusicTheme): CSSProperties {
  const bw = t.borderWidth ?? 1.5;
  const gradientBorder = t.border.includes("gradient");
  return gradientBorder
    ? { border: `${bw}px solid transparent`, background: `${t.bg} padding-box, ${t.border} border-box`, color: t.fg }
    : { border: `${bw}px solid ${t.border}`, background: t.bg, color: t.fg };
}

export const gradient = (t: MusicTheme, dir = "90deg") => `linear-gradient(${dir}, ${t.colors.join(", ")})`;
export { solid as solidLayer };
