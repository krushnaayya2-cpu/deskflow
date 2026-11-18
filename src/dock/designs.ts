// The six dock designs. Each turns the dock style + accent into concrete
// visuals; the dock component and the settings previews both use this.
import type { CSSProperties } from "react";
import type { DockDesign, DockStyle } from "../lib/config";

export interface DockLook {
  /** Bar stretches across the whole screen edge. */
  full: boolean;
  /** Icons centred along the bar (else start-aligned). */
  align: "center" | "start";
  /** Bar surface. Empty for designs without a bar (Pills). */
  bar: CSSProperties;
  /** Surface behind each icon (Pills). */
  item?: CSSProperties;
  indicator: "dot" | "line" | "glow";
  /** Padding inside the bar around icons. */
  pad: number;
  radius: number;
  /** Margin between the bar and the screen edge. */
  margin: number;
  /** Shows a Start button and clock by default. */
  taskbarLike: boolean;
  /** Text colour on the bar. */
  fg: string;
}

const tint = (dark: boolean, a: number) => (dark ? `rgba(22,22,30,${a})` : `rgba(248,248,252,${a})`);

/** Bar alpha from the background mode. With real glass behind it the CSS
 * layer only adds a light tint. */
function alpha(s: DockStyle, glassAlpha: number) {
  const o = s.opacity / 100;
  if (s.background === "transparent") return 0;
  if (s.background === "glass") return o * glassAlpha;
  return 0.25 + o * 0.75;
}

export function dockLook(design: DockDesign, s: DockStyle, accent: string, dark: boolean): DockLook {
  const fg = dark ? "#f4f4f8" : "#16161d";
  const border = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)";
  switch (design) {
    case "glass":
      return {
        full: false,
        align: "center",
        bar: {
          background: tint(dark, alpha(s, 0.35)),
          border: `1px solid ${border}`,
          boxShadow: "0 10px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
        },
        indicator: "dot",
        pad: 8,
        radius: s.cornerRadius,
        margin: 10,
        taskbarLike: false,
        fg,
      };
    case "minimal":
      return {
        full: false,
        align: "center",
        bar: { background: tint(dark, alpha(s, 0.5)) },
        indicator: "dot",
        pad: 6,
        radius: Math.min(s.cornerRadius, 14),
        margin: 8,
        taskbarLike: false,
        fg,
      };
    case "neon":
      return {
        full: false,
        align: "center",
        bar: {
          background: `rgba(6,6,10,${Math.max(alpha(s, 0.6), 0.35)})`,
          border: `1.5px solid ${accent}`,
          boxShadow: `0 0 14px ${accent}88, 0 0 40px ${accent}44, inset 0 0 18px ${accent}22`,
        },
        indicator: "glow",
        pad: 9,
        radius: s.cornerRadius,
        margin: 12,
        taskbarLike: false,
        fg: "#f4f4f8",
      };
    case "classic":
      return {
        full: true,
        align: "start",
        bar: {
          background: tint(dark, alpha(s, 0.55)),
          borderTop: `1px solid ${border}`,
        },
        indicator: "line",
        pad: 6,
        radius: 0,
        margin: 0,
        taskbarLike: true,
        fg,
      };
    case "pills":
      return {
        full: false,
        align: "center",
        bar: {},
        item: {
          background: tint(dark, Math.max(alpha(s, 0.7), 0.25)),
          border: `1px solid ${border}`,
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          backdropFilter: "blur(14px)",
        },
        indicator: "dot",
        pad: 4,
        radius: s.cornerRadius,
        margin: 12,
        taskbarLike: false,
        fg,
      };
    case "win11":
      return {
        full: true,
        align: "center",
        bar: {
          background: dark ? `rgba(32,32,36,${alpha(s, 0.55)})` : `rgba(243,243,246,${alpha(s, 0.55)})`,
          borderTop: `1px solid ${border}`,
        },
        indicator: "line",
        pad: 5,
        radius: 0,
        margin: 0,
        taskbarLike: true,
        fg,
      };
  }
}

export const DOCK_DESIGNS: { id: DockDesign; label: string; description: string }[] = [
  { id: "glass", label: "Glass", description: "Frosted floating bar" },
  { id: "minimal", label: "Minimal", description: "Flat and quiet" },
  { id: "neon", label: "Neon", description: "Glowing accent outline" },
  { id: "classic", label: "Classic bar", description: "Full-width taskbar" },
  { id: "pills", label: "Floating pills", description: "Each icon on its own" },
  { id: "win11", label: "Windows 11", description: "Centred, full width" },
];
