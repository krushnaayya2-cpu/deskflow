// The dock: pinned + running apps with magnification, launch bounce,
// right-click menus, drag-to-reorder and six designs.
//
// The window is bigger than the bar (room for magnified icons, tooltips and
// menus). Everything is positioned absolutely in window coordinates; the
// backend makes the window click-through outside the rectangles we report.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LazyMotion, domAnimation, m } from "framer-motion";
import { getConfig, onConfigChanged, setConfig, type Config, type PinnedApp } from "../lib/config";
import {
  activate,
  closeApp,
  getIcon,
  getRunning,
  launch,
  onHover,
  onRunning,
  revealPath,
  setBar,
  setHitRects,
  startMenu,
  type Rect,
  type RunningApp,
} from "../lib/dock";
import { dockLook } from "./designs";

type Item =
  | { kind: "start"; id: string }
  | { kind: "app"; id: string; name: string; path: string; key: string; pin?: PinnedApp; app?: RunningApp }
  | { kind: "sep"; id: string }
  | { kind: "clock"; id: string };

interface Placed {
  item: Item;
  /** Offset along the bar from its start, and length along the bar. */
  pos: number;
  len: number;
}

const SEP_LEN = 10;
const CLOCK_LEN = 76;
const BOUNCE_MS = 1700;

const media = window.matchMedia("(prefers-color-scheme: dark)");

