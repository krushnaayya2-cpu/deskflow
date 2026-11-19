// The convert window: a round button next to a hovered file, which opens a
// radial menu of conversions; the hub then shows a progress ring and a
// success pulse. The window is 360×360 and click-through outside the circle.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import { getConfig, type Config } from "../lib/config";
import {
  closeConvert,
  expand,
  getPending,
  installTool,
  onHover,
  onJob,
  onPending,
  setHitRects,
  start,
  type ConvOption,
  type JobUpdate,
  type Pending,
} from "../lib/convert";
import { Icon } from "./icons";

const SIZE = 360;
const C = SIZE / 2;
const RING = 116; // distance of option bubbles from the centre
const SPRING = { type: "spring", stiffness: 420, damping: 28 } as const;

type Phase = { kind: "menu" } | { kind: "install"; option: ConvOption } | { kind: "installing"; option: ConvOption; error?: string } | { kind: "job"; id: number };

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function Convert() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "menu" });
  const [job, setJob] = useState<JobUpdate | null>(null);
  const [hovered, setHovered] = useState(false);
  const [accent, setAccent] = useState("#7c5cff");
  const jobId = useRef<number | null>(null);

  const reload = useCallback(() => {
    getPending().then((p) => {
      setPending(p);
      setPhase({ kind: "menu" });
      setJob(null);
      jobId.current = null;
    });
  }, []);

  useEffect(() => {
    reload();
    getConfig().then((c: Config) => setAccent(c.appearance.accent)).catch(() => {});
    const subs = [
      onPending(reload),
      onHover(setHovered),
      onJob((j) => {
        if (j.id === jobId.current) setJob(j);
      }),
    ];
    return () => subs.forEach((p) => p.then((f) => f()));
  }, [reload]);

  const mode = pending?.mode ?? "button";

  // Clickable area: the small button, or the whole radial menu.
  useEffect(() => {
    const r = mode === "button" ? 30 : 168;
    setHitRects([{ x: C - r, y: C - r, w: r * 2, h: r * 2 }]).catch(() => {});
  }, [mode]);

  // Leaving the menu closes it (unless a conversion is running).
  useEffect(() => {
    if (hovered || mode !== "menu" || phase.kind === "job" || phase.kind === "installing") return;
    const t = window.setTimeout(() => closeConvert(), 1600);
    return () => window.clearTimeout(t);
  }, [hovered, mode, phase.kind]);

  // Finished: show the result briefly, then tidy away.
  useEffect(() => {
    if (job?.state !== "done" && job?.state !== "error") return;
    const t = window.setTimeout(() => closeConvert(), job.state === "done" ? 1600 : 4000);
    return () => window.clearTimeout(t);
  }, [job?.state]);

  if (!pending) return null;

  const choose = async (o: ConvOption) => {
    if (!o.available) return setPhase({ kind: "install", option: o });
    const id = await start(pending.files, o.id);
    jobId.current = id;
    setPhase({ kind: "job", id });
  };

  const install = async (o: ConvOption) => {
    setPhase({ kind: "installing", option: o });
    try {
      await installTool(o.tool!);
      const p = await getPending();
      setPending(p);
      setPhase({ kind: "menu" });
    } catch (e) {
      setPhase({ kind: "installing", option: o, error: String(e) });
    }
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="fixed inset-0">
        <AnimatePresence initial={true} mode="wait">
          {mode === "button" ? (
            <m.button
              key="button"
              type="button"
              aria-label={`Convert ${fileName(pending.files[0] ?? "")}`}
              title="Convert this file"
              onClick={async () => {
                await expand();
                setPending({ ...pending, mode: "menu" });
              }}
              className="absolute flex items-center justify-center rounded-full text-white"
              style={{ left: C - 22, top: C - 22, width: 44, height: 44, background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 0 0 3px rgba(255,255,255,0.25), 0 6px 20px ${accent}88` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.12 }}
              transition={SPRING}
            >
              <Icon name="convert" size={20} />
            </m.button>
          ) : (
            <m.div key="menu" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Glass disc behind everything */}
              <m.div
                className="absolute rounded-full"
                style={{ left: C - 160, top: C - 160, width: 320, height: 320, background: "radial-gradient(circle, rgba(20,20,30,0.82) 55%, rgba(20,20,30,0.55))", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", backdropFilter: "blur(18px)" }}
                initial={{ scale: 0.3 }}
                animate={{ scale: phase.kind === "job" ? 0.62 : 1 }}
                transition={SPRING}
              />
              {phase.kind === "menu" && <Options options={pending.options} accent={accent} onChoose={choose} />}
              <Hub
                pending={pending}
                phase={phase}
                job={job}
                accent={accent}
                onClose={() => closeConvert()}
                onInstall={install}
                onBack={() => setPhase({ kind: "menu" })}
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}

function Options({ options, accent, onChoose }: { options: ConvOption[]; accent: string; onChoose: (o: ConvOption) => void }) {
  if (!options.length) return null;
  return (
    <>
      {options.map((o, i) => {
        const angle = -Math.PI / 2 + (i / options.length) * Math.PI * 2;
        const x = C + Math.cos(angle) * RING;
        const y = C + Math.sin(angle) * RING;
        return (
          <m.button
            key={o.id}
            type="button"
            onClick={() => onChoose(o)}
            title={o.available ? `Convert to ${o.label}` : `Needs ${o.tool} — click to install`}
            aria-label={o.available ? `Convert to ${o.label}` : `Convert to ${o.label} (needs ${o.tool})`}
            className="absolute flex flex-col items-center justify-center rounded-full text-[11px] font-semibold"
            style={{
              width: 66,
              height: 66,
              left: x - 33,
              top: y - 33,
              background: o.available ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${o.available ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"}`,
              color: o.available ? "#fff" : "rgba(255,255,255,0.5)",
            }}
            initial={{ scale: 0, x: C - x, y: C - y, opacity: 0 }}
            animate={{ scale: 1, x: 0, y: 0, opacity: 1 }}
            whileHover={{ scale: 1.12, backgroundColor: `${accent}55` }}
            transition={{ ...SPRING, delay: i * 0.035 }}
          >
            <Icon name={o.icon} size={20} />
            <span className="mt-0.5 leading-none">{o.label}</span>
            {!o.available && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: accent }}>
                <Icon name="download" size={11} />
              </span>
            )}
          </m.button>
        );
      })}
    </>
  );
}

