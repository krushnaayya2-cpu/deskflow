// Visual designs for the Dynamic Island. Each design is a pure function of
// the accent colour so both the island and the settings previews use it.
import type { CSSProperties } from "react";
import type { IslandDesign } from "../lib/config";

export interface DesignLook {
  /** CSS for the pill surface (background, border, colours, animation). */
  surface: CSSProperties;
  /** Extra class names (for CSS keyframe animations). */
  className?: string;
  /** Class names always on the surface (e.g. the Liquid Glass layers). */
  surfaceClass?: string;
  /** Put real (native acrylic) blur behind the pill. */
  nativeGlass?: boolean;
  /** Shadow at rest and while a notification is blooming. */
  shadow: string;
  glow: (accent: string) => string;
  /** Square top corners and no gap above, like a laptop notch. */
  notch?: boolean;
  /** Multiplier for pill heights (slimmer designs). */
  heightScale?: number;
  /** Text and control colours, exposed to the content as CSS variables. */
  fg: string;
  muted: string;
  btn: string;
  track: string;
}

const dark = { fg: "#fff", muted: "rgba(255,255,255,0.55)", btn: "rgba(255,255,255,0.13)", track: "rgba(255,255,255,0.15)" };
const glowFor = (a: string) => `0 0 0 1px ${a}88, 0 8px 30px ${a}55`;

// No design uses CSS backdrop-filter: in a transparent window it can't see
// the desktop, and its extra compositing layer drew square/black corners
// behind the rounded pill while it morphed. Designs that want blur set
// `nativeGlass` and get real acrylic from the backend instead.
export const DESIGNS: Record<IslandDesign, { label: string; description: string; look: (accent: string) => DesignLook }> = {
  liquid: {
    label: "Liquid Glass",
    description: "iPhone-style dark glass",
    look: () => ({
      // Colours live in src/styles/glass.css (.lg-surface.lg-island).
      surface: {},
      surfaceClass: "lg-surface lg-island",
      nativeGlass: true,
      shadow: "var(--lg-shadow)",
      glow: (a) => `0 0 0 1px ${a}77, 0 8px 32px ${a}44, 0 8px 32px rgba(0,0,0,0.25)`,
      ...dark,
      muted: "rgba(255,255,255,0.62)",
      btn: "rgba(255,255,255,0.14)",
    }),
  },
  glass: {
    label: "Glass",
    description: "Translucent dark glass",
    look: () => ({
      surface: { background: "rgba(16,16,22,0.72)", border: "1px solid rgba(255,255,255,0.14)" },
      nativeGlass: true,
      shadow: "0 6px 24px rgba(0,0,0,0.35)",
      glow: glowFor,
      ...dark,
    }),
  },
  solid: {
    label: "Solid",
    description: "Pure black, phone-style",
    look: () => ({
      surface: { background: "#000", border: "1px solid rgba(255,255,255,0.05)" },
      shadow: "0 6px 20px rgba(0,0,0,0.45)",
      glow: glowFor,
      ...dark,
    }),
  },
  notch: {
    label: "Notch",
    description: "Hangs from the top edge",
    look: () => ({
      surface: { background: "#000", borderLeft: "1px solid rgba(255,255,255,0.06)", borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)" },
      shadow: "0 8px 22px rgba(0,0,0,0.5)",
      glow: (a) => `0 10px 30px ${a}55`,
      notch: true,
      ...dark,
    }),
  },
  neon: {
    label: "Neon",
    description: "Animated glowing border",
    look: (a) => ({
      surface: {
        border: "1.5px solid transparent",
        background: `linear-gradient(#07070b,#07070b) padding-box, linear-gradient(90deg, ${a}, #22d3ee, #f472b6, ${a}) border-box`,
        backgroundSize: "100% 100%, 300% 100%",
      },
      className: "isl-flow",
      shadow: `0 0 18px ${a}55, 0 6px 22px rgba(0,0,0,0.4)`,
      glow: (x) => `0 0 28px ${x}aa, 0 0 60px ${x}55`,
      ...dark,
    }),
  },
  aurora: {
    label: "Aurora",
    description: "Shifting colour gradient",
    look: (a) => ({
      surface: {
        background: `linear-gradient(rgba(8,8,18,0.38),rgba(8,8,18,0.38)), linear-gradient(120deg, ${a}, #22d3ee, #a855f7, ${a})`,
        backgroundSize: "100% 100%, 300% 300%",
        border: "1px solid rgba(255,255,255,0.22)",
      },
      className: "isl-flow-slow",
      shadow: `0 8px 26px ${a}44`,
      glow: (x) => `0 0 0 2px #fff6, 0 10px 34px ${x}88`,
      ...dark,
      muted: "rgba(255,255,255,0.75)",
      btn: "rgba(255,255,255,0.2)",
    }),
  },
  minimal: {
    label: "Minimal",
    description: "Slim and borderless",
    look: () => ({
      surface: { background: "rgba(0,0,0,0.5)" },
      nativeGlass: true,
      shadow: "none",
      glow: (a) => `0 0 0 1px ${a}aa`,
      heightScale: 0.86,
      ...dark,
    }),
  },
  frost: {
    label: "Frost",
    description: "Light glass, dark text",
    look: () => ({
      surface: { background: "rgba(250,250,253,0.82)", border: "1px solid rgba(0,0,0,0.08)" },
      nativeGlass: true,
      shadow: "0 8px 26px rgba(0,0,0,0.18)",
      glow: (a) => `0 0 0 1.5px ${a}, 0 10px 30px ${a}44`,
      fg: "#15151c",
      muted: "rgba(0,0,0,0.55)",
      btn: "rgba(0,0,0,0.07)",
      track: "rgba(0,0,0,0.12)",
    }),
  },
};

/** CSS custom properties consumed by the island content. */
export const designVars = (l: DesignLook) =>
  ({ "--isl-fg": l.fg, "--isl-muted": l.muted, "--isl-btn": l.btn, "--isl-track": l.track, color: l.fg }) as CSSProperties;
