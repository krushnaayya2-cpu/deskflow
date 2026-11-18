// Settings → Dock: design, look, behaviour, pinned apps and themes.
import { useEffect, useMemo, useState } from "react";
import type { DockDesign, DockStyle, DockTheme, PinnedApp } from "../lib/config";
import { exportTheme, importTheme, installedApps, makePin } from "../lib/dock";
import { DOCK_DESIGNS, dockLook } from "../dock/designs";
import { AccentPicker, Row, Segmented, Slider, Toggle } from "./controls";
import type { SectionProps } from "./sections";

/** Ready-made looks, one per design, as a starting point. */
const PRESETS: DockTheme[] = DOCK_DESIGNS.map((d) => ({
  name: d.label,
  style: {
    design: d.id,
    background: "glass",
    iconSize: d.id === "classic" || d.id === "win11" ? 36 : 48,
    spacing: d.id === "pills" ? 10 : d.id === "win11" ? 6 : 8,
    cornerRadius: d.id === "minimal" ? 14 : d.id === "neon" ? 20 : 22,
    blur: 70,
    opacity: d.id === "minimal" ? 80 : 60,
    accent: null,
    magnification: d.id === "classic" || d.id === "win11" ? 100 : 160,
    position: "bottom",
    autoHide: false,
  },
}));

export function DockSection({ config, update }: SectionProps) {
  const dock = config.dock;
  const st = dock.style;
  const accent = st.accent ?? config.appearance.accent;
  const [message, setMessage] = useState<string | null>(null);
  const setDock = (patch: Partial<typeof dock>, immediate = false) =>
    update((c) => ({ ...c, dock: { ...c.dock, ...patch } }), { immediate });
  const setStyle = (patch: Partial<DockStyle>, immediate = false) =>
    update((c) => ({ ...c, dock: { ...c.dock, style: { ...c.dock.style, ...patch } } }), { immediate });

  return (
    <div className="space-y-2.5">
      <Row label="Show dock" description="A customizable app dock with your pinned and running apps." htmlFor="dock-on">
        <Toggle id="dock-on" label="Show dock" checked={dock.enabled} onChange={(v) => setDock({ enabled: v }, true)} />
      </Row>

      <div className={dock.enabled ? "space-y-2.5" : "pointer-events-none space-y-2.5 opacity-50"} aria-disabled={!dock.enabled}>
        <DesignGrid value={st.design} style={st} accent={accent} dark={config.appearance.theme !== "light"} onChange={(d) => setStyle({ design: d }, true)} />

        <Row label="Background" description="Glass uses real Windows blur.">
          <Segmented label="Dock background" value={st.background}
            options={[{ value: "glass", label: "Glass" }, { value: "solid", label: "Solid" }, { value: "transparent", label: "Transparent" }]}
            onChange={(v) => setStyle({ background: v }, true)} />
        </Row>
        <Row label="Icon size" htmlFor="d-size"><Slider id="d-size" label="Icon size" min={24} max={96} value={st.iconSize} unit="px" onChange={(v) => setStyle({ iconSize: v })} /></Row>
        <Row label="Spacing" htmlFor="d-gap"><Slider id="d-gap" label="Spacing" min={0} max={40} value={st.spacing} unit="px" onChange={(v) => setStyle({ spacing: v })} /></Row>
        <Row label="Corner radius" htmlFor="d-rad"><Slider id="d-rad" label="Corner radius" min={0} max={48} value={st.cornerRadius} unit="px" onChange={(v) => setStyle({ cornerRadius: v })} /></Row>
        <Row label="Blur strength" description="0 turns the blur off." htmlFor="d-blur"><Slider id="d-blur" label="Blur strength" min={0} max={100} value={st.blur} unit="%" onChange={(v) => setStyle({ blur: v })} /></Row>
        <Row label="Opacity" htmlFor="d-op"><Slider id="d-op" label="Opacity" min={0} max={100} value={st.opacity} unit="%" onChange={(v) => setStyle({ opacity: v })} /></Row>
        <Row label="Magnification" description="How much icons grow under the cursor. 100% is off." htmlFor="d-mag"><Slider id="d-mag" label="Magnification" min={100} max={250} step={5} value={st.magnification} unit="%" onChange={(v) => setStyle({ magnification: v })} /></Row>
        <Row label="Accent colour" description={st.accent ? "Custom for the dock." : "Following the app accent."}>
          <div className="flex items-center gap-3">
            <AccentPicker value={accent} onChange={(hex) => setStyle({ accent: hex })} />
            {st.accent && (
              <button type="button" className="text-[12px] text-muted underline" onClick={() => setStyle({ accent: null })}>Reset</button>
            )}
          </div>
        </Row>

        <h2 className="pt-4 pb-1 text-[13px] font-semibold text-muted">Behaviour</h2>
        <Row label="Position">
          <Segmented label="Dock position" value={st.position}
            options={[{ value: "bottom", label: "Bottom" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }]}
            onChange={(v) => setStyle({ position: v }, true)} />
        </Row>
        <Row label="Auto-hide" description="Slide away until you move the mouse to the screen edge." htmlFor="d-ah">
          <Toggle id="d-ah" label="Auto-hide" checked={st.autoHide} onChange={(v) => setStyle({ autoHide: v }, true)} />
        </Row>
        <Row label="Monitors">
          <Segmented label="Dock monitors" value={dock.monitor}
            options={[{ value: "primary", label: "Main display" }, { value: "all", label: "All displays" }]}
            onChange={(v) => setDock({ monitor: v }, true)} />
        </Row>
        <Row label="Hide the Windows taskbar" description="DeskFlow restores it when you turn this off or quit DeskFlow." htmlFor="d-tb">
          <Toggle id="d-tb" label="Hide the Windows taskbar" checked={dock.hideTaskbar} onChange={(v) => setDock({ hideTaskbar: v }, true)} />
        </Row>
        <Row label="Show running apps" description="Apps that are open but not pinned." htmlFor="d-run">
          <Toggle id="d-run" label="Show running apps" checked={dock.showRunning} onChange={(v) => setDock({ showRunning: v })} />
        </Row>
        <Row label="Show Start button" htmlFor="d-start">
          <Toggle id="d-start" label="Show Start button" checked={dock.showStart} onChange={(v) => setDock({ showStart: v })} />
        </Row>
        <Row label="Show clock" description="On the Classic and Windows 11 designs." htmlFor="d-clock">
          <Toggle id="d-clock" label="Show clock" checked={dock.showClock} onChange={(v) => setDock({ showClock: v })} />
        </Row>

        <PinnedApps pinned={dock.pinned} onChange={(p) => setDock({ pinned: p }, true)} />

        <Themes
          themes={dock.themes}
          current={st}
          onApply={(s) => setStyle(s, true)}
          onChange={(t) => setDock({ themes: t }, true)}
          setMessage={setMessage}
        />
        {message && <p role="status" className="px-1 text-[12.5px] text-muted">{message}</p>}
        <p className="px-1 pt-2 text-[12px] text-muted">
          Tips: drag icons on the dock to reorder pinned apps, right-click for options, middle-click to open a new window.
        </p>
      </div>
    </div>
  );
}

