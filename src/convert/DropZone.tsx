// Floating drop zone: drop files on the circle to convert them, or click it
// to pick files.
import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getConfig } from "../lib/config";
import { openFiles, pickFiles } from "../lib/convert";
import { Icon } from "./icons";

export default function DropZone() {
  const [over, setOver] = useState(false);
  const [accent, setAccent] = useState("#7c5cff");

  useEffect(() => {
    getConfig().then((c) => setAccent(c.appearance.accent)).catch(() => {});
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setOver(true);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") {
        setOver(false);
        if (p.paths.length) openFiles(p.paths).catch(() => {});
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Drop files here to convert, or click to choose files"
      title="Drop files to convert"
      onClick={() => pickFiles()}
      className="fixed inset-[7px] flex flex-col items-center justify-center rounded-full text-[9.5px] font-semibold transition-all duration-200"
      style={{
        background: over ? `linear-gradient(135deg, ${accent}, #22d3ee)` : "rgba(20,20,30,0.72)",
        border: `1.5px ${over ? "solid" : "dashed"} ${over ? "#fff" : "rgba(255,255,255,0.35)"}`,
        boxShadow: over ? `0 0 24px ${accent}` : "0 6px 18px rgba(0,0,0,0.35)",
        transform: over ? "scale(1.06)" : undefined,
      }}
    >
      <Icon name="convert" size={20} />
      <span className="mt-0.5">{over ? "Drop" : "Convert"}</span>
    </button>
  );
}
