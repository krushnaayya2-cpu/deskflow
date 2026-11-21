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
  /** Class names on the bar (Liquid Glass layers from glass.css). */
  barClass?: string;
  /** Surface behind each icon (Pills, Pebble, Tiles). Gets the item id. */
  item?: CSSProperties | ((id: string) => CSSProperties);
  /** Attached to the screen edge: only the top corners are rounded. */
  edge?: boolean;
  /** Start/Search, apps and tray each get their own capsule. */
  split?: boolean;
  /** The tray sits in its own capsule above the apps. */
  stackTray?: boolean;
  /** Draw dividers between icons regardless of the setting. */
  dividers?: boolean;
  /** Underline indicators run the full icon width. */
  wideIndicator?: boolean;
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

const PASTELS = ["#e8b4a6", "#aeb8f2", "#f2a1b5", "#9fd3b2", "#c3b0f2", "#f3cf9a", "#a6d8ec"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export function dockLook(design: DockDesign, s: DockStyle, accent: string, dark: boolean): DockLook {
  const fg = dark ? "#f4f4f8" : "#16161d";
  const border = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)";
  // No design uses CSS backdrop-filter: from a transparent window it can't
  // see the desktop and it left square corners behind rounded shapes. Real
  // blur comes from the native acrylic window under the bar.
  switch (design) {
    case "liquid":
      return {
        full: false, align: "center",
        // Colours, highlight, inner glow and gradient border: glass.css.
        bar: { boxShadow: "var(--lg-shadow)" },
        barClass: "lg-surface lg-prism",
        indicator: "dot", pad: 8,
        // Taskbar radius stays in the 20-28px range (default --lg-dock-radius).
        radius: Math.min(Math.max(s.cornerRadius, 20), 28),
        margin: 10, taskbarLike: false,
        fg: "var(--lg-fg)",
      };
    case "tab":
      return {
        full: false, align: "center", edge: true,
        bar: { background: tint(dark, alpha(s, 0.5)), border: `1px solid ${border}`, borderBottom: "none", boxShadow: "0 -6px 30px rgba(0,0,0,0.18)" },
        indicator: "dot", pad: 9, radius: s.cornerRadius, margin: 0, taskbarLike: false, fg,
      };
    case "pebble":
      return {
        full: false, align: "center",
        bar: { background: `rgba(24,24,28,${Math.max(alpha(s, 0.8), 0.6)})`, border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 14px 40px rgba(0,0,0,0.45)" },
        item: { background: "rgba(255,255,255,0.07)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.35)" },
        indicator: "dot", pad: 9, radius: s.cornerRadius, margin: 14, taskbarLike: false, fg: "#f4f4f8",
      };
    case "rail":
      return {
        full: false, align: "center", dividers: true,
        bar: { background: tint(dark, alpha(s, 0.5)), border: `1px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.2)" },
        indicator: "line", pad: 7, radius: Math.min(s.cornerRadius, 6), margin: 10, taskbarLike: false, fg,
      };
    case "underline":
      return {
        full: true, align: "center", wideIndicator: true,
        bar: { background: dark ? "linear-gradient(transparent, rgba(10,12,20,0.35))" : "linear-gradient(transparent, rgba(255,255,255,0.3))", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)"}` },
        indicator: "line", pad: 6, radius: 0, margin: 6, taskbarLike: true, fg,
      };
    case "split":
      return {
        full: true, align: "center", split: true,
        bar: { background: tint(dark, Math.max(alpha(s, 0.75), 0.3)), border: `1px solid ${border}`, boxShadow: "0 8px 26px rgba(0,0,0,0.2)" },
        indicator: "dot", pad: 7, radius: s.cornerRadius, margin: 12, taskbarLike: true, fg,
      };
    case "stack":
      return {
        full: false, align: "center", stackTray: true,
        bar: { background: tint(dark, alpha(s, 0.55)), border: `1px solid ${border}`, boxShadow: "0 10px 34px rgba(0,0,0,0.28)" },
        indicator: "dot", pad: 8, radius: s.cornerRadius, margin: 12, taskbarLike: false, fg,
      };
    case "tiles":
      return {
        full: false, align: "center",
        bar: {},
        item: (id) => {
          const c = PASTELS[Math.abs(hash(id)) % PASTELS.length];
          return { background: `${c}cc`, border: "1px solid rgba(255,255,255,0.35)", boxShadow: `0 6px 16px ${c}55` };
        },
        indicator: "line", wideIndicator: true, pad: 4, radius: s.cornerRadius, margin: 14, taskbarLike: false, fg,
      };
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
  { id: "liquid", label: "Liquid Glass", description: "iPhone-style glass bar" },
  { id: "glass", label: "Glass", description: "Frosted floating bar" },
  { id: "minimal", label: "Minimal", description: "Flat and quiet" },
  { id: "neon", label: "Neon", description: "Glowing accent outline" },
  { id: "classic", label: "Classic bar", description: "Full-width taskbar" },
  { id: "pills", label: "Floating pills", description: "Each icon on its own" },
  { id: "win11", label: "Windows 11", description: "Centred, full width" },
  { id: "tab", label: "Edge tab", description: "Attached to the screen edge" },
  { id: "pebble", label: "Pebble", description: "Dark pill, icon tiles" },
  { id: "rail", label: "Rail", description: "Squared with dividers" },
  { id: "underline", label: "Underlined", description: "Thin line, wide indicators" },
  { id: "split", label: "Split", description: "Start · apps · tray capsules" },
  { id: "stack", label: "Stack", description: "Tray above the apps" },
  { id: "tiles", label: "Pastel tiles", description: "Icons on soft tiles" },
];

export const itemStyle = (look: DockLook, id: string) =>
  typeof look.item === "function" ? look.item(id) : look.item;
