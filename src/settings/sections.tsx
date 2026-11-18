// The pages of the settings window.
import { useEffect, useState } from "react";
import { getAppInfo, openConfigFolder, type AppInfo, type Config } from "../lib/config";
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
