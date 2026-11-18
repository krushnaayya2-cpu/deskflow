// Settings window shell: sidebar navigation + animated content pane.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { getConfig, onConfigChanged, setConfig, type Config } from "../lib/config";
import { applyTheme } from "../lib/theme";
import { AboutSection, AppearanceSection, ComingSoon, GeneralSection, IslandSection, type SectionProps } from "./sections";

type SectionId = "general" | "appearance" | "dock" | "island" | "convert" | "desktop" | "ai" | "about";

const SECTIONS: { id: SectionId; label: string; icon: string; render: (p: SectionProps) => ReactElement }[] = [
  { id: "general", label: "General", icon: "⚙", render: (p) => <GeneralSection {...p} /> },
  { id: "appearance", label: "Appearance", icon: "◐", render: (p) => <AppearanceSection {...p} /> },
  { id: "island", label: "Dynamic Island", icon: "⬬", render: (p) => <IslandSection {...p} /> },
  { id: "dock", label: "Dock", icon: "▭", render: () => <ComingSoon step={2} what="Glass dock, 6 designs, themes with JSON import/export." /> },
  { id: "convert", label: "Converter", icon: "◎", render: () => <ComingSoon step={4} what="Hover-to-convert circle menu with a local conversion engine." /> },
  { id: "desktop", label: "Desktop", icon: "▦", render: () => <ComingSoon step={5} what="Fences, sorting rules and one-click clean with undo." /> },
  { id: "ai", label: "AI Apps", icon: "✦", render: () => <ComingSoon step={6} what="AI spotlight in the dock and styled AI notifications." /> },
  { id: "about", label: "About", icon: "ⓘ", render: () => <AboutSection /> },
];

export default function App() {
  const [config, setLocal] = useState<Config | null>(null);
  const [active, setActive] = useState<SectionId>("general");
  const [saveError, setSaveError] = useState<string | null>(null);
  const configRef = useRef<Config | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const navRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const show = useCallback((c: Config) => {
    configRef.current = c;
    setLocal(c);
    applyTheme(c.appearance.theme, c.appearance.accent);
  }, []);

  useEffect(() => {
    getConfig().then(show).catch((e) => setSaveError(String(e)));
    const unlisten = onConfigChanged(show); // tray menu or another window changed settings
    return () => {
      unlisten.then((f) => f());
    };
  }, [show]);

  /**
   * Update UI instantly, then save. Rapid changes (dragging the colour picker)
   * are debounced; `immediate` saves right away and reports backend errors.
   */
  const update: SectionProps["update"] = useCallback(
    async (fn, opts) => {
      if (!configRef.current) return null;
      const previous = configRef.current;
      const next = fn(previous);
      show(next);
      window.clearTimeout(saveTimer.current);
      const save = async () => {
        try {
          await setConfig(next);
          setSaveError(null);
          return null;
        } catch (e) {
          show(previous); // roll back to what is actually saved
          const msg = String(e);
          setSaveError(msg);
          return msg;
        }
      };
      if (opts?.immediate) return save();
      saveTimer.current = window.setTimeout(save, 250);
      return null;
    },
    [show],
  );

  // Up/Down arrows move between sidebar entries (WAI-ARIA tabs pattern).
  const onNavKey = (e: KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + SECTIONS.length) % SECTIONS.length;
    setActive(SECTIONS[next].id);
    navRefs.current[next]?.focus();
  };

  const current = SECTIONS.find((s) => s.id === active)!;

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="flex h-full bg-bg">
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings sections"
          className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line p-3"
        >
          <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
            <img src="/icon.png" alt="" className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight">DeskFlow</span>
          </div>
          {SECTIONS.map((s, i) => {
            const selected = s.id === active;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  navRefs.current[i] = el;
                }}
                id={`tab-${s.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls="settings-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(s.id)}
                onKeyDown={(e) => onNavKey(e, i)}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
                  selected ? "text-fg" : "text-muted hover:bg-panel hover:text-fg"
                }`}
              >
                {selected && (
                  <m.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-lg bg-panel-hover"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                {selected && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />}
                <span aria-hidden className="relative w-4 text-center">
                  {s.icon}
                </span>
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </nav>

        <main
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`tab-${active}`}
          className="flex-1 overflow-y-auto px-8 py-7"
        >
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <h1 className="mb-5 text-[22px] font-semibold tracking-tight">{current.label}</h1>
              {config ? current.render({ config, update }) : <p className="text-muted">Loading…</p>}
            </m.div>
          </AnimatePresence>
          {saveError && (
            <p role="alert" className="mt-4 text-[12.5px] text-red-400">
              Couldn’t save: {saveError}
            </p>
          )}
        </main>
      </div>
    </LazyMotion>
  );
}