function Hub(props: {
  pending: Pending;
  phase: Phase;
  job: JobUpdate | null;
  accent: string;
  onClose: () => void;
  onInstall: (o: ConvOption) => void;
  onBack: () => void;
}) {
  const { pending, phase, job, accent } = props;
  const n = pending.files.length;
  const box = "absolute flex flex-col items-center justify-center rounded-full text-center";
  const style = { left: C - 58, top: C - 58, width: 116, height: 116, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)" };

  if (phase.kind === "install" || phase.kind === "installing") {
    const label = phase.option.tool === "libreoffice" ? "LibreOffice" : phase.option.tool === "ffmpeg" ? "FFmpeg" : "Poppler";
    return (
      <m.div className={`${box} gap-1.5 px-3`} style={{ ...style, left: C - 80, top: C - 80, width: 160, height: 160 }} initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
        {phase.kind === "installing" && !phase.error ? (
          <>
            <Spinner accent={accent} />
            <p className="text-[11.5px] leading-tight opacity-80">Installing {label}…</p>
          </>
        ) : (
          <>
            <p className="text-[11.5px] leading-tight opacity-85">{phase.kind === "installing" ? phase.error : `This needs ${label} (free). Install it now?`}</p>
            <div className="flex gap-1.5">
              <button type="button" className="rounded-full bg-white/15 px-2.5 py-1 text-[11.5px]" onClick={props.onBack}>Back</button>
              <button type="button" className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: accent }} onClick={() => props.onInstall(phase.option)}>Install</button>
            </div>
          </>
        )}
      </m.div>
    );
  }

  if (phase.kind === "job") {
    const p = job?.progress ?? 0;
    const done = job?.state === "done";
    const failed = job?.state === "error";
    return (
      <div className={box} style={{ ...style, background: "transparent", border: "none" }}>
        {done && <span className="pulse-ring absolute inset-0 rounded-full" style={{ border: "3px solid #4ade80" }} />}
        <svg width="116" height="116" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="58" cy="58" r="50" stroke="rgba(255,255,255,0.12)" strokeWidth="6" fill="none" />
          {p >= 0 && !failed && (
            <circle cx="58" cy="58" r="50" stroke={done ? "#4ade80" : accent} strokeWidth="6" fill="none" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - (done ? 1 : p))} style={{ transition: "stroke-dashoffset .3s, stroke .3s" }} />
          )}
        </svg>
        {p < 0 && !done && !failed && <div className="absolute inset-0"><Spinner accent={accent} big /></div>}
        <m.div key={job?.state} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING} className="relative flex flex-col items-center px-3">
          {done ? (
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "#22c55e" }}><Icon name="check" size={24} /></span>
          ) : failed ? (
            <>
              <span className="text-red-400"><Icon name="alert" size={26} /></span>
              <p className="mt-1 line-clamp-3 text-[10px] leading-tight opacity-80">{job?.error}</p>
            </>
          ) : (
            <span className="text-[15px] font-semibold tabular-nums">{p >= 0 ? `${Math.round(p * 100)}%` : "…"}</span>
          )}
        </m.div>
      </div>
    );
  }

  // Menu idle: file name + close.
  return (
    <m.div className={`${box} px-3`} style={style} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={SPRING}>
      <p className="line-clamp-2 text-[11.5px] font-semibold leading-tight">{n > 1 ? `${n} files` : fileName(pending.files[0] ?? "")}</p>
      {!pending.options.length && <p className="mt-1 text-[10.5px] opacity-70">Nothing to convert these to</p>}
      <button type="button" aria-label="Close" onClick={props.onClose} className="mt-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/12 hover:bg-white/25">
        <Icon name="close" size={13} />
      </button>
    </m.div>
  );
}

function Spinner({ accent, big }: { accent: string; big?: boolean }) {
  const s = big ? 116 : 34;
  const r = big ? 50 : 14;
  return (
    <svg width={s} height={s} className="spin" aria-hidden>
      <circle cx={s / 2} cy={s / 2} r={r} stroke={accent} strokeWidth={big ? 6 : 3.5} fill="none" strokeLinecap="round" strokeDasharray={`${r * 2} ${r * 8}`} />
    </svg>
  );
}
