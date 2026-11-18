// Small, accessible building blocks for the settings UI.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { comboFromEvent, displayCombo } from "../lib/hotkey";

/** A labelled setting row: label + description on the left, control on the right. */
export function Row(props: { label: string; description?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-line bg-panel px-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={props.htmlFor} className="block text-[14px] font-medium">
          {props.label}
        </label>
        {props.description && <p className="mt-0.5 text-[12.5px] text-muted">{props.description}</p>}
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}

/** On/off switch. Native button with role="switch" for screen readers. */
export function Toggle(props: { id?: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      id={props.id}
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
        props.checked ? "bg-accent" : "bg-line"
      }`}
    >
      <span
        className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300"
        style={{
          transform: props.checked ? "translateX(20px)" : "none",
          transitionTimingFunction: "cubic-bezier(.34,1.56,.64,1)", // springy overshoot
        }}
      />
    </button>
  );
}

/** Segmented control (radio group) with arrow-key support. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = props.options.findIndex((o) => o.value === props.value);
  const move = (delta: number) => {
    const next = (idx + delta + props.options.length) % props.options.length;
    props.onChange(props.options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={props.label} className="flex rounded-lg border border-line bg-panel p-0.5">
      {props.options.map((o, i) => {
        const active = o.value === props.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => props.onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(1));
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(-1));
            }}
            className={`rounded-md px-3 py-1 text-[13px] transition-colors ${
              active ? "bg-accent text-white shadow" : "text-muted hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Click (or press Enter), then press a key combination to record it.
 * Escape cancels. The combo is only saved once the backend accepts it.
 */
export function HotkeyRecorder(props: { id?: string; value: string; onChange: (combo: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        setPreview(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (combo) {
        setRecording(false);
        setPreview(null);
        props.onChange(combo);
      } else {
        // Show held modifiers while the user builds the combo.
        const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
        setPreview(mods.length ? `${mods.join("+")}+…` : null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, props]);

  return (
    <button
      id={props.id}
      ref={btn}
      type="button"
      aria-live="polite"
      onClick={() => setRecording((r) => !r)}
      onBlur={() => setRecording(false)}
      className={`min-w-36 rounded-lg border px-3 py-1.5 font-mono text-[13px] transition-colors ${
        recording ? "border-accent bg-accent/15 text-fg" : "border-line bg-panel hover:bg-panel-hover"
      }`}
    >
      {recording ? preview ?? "Press keys… (Esc to cancel)" : displayCombo(props.value)}
    </button>
  );
}

export const ACCENT_PRESETS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

/** Accent colour: preset swatches plus a custom colour picker. */
export function AccentPicker(props: { value: string; onChange: (hex: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex items-center gap-2">
      {ACCENT_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={props.value.toLowerCase() === c}
          aria-label={`Accent ${c}`}
          onClick={() => props.onChange(c)}
          className="h-6 w-6 rounded-full ring-offset-2 ring-offset-transparent transition-transform hover:scale-110"
          style={{
            background: c,
            boxShadow: props.value.toLowerCase() === c ? `0 0 0 2px var(--fg)` : undefined,
          }}
        />
      ))}
      <label className="relative ml-1 h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-line"
        style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
        <span className="sr-only">Custom accent colour</span>
        <input
          type="color"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

/** Labelled range slider showing its current value. */
export function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={props.id}
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-40 accent-[var(--accent)]"
      />
      <span className="w-14 text-right font-mono text-[12.5px] text-muted tabular-nums">
        {props.value}
        {props.unit ?? ""}
      </span>
    </div>
  );
}
