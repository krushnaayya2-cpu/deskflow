// AI task cards for the Dynamic Island, in eight styles modelled on the
// user's reference designs. Each style returns the island's shape, surface
// and content for the task's current state:
//   running → permission (Deny / Allow once) → completed (View result)
//                                           ↘ attention (Review)
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { m } from "framer-motion";
import type { AiNotification, AiStatus, AiTask } from "../../lib/ai";
import { decide, dismiss, openTarget } from "../../lib/ai";
import type { PinnedApp } from "../../lib/config";
import { getIcon } from "../../lib/dock";
import "./ai.css";

export interface AiLook {
  /** Shared glass classes for the card's surface. */
  surfaceClass?: string;
  w: number;
  h: number;
  r: number;
  surface: CSSProperties;
  shadow: string;
  /** Draw outside a single pill (Split, Sidecar, Ticket use their own shapes). */
  bare?: boolean;
  content: ReactNode;
}

const COLORS: Record<AiStatus, { main: string; soft: string; text: string }> = {
  running: { main: "#3b82f6", soft: "rgba(59,130,246,0.14)", text: "Running" },
  permission: { main: "#f59e0b", soft: "rgba(245,158,11,0.16)", text: "Permission needed" },
  completed: { main: "#22c55e", soft: "rgba(34,197,94,0.15)", text: "Completed" },
  attention: { main: "#ef4444", soft: "rgba(239,68,68,0.14)", text: "Needs attention" },
};
const TICKER: Record<AiStatus, string> = { running: "#22d3ee", permission: "#fbbf24", completed: "#34d399", attention: "#f87171" };

const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation() };

// ---- Shared pieces -------------------------------------------------------------

/** The app's real icon when it is one of the detected AI apps, else a sparkle. */
export function AppIcon({ task, apps, size, light }: { task: AiTask; apps: PinnedApp[]; size: number; light?: boolean }) {
  const app = apps.find((a) => a.name.toLowerCase().includes(task.app.toLowerCase()) || task.app.toLowerCase().includes(a.name.toLowerCase()));
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (app) getIcon(app.target || app.path).then(setSrc).catch(() => {});
  }, [app?.path]);
  if (src) return <img src={src} alt="" style={{ width: size, height: size }} className="shrink-0" draggable={false} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[30%]" style={{ width: size, height: size, background: light ? "rgba(249,115,22,0.12)" : "rgba(249,115,22,0.18)", color: "#f97316" }}>
      <Sparkle size={size * 0.62} />
    </span>
  );
}

