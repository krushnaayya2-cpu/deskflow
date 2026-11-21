// The Dynamic Island pill.
//
// Shapes (scaled by the Size setting):
//   idle     small pill, nothing happening
//   compact  one live activity (music, timer, low battery)
//   medium   hover, or a one-off event (download, charger, Wi-Fi) blooming in
//   details  click: full controls for the current activity
//   actions  long-press: quick actions (timers, play/pause, settings)
//
// The window around the pill is click-through; Rust tells us when the cursor
// is over the pill (onHover) because the webview can't see the mouse while
// it is click-through.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diag } from "../lib/diag";
import { getTasks, onNotify, onTasks, type AiNotification, type AiTask } from "../lib/ai";
import { aiLook, COMPLETED_MS, noteLook, pickTask } from "./ai/AiViews";
import { Refraction } from "./glass/Refraction";
import { AnimatePresence, LazyMotion, domAnimation, m, type TargetAndTransition } from "framer-motion";
import { getConfig, onConfigChanged, type Config } from "../lib/config";
import {
  getSnapshot,
  mediaArt,
  mediaControl,
  onEvent,
  onHover,
  onState,
  openPath,
  openSettings,
  revealPath,
  setHitRect,
  setIslandGlass,
  glassSupported,
  type IslandEvent,
  type Media,
  type SystemState,
} from "../lib/island";
import * as I from "./icons";
import { DESIGNS, designVars } from "./designs";
import { autoTheme, findTheme, shellStyle } from "./music/themes";
import { BarMusic, CompactMusic, Decoration, FullMusic, OrbitRing } from "./music/MusicViews";

const SHAPES = {
  idle: { w: 126, h: 32, r: 16 },
  compact: { w: 252, h: 36, r: 18 },
  medium: { w: 372, h: 82, r: 28 },
  details: { w: 404, h: 156, r: 34 },
  actions: { w: 430, h: 100, r: 30 },
} as const;
type Mode = keyof typeof SHAPES;
/** Larger shapes for the themed music player. */
const MUSIC_SHAPES: Partial<Record<Mode, { w: number; h: number; r: number }>> = {
  compact: { w: 300, h: 42, r: 21 },
  medium: { w: 540, h: 96, r: 40 },
  details: { w: 640, h: 196, r: 38 },
};

const TRANSIENT_MS = 4500;
const LONG_PRESS_MS = 500;
const MUSIC_LINGER_MS = 60_000; // keep a paused song visible for a minute
const SPRING = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;
/** Shape morph: width, height and corner radius move together on one
 *  spring-like curve (same values as --lg-ease / --lg-duration in
 *  src/styles/glass.css), so the island never looks stretched mid-change. */
const MORPH = { duration: 0.4, ease: [0.32, 0.72, 0, 1] } as const;
/** Gentle bounce when the pointer arrives. Transform only (60fps). */
const BOUNCE: TargetAndTransition = { scale: [1, 1.035, 0.995, 1], transition: { duration: 0.45, ease: "easeOut" } };

