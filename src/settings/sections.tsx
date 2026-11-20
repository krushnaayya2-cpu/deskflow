// The pages of the settings window.
import { useEffect, useState } from "react";
import { getAppInfo, getPerfStats, openConfigFolder, type AppInfo, type PerfStats, type Config, type IslandActivity, type IslandConfig } from "../lib/config";
import { islandDemo } from "../lib/island";
import { DESIGNS, designVars } from "../island/designs";
import { MUSIC_THEMES, gradient, shellStyle } from "../island/music/themes";
import type { IslandDesign } from "../lib/config";
import { AccentPicker, HotkeyRecorder, Row, Segmented, Slider, Toggle } from "./controls";

export interface SectionProps {
  config: Config;
  /** Merge a change into the config and save it. Resolves to an error message or null. */
  update: (fn: (c: Config) => Config, opts?: { immediate?: boolean }) => Promise<string | null>;
}

export function GeneralSection({ config, update }: SectionProps) {
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      <Row label="Start with Windows" description="Launch DeskFlow quietly in the tray when you sign in." htmlFor="autostart">
        <Toggle
          id="autostart"
          label="Start with Windows"
          checked={config.general.autostart}
          onChange={(v) => update((c) => ({ ...c, general: { ...c.general, autostart: v } }), { immediate: true })}
        />
      </Row>
      <Row
        label="Open settings hotkey"
        description="Works from anywhere. Click the button, then press a new combination."
        htmlFor="hotkey"
      >
        <HotkeyRecorder
          id="hotkey"
          value={config.general.settingsHotkey}
          onChange={async (combo) => {
            const err = await update((c) => ({ ...c, general: { ...c.general, settingsHotkey: combo } }), {
              immediate: true,
            });
            setHotkeyError(err);
          }}
        />
      </Row>
      {hotkeyError && (
        <p role="alert" className="px-1 text-[12.5px] text-red-400">
          {hotkeyError}
        </p>
      )}
    </div>
  );
}

export function AppearanceSection({ config, update }: SectionProps) {
  return (
    <div className="space-y-2.5">
      <Row label="Theme" description="System follows your Windows light/dark setting.">
        <Segmented
          label="Theme"
          value={config.appearance.theme}
          options={[
            { value: "system", label: "System" },
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(v) => update((c) => ({ ...c, appearance: { ...c.appearance, theme: v } }))}
        />
      </Row>
      <Row label="Accent colour" description="Used by the dock, Dynamic Island and highlights.">
        <AccentPicker
          value={config.appearance.accent}
          onChange={(hex) => update((c) => ({ ...c, appearance: { ...c.appearance, accent: hex } }))}
        />
      </Row>
    </div>
  );
}

/** Placeholder for features delivered in later steps. */
export function ComingSoon({ step, what }: { step: number; what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel px-5 py-8 text-center">
      <p className="text-[14px] font-medium">Arrives in step {step}</p>
      <p className="mt-1 text-[12.5px] text-muted">{what}</p>
    </div>
  );
}

export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [perf, setPerf] = useState<PerfStats | null>(null);
  useEffect(() => {
    getAppInfo().then(setInfo).catch(() => {});
    // Live usage while this page is open (the first CPU sample is a baseline).
    const tick = () => getPerfStats().then(setPerf).catch(() => {});
    tick();
    const iv = window.setInterval(tick, 2000);
    return () => window.clearInterval(iv);
  }, []);
  const mono = "font-mono text-[13px] text-muted tabular-nums";
  return (
    <div className="space-y-2.5">
      <Row label="Memory" description={`Same as Task Manager's Memory column, for all DeskFlow processes (${perf?.processes ?? "…"}) including WebView2 helpers. Including memory shared with Windows: ${perf ? perf.workingSetMb.toFixed(0) : "…"} MB.`}>
        <span className={mono}>{perf ? `${perf.memoryMb.toFixed(0)} MB` : "…"}</span>
      </Row>
      <Row label="CPU" description="Average over the last 2 seconds, share of the whole PC.">
        <span className={mono}>{perf ? `${perf.cpuPercent.toFixed(1)} %` : "…"}</span>
      </Row>
      <Row label="Startup time" description="From launch until the tray, island and dock were ready.">
        <span className={mono}>{perf ? `${perf.startupSecs.toFixed(2)} s` : "…"}</span>
      </Row>
      <Row label="Version" description="DeskFlow runs fully offline and sends no telemetry.">
        <span className="font-mono text-[13px] text-muted">{info?.version ?? "…"}</span>
      </Row>
      <Row label="Settings file" description={info?.configDir ? `${info.configDir}\\config.json` : "…"}>
        <button
          type="button"
          onClick={() => openConfigFolder().catch(() => {})}
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] hover:bg-panel-hover"
        >
          Open folder
        </button>
      </Row>
    </div>
  );
}

