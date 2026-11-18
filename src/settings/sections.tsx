// The pages of the settings window.
import { useEffect, useState } from "react";
import { getAppInfo, openConfigFolder, type AppInfo, type Config, type IslandActivity, type IslandConfig } from "../lib/config";
import { islandDemo } from "../lib/island";
import { AccentPicker, HotkeyRecorder, Row, Segmented, Toggle } from "./controls";

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
  useEffect(() => {
    getAppInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <div className="space-y-2.5">
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
        <Row label="Size">
          <Segmented label="Island size" value={isl.size}
            options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]}
            onChange={(v) => set({ size: v })} />
        </Row>
        <Row label="Style" description="Glass is translucent; Solid is pure black.">
          <Segmented label="Island style" value={isl.style}
            options={[{ value: "glass", label: "Glass" }, { value: "solid", label: "Solid" }]}
            onChange={(v) => set({ style: v })} />
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
