// Settings → Converter: how to start conversions and which tools are installed.
import { useEffect, useState } from "react";
import type { ConverterConfig } from "../lib/config";
import { installTool, onJob, pickFiles, toolStatus, type JobUpdate, type Tool, type ToolStatus } from "../lib/convert";
import { Row, Slider, Toggle } from "./controls";
import type { SectionProps } from "./sections";

export function ConverterSection({ config, update }: SectionProps) {
  const c = config.converter;
  const set = (patch: Partial<ConverterConfig>, immediate = true) =>
    update((x) => ({ ...x, converter: { ...x.converter, ...patch } }), { immediate });
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [busy, setBusy] = useState<Tool | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobUpdate[]>([]);
  const refresh = () => toolStatus().then(setTools).catch(() => setTools([]));
  useEffect(() => {
    refresh();
    const un = onJob((j) => setJobs((js) => [j, ...js.filter((x) => x.id !== j.id)].slice(0, 6)));
    return () => {
      un.then((f) => f());
    };
  }, []);

  return (
    <div className="space-y-2.5">
      <Row label="Convert files" description="Pick files and choose what to turn them into. Results are saved next to the originals.">
        <button type="button" onClick={() => pickFiles()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
          Choose files…
        </button>
      </Row>

      <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Ways to convert</h2>
      <Row label="Hover button" description="Rest the mouse on a file on the desktop or in File Explorer; a round button appears. Click it for the convert menu." htmlFor="cv-hover">
        <Toggle id="cv-hover" label="Hover button" checked={c.hoverButton} onChange={(v) => set({ hoverButton: v })} />
      </Row>
      <Row label="Hover delay" description="How long to rest on a file before the button appears." htmlFor="cv-delay">
        <Slider id="cv-delay" label="Hover delay" min={300} max={2000} step={100} value={c.hoverDelayMs} unit=" ms" onChange={(v) => set({ hoverDelayMs: v }, false)} />
      </Row>
      <Row label="Right-click menu" description="Adds “Convert with DeskFlow” to supported files (under “Show more options” on Windows 11)." htmlFor="cv-menu">
        <Toggle id="cv-menu" label="Right-click menu" checked={c.contextMenu} onChange={(v) => set({ contextMenu: v })} />
      </Row>
      <Row label="Drop zone" description="A small circle at the right edge of the screen. Drop files on it to convert them." htmlFor="cv-drop">
        <Toggle id="cv-drop" label="Drop zone" checked={c.dropZone} onChange={(v) => set({ dropZone: v })} />
      </Row>

      <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Conversion tools</h2>
      <p className="px-1 pb-1 text-[12px] text-muted">
        Images and PDFs (to PNG/JPG/WebP, images to PDF, merge, compress) work out of the box. These free tools add the rest; everything runs offline on your PC.
      </p>
      {(tools ?? []).map((t) => (
        <Row key={t.tool} label={t.label} description={t.path ? `${t.purpose} — installed` : t.purpose}>
          {t.path ? (
            <span className="text-[12.5px] font-medium text-emerald-500">✓ Ready</span>
          ) : (
            <button type="button" disabled={busy !== null}
              onClick={async () => {
                setBusy(t.tool);
                setErr(null);
                try {
                  await installTool(t.tool);
                } catch (e) {
                  setErr(String(e));
                }
                setBusy(null);
                refresh();
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-panel-hover disabled:opacity-50">
              {busy === t.tool ? "Installing…" : "Install"}
            </button>
          )}
        </Row>
      ))}
      {err && <p role="alert" className="px-1 text-[12.5px] text-red-400">{err}</p>}

      {jobs.length > 0 && (
        <>
          <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Recent</h2>
          {jobs.map((j) => (
            <Row key={j.id} label={j.label} description={j.error ?? (j.outputs[0] ?? "")}>
              <span className="text-[12.5px] text-muted">
                {j.state === "running" ? (j.progress >= 0 ? `${Math.round(j.progress * 100)}%` : "Working…") : j.state === "done" ? "Done" : j.state === "error" ? "Failed" : "Queued"}
              </span>
            </Row>
          ))}
        </>
      )}
    </div>
  );
}