/** Text width in px for the island's font, for sizing pills to content. */
const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function textWidth(text: string, px: number, weight = 600) {
  if (!measureCtx || !text) return 0;
  measureCtx.font = `${weight} ${px}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}

type Transient = (IslandEvent | { kind: "timerDone" }) & { id: number };
interface Timer {
  endsAt: number;
  total: number;
}

/** Which activity the island is showing right now. */
type Current =
  | { kind: "ai"; task: AiTask }
  | { kind: "aiNote"; note: AiNotification }
  | { kind: "transient"; t: Transient }
  | { kind: "timer"; timer: Timer }
  | { kind: "music"; media: Media }
  | { kind: "batteryLow"; percent: number }
  | { kind: "idle" };

export default function Island() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sys, setSys] = useState<SystemState>({ media: null, battery: null, network: null });
  const [queue, setQueue] = useState<Transient[]>([]);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState<null | "details" | "actions">(null);
  const [now, setNow] = useState(Date.now());
  const lastPlaying = useRef(0);
  const nextId = useRef(1);
  const cfgRef = useRef<Config | null>(null);
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [aiNotes, setAiNotes] = useState<AiNotification[]>([]);
  const [aiTick, setAiTick] = useState(0);
  // Window width: the native window is resized when the Size setting or the
  // display changes, and the hit area must be re-centred with it.
  const [vw, setVw] = useState(window.innerWidth);
  const [nativeGlassOk, setNativeGlassOk] = useState(false);
  const [refractOk, setRefractOk] = useState(true);
  const pillRef = useRef<HTMLDivElement>(null);

  // ---- Data subscriptions ------------------------------------------------
  useEffect(() => {
    getConfig()
      .then((c) => {
        cfgRef.current = c;
        setConfig(c);
        diag(`island config: scale=${c.island.scale} style=${c.island.style} hideWhenIdle=${c.island.hideWhenIdle}`);
      })
      .catch((e) => diag(`get_config failed: ${e}`));
    getSnapshot().then(setSys).catch(() => {});
    glassSupported()
      .then((ok) => {
        setNativeGlassOk(ok);
        document.documentElement.dataset.glass = ok ? "native" : "none";
      })
      .catch(() => (document.documentElement.dataset.glass = "none"));
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    getTasks().then(setAiTasks).catch((e) => diag(`ai_tasks failed: ${e}`));
    diag(`island page loaded ${window.innerWidth}x${window.innerHeight}`);
    const subs = [
      onTasks(setAiTasks),
      onNotify((n) => {
        setAiNotes((q) => [...q.slice(-4), n]);
        if (cfgRef.current?.ai.sound) chime();
      }),
      onConfigChanged((c) => ((cfgRef.current = c), setConfig(c))),
      onState(setSys),
      onHover(setHovered),
      onEvent((e) => {
        const a = cfgRef.current?.island.activities;
        if (!a) return;
        const allowed =
          e.kind === "notify" ||
          (e.kind === "download" && a.downloads) ||
          (e.kind === "charging" && a.battery) ||
          (e.kind === "network" && a.network);
        if (allowed) pushTransient(e);
      }),
    ];
    return () => {
      window.removeEventListener("resize", onResize);
      subs.forEach((p) => p.then((f) => f()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushTransient = useCallback((e: IslandEvent | { kind: "timerDone" }) => {
    setQueue((q) => [...q, { ...e, id: nextId.current++ }]);
  }, []);

  // Show each one-off event for a few seconds, then move to the next.
  useEffect(() => {
    if (!queue.length) return;
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), TRANSIENT_MS);
    return () => window.clearTimeout(t);
  }, [queue]);

  // AI notifications stay a little longer than system ones (there's text to read).
  useEffect(() => {
    if (!aiNotes.length || queue.length) return;
    const t = window.setTimeout(() => setAiNotes((q) => q.slice(1)), 7000);
    return () => window.clearTimeout(t);
  }, [aiNotes, queue.length]);

  // A completed task shows for COMPLETED_MS; wake up when it should go.
  useEffect(() => {
    const ends = aiTasks.filter((t) => t.status === "completed").map((t) => t.updated + COMPLETED_MS - Date.now()).filter((d) => d > 0);
    if (!ends.length) return;
    const t = window.setTimeout(() => setAiTick((x) => x + 1), Math.min(...ends) + 50);
    return () => window.clearTimeout(t);
  }, [aiTasks, aiTick]);
  const aiTask = useMemo(() => pickTask(aiTasks, Date.now()), [aiTasks, aiTick]);

  // Tick only while something time-based is on screen (keeps idle CPU ~0).
  const media = sys.media;
  if (media?.playing) lastPlaying.current = Date.now();
  const musicLingering = !!media && !media.playing && Date.now() - lastPlaying.current < MUSIC_LINGER_MS;
  useEffect(() => {
    if (!timer && !musicLingering) return;
    const iv = window.setInterval(() => setNow(Date.now()), timer ? 250 : 5000);
    return () => window.clearInterval(iv);
  }, [timer, musicLingering]);

  // Album art for the current track.
  const [art, setArt] = useState<string | null>(null);
  const artKey = media?.artKey ?? "";
  useEffect(() => {
    setArt(null);
    if (!artKey) return;
    // The backend fetches art right before announcing a new track.
    mediaArt().then(setArt).catch(() => {});
  }, [artKey]);

  // Timer finished?
  useEffect(() => {
    if (timer && now >= timer.endsAt) {
      setTimer(null);
      pushTransient({ kind: "timerDone" });
      chime();
    }
  }, [now, timer, pushTransient]);

  // Progress bar ticks while the full player is open.
  useEffect(() => {
    if (!(pinned === "details" && sys.media?.playing)) return;
    const iv = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(iv);
  }, [pinned, sys.media?.playing]);

  // Leaving the island closes details/actions after a short grace period.
  useEffect(() => {
    if (hovered || !pinned) return;
    const t = window.setTimeout(() => setPinned(null), 700);
    return () => window.clearTimeout(t);
  }, [hovered, pinned]);

  // ---- What to show ------------------------------------------------------
  const act = config?.island.activities;
  const current: Current = useMemo(() => {
    if (aiTask?.status === "permission") return { kind: "ai", task: aiTask };
    if (queue[0]) return { kind: "transient", t: queue[0] };
    if (aiNotes[0]) return { kind: "aiNote", note: aiNotes[0] };
    if (aiTask) return { kind: "ai", task: aiTask };
    if (timer && act?.timer) return { kind: "timer", timer };
    if (media && act?.music && (media.playing || musicLingering)) return { kind: "music", media };
    const b = sys.battery;
    if (b && act?.battery && !b.charging && b.percent <= 20) return { kind: "batteryLow", percent: b.percent };
    return { kind: "idle" };
  }, [aiTask, queue, aiNotes, timer, media, musicLingering, sys.battery, act]);

  const isAi = (current.kind === "ai" || current.kind === "aiNote") && pinned !== "actions";
  const mode: Mode = pinned
    ? pinned
    : hovered || current.kind === "transient"
      ? "medium"
      : current.kind === "idle"
        ? "idle"
        : "compact";

  // ---- Geometry + hit area -----------------------------------------------
  const s = (config?.island.scale ?? 100) / 100;
  const design = config ? DESIGNS[config.island.style] ?? DESIGNS.glass : DESIGNS.glass;
  const baseLook = design.look("#000");
  const offsetY = baseLook.notch ? 0 : config?.island.offsetY ?? 8;
  const isMusic = current.kind === "music" && mode !== "actions" && mode !== "idle";
  const aiCard = !config || !isAi
    ? null
    : current.kind === "ai"
      ? aiLook(config.ai.style, current.task, config.ai.apps, s)
      : current.kind === "aiNote"
        ? noteLook(current.note, config.ai.apps, config.appearance.accent, s, () => setAiNotes((q) => q.slice(1)))
        : null;
  const shape = aiCard ?? ((isMusic && MUSIC_SHAPES[mode]) || SHAPES[mode]);
  // Size to content: notifications grow to fit their text (up to 1.45x the
  // base width) instead of truncating inside a fixed pill.
  const fitW = (() => {
    if (aiCard || current.kind !== "transient" || mode !== "medium") return shape.w * s;
    const t = current.t;
    const title = t.kind === "download" ? "Download complete" : t.kind === "notify" ? t.title : t.kind === "network" ? (t.connected ? "Connected" : "Disconnected") : "";
    const sub = t.kind === "download" ? t.name : t.kind === "notify" ? t.body : t.kind === "network" ? t.name : "";
    const text = Math.max(textWidth(title, 13 * s, 600), textWidth(sub, 12 * s, 400));
    const right = (t.kind === "download" && t.path) || (t.kind === "notify" && t.path) ? 120 * s : 0;
    const want = 28 * s + 34 * s + 10 * s + text + right + 12 * s;
    return Math.min(Math.max(shape.w * s, want), shape.w * s * 1.45);
  })();
  const w = Math.round(fitW);
  const h = Math.round(shape.h * s * (!aiCard && (mode === "idle" || mode === "compact") ? baseLook.heightScale ?? 1 : 1));
  useEffect(() => {
    setHitRect({ x: (vw - w) / 2, y: offsetY, w, h }).catch(() => {});
  }, [w, h, offsetY, vw]);

  // ---- Click vs long-press -----------------------------------------------
  // Fix (pressing pause collapsed the island): a press that lands on a
  // control — play/pause, next, seek, volume, Open — must never also toggle
  // the island. Children stop propagation, but this check does not depend on
  // that: any control, now or later, is honoured by its tag/role alone.
  const onControl = (e: React.PointerEvent) =>
    !!(e.target as Element | null)?.closest?.('button, a, input, [role="slider"], [data-control]');
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const ignorePress = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    ignorePress.current = onControl(e);
    if (ignorePress.current) return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setPinned("actions");
    }, LONG_PRESS_MS);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    window.clearTimeout(pressTimer.current);
    if (ignorePress.current || onControl(e)) {
      ignorePress.current = false;
      return;
    }
    if (!longPressed.current) setPinned((p) => (p ? null : aiCard ? null : "details"));
  };

  const startTimer = (minutes: number) => {
    setTimer({ endsAt: Date.now() + minutes * 60_000, total: minutes * 60_000 });
    setNow(Date.now());
    setPinned(null);
  };

  // ---- Native glass behind the pill ---------------------------------------
  // Reported every animation frame while the pill morphs (onUpdate), when a
  // morph ends, and whenever glass is switched on/off or the window moves.
  const glassRaf = useRef(0);
  const glassInfo = useRef({ want: false, y: 0, key: "" });
  const lastGlassKey = useRef("");
  const sentGlass = useRef({ w: 0, h: 0, r: 0 });
  const reportGlass = useCallback((gw: number, gh: number, gr: number) => {
    // Only when it actually moved: during a morph this is called every
    // frame, and each call is an IPC round trip plus a Win32 window move.
    const p = sentGlass.current;
    if (Math.abs(p.w - gw) < 2 && Math.abs(p.h - gh) < 2 && Math.abs(p.r - gr) < 2) return;
    sentGlass.current = { w: gw, h: gh, r: gr };
    cancelAnimationFrame(glassRaf.current);
    glassRaf.current = requestAnimationFrame(() => {
      if (!glassInfo.current.want) return;
      setIslandGlass({ x: (window.innerWidth - gw) / 2, y: glassInfo.current.y, w: gw, h: gh }, gr).catch(() => {});
    });
  }, []);
  useEffect(() => {
    const g = glassInfo.current;
    if (g.key === lastGlassKey.current) return;
    lastGlassKey.current = g.key;
    if (!g.want) {
      cancelAnimationFrame(glassRaf.current);
      setIslandGlass(null, 0).catch(() => {});
      return;
    }
    const el = pillRef.current;
    if (el) reportGlass(el.offsetWidth, el.offsetHeight, Math.min(el.offsetHeight / 2, Number.parseFloat(getComputedStyle(el).getPropertyValue("--isl-rb")) || el.offsetHeight / 2));
  });

  if (!config) return null;
  const look = (DESIGNS[config.island.style] ?? DESIGNS.glass).look(config.appearance.accent);
  const hidden = mode === "idle" && config.island.hideWhenIdle && !hovered;
  const glowing = current.kind === "transient";
  const themeChoice = findTheme(config.island.musicTheme);
  const mTheme = themeChoice ?? autoTheme(config.appearance.accent, look.fg, look.muted);
  const themed = isMusic && !!themeChoice;
  const surface = aiCard
    ? aiCard.bare ? { background: "transparent" } : aiCard.surface
    : themed ? shellStyle(mTheme) : { ...look.surface, ...designVars(look) };
  const shadow = aiCard ? (aiCard.bare ? "none" : aiCard.shadow) : themed ? mTheme.glow : glowing ? look.glow(config.appearance.accent) : look.shadow;
  const notch = look.notch && !aiCard;
  // Island is always a pill: corner radius = height / 2 (the notch design
  // keeps square top corners).
  const rBottom = aiCard ? shape.r * s : h <= 110 * s ? h / 2 : shape.r * s;
  const rTop = notch ? 0 : rBottom;
  const liquid = !aiCard && !themed && !!look.surfaceClass;
  // Refraction replaces the acrylic for the Liquid Glass design: it draws
  // the blurred, bent background itself, so a second blurred layer beneath
  // would only wash it out.
  const wantsRefract = !!look.prism && !!config.island.refraction && refractOk && !aiCard && !themed && !hidden;
  const wantsGlass = nativeGlassOk && !!look.nativeGlass && !wantsRefract && !aiCard && !themed && !hidden;
  glassInfo.current = { want: wantsGlass, y: offsetY, key: `${wantsGlass}:${vw}:${offsetY}` };

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="pointer-events-none fixed inset-0 flex justify-center" style={{ paddingTop: offsetY }}>
        <div className="relative h-fit">
        {themed && mTheme.deco === "orbit" && mode !== "compact" && <OrbitRing theme={mTheme} w={w} h={h} />}
        {/* Bounce wrapper: transform only, so it never fights the morph. */}
        <m.div animate={hovered && !hidden ? BOUNCE : { scale: 1 }} whileTap={{ scale: 0.97 }} style={{ willChange: "transform" }}>
        {/* Fix (island morph + corners): the outer element animates width,
            height and the two corner radii together on one curve and carries
            the shadow; the inner surface fills it exactly and is clipped with
            clip-path using the same animated radii, so no square corner or
            child layer (canvas, glow) can leak outside the pill. */}
        <m.div
          ref={pillRef}
          role="status"
          aria-live="polite"
          className="pointer-events-auto relative cursor-default select-none"
          style={{ fontSize: 13 * s, borderRadius: "var(--isl-rt) var(--isl-rt) var(--isl-rb) var(--isl-rb)" } as React.CSSProperties}
          initial={false}
          animate={{
            width: w,
            height: h,
            "--isl-rt": `${rTop}px`,
            "--isl-rb": `${rBottom}px`,
            opacity: hidden ? 0 : 1,
            boxShadow: shadow,
          } as never}
          transition={{ ...MORPH, opacity: { duration: 0.25 } }}
          onUpdate={(v) => {
            if (!wantsGlass) return;
            const vw2 = Number.parseFloat(String(v.width ?? w));
            const vh2 = Number.parseFloat(String(v.height ?? h));
            reportGlass(vw2, vh2, Number.parseFloat(String(v["--isl-rb"] ?? rBottom)));
          }}
          onAnimationComplete={() => {
            if (!wantsGlass) return;
            sentGlass.current = { w: 0, h: 0, r: 0 };
            reportGlass(w, h, rBottom);
          }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={() => window.clearTimeout(pressTimer.current)}
        >
          <div
            className={`absolute inset-0 ${liquid ? look.surfaceClass : ""} ${wantsRefract ? "lg-refract" : ""} ${aiCard || themed || mode === "idle" || mode === "compact" ? "" : look.className ?? ""}`}
            style={{
              ...surface,
              borderRadius: "inherit",
              overflow: aiCard?.bare ? "visible" : "hidden",
              clipPath: aiCard?.bare ? undefined : "inset(0 round var(--isl-rt) var(--isl-rt) var(--isl-rb) var(--isl-rb))",
            }}
          >
          {/* Refractive glass layers: rainbow rim and specular. They sit
              under the content and never take pointer events. */}
          {wantsRefract && (
            <Refraction
              w={w}
              h={h}
              radius={rBottom}
              x={(vw - w) / 2}
              y={offsetY}
              active={mode !== "idle" && mode !== "compact"}
              onUnsupported={() => setRefractOk(false)}
            />
          )}
          {liquid && look.prism && (
            <>
              <span className="lg-iris" aria-hidden />
              <span className="lg-spec" aria-hidden />
            </>
          )}
          {themed && mode !== "compact" && <Decoration theme={mTheme} s={s} />}
          <AnimatePresence mode="popLayout" initial={false}>
            <m.div
              key={`${mode}:${current.kind}:${current.kind === "transient" ? current.t.id : current.kind === "aiNote" ? current.note.id : current.kind === "ai" ? current.task.id + current.task.status : ""}`}
              className="absolute inset-0 flex items-center"
              style={{ padding: aiCard?.bare ? 0 : `0 ${(isMusic ? 16 : aiCard ? 18 : 14) * s}px` }}
              // Cross-fade with opacity + scale only (no filter: blur, which
              // repaints every frame and dropped frames during the morph).
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ ...SPRING, delay: 0.06 }}
            >
              {aiCard ? (
                aiCard.content
              ) : mode === "actions" ? (
                <QuickActions s={s} accent={config.appearance.accent} media={media} onTimer={startTimer} />
              ) : isMusic && current.kind === "music" ? (
                mode === "compact" ? (
                  <CompactMusic media={current.media} theme={mTheme} art={art} s={s} now={now} viz={config.island.visualizer} />
                ) : mode === "medium" ? (
                  <BarMusic media={current.media} theme={mTheme} art={art} s={s} now={now} viz={config.island.visualizer} />
                ) : (
                  <FullMusic media={current.media} theme={mTheme} art={art} s={s} now={now} viz={config.island.visualizer} />
                )
              ) : (
                <Content mode={mode} cur={current} sys={sys} s={s} now={now} accent={config.appearance.accent}
                  onCancelTimer={() => setTimer(null)}
                  onAddMinute={() => setTimer((t) => (t ? { endsAt: t.endsAt + 60_000, total: t.total + 60_000 } : t))}
                />
              )}
            </m.div>
          </AnimatePresence>
          </div>
        </m.div>
        </m.div>
        </div>
      </div>
    </LazyMotion>
  );
}

// ---------------------------------------------------------------------------

/** Stop clicks on inner buttons from toggling the island. */
const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation() };

function Btn(props: { label: string; onClick: () => void; children: ReactNode; s: number; primary?: boolean; accent?: string }) {
  // Controls follow the island's size but never shrink below 90%: at the
  // smallest island sizes the buttons were too small to hit. `isl-hit` adds
  // a few px of invisible hit area around each one.
  const s = Math.max(props.s, 0.9);
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      {...stop}
      onClick={props.onClick}
      className="isl-hit flex items-center justify-center gap-1.5 rounded-full transition-transform hover:scale-110 active:scale-95"
      style={{
        height: 30 * s,
        minWidth: 30 * s,
        padding: `0 ${10 * s}px`,
        background: props.primary ? props.accent : "var(--isl-btn)",
        color: props.primary ? "#fff" : undefined,
      }}
    >
      {props.children}
    </button>
  );
}

function Content(props: {
  mode: Mode;
  cur: Current;
  sys: SystemState;
  s: number;
  now: number;
  accent: string;
  onCancelTimer: () => void;
  onAddMinute: () => void;
}) {
  const { mode, cur, sys, s, accent } = props;
  const big = mode === "medium" || mode === "details";
  const iconSize = (big ? 20 : 15) * s;

  switch (cur.kind) {
    case "idle":
      if (!big) return null;
      return <IdleInfo sys={sys} s={s} details={mode === "details"} />;

    case "batteryLow":
      return (
        <Row
          s={s}
          left={<I.BatteryIcon width={iconSize} height={iconSize} className="text-red-400" />}
          title={big ? "Battery low" : undefined}
          subtitle={big ? "Plug in your charger soon" : undefined}
          right={<span className="font-semibold text-red-400">{cur.percent}%</span>}
        />
      );

    case "timer": {
      const left = Math.max(0, cur.timer.endsAt - props.now);
      const frac = 1 - left / cur.timer.total;
      return (
        <div className="flex w-full flex-col gap-2">
          <Row
            s={s}
            left={<Ring frac={frac} size={(big ? 34 : 22) * s} accent={accent}><I.TimerIcon width={iconSize * 0.7} height={iconSize * 0.7} /></Ring>}
            title={big ? "Timer" : undefined}
            right={<span className="font-semibold tabular-nums" style={{ fontSize: (big ? 22 : 14) * s, color: accent }}>{fmt(left)}</span>}
          />
          {mode === "details" && (
            <div className="flex justify-end gap-2">
              <Btn s={s} label="Add one minute" onClick={props.onAddMinute}>+1 min</Btn>
              <Btn s={s} label="Cancel timer" onClick={props.onCancelTimer}><I.X width={14 * s} height={14 * s} /> Cancel</Btn>
            </div>
          )}
        </div>
      );
    }

    case "music": {
      const md = cur.media;
      const controls = (
        <div className="flex items-center gap-1.5">
          <Btn s={s} label="Previous track" onClick={() => mediaControl("prev")}><I.Prev width={14 * s} height={14 * s} /></Btn>
          <Btn s={s} label={md.playing ? "Pause" : "Play"} onClick={() => mediaControl("toggle")} primary accent={accent}>
            {md.playing ? <I.Pause width={14 * s} height={14 * s} /> : <I.Play width={14 * s} height={14 * s} />}
          </Btn>
          <Btn s={s} label="Next track" onClick={() => mediaControl("next")}><I.Next width={14 * s} height={14 * s} /></Btn>
        </div>
      );
      if (!big) {
        return (
          <Row s={s} left={<Eq playing={md.playing} s={s} accent={accent} />} title={md.title} right={<span className="isl-muted">{md.artist}</span>} compact />
        );
      }
      return (
        <div className="flex w-full flex-col gap-2.5">
          <Row
            s={s}
            left={<Art s={s * (mode === "details" ? 1.3 : 1)} accent={accent} playing={md.playing} />}
            title={md.title}
            subtitle={[md.artist, mode === "details" ? appName(md.app) : ""].filter(Boolean).join(" · ")}
            right={mode === "medium" ? controls : undefined}
          />
          {mode === "details" && <div className="flex justify-center">{controls}</div>}
        </div>
      );
    }

    case "transient":
      return <TransientView t={cur.t} s={s} big={big} accent={accent} details={mode === "details"} />;
  }
}

function TransientView(props: { t: Transient; s: number; big: boolean; accent: string; details: boolean }) {
  const { t, s, big, accent } = props;
  const icon = (n: ReactNode) => (
    <div className="flex shrink-0 items-center justify-center rounded-full" style={{ width: 34 * s, height: 34 * s, background: `${accent}33`, color: accent }}>
      {n}
    </div>
  );
  const sz = { width: 18 * s, height: 18 * s };
  switch (t.kind) {
    case "download":
      return (
        <Row s={s} left={icon(<I.Download {...sz} />)} title={big ? "Download complete" : t.name} subtitle={big ? t.name : undefined}
          right={big && t.path ? (
            <div className="flex gap-1.5">
              <Btn s={s} label="Show in folder" onClick={() => revealPath(t.path)}><I.Folder width={14 * s} height={14 * s} /></Btn>
              <Btn s={s} label="Open file" onClick={() => openPath(t.path)} primary accent={accent}>Open</Btn>
            </div>
          ) : undefined}
        />
      );
    case "charging":
      return (
        <Row s={s} left={icon(t.charging ? <I.Bolt {...sz} /> : <I.BatteryIcon {...sz} />)}
          title={t.charging ? "Charging" : "On battery"} right={<span className="font-semibold" style={{ fontSize: 18 * s, color: t.charging ? "#4ade80" : undefined }}>{t.percent}%</span>} />
      );
    case "network":
      return (
        <Row s={s}
          left={icon(!t.connected ? <I.WifiOff {...sz} /> : t.wifi ? <I.Wifi {...sz} /> : <I.Ethernet {...sz} />)}
          title={t.connected ? "Connected" : "Disconnected"} subtitle={t.connected ? t.name : "No internet connection"} />
      );
    case "notify":
      return (
        <Row s={s} left={icon(<I.Bell {...sz} />)} title={t.title} subtitle={t.body}
          right={big && t.path ? <Btn s={s} label="Open" onClick={() => openPath(t.path!)} primary accent={accent}>Open</Btn> : undefined} />
      );
    case "timerDone":
      return <Row s={s} left={icon(<I.TimerIcon {...sz} />)} title="Time’s up!" subtitle={big ? "Your timer has finished" : undefined} />;
  }
}

function IdleInfo({ sys, s, details }: { sys: SystemState; s: number; details: boolean }) {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  const n = sys.network;
  return (
    <div className="flex w-full flex-col gap-3">
      <Row
        s={s}
        title={<span style={{ fontSize: 20 * s }} className="font-semibold tabular-nums">{time}</span>}
        subtitle={date}
        right={
          <div className="flex items-center gap-3 isl-soft">
            {n && (n.connected ? (n.wifi ? <I.Wifi width={16 * s} height={16 * s} /> : <I.Ethernet width={16 * s} height={16 * s} />) : <I.WifiOff width={16 * s} height={16 * s} />)}
            {sys.battery && (
              <span className="flex items-center gap-1">
                {sys.battery.charging ? <I.Bolt width={14 * s} height={14 * s} className="text-green-400" /> : <I.BatteryIcon width={16 * s} height={16 * s} />}
                {sys.battery.percent}%
              </span>
            )}
          </div>
        }
      />
      {details && (
        <p className="isl-muted" style={{ fontSize: 12 * s }}>
          {n?.connected ? `Online via ${n.name || "network"}` : "Offline"} · Hold the island for quick actions
        </p>
      )}
    </div>
  );
}

function QuickActions({ s, accent, media, onTimer }: { s: number; accent: string; media: Media | null; onTimer: (m: number) => void }) {
  return (
    <div className="flex w-full flex-col gap-2.5">
      <p className="isl-muted" style={{ fontSize: 11 * s }}>Quick actions</p>
      <div className="flex flex-wrap items-center gap-2">
        {[1, 5, 15, 25].map((m) => (
          <Btn key={m} s={s} label={`Start ${m} minute timer`} onClick={() => onTimer(m)}>
            <I.TimerIcon width={13 * s} height={13 * s} /> {m}m
          </Btn>
        ))}
        {media && (
          <Btn s={s} label={media.playing ? "Pause music" : "Play music"} onClick={() => mediaControl("toggle")} primary accent={accent}>
            {media.playing ? <I.Pause width={13 * s} height={13 * s} /> : <I.Play width={13 * s} height={13 * s} />}
          </Btn>
        )}
        <Btn s={s} label="Open DeskFlow settings" onClick={() => openSettings()}><I.Gear width={14 * s} height={14 * s} /></Btn>
      </div>
    </div>
  );
}

// ---- Small presentational pieces -----------------------------------------

function Row(props: { s: number; left?: ReactNode; title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; compact?: boolean }) {
  return (
    <div className="flex w-full min-w-0 items-center" style={{ gap: 10 * props.s }}>
      {props.left}
      <div className="min-w-0 flex-1">
        {props.title && <div className="truncate font-semibold leading-tight">{props.title}</div>}
        {props.subtitle && <div className="truncate leading-tight isl-muted" style={{ fontSize: 12 * props.s, marginTop: 2 }}>{props.subtitle}</div>}
      </div>
      {props.right && <div className={`shrink-0 ${props.compact ? "max-w-[40%] truncate" : ""}`}>{props.right}</div>}
    </div>
  );
}

/** Animated equaliser bars for the compact music view. */
function Eq({ playing, s, accent }: { playing: boolean; s: number; accent: string }) {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 14 * s }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={playing ? "eq-bar" : ""}
          style={{ width: 3 * s, height: playing ? "100%" : "30%", background: accent, borderRadius: 2, animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

/** Placeholder album art: accent gradient tile with a pulsing note. */
function Art({ s, accent, playing }: { s: number; accent: string; playing: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-center rounded-xl" style={{ width: 44 * s, height: 44 * s, background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}>
      <Eq playing={playing} s={s * 1.2} accent="#fff" />
    </div>
  );
}

function Ring({ frac, size, accent, children }: { frac: number; size: number; accent: string; children: ReactNode }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--isl-track)" strokeWidth={3} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={accent} strokeWidth={3} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset .25s linear" }} />
      </svg>
      {children}
    </div>
  );
}

function fmt(ms: number) {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" or "chrome.exe" → readable name. */
function appName(id: string) {
  if (!id) return "";
  const last = id.split("!").pop() ?? id;
  return last.replace(/\.exe$/i, "").replace(/^\w/, (c) => c.toUpperCase());
}

/** Soft two-note chime, synthesised so no audio file ships with the app. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.15, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.65);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio unavailable: silent */
  }
}