export default function Dock() {
  const [config, setLocal] = useState<Config | null>(null);
  const [running, setRunning] = useState<RunningApp[]>([]);
  const [hovered, setHovered] = useState(false);
  const [mouse, setMouse] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string } | null>(null);
  const [bouncing, setBouncing] = useState<Record<string, number>>({});
  const [dragOrder, setDragOrder] = useState<PinnedApp[] | null>(null);
  const [systemDark, setSystemDark] = useState(media.matches);
  const [, setTick] = useState(0);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cfgRef = useRef<Config | null>(null);

  useEffect(() => {
    const show = (c: Config) => ((cfgRef.current = c), setLocal(c));
    getConfig().then(show);
    getRunning().then(setRunning).catch(() => {});
    const subs = [onConfigChanged(show), onRunning(setRunning), onHover((h) => (setHovered(h), !h && setMouse(null)))];
    const onMedia = () => setSystemDark(media.matches);
    media.addEventListener("change", onMedia);
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      subs.forEach((p) => p.then((f) => f()));
      media.removeEventListener("change", onMedia);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // ---- Items ---------------------------------------------------------------
  const dock = config?.dock;
  const style = dock?.style;
  const accent = style?.accent ?? config?.appearance.accent ?? "#7c5cff";
  const dark = config?.appearance.theme === "dark" || (config?.appearance.theme === "system" && systemDark);
  const look = style ? dockLook(style.design, style, accent, dark) : null;
  const vertical = style?.position === "left" || style?.position === "right";

  const items: Item[] = useMemo(() => {
    if (!dock || !look) return [];
    const pinned = dragOrder ?? dock.pinned;
    const out: Item[] = [];
    if (dock.showStart) out.push({ kind: "start", id: "start" });
    const usedKeys = new Set<string>();
    for (const pin of pinned) {
      const app = pin.target ? running.find((r) => r.key === pin.target) : undefined;
      if (app) usedKeys.add(app.key);
      out.push({ kind: "app", id: `pin:${pin.path}`, name: pin.name, path: pin.path, key: pin.target, pin, app });
    }
    if (dock.showRunning) {
      const extra = running.filter((r) => !usedKeys.has(r.key));
      if (extra.length && pinned.length) out.push({ kind: "sep", id: "sep" });
      for (const app of extra) out.push({ kind: "app", id: `run:${app.key}`, name: app.name, path: app.path, key: app.key, app });
    }
    if (look.taskbarLike && dock.showClock && !vertical) out.push({ kind: "clock", id: "clock" });
    return out;
  }, [dock, look, running, dragOrder, vertical]);

  // Clock ticks only when visible.
  const hasClock = items.some((i) => i.kind === "clock");
  useEffect(() => {
    if (!hasClock) return;
    const iv = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(iv);
  }, [hasClock]);

  // Stop bouncing once the app shows up as running (or after a timeout).
  useEffect(() => {
    const ids = Object.keys(bouncing);
    if (!ids.length) return;
    const t = window.setTimeout(() => setBouncing({}), BOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [bouncing]);

  // ---- Geometry ------------------------------------------------------------
  const size = style?.iconSize ?? 48;
  const spacing = style?.spacing ?? 8;
  const pad = look?.pad ?? 8;
  const thickness = size + pad * 2 + (look?.indicator === "line" ? 4 : 6);
  const mainSpace = vertical ? win.h : win.w;

  const { placed, barLen } = useMemo(() => {
    const lenOf = (it: Item) => (it.kind === "sep" ? SEP_LEN : it.kind === "clock" ? CLOCK_LEN : size);
    const seq = (list: Item[], start: number) => {
      const out: Placed[] = [];
      let cur = start;
      for (const it of list) {
        const len = lenOf(it);
        out.push({ item: it, pos: cur, len });
        cur += len + spacing;
      }
      return { out, end: list.length ? cur - spacing : start };
    };
    if (look?.full) {
      // Start at the left edge, clock at the right edge, apps centred or after Start.
      const lead = items.filter((i) => i.kind === "start");
      const tail = items.filter((i) => i.kind === "clock");
      const mid = items.filter((i) => i.kind !== "start" && i.kind !== "clock");
      const L = mainSpace;
      const a = seq(lead, pad + 4);
      const midLen = seq(mid, 0).end;
      const midStart = look.align === "center" ? Math.max(a.end + spacing, (L - midLen) / 2) : a.end + spacing;
      const b = seq(mid, midStart);
      const c = seq(tail, L - pad - 4 - (tail.length ? CLOCK_LEN : 0));
      return { placed: [...a.out, ...b.out, ...c.out], barLen: L };
    }
    const s = seq(items, pad);
    return { placed: s.out, barLen: s.end + pad };
  }, [items, look, size, spacing, pad, mainSpace]);

  const margin = look?.margin ?? 10;
  const autoHidden = !!style?.autoHide && !hovered && !menu;
  // Bar rectangle in window coordinates.
  const bar: Rect = useMemo(() => {
    const along = look?.full ? 0 : (mainSpace - barLen) / 2;
    if (!vertical) return { x: along, y: win.h - margin - thickness, w: barLen, h: thickness };
    const x = style?.position === "left" ? margin : win.w - margin - thickness;
    return { x, y: along, w: thickness, h: barLen };
  }, [look, mainSpace, barLen, vertical, win, margin, thickness, style?.position]);

  // Slide off the screen edge when auto-hidden.
  const hideOffset = thickness + margin + 4;
  const slide = autoHidden
    ? vertical
      ? { x: style?.position === "left" ? -hideOffset : hideOffset, y: 0 }
      : { x: 0, y: hideOffset }
    : { x: 0, y: 0 };

  // ---- Magnification -------------------------------------------------------
  const mag = (style?.magnification ?? 100) / 100;
  const dragging = dragOrder !== null;
  // Which items magnify: on full-width designs only the app group (Start
  // and the clock stay put at the screen edges).
  const magnifies = (it: Item) => it.kind === "app" || (it.kind === "start" && !look?.full);
  const scales = useMemo(() => {
    if (mouse === null || mag <= 1 || dragging || menu) return placed.map(() => 1);
    const range = size * 2.6;
    const barStart = vertical ? bar.y : bar.x;
    return placed.map((p) => {
      if (!magnifies(p.item)) return 1;
      const d = Math.abs(mouse - (barStart + p.pos + p.len / 2));
      return d >= range ? 1 : 1 + (mag - 1) * ((1 + Math.cos((Math.PI * d) / range)) / 2);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouse, mag, dragging, menu, placed, size, vertical, bar, look?.full]);
  // macOS-style: each enlarged icon takes more room, so icons spread apart
  // and the bar grows evenly at both ends (total growth = extra).
  const { shifts, extra } = useMemo(() => {
    const e = scales.map((sc) => (sc - 1) * size);
    const E = e.reduce((a, b) => a + b, 0);
    let before = 0;
    // Everything in the app group moves (including the separator); on
    // full-width designs Start and the clock stay fixed.
    const moves = (it: Item) => !(look?.full && (it.kind === "start" || it.kind === "clock"));
    const sh = placed.map((p, i) => {
      if (!moves(p.item)) return 0;
      const v = before + e[i] / 2 - E / 2;
      before += e[i];
      return v;
    });
    return { shifts: sh, extra: E };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scales, placed, size, look?.full]);
  // The visible bar including magnification growth (floating designs).
  const grownBar: Rect = useMemo(() => {
    if (look?.full || !extra) return bar;
    return vertical ? { ...bar, y: bar.y - extra / 2, h: bar.h + extra } : { ...bar, x: bar.x - extra / 2, w: bar.w + extra };
  }, [bar, extra, vertical, look?.full]);

  // ---- Report geometry to the backend --------------------------------------
  const menuRect = useMemo<Rect | null>(() => {
    if (!menu) return null;
    const p = placed.find((x) => x.item.id === menu.id);
    if (!p) return null;
    const w = 220;
    const h = 230;
    if (!vertical) {
      const cx = bar.x + p.pos + p.len / 2;
      return { x: Math.min(Math.max(cx - w / 2, 4), win.w - w - 4), y: bar.y - h - 10, w, h };
    }
    const cy = bar.y + p.pos + p.len / 2;
    const y = Math.min(Math.max(cy - h / 2, 4), win.h - h - 4);
    return style?.position === "left" ? { x: bar.x + bar.w + 10, y, w, h } : { x: bar.x - w - 10, y, w, h };
  }, [menu, placed, bar, vertical, win, style?.position]);

  useEffect(() => {
    if (!look) return;
    let rects: Rect[];
    if (autoHidden) {
      // A thin strip along the screen edge reveals the dock.
      const strip = 6;
      rects = [
        !vertical
          ? { x: bar.x, y: win.h - strip, w: bar.w, h: strip }
          : style?.position === "left"
            ? { x: 0, y: bar.y, w: strip, h: bar.h }
            : { x: win.w - strip, y: bar.y, w: strip, h: bar.h },
      ];
    } else {
      // Include room for magnified icons + tooltip while hovering.
      const grow = hovered ? size * (mag - 1) + 34 : 0;
      const g = grownBar;
      const r = !vertical
        ? { x: g.x - size, y: g.y - grow, w: g.w + size * 2, h: g.h + grow }
        : style?.position === "left"
          ? { x: g.x, y: g.y - size, w: g.w + grow, h: g.h + size * 2 }
          : { x: g.x - grow, y: g.y - size, w: g.w + grow, h: g.h + size * 2 };
      rects = [r];
    }
    if (menuRect) rects.push(menuRect);
    setHitRects(rects).catch(() => {});
  }, [look, autoHidden, bar, grownBar, win, vertical, hovered, size, mag, menuRect, style?.position]);

  // Real blur behind the bar (backend decides if the design wants it).
  const radius = look?.radius ?? 0;
  useEffect(() => {
    if (!look) return;
    if (autoHidden || style?.design === "pills") setBar(null, 0).catch(() => {});
  }, [autoHidden, look, style?.design]);
  const raf = useRef(0);
  const reportBar = useCallback(() => {
    if (!look || autoHidden || style?.design === "pills") return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setBar(grownBar, radius).catch(() => {}));
  }, [look, autoHidden, style?.design, grownBar, radius]);
  useEffect(() => {
    if (!autoHidden) reportBar();
  }, [reportBar, autoHidden]);

  // ---- Actions -------------------------------------------------------------
  const savePinned = useCallback(async (pinned: PinnedApp[]) => {
    const c = cfgRef.current;
    if (!c) return;
    await setConfig({ ...c, dock: { ...c.dock, pinned } }).catch(() => {});
  }, []);

  const onItemClick = (it: Item) => {
    setMenu(null);
    if (it.kind === "start") return void startMenu();
    if (it.kind !== "app") return;
    if (it.app) return void activate(it.app.key).catch(() => {});
    setBouncing((b) => ({ ...b, [it.id]: Date.now() }));
    launch(it.path).catch(() => {});
  };

  // Drag to reorder pinned apps.
  const drag = useRef<{ id: string; start: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent, it: Item) => {
    if (e.button !== 0 || it.kind !== "app" || !it.pin) return;
    drag.current = { id: it.id, start: vertical ? e.clientY : e.clientX, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const main = vertical ? e.clientY : e.clientX;
    if (!drag.current) return setMouse(main);
    if (!drag.current.moved && Math.abs(main - drag.current.start) < 6) return;
    drag.current.moved = true;
    const pinned = dragOrder ?? dock!.pinned;
    const from = pinned.findIndex((p) => `pin:${p.path}` === drag.current!.id);
    const barStart = vertical ? bar.y : bar.x;
    const pinPlaced = placed.filter((p) => p.item.kind === "app" && p.item.pin);
    let to = pinPlaced.findIndex((p) => main < barStart + p.pos + p.len / 2);
    if (to < 0) to = pinPlaced.length - 1;
    if (from >= 0 && to !== from) {
      const next = [...pinned];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setDragOrder(next);
    } else if (!dragOrder) setDragOrder(pinned);
  };
  const onPointerUp = (it: Item) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      if (dragOrder) savePinned(dragOrder).finally(() => setDragOrder(null));
      return;
    }
    setDragOrder(null);
    onItemClick(it);
  };

  if (!config || !dock || !style || !look) return null;

  const hoveredIdx = mouse === null || menu || dragging ? -1 : scales.findIndex((s, i) => s === Math.max(...scales) && s > 1 && placed[i]);

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className="fixed inset-0"
        style={{ color: look.fg }}
        animate={slide}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        onAnimationComplete={() => !autoHidden && reportBar()}
        onPointerMove={onPointerMove}
        onPointerLeave={() => !drag.current && setMouse(null)}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setMenu(null);
        }}
      >
        {/* Bar surface */}
        {style.design !== "pills" && (
          <m.div
            className="absolute"
            style={{ borderRadius: radius, ...look.bar }}
            initial={false}
            animate={{ left: grownBar.x, top: grownBar.y, width: grownBar.w, height: grownBar.h }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        )}

        {placed.map((p, i) => {
          const it = p.item;
          const sc = scales[i];
          const shift = shifts[i];
          const main = (vertical ? bar.y : bar.x) + p.pos;
          const cross = vertical ? bar.x + pad : bar.y + pad;
          const pos: CSSProperties = vertical
            ? { left: cross, top: main, width: size, height: p.len }
            : { left: main, top: cross, width: p.len, height: size };
          if (it.kind === "sep") {
            const lineStyle: CSSProperties = vertical
              ? { left: bar.x + 8, top: bar.y + p.pos + SEP_LEN / 2, width: bar.w - 16, height: 1 }
              : { left: bar.x + p.pos + SEP_LEN / 2, top: bar.y + 10, width: 1, height: bar.h - 20 };
            return (
              <m.div key={it.id} className="absolute opacity-30" style={{ ...lineStyle, background: look.fg }}
                initial={false} animate={vertical ? { y: shift } : { x: shift }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
            );
          }
          if (it.kind === "clock") {
            return <Clock key={it.id} style={{ ...pos, left: bar.x + p.pos, width: CLOCK_LEN }} />;
          }
          const origin =
            style.position === "bottom" ? "50% 100%" : style.position === "left" ? "0% 50%" : "100% 50%";
          const bounce = it.kind === "app" && bouncing[it.id];
          return (
            <m.div
              key={it.id}
              className="absolute"
              style={pos}
              initial={false}
              animate={vertical ? { y: shift } : { x: shift }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <m.button
                type="button"
                aria-label={it.kind === "start" ? "Start" : it.name}
                className="relative flex h-full w-full items-center justify-center outline-none"
                style={{ transformOrigin: origin, ...(look.item ? { ...look.item, borderRadius: radius * 0.6 + 6 } : {}) }}
                animate={{
                  scale: sc,
                  ...(bounce
                    ? style.position === "bottom"
                      ? { y: [0, -size * 0.35, 0, -size * 0.15, 0] }
                      : { x: [0, (style.position === "left" ? 1 : -1) * size * 0.35, 0] }
                    : { y: 0, x: 0 }),
                }}
                transition={
                  bounce
                    ? { scale: { type: "spring", stiffness: 500, damping: 30 }, default: { duration: 0.8, repeat: 1, ease: "easeOut" } }
                    : { type: "spring", stiffness: 500, damping: 30 }
                }
                onPointerDown={(e) => onPointerDown(e, it)}
                onPointerUp={() => onPointerUp(it)}
                onAuxClick={(e) => e.button === 1 && it.kind === "app" && launch(it.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (it.kind === "app") setMenu({ id: it.id });
                }}
              >
                {it.kind === "start" ? (
                  <StartGlyph size={size * 0.62} accent={accent} />
                ) : (
                  <AppIcon path={it.path} hwnd={it.app?.windows[0]?.hwnd} name={it.name} size={size * (look.item ? 0.78 : 1)} accent={accent} />
                )}
              </m.button>
              {it.kind === "app" && it.app && (
                <Indicator kind={look.indicator} focused={it.app.focused} accent={accent} fg={look.fg} pos={style.position} size={size} pad={pad} count={it.app.windows.length} />
              )}
              {hoveredIdx === i && (
                <Tooltip text={it.kind === "start" ? "Start" : it.name} pos={style.position} size={size} scale={sc} dark={dark} />
              )}
            </m.div>
          );
        })}

        {menu && menuRect && (
          <ContextMenu
            rect={menuRect}
            dark={dark}
            item={items.find((i) => i.id === menu.id)}
            onClose={() => setMenu(null)}
            onPin={(it) => {
              if (it.kind !== "app") return;
              const pin: PinnedApp = { name: it.name, path: it.path, target: it.key, args: "" };
              savePinned([...dock.pinned, pin]);
            }}
            onUnpin={(it) => it.kind === "app" && savePinned(dock.pinned.filter((p) => p.path !== it.pin?.path))}
          />
        )}
      </m.div>
    </LazyMotion>
  );
}

// ---------------------------------------------------------------------------

const iconCache = new Map<string, string | null>();

function AppIcon({ path, hwnd, name, size, accent }: { path: string; hwnd?: number; name: string; size: number; accent: string }) {
  const [src, setSrc] = useState<string | null | undefined>(iconCache.get(path));
  useEffect(() => {
    if (iconCache.has(path)) return setSrc(iconCache.get(path));
    let alive = true;
    getIcon(path, hwnd)
      .then((url) => {
        iconCache.set(path, url);
        if (alive) setSrc(url);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [path, hwnd]);
  if (src) return <img src={src} alt="" draggable={false} style={{ width: size, height: size }} className="pointer-events-none select-none drop-shadow" />;
  // Fallback: first letter on an accent tile.
  return (
    <div
      className="flex items-center justify-center rounded-[22%] font-semibold text-white"
      style={{ width: size * 0.86, height: size * 0.86, fontSize: size * 0.42, background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Neutral Start glyph: four rounded tiles in the accent colour. */
function StartGlyph({ size, accent }: { size: number; accent: string }) {
  const t = size / 2 - 1.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {[0, 1].flatMap((r) =>
        [0, 1].map((c) => <rect key={`${r}${c}`} x={c * (t + 3)} y={r * (t + 3)} width={t} height={t} rx={t * 0.22} fill={accent} opacity={r + c === 1 ? 0.75 : 1} />),
      )}
    </svg>
  );
}

function Indicator(p: { kind: "dot" | "line" | "glow"; focused: boolean; accent: string; fg: string; pos: string; size: number; pad: number; count: number }) {
  const color = p.focused || p.kind === "glow" ? p.accent : p.fg;
  const len = p.kind === "line" ? (p.focused ? 18 : 8) : p.focused ? 14 : 5;
  const thick = p.kind === "line" ? 3 : 5;
  const off = p.pad / 2 + 2;
  const style: CSSProperties =
    p.pos === "bottom"
      ? { left: "50%", bottom: -off - thick / 2, width: len, height: thick, translate: "-50% 0" }
      : p.pos === "left"
        ? { top: "50%", left: -off - thick / 2, width: thick, height: len, translate: "0 -50%" }
        : { top: "50%", right: -off - thick / 2, width: thick, height: len, translate: "0 -50%" };
  return (
    <span
      className="absolute rounded-full transition-all duration-300"
      style={{ ...style, background: color, opacity: p.focused ? 1 : 0.55, boxShadow: p.kind === "glow" ? `0 0 8px ${p.accent}, 0 0 16px ${p.accent}` : undefined }}
    />
  );
}

function Tooltip({ text, pos, size, scale, dark }: { text: string; pos: string; size: number; scale: number; dark: boolean }) {
  const gap = size * (scale - 1) + 10;
  const style: CSSProperties =
    pos === "bottom"
      ? { bottom: `calc(100% + ${gap}px)`, left: "50%", translate: "-50% 0" }
      : pos === "left"
        ? { left: `calc(100% + ${gap}px)`, top: "50%", translate: "0 -50%" }
        : { right: `calc(100% + ${gap}px)`, top: "50%", translate: "0 -50%" };
  return (
    <div
      className="pointer-events-none absolute whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-medium shadow-lg"
      style={{ ...style, background: dark ? "rgba(30,30,38,0.92)" : "rgba(255,255,255,0.95)", color: dark ? "#fff" : "#111", border: "1px solid rgba(127,127,127,0.25)" }}
    >
      {text}
    </div>
  );
}

function Clock({ style }: { style: CSSProperties }) {
  const d = new Date();
  return (
    <div className="absolute flex flex-col items-end justify-center text-right leading-tight" style={style}>
      <span className="text-[12.5px] font-medium tabular-nums">{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      <span className="text-[11px] opacity-70">{d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</span>
    </div>
  );
}

function ContextMenu(props: {
  rect: Rect;
  dark: boolean;
  item?: Item;
  onClose: () => void;
  onPin: (it: Item) => void;
  onUnpin: (it: Item) => void;
}) {
  const it = props.item;
  if (!it || it.kind !== "app") return null;
  const entries: { label: string; run: () => void; danger?: boolean }[] = [];
  if (it.app) entries.push({ label: "Show", run: () => activate(it.app!.key) });
  entries.push({ label: it.app ? "New window" : "Open", run: () => launch(it.path) });
  entries.push(it.pin ? { label: "Unpin from dock", run: () => props.onUnpin(it) } : { label: "Pin to dock", run: () => props.onPin(it) });
  entries.push({ label: "Show in folder", run: () => revealPath(it.app?.path ?? it.pin?.target ?? it.path) });
  if (it.app) entries.push({ label: it.app.windows.length > 1 ? `Close ${it.app.windows.length} windows` : "Close window", run: () => closeApp(it.app!.key), danger: true });

  return (
    <m.div
      role="menu"
      aria-label={`${it.name} options`}
      className="absolute overflow-hidden rounded-xl p-1.5 text-[13px] shadow-2xl"
      style={{
        left: props.rect.x,
        top: props.rect.y + props.rect.h - (entries.length * 32 + 40),
        width: props.rect.w,
        background: props.dark ? "rgba(28,28,36,0.96)" : "rgba(252,252,255,0.97)",
        color: props.dark ? "#f4f4f8" : "#16161d",
        border: "1px solid rgba(127,127,127,0.25)",
      }}
      initial={{ opacity: 0, scale: 0.94, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 520, damping: 34 }}
    >
      <p className="truncate px-2.5 pt-1 pb-1.5 text-[11.5px] font-semibold opacity-60">{it.name}</p>
      {entries.map((e) => (
        <button
          key={e.label}
          role="menuitem"
          type="button"
          className={`block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[rgba(127,127,127,0.16)] ${e.danger ? "text-red-500" : ""}`}
          onClick={() => {
            e.run();
            props.onClose();
          }}
        >
          {e.label}
        </button>
      ))}
    </m.div>
  );
}