export const Sparkle = ({ size, color = "currentColor" }: { size: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" fill={color} />
    <path d="M19 15c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z" fill={color} opacity=".7" />
  </svg>
);

function StatusIcon({ status, size, color }: { status: AiStatus; size: number; color?: string }) {
  const c = color ?? COLORS[status].main;
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (status) {
    case "running":
      return <svg {...p} className="ai-spin"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>;
    case "permission":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></svg>;
    case "completed":
      return <svg {...p}><circle cx="12" cy="12" r="9" fill={c} stroke="none" /><path d="m8 12 3 3 5-6" stroke="#fff" /></svg>;
    case "attention":
      return <svg {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>;
  }
}

const Lock = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

function Btn(props: { children: ReactNode; onClick: () => void; kind: "primary" | "neutral" | "ghost"; color?: string; s: number; dark?: boolean }) {
  const st: CSSProperties =
    props.kind === "primary"
      ? { background: props.color, color: props.color === "#fbbf24" || props.color === "#f59e0b" || props.color === "#34d399" ? "#1a1205" : "#fff" }
      : props.kind === "neutral"
        ? { background: props.dark ? "rgba(255,255,255,0.1)" : "#fff", border: `1px solid ${props.dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)"}` }
        : { color: props.color };
  return (
    <button type="button" {...stop} onClick={props.onClick}
      className={`shrink-0 rounded-full font-semibold whitespace-nowrap ${props.kind === "primary" ? "lg-btn" : props.kind === "neutral" ? "lg-btn lg-btn-plain" : ""}`}
      style={{ ...st, fontSize: 12.5 * props.s, padding: `${6 * props.s}px ${13 * props.s}px` }}>
      {props.children}
    </button>
  );
}

/** Buttons for the current state. */
function Actions({ t, s, dark, allowColor }: { t: AiTask; s: number; dark: boolean; allowColor: string }) {
  if (t.status === "permission")
    return (
      <div className="flex shrink-0 gap-2">
        <Btn kind="neutral" s={s} dark={dark} onClick={() => decide(t.id, "deny")}>Deny</Btn>
        <Btn kind="primary" s={s} color={allowColor} onClick={() => decide(t.id, "allow")}>Allow once</Btn>
      </div>
    );
  if (t.status === "completed")
    return <Btn kind="neutral" s={s} dark={dark} onClick={() => finish(t)}>{t.result ? "View result" : "Done"}</Btn>;
  if (t.status === "attention")
    return <Btn kind="primary" s={s} color="#2563eb" onClick={() => finish(t)}>Review</Btn>;
  return null;
}

/** Open the result (if any) and clear the card. */
function finish(t: AiTask) {
  if (t.result) openTarget(t.result).catch(() => {});
  dismiss(t.id).catch(() => {});
}

const stepText = (t: AiTask) => (t.step && t.steps ? `${t.step} of ${t.steps}` : "");
const progress = (t: AiTask) => (t.status === "completed" ? 1 : t.step && t.steps ? t.step / t.steps : 0.35);

function Segments({ t, s, color, track }: { t: AiTask; s: number; color: string; track: string }) {
  const n = t.steps ?? 4;
  const done = t.status === "completed" ? n : t.step ?? 1;
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="rounded-full transition-colors" style={{ width: 28 * s, height: 5 * s, background: i < done ? color : track }} />
      ))}
    </div>
  );
}