const ACTIVITY_LABELS: { key: IslandActivity; label: string; description: string }[] = [
  { key: "music", label: "Music", description: "Now playing from Spotify, browsers and other media apps, with play/pause." },
  { key: "timer", label: "Timer", description: "Countdown started from the island's quick actions (long-press)." },
  { key: "battery", label: "Battery & charging", description: "Charger plugged in or out, and low-battery warnings." },
  { key: "network", label: "Wi-Fi & network", description: "Connected, disconnected or switched networks." },
  { key: "downloads", label: "Downloads", description: "Files that finish downloading into your Downloads folder." },
];

export function IslandSection({ config, update }: SectionProps) {
  const isl = config.island;
  const [demoStep, setDemoStep] = useState(0);
  const set = (patch: Partial<IslandConfig>, immediate = false) =>
    update((c) => ({ ...c, island: { ...c.island, ...patch } }), { immediate });

  return (
    <div className="space-y-2.5">
      <Row label="Show Dynamic Island" description="A live pill at the top-centre of your screen." htmlFor="island-enabled">
        <Toggle id="island-enabled" label="Show Dynamic Island" checked={isl.enabled} onChange={(v) => set({ enabled: v }, true)} />
      </Row>

      <div className={isl.enabled ? "space-y-2.5" : "pointer-events-none space-y-2.5 opacity-50"} aria-disabled={!isl.enabled}>
        <Row label="Preview" description="Play a sample activity on the island. Click again for the next one.">
          <button
            type="button"
            onClick={() => {
              islandDemo(demoStep).catch(() => {});
              setDemoStep((n) => n + 1);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            Show sample
          </button>
        </Row>
        <DesignPicker value={isl.style} accent={config.appearance.accent} onChange={(v) => set({ style: v }, true)} />
        <MusicThemePicker value={isl.musicTheme} onChange={(v) => set({ musicTheme: v }, true)} />
        <Row label="Audio-reactive visualizer" description="Animated bars and waves that move with your PC's sound." htmlFor="island-viz">
          <Toggle id="island-viz" label="Audio-reactive visualizer" checked={isl.visualizer} onChange={(v) => set({ visualizer: v })} />
        </Row>
        <Row label="Size" description="Drag to make the island smaller or bigger. Applies to every mode: idle, music, alerts and AI cards." htmlFor="island-scale">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[
                { label: "S", v: 85 },
                { label: "M", v: 100 },
                { label: "L", v: 120 },
                { label: "XL", v: 145 },
              ].map((p) => (
                <button key={p.label} type="button" aria-label={`Size ${p.label}`} onClick={() => set({ scale: p.v }, true)}
                  className={`rounded-md border px-2 py-0.5 text-[12px] ${isl.scale === p.v ? "border-accent bg-accent/15" : "border-line hover:bg-panel-hover"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <Slider id="island-scale" label="Island size" min={60} max={170} step={5} value={isl.scale} unit="%" onChange={(v) => set({ scale: v })} />
          </div>
        </Row>
        <Row label="Monitors">
          <Segmented label="Island monitors" value={isl.monitor}
            options={[{ value: "primary", label: "Main display" }, { value: "all", label: "All displays" }]}
            onChange={(v) => set({ monitor: v }, true)} />
        </Row>
        <Row label="Distance from top" description={`${isl.offsetY} px`} htmlFor="island-offset">
          <input id="island-offset" type="range" min={0} max={60} value={isl.offsetY}
            onChange={(e) => set({ offsetY: Number(e.target.value) })}
            className="w-40 accent-[var(--accent)]" />
        </Row>
        <Row label="Hide when idle" description="Fade out when nothing is happening. Hover the top-centre to reveal it." htmlFor="island-hide">
          <Toggle id="island-hide" label="Hide when idle" checked={isl.hideWhenIdle} onChange={(v) => set({ hideWhenIdle: v })} />
        </Row>

        <h2 className="pt-4 pb-1 text-[13px] font-semibold text-muted">Activities</h2>
        {ACTIVITY_LABELS.map((a) => (
          <Row key={a.key} label={a.label} description={a.description} htmlFor={`act-${a.key}`}>
            <Toggle id={`act-${a.key}`} label={a.label} checked={isl.activities[a.key]}
              onChange={(v) => set({ activities: { ...isl.activities, [a.key]: v } })} />
          </Row>
        ))}
        <p className="px-1 pt-2 text-[12px] text-muted">
          Hover the island to expand it, click for details, and press and hold for quick actions (timers, play/pause, settings).
          File-conversion progress and AI notifications appear here once those features are added.
        </p>
      </div>
    </div>
  );
}

/** Grid of island designs with a live mini preview of each. */
function DesignPicker(props: { value: IslandDesign; accent: string; onChange: (d: IslandDesign) => void }) {
  const ids = Object.keys(DESIGNS) as IslandDesign[];
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="mb-3 text-[14px] font-medium">Design</p>
      <div role="radiogroup" aria-label="Island design" className="grid grid-cols-3 gap-3 lg:grid-cols-4">
        {ids.map((id) => {
          const d = DESIGNS[id];
          const look = d.look(props.accent);
          const selected = id === props.value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => props.onChange(id)}
              className={`group overflow-hidden rounded-xl border text-left transition ${
                selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-muted"
              }`}
            >
              <div
                className="flex h-16 justify-center"
                style={{ background: "linear-gradient(135deg,#3b1d4a,#0f172a 60%,#1e3a5f)", paddingTop: look.notch ? 0 : 10 }}
              >
                <div
                  className={`flex h-7 w-32 items-center gap-2 px-3 text-[10px] font-semibold ${look.className ?? ""} ${look.surfaceClass ?? ""}`}
                  style={{
                    ...look.surface,
                    // The real island gets native acrylic; in this preview the
                    // gradient behind is page content, so CSS blur shows it.
                    ...(look.nativeGlass ? { backdropFilter: "blur(10px) saturate(180%)" } : {}),
                    ...designVars(look),
                    borderRadius: look.notch ? "0 0 14px 14px" : 14,
                    boxShadow: look.shadow,
                    height: 28 * (look.heightScale ?? 1),
                  }}
                >
                  <span className="flex items-end gap-[2px]" style={{ height: 10 }}>
                    {[6, 10, 7, 9].map((h, i) => (
                      <span key={i} style={{ width: 2, height: h, background: props.accent, borderRadius: 1 }} />
                    ))}
                  </span>
                  <span className="truncate">Now playing</span>
                </div>
              </div>
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium">{d.label}</p>
                <p className="text-[11.5px] text-muted">{d.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Music player looks for the island, each with a small live-ish preview. */
function MusicThemePicker(props: { value: string; onChange: (id: string) => void }) {
  const opts = [{ id: "auto", label: "Match island design" }, ...MUSIC_THEMES];
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-[14px] font-medium">Music player style</p>
      <p className="mb-3 text-[12.5px] text-muted">How the island looks while music plays. Hover it for the player bar; click for the full player.</p>
      <div role="radiogroup" aria-label="Music player style" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {opts.map((o) => {
          const t = MUSIC_THEMES.find((x) => x.id === o.id);
          const selected = o.id === props.value;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={selected} onClick={() => props.onChange(o.id)}
              className={`overflow-hidden rounded-xl border text-left transition ${selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-muted"}`}>
              <div className="flex h-16 items-center justify-center px-2" style={{ background: t?.light ? "linear-gradient(135deg,#e9edf5,#cfd6e4)" : "linear-gradient(135deg,#1b1530,#07080f)" }}>
                {t ? (
                  <div className="flex h-8 w-full items-center gap-1.5 rounded-full px-2" style={{ ...shellStyle(t), boxShadow: t.glow }}>
                    <span className="h-5 w-5 shrink-0 rounded-[5px]" style={{ background: gradient(t, "135deg") }} />
                    <span className="h-1.5 w-8 shrink-0 rounded-full" style={{ background: t.fg, opacity: 0.85 }} />
                    <span className="flex h-4 flex-1 items-end justify-end gap-[2px]">
                      {[5, 9, 6, 12, 8, 14, 10, 7, 11, 6].map((hh, i) => (
                        <span key={i} style={{ width: 2, height: hh, borderRadius: 1, background: t.colors[i % 3] }} />
                      ))}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11.5px] text-muted">Uses your island design</span>
                )}
              </div>
              <div className="px-3 py-1.5 text-[12.5px] font-medium">{o.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