function DesignGrid(props: { value: DockDesign; style: DockStyle; accent: string; dark: boolean; onChange: (d: DockDesign) => void }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="mb-3 text-[14px] font-medium">Design</p>
      <div role="radiogroup" aria-label="Dock design" className="grid grid-cols-3 gap-3">
        {DOCK_DESIGNS.map((d) => {
          const look = dockLook(d.id, { ...props.style, design: d.id }, props.accent, props.dark);
          const selected = d.id === props.value;
          return (
            <button key={d.id} type="button" role="radio" aria-checked={selected} onClick={() => props.onChange(d.id)}
              className={`overflow-hidden rounded-xl border text-left transition ${selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-muted"}`}>
              <div className="relative flex h-16 items-end justify-center" style={{ background: "linear-gradient(135deg,#3b1d4a,#0f172a 60%,#1e3a5f)" }}>
                <div
                  className={`flex items-center gap-1.5 ${look.full ? "w-full" : ""} ${look.align === "center" ? "justify-center" : "justify-start"}`}
                  style={{ ...look.bar, borderRadius: look.full ? 0 : Math.min(look.radius, 12), padding: 5, marginBottom: look.full ? 0 : 6, backdropFilter: "blur(8px)" }}
                >
                  {["#7c5cff", "#22d3ee", "#f472b6", "#f59e0b"].map((c) => (
                    <span key={c} className="block h-5 w-5 rounded-[6px]" style={{ background: c, ...(look.item ? { boxShadow: "0 0 0 3px rgba(255,255,255,0.15)" } : {}) }} />
                  ))}
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

function PinnedApps({ pinned, onChange }: { pinned: PinnedApp[]; onChange: (p: PinnedApp[]) => void }) {
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= pinned.length) return;
    const next = [...pinned];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[14px] font-medium">Pinned apps</p>
        <button type="button" onClick={() => setAdding((a) => !a)} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
          {adding ? "Done" : "Add app"}
        </button>
      </div>
      {adding && <AppPicker pinned={pinned} onAdd={(p) => onChange([...pinned, p])} />}
      <ul className="divide-y divide-line">
        {pinned.map((p, i) => (
          <li key={p.path} className="flex items-center gap-2 py-1.5 text-[13px]">
            <span className="flex-1 truncate">{p.name}</span>
            <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-2 py-0.5 text-muted hover:bg-panel-hover disabled:opacity-30">↑</button>
            <button type="button" aria-label={`Move ${p.name} down`} disabled={i === pinned.length - 1} onClick={() => move(i, 1)} className="rounded px-2 py-0.5 text-muted hover:bg-panel-hover disabled:opacity-30">↓</button>
            <button type="button" aria-label={`Unpin ${p.name}`} onClick={() => onChange(pinned.filter((x) => x.path !== p.path))} className="rounded px-2 py-0.5 text-red-400 hover:bg-panel-hover">Remove</button>
          </li>
        ))}
        {!pinned.length && <li className="py-2 text-[12.5px] text-muted">No pinned apps yet.</li>}
      </ul>
    </div>
  );
}

function AppPicker({ pinned, onAdd }: { pinned: PinnedApp[]; onAdd: (p: PinnedApp) => void }) {
  const [apps, setApps] = useState<PinnedApp[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    installedApps().then(setApps).catch(() => setApps([]));
  }, []);
  const list = useMemo(
    () => (apps ?? []).filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) && !pinned.some((p) => p.path === a.path)).slice(0, 60),
    [apps, q, pinned],
  );
  return (
    <div className="mb-3 rounded-lg border border-line p-2">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search installed apps…" aria-label="Search installed apps"
        className="mb-2 w-full rounded-md border border-line bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
      <div className="max-h-56 overflow-y-auto">
        {apps === null && <p className="p-2 text-[12.5px] text-muted">Loading…</p>}
        {list.map((a) => (
          <button key={a.path} type="button" onClick={async () => onAdd(await makePin(a.path))}
            className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-panel-hover">
            {a.name}
          </button>
        ))}
        {apps !== null && !list.length && <p className="p-2 text-[12.5px] text-muted">No matches.</p>}
      </div>
    </div>
  );
}