function Bar({ t, s, color, width }: { t: AiTask; s: number; color: string; width: number }) {
  return (
    <div className="overflow-hidden rounded-full" style={{ width: width * s, height: 4 * s, background: "rgba(255,255,255,0.12)" }}>
      <m.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${progress(t) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
    </div>
  );
}

const Divider = ({ s, light }: { s: number; light?: boolean }) => <span className="shrink-0" style={{ width: 1, height: 26 * s, background: light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.18)" }} />;

// ---- Styles ------------------------------------------------------------------------

export function aiLook(style: string, t: AiTask, apps: PinnedApp[], s: number): AiLook {
  const c = COLORS[t.status];
  switch (style) {
    case "split": {
      const light = "rgba(255,255,255,0.94)";
      return {
        w: t.status === "running" ? 560 : 640, h: 58, r: 29, bare: true, surface: {}, shadow: "none",
        content: (
          <div className="flex h-full w-full items-center gap-2 text-[#111827]">
            <div className="flex h-full items-center gap-2 rounded-full px-3" style={{ background: light, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
              <AppIcon task={t} apps={apps} size={30 * s} light />
              <span className="font-semibold" style={{ fontSize: 15 * s }}>{t.app}</span>
              <span className="opacity-60">⌄</span>
            </div>
            <div className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-full px-3" style={{ background: `linear-gradient(${c.soft}, ${c.soft}), ${light}`, border: `1.5px solid ${c.main}66`, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" style={{ background: c.soft, color: c.main, fontSize: 12.5 * s }}>
                <StatusIcon status={t.status} size={16 * s} /> {c.text}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium" style={{ fontSize: 14 * s }}>{t.title}</span>
              {t.status === "running" ? <span className="shrink-0 text-gray-500" style={{ fontSize: 13 * s }}>{stepText(t)}</span> : <Actions t={t} s={s} dark={false} allowColor="#2563eb" />}
            </div>
          </div>
        ),
      };
    }
    case "paper": {
      const ask = t.status === "permission";
      return {
        w: 520, h: ask ? 190 : 104, r: 40,
        surface: { background: "linear-gradient(180deg, rgba(238,240,252,0.95), rgba(226,230,248,0.92))", border: "1px solid rgba(255,255,255,0.9)", color: "#1e1b4b" },
        shadow: "0 0 40px rgba(139,152,255,0.45), 0 10px 30px rgba(0,0,0,0.25)",
        content: (
          <div className="flex h-full w-full flex-col items-stretch justify-center gap-2 py-2">
            {t.tag && (
              <span className="mx-auto flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-0.5 font-medium" style={{ fontSize: 11.5 * s }}>
                <Sparkle size={12 * s} color="#6366f1" /> {t.tag} ⌄
              </span>
            )}
            <div className="flex items-center gap-3">
              <span className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-2.5 py-1.5 font-semibold shadow-sm" style={{ fontSize: 13 * s }}>
                <AppIcon task={t} apps={apps} size={20 * s} light /> {t.app}
              </span>
              <Divider s={s} light />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold" style={{ fontSize: 14 * s }}>{ask ? "Waiting for you" : t.title}</p>
                <div className="mt-1 flex items-center gap-2" style={{ fontSize: 11 * s }}>
                  {t.status === "running" && <span className="opacity-60">{stepText(t)}</span>}
                  <Segments t={t} s={s * 0.8} color="#6366f1" track="rgba(99,102,241,0.18)" />
                </div>
              </div>
              {!ask && (
                <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium" style={{ background: c.soft, color: c.main, fontSize: 11.5 * s }}>
                  <StatusIcon status={t.status} size={13 * s} /> {c.text}
                </span>
              )}
              {(t.status === "completed" || t.status === "attention") && <Actions t={t} s={s * 0.9} dark={false} allowColor="#4f46e5" />}
            </div>
            {ask && (
              <m.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-white px-4 py-3 shadow-md">
                <p className="flex items-center gap-2 font-semibold" style={{ fontSize: 12 * s }}><AppIcon task={t} apps={apps} size={18 * s} light /> {t.app}</p>
                <p className="mt-1 text-center font-semibold" style={{ fontSize: 15 * s }}>{t.title}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" {...stop} onClick={() => decide(t.id, "deny")} className="flex-1 rounded-xl bg-gray-100 py-1.5 font-semibold" style={{ fontSize: 13 * s }}>Deny</button>
                  <button type="button" {...stop} onClick={() => decide(t.id, "allow")} className="flex-1 rounded-xl py-1.5 font-semibold text-white" style={{ fontSize: 13 * s, background: "#4f46e5" }}>Allow once</button>
                </div>
              </m.div>
            )}
          </div>
        ),
      };
    }
    case "shutters": {
      const open = t.status === "permission";
      const col = TICKER[t.status];
      const panel = (dir: "l" | "r") => (
        <m.div className="flex h-full items-center justify-center" style={{ width: 54 * s, background: "rgba(255,255,255,0.06)", borderRadius: dir === "l" ? "999px 0 0 999px" : "0 999px 999px 0" }}
          initial={{ x: 0 }} animate={{ x: open ? (dir === "l" ? -6 : 6) : 0 }}>
          {open && <span className="opacity-70">{dir === "l" ? "←" : "→"}</span>}
        </m.div>
      );
      return {
        w: open ? 470 : 360, h: t.status === "running" ? 58 : 76, r: open ? 26 : 29,
        surface: { background: "linear-gradient(180deg,#1c2129,#12161c)", border: `1.5px solid ${open ? col : "rgba(255,255,255,0.12)"}`, color: "#fff" },
        shadow: `0 0 22px ${col}33, 0 10px 30px rgba(0,0,0,0.5)`,
        content: (
          <div className="flex h-full w-full items-center" style={{ margin: `0 -${16 * s}px` }}>
            {(open || t.status === "completed") && panel("l")}
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 px-3">
              <p className="flex max-w-full items-center gap-2 truncate font-semibold" style={{ fontSize: 15 * s }}>
                {t.status === "running" ? <Sparkle size={18 * s} color={col} /> : <StatusIcon status={t.status} size={18 * s} color={col} />} {t.title}
              </p>
              {t.status === "running" && <Bar t={t} s={s} color={col} width={180} />}
              {open && <Actions t={t} s={s * 0.9} dark allowColor={col} />}
              {(t.status === "completed" || t.status === "attention") && <Actions t={t} s={s * 0.85} dark allowColor={col} />}
            </div>
            {(open || t.status === "completed") && panel("r")}
          </div>
        ),
      };
    }
    case "sidecar": {
      const col = TICKER[t.status];
      const card = t.status !== "running";
      return {
        w: card ? 470 : 320, h: card ? 92 : 58, r: 29, bare: true, surface: {}, shadow: "none",
        content: (
          <div className="flex h-full w-full items-center gap-2 text-white">
            <m.div layout className="flex shrink-0 items-center gap-2.5 rounded-full px-4"
              style={{ height: 58 * s, background: "linear-gradient(180deg,#151b26,#0d1118)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 26px rgba(0,0,0,0.5)" }}>
              <Sparkle size={20 * s} color="#22d3ee" />
              {!card && (
                <div className="flex flex-col gap-1">
                  <span className="truncate font-semibold" style={{ fontSize: 14 * s, maxWidth: 200 * s }}>{t.title}</span>
                  <Bar t={t} s={s} color="#22d3ee" width={170} />
                </div>
              )}
            </m.div>
            {card && (
              <m.div initial={{ opacity: 0, x: -16, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="flex h-full min-w-0 flex-1 flex-col justify-center gap-2 rounded-2xl px-4"
                style={{ background: "linear-gradient(180deg,#161c27,#0f141c)", border: `1.5px solid ${col}`, boxShadow: `0 0 20px ${col}44` }}>
                <p className="flex items-center gap-2 truncate font-semibold" style={{ fontSize: 15 * s }}>
                  {t.status === "permission" ? "📁" : <StatusIcon status={t.status} size={18 * s} color={col} />} {t.title}
                  {t.status === "permission" && <button type="button" {...stop} onClick={() => decide(t.id, "deny")} className="ml-auto opacity-60" aria-label="Deny">✕</button>}
                </p>
                <div className="self-start"><Actions t={t} s={s * 0.85} dark allowColor={col} /></div>
              </m.div>
            )}
          </div>
        ),
      };
    }
    case "taskmap": {
      const col = TICKER[t.status];
      const labels = t.stepLabels.length ? t.stepLabels : Array.from({ length: t.steps ?? 3 }, (_, i) => `Step ${i + 1}`);
      const cur = t.step ?? 1;
      return {
        w: 600, h: 64, r: 32,
        surface: { background: "linear-gradient(180deg,#141a22,#0c1016)", border: `1.5px solid ${col}66`, color: "#fff" },
        shadow: `0 0 22px ${col}33, 0 10px 30px rgba(0,0,0,0.5)`,
        content: (
          <div className="flex w-full items-center gap-3">
            <Sparkle size={20 * s} color={col} />
            <span className="min-w-0 flex-1 truncate font-semibold" style={{ fontSize: 14.5 * s }}>{t.title}</span>
            <div className="flex shrink-0 items-start">
              {labels.map((l, i) => {
                const n = i + 1;
                const done = t.status === "completed" || n < cur;
                const here = n === cur && t.status !== "completed";
                return (
                  <div key={l} className="flex items-start">
                    {i > 0 && <span className="mt-[9px] block" style={{ width: 34 * s, height: 2, background: n <= cur || t.status === "completed" ? col : "rgba(255,255,255,0.2)" }} />}
                    <div className="flex flex-col items-center" style={{ width: 20 * s }}>
                      <span className="flex items-center justify-center rounded-full" style={{ width: 20 * s, height: 20 * s, border: `2px solid ${done || here ? col : "rgba(255,255,255,0.3)"}`, background: done ? col : "transparent" }}>
                        {done ? <span style={{ fontSize: 11 * s, color: "#0b0f14" }}>✓</span> : here && t.status === "permission" ? <Lock size={11 * s} color={col} /> : here ? <span className="rounded-full" style={{ width: 7 * s, height: 7 * s, background: col }} /> : null}
                      </span>
                      <span className="mt-1 whitespace-nowrap opacity-75" style={{ fontSize: 10 * s }}>{l}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {t.status !== "running" && <Actions t={t} s={s * 0.85} dark allowColor={col} />}
          </div>
        ),
      };
    }
    case "ticket": {
      const col = TICKER[t.status];
      const card = t.status !== "running";
      return {
        w: card ? 340 : 320, h: card ? 200 : 58, r: 28, bare: true, surface: {}, shadow: "none",
        content: (
          <div className="flex h-full w-full flex-col items-center">
            <div className="flex w-full items-center justify-center gap-2.5 rounded-full px-4 text-white"
              style={{ height: 52 * s, background: "linear-gradient(180deg,#151b24,#0d1117)", border: `1.5px solid ${card ? col : "rgba(255,255,255,0.12)"}`, boxShadow: `0 0 20px ${col}33` }}>
              {t.status === "running" ? <Sparkle size={18 * s} color="#22d3ee" /> : <StatusIcon status={t.status} size={18 * s} color={col} />}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-semibold" style={{ fontSize: 14 * s }}>{t.title}</span>
                {!card && <Bar t={t} s={s} color="#22d3ee" width={170} />}
              </div>
            </div>
            {card && (
              <m.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}
                className="ticket-edge -mt-1 flex w-[88%] flex-col items-center gap-2 bg-[#fbfaf7] px-4 pt-4 pb-6 text-[#1f2937]">
                <p className="flex items-center gap-2 font-semibold" style={{ fontSize: 14 * s }}>
                  {t.status === "permission" ? "📁" : <StatusIcon status={t.status} size={18 * s} />} {t.status === "permission" ? "Waiting for you" : t.detail || (t.status === "completed" ? "Your result is ready" : "Something needs a look")}
                </p>
                {t.status === "permission" ? (
                  <div className="flex gap-2">
                    <Btn kind="neutral" s={s * 0.9} onClick={() => decide(t.id, "deny")}>Deny</Btn>
                    <Btn kind="primary" s={s * 0.9} color="#fbbf24" onClick={() => decide(t.id, "allow")}>Allow once</Btn>
                  </div>
                ) : (
                  <button type="button" {...stop} onClick={() => finish(t)} className="font-semibold" style={{ color: t.status === "completed" ? "#16a34a" : "#dc2626", fontSize: 13 * s }}>
                    {t.status === "completed" ? "View result ›" : "Review ›"}
                  </button>
                )}
              </m.div>
            )}
          </div>
        ),
      };
    }
    case "lifecycle": {
      const col = { running: "#3b82f6", permission: "#f59e0b", completed: "#22c55e", attention: "#ef4444" }[t.status];
      return {
        w: t.status === "running" ? 400 : 560, h: 62, r: 31,
        surface: { background: "linear-gradient(180deg,#1a1f2b,#10141c)", border: `1px solid ${t.status === "permission" ? col + "88" : "rgba(255,255,255,0.1)"}`, color: "#fff" },
        shadow: `0 0 18px ${col}22, 0 10px 28px rgba(0,0,0,0.5)`,
        content: (
          <div className="flex w-full items-center gap-3">
            <m.span key={t.status} initial={{ scale: 0.5, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
              className="flex shrink-0 items-center justify-center rounded-full" style={{ width: 40 * s, height: 40 * s, background: `${col}22` }}>
              {t.status === "running" ? <Dots color={col} s={s} /> : t.status === "permission" ? <Lock size={20 * s} color={col} /> : <StatusIcon status={t.status} size={22 * s} color={col} />}
            </m.span>
            <Divider s={s} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold" style={{ fontSize: 15 * s }}>{t.title}</p>
              {(t.detail || stepText(t)) && <p className="truncate opacity-60" style={{ fontSize: 11.5 * s }}>{t.detail || `Step ${stepText(t)}`}</p>}
            </div>
            <Actions t={t} s={s * 0.9} dark allowColor="#3b82f6" />
          </div>
        ),
      };
    }
    default: {
      // Ticker
      const col = TICKER[t.status];
      return {
        w: t.status === "running" ? 560 : 600, h: 54, r: 27,
        surface: { background: "linear-gradient(180deg,#0f1520,#0a0e15)", border: `1.5px solid ${col}`, color: "#fff" },
        shadow: `0 0 16px ${col}66, 0 0 40px ${col}22, inset 0 0 14px ${col}1a`,
        content: (
          <div className="flex w-full items-center gap-3">
            <AppIcon task={t} apps={apps} size={24 * s} />
            <span className="font-semibold" style={{ fontSize: 14.5 * s }}>{t.app}</span>
            <Divider s={s} />
            <m.span key={t.title} initial={{ x: 40, opacity: 0, filter: "blur(4px)" }} animate={{ x: 0, opacity: 1, filter: "blur(0px)" }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold" style={{ fontSize: 15 * s, fontStyle: t.status === "running" ? "italic" : undefined }}>
              {t.status === "completed" && <StatusIcon status="completed" size={18 * s} color={col} />}
              <span className="truncate">{t.title}{t.status === "running" ? "…" : ""}</span>
              <span className="ai-trail shrink-0" style={{ width: 70 * s, background: `linear-gradient(90deg, ${col}88, transparent)` }} />
            </m.span>
            {t.status === "running" ? (
              <>
                {stepText(t) && <span className="shrink-0 rounded-full px-2.5 py-0.5" style={{ border: `1px solid ${col}88`, fontSize: 12 * s }}>Step {stepText(t)}</span>}
                <StatusIcon status="running" size={22 * s} color={col} />
              </>
            ) : (
              <Actions t={t} s={s * 0.9} dark allowColor={col} />
            )}
          </div>
        ),
      };
    }
  }
}

function Dots({ color, s }: { color: string; s: number }) {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="ai-dot rounded-full" style={{ width: 6 * s, height: 6 * s, background: color, animationDelay: `${i * 0.18}s` }} />
      ))}
    </span>
  );
}

// ---- Plain AI notification card -------------------------------------------------

/** Text that types itself out, ~40 characters a second. */
export function Typing({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const iv = window.setInterval(() => setN((x) => (x >= text.length ? (window.clearInterval(iv), x) : x + 2)), 50);
    return () => window.clearInterval(iv);
  }, [text]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ai-caret">▍</span>}
    </>
  );
}

export function noteLook(n: AiNotification, apps: PinnedApp[], accent: string, s: number, onClose: () => void): AiLook {
  const t = { app: n.app } as AiTask;
  return {
    w: 470, h: 112, r: 30,
    // The shared glass material; the gradient border stays, it is what
    // marks this out as a notification rather than a task card.
    surfaceClass: "lg-ai-card",
    surface: {
      background: `linear-gradient(160deg, rgba(24,26,34,0.82), rgba(12,13,18,0.86)) padding-box, linear-gradient(120deg, ${accent}, #a855f7, #22d3ee) border-box`,
      border: "1.5px solid transparent",
      color: "#fff",
    },
    shadow: `0 0 28px ${accent}44, 0 12px 34px rgba(0,0,0,0.5)`,
    content: (
      <div className="flex w-full items-start gap-3 py-3">
        <AppIcon task={t} apps={apps} size={38 * s} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 opacity-60" style={{ fontSize: 11.5 * s }}>
            <Sparkle size={11 * s} color="#c084fc" /> {n.app}
          </p>
          <p className="truncate font-semibold" style={{ fontSize: 14.5 * s }}>{n.title}</p>
          <p className="line-clamp-2 opacity-80" style={{ fontSize: 12.5 * s, lineHeight: 1.35 }}><Typing text={n.body} /></p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {n.url && (
            <Btn kind="primary" s={s * 0.85} color={accent} onClick={() => (openTarget(n.url!).catch(() => {}), onClose())}>Open</Btn>
          )}
          <Btn kind="neutral" s={s * 0.85} dark onClick={onClose}>Dismiss</Btn>
        </div>
      </div>
    ),
  };
}

/** Which task deserves the island right now (null = none). */
export function pickTask(tasks: AiTask[], now: number): AiTask | null {
  const rank = (t: AiTask) =>
    t.status === "permission" ? 0 : t.status === "attention" ? 1 : t.status === "completed" ? (now - t.updated < COMPLETED_MS ? 2 : 9) : 3;
  const live = tasks.filter((t) => rank(t) < 9).sort((a, b) => rank(a) - rank(b) || b.updated - a.updated);
  return live[0] ?? null;
}
export const COMPLETED_MS = 12_000;
