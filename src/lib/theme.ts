// Applies dark/light mode and the accent colour to a document via CSS variables.
// Shared by every DeskFlow window so they all look consistent.
import type { ThemeMode } from "./config";

const media = window.matchMedia("(prefers-color-scheme: dark)");
let currentMode: ThemeMode = "system";

function resolve(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") return media.matches ? "dark" : "light";
  return mode;
}

export function applyTheme(mode: ThemeMode, accent: string) {
  currentMode = mode;
  const root = document.documentElement;
  root.dataset.theme = resolve(mode);
  root.style.setProperty("--accent", accent);
}

// Follow Windows' light/dark switch live when the user picked "system".
media.addEventListener("change", () => {
  if (currentMode === "system") document.documentElement.dataset.theme = resolve("system");
});