function Themes(props: {
  themes: DockTheme[];
  current: DockStyle;
  onApply: (s: DockStyle) => void;
  onChange: (t: DockTheme[]) => void;
  setMessage: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const save = () => {
    const n = name.trim() || `My theme ${props.themes.length + 1}`;
    props.onChange([...props.themes.filter((t) => t.name !== n), { name: n, style: props.current }]);
    setName("");
    props.setMessage(`Saved “${n}”.`);
  };
  const btn = "rounded-md border border-line px-2.5 py-1 text-[12.5px] hover:bg-panel-hover";
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="mb-1 text-[14px] font-medium">Themes</p>
      <p className="mb-3 text-[12.5px] text-muted">Save the current look, switch between looks, or share them as .json files.</p>

      <p className="mb-1.5 text-[12px] font-semibold text-muted">Presets</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((t) => (
          <button key={t.name} type="button" className={btn} onClick={() => props.onApply(t.style)}>{t.name}</button>
        ))}
      </div>

      <p className="mb-1.5 text-[12px] font-semibold text-muted">Saved</p>
      <ul className="mb-3 divide-y divide-line">
        {props.themes.map((t) => (
          <li key={t.name} className="flex items-center gap-2 py-1.5 text-[13px]">
            <span className="flex-1 truncate">{t.name}</span>
            <button type="button" className={btn} onClick={() => props.onApply(t.style)}>Apply</button>
            <button type="button" className={btn} onClick={async () => {
              try {
                if (await exportTheme(t)) props.setMessage(`Exported “${t.name}”.`);
              } catch (e) {
                props.setMessage(String(e));
              }
            }}>Export</button>
            <button type="button" className={`${btn} text-red-400`} onClick={() => props.onChange(props.themes.filter((x) => x.name !== t.name))}>Delete</button>
          </li>
        ))}
        {!props.themes.length && <li className="py-1.5 text-[12.5px] text-muted">No saved themes yet.</li>}
      </ul>

      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Theme name" aria-label="Theme name"
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="flex-1 rounded-md border border-line bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-accent" />
        <button type="button" onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">Save current</button>
        <button type="button" className={btn} onClick={async () => {
          try {
            const t = await importTheme();
            if (t) {
              props.onChange([...props.themes.filter((x) => x.name !== t.name), t]);
              props.setMessage(`Imported “${t.name}”.`);
            }
          } catch (e) {
            props.setMessage(String(e));
          }
        }}>Import…</button>
      </div>
    </div>
  );
}
