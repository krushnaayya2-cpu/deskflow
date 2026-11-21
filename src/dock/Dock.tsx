// The dock: pinned + running apps with magnification, launch bounce,
// right-click menus, drag-to-reorder, system tray and thirteen designs.
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
  shell,
  startMenu,
  type Rect,
  type RunningApp,
} from "../lib/dock";
import { dockLook, itemStyle } from "./designs";
import { getSnapshot, onState, type SystemState } from "../lib/island";
import type { IconStyle } from "../lib/config";
import { getTasks, onTasks } from "../lib/ai";
import { Refraction } from "../island/glass/Refraction";

type Item =
  | { kind: "start"; id: string }
  | { kind: "search"; id: string }
  | { kind: "tray"; id: string }
  | { kind: "app"; id: string; name: string; path: string; key: string; pin?: PinnedApp; app?: RunningApp; ai?: boolean }
  | { kind: "sep"; id: string }
  | { kind: "clock"; id: string };

interface Placed {
  item: Item;
  /** Offset along the bar from its start, and length along the bar. */
  pos: number;
  len: number;
}

const SEP_LEN = 10;
const CLOCK_LEN = 96;
const TRAY_ICONS_LEN = 86;
/** Groups for split/full layouts: lead (Start, Search), apps, tail (tray). */
const groupOf = (it: Item) => (it.kind === "start" || it.kind === "search" ? 0 : it.kind === "tray" || it.kind === "clock" ? 2 : 1);
const BOUNCE_MS = 1700;

const media = window.matchMedia("(prefers-color-scheme: dark)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const [sys, setSys] = useState<SystemState>({ media: null, battery: null, network: null });
  const cfgRef = useRef<Config | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [refractOk, setRefractOk] = useState(true);

  useEffect(() => {
    const busy = (ts: { status: string }[]) => setAiBusy(ts.some((t) => t.status === "running" || t.status === "permission"));
    getTasks().then(busy).catch(() => {});
    const un = onTasks(busy);
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    const show = (c: Config) => ((cfgRef.current = c), setLocal(c));
    getConfig().then(show);
    getRunning().then(setRunning).catch(() => {});
    getSnapshot().then(setSys).catch(() => {});
    const subs = [onConfigChanged(show), onRunning(setRunning), onHover((h) => (setHovered(h), !h && setMouse(null))), onState(setSys)];
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
    if (dock.showSearch) out.push({ kind: "search", id: "search" });
    const usedKeys = new Set<string>();
    // AI section: detected AI apps first, inside a glowing ring.
    const aiApps = config?.ai.dockSection ? config.ai.apps : [];
    const aiPaths = new Set(aiApps.map((a) => a.path.toLowerCase()));
    for (const pin of aiApps) {
      const app = pin.target ? running.find((r) => r.key === pin.target) : undefined;
      if (app) usedKeys.add(app.key);
      out.push({ kind: "app", id: `ai:${pin.path}`, name: pin.name, path: pin.path, key: pin.target, app, ai: true });
    }
    if (aiApps.length && pinned.length) out.push({ kind: "sep", id: "sep-ai" });
    for (const pin of pinned) {
      if (aiPaths.has(pin.path.toLowerCase())) continue;
      const app = pin.target ? running.find((r) => r.key === pin.target) : undefined;
      if (app) usedKeys.add(app.key);
      out.push({ kind: "app", id: `pin:${pin.path}`, name: pin.name, path: pin.path, key: pin.target, pin, app });
    }
    if (dock.showRunning) {
      const extra = running.filter((r) => !usedKeys.has(r.key));
      if (extra.length && pinned.length) out.push({ kind: "sep", id: "sep" });
      for (const app of extra) out.push({ kind: "app", id: `run:${app.key}`, name: app.name, path: app.path, key: app.key, app });
    }
    // Tray (Wi-Fi/volume/battery + clock) on horizontal docks.
    if (!vertical && (dock.showTray || dock.showClock)) {
      if (!look.full && !look.stackTray && out.length) out.push({ kind: "sep", id: "sep-tray" });
      out.push({ kind: "tray", id: "tray" });
    }
    return out;
  }, [dock, look, running, dragOrder, vertical, config?.ai.dockSection, config?.ai.apps]);

  // Clock ticks only when visible.
  const hasClock = items.some((i) => i.kind === "clock" || i.kind === "tray");
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

  const trayLen = (dock?.showTray ? TRAY_ICONS_LEN : 0) + (dock?.showClock ? CLOCK_LEN : 0);
  const { placed, barLen, groups } = useMemo(() => {
    const lenOf = (it: Item) =>
      it.kind === "sep" ? SEP_LEN : it.kind === "clock" ? CLOCK_LEN : it.kind === "tray" ? trayLen : it.kind === "search" && look?.split ? size * 2.4 : size;
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
    // Stack: the tray lives in its own capsule above the bar.
    const main = look?.stackTray ? items.filter((i) => i.kind !== "tray") : items;
    if (look?.full) {
      // Start/Search at the left edge, tray at the right, apps centred or after Start.
      const edge = look.split ? look.margin + pad : pad + 4;
      const lead = main.filter((i) => groupOf(i) === 0);
      const tail = main.filter((i) => groupOf(i) === 2);
      const mid = main.filter((i) => groupOf(i) === 1);
      const L = mainSpace;
      const a = seq(lead, edge);
      const midLen = seq(mid, 0).end;
      const gapAfterLead = look.split ? pad * 2 + 16 : spacing;
      const midStart = look.align === "center" ? Math.max(a.end + gapAfterLead, (L - midLen) / 2) : a.end + gapAfterLead;
      const b2 = seq(mid, midStart);
      const tailLen = seq(tail, 0).end;
      const c = seq(tail, L - edge - tailLen);
      // Capsule extents per group (used by the Split design).
      const g = [
        lead.length ? { start: edge - pad, end: a.end + pad } : null,
        mid.length ? { start: midStart - pad, end: b2.end + pad } : null,
        tail.length ? { start: L - edge - tailLen - pad, end: L - edge + pad } : null,
      ];
      return { placed: [...a.out, ...b2.out, ...c.out], barLen: L, groups: g };
    }
    const sq = seq(main, pad);
    return { placed: sq.out, barLen: sq.end + pad, groups: [] as ({ start: number; end: number } | null)[] };
  }, [items, look, size, spacing, pad, mainSpace, trayLen]);

  const margin = look?.margin ?? 10;
  const autoHidden = !!style?.autoHide && !hovered && !menu;
  // Bar rectangle in window coordinates.
  const bar: Rect = useMemo(() => {
    const along = look?.full ? 0 : (mainSpace - barLen) / 2;
    if (!vertical) return { x: along, y: win.h - margin - thickness, w: barLen, h: thickness };
    const x = style?.position === "left" ? margin : win.w - margin - thickness;
    return { x, y: along, w: thickness, h: barLen };
  }, [look, mainSpace, barLen, vertical, win, margin, thickness, style?.position]);

  // Stack: the tray capsule above the bar.
  const stackRect: Rect | null = useMemo(() => {
    if (!look?.stackTray || vertical || !items.some((i) => i.kind === "tray")) return null;
    const w = trayLen + pad * 2 + 8;
    const h = 34;
    return { x: (win.w - w) / 2, y: bar.y - h - 8, w, h };
  }, [look?.stackTray, vertical, items, trayLen, pad, win.w, bar.y]);

  // Slide off the screen edge when auto-hidden.
  const hideOffset = thickness + margin + 4;
  const slide = autoHidden
    ? vertical
      ? { x: style?.position === "left" ? -hideOffset : hideOffset, y: 0 }
      : { x: 0, y: hideOffset }
    : { x: 0, y: 0 };

  // ---- Magnification -------------------------------------------------------
  const HOVER_SCALE = reduceMotion ? 1 : 1.15;
  const mag = (style?.magnification ?? 100) / 100;
  const dragging = dragOrder !== null;
  // Which items magnify: on full-width designs only the app group (Start
  // and the clock stay put at the screen edges).
  const magnifies = (it: Item) => it.kind === "app" || (it.kind === "start" && !look?.full) || (it.kind === "search" && !look?.full && !look?.split);
  const scales = useMemo(() => {
    if (mouse === null || dragging || menu) return placed.map(() => 1);
    const range = size * 2.6;
    const barStart = vertical ? bar.y : bar.x;
    // Magnification off: the icon under the pointer still springs up to
    // HOVER_SCALE (1.15, also --lg-hover-scale in glass.css) as feedback.
    if (mag <= 1) {
      return placed.map((p) => {
        if (!magnifies(p.item)) return 1;
        const a = barStart + p.pos;
        return mouse >= a && mouse <= a + p.len ? HOVER_SCALE : 1;
      });
    }
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
    const moves = (it: Item) => !(look?.full && groupOf(it) !== 1);
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
      const grow = hovered ? size * (Math.max(mag, 1.15) - 1) + 34 : 0;
      const g = grownBar;
      const r = !vertical
        ? { x: g.x - size, y: g.y - grow, w: g.w + size * 2, h: g.h + grow }
        : style?.position === "left"
          ? { x: g.x, y: g.y - size, w: g.w + grow, h: g.h + size * 2 }
          : { x: g.x - grow, y: g.y - size, w: g.w + grow, h: g.h + size * 2 };
      rects = [r];
    }
    if (menuRect) rects.push(menuRect);
    if (stackRect && !autoHidden) rects.push(stackRect);
    setHitRects(rects).catch(() => {});
  }, [look, autoHidden, bar, grownBar, win, vertical, hovered, size, mag, menuRect, stackRect, style?.position]);

  // Real blur behind the bar (backend decides if the design wants it).
  const radius = look?.radius ?? 0;
  const refract = !!look?.barClass?.includes("lg-prism") && !!config?.island.refraction && refractOk && !autoHidden;
  useEffect(() => {
    if (!look) return;
    if (autoHidden || style?.design === "pills") setBar(null, 0).catch(() => {});
  }, [autoHidden, look, style?.design]);
  const raf = useRef(0);
  const reportBar = useCallback(() => {
    if (!look || autoHidden || style?.design === "pills") return;
    cancelAnimationFrame(raf.current);
    const r = look.edge ? (vertical ? { ...grownBar, w: grownBar.w + radius } : { ...grownBar, h: grownBar.h + radius }) : grownBar;
    raf.current = requestAnimationFrame(() => setBar(r, radius).catch(() => {}));
  }, [look, autoHidden, style?.design, grownBar, radius, vertical]);
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
    if (it.kind === "search") return void shell("search");
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
        {look.split
          ? groups.map(
              (g, gi) =>
                g && (
                  <m.div key={gi} className="absolute" style={{ ...look.bar, borderRadius: radius }} initial={false}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    animate={(() => {
                      // The app capsule grows with magnification.
                      const grow = gi === 1 ? extra / 2 : 0;
                      return vertical
                        ? { left: bar.x, top: bar.y + g.start - grow, width: bar.w, height: g.end - g.start + grow * 2 }
                        : { left: bar.x + g.start - grow, top: bar.y, width: g.end - g.start + grow * 2, height: bar.h };
                    })()} />
                ),
            )
          : Object.keys(look.bar).length > 0 && (
              // Fix (corners): the bar fills its rect exactly and clips to its
              // own radius; the native glass under it is inset a few px so
              // no square corner can show (see src-tauri/src/glass.rs).
              <m.div
                className={`absolute ${look.barClass ?? ""} ${refract ? "lg-refract" : ""}`}
                style={{
                  ...look.bar,
                  borderRadius: look.edge
                    ? style.position === "bottom" ? `${radius}px ${radius}px 0 0` : style.position === "left" ? `0 ${radius}px ${radius}px 0` : `${radius}px 0 0 ${radius}px`
                    : radius,
                }}
                initial={false}
                animate={{ left: grownBar.x, top: grownBar.y, width: grownBar.w, height: grownBar.h }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                {/* Same refractive glass as the island, so the whole UI
                    matches. Falls back to the CSS skin if it can't run. */}
                {refract && (
                  <>
                    <Refraction
                      w={grownBar.w}
                      h={grownBar.h}
                      radius={radius}
                      x={grownBar.x}
                      y={grownBar.y}
                      active={hovered}
                      onUnsupported={() => setRefractOk(false)}
                    />
                    <span className="lg-iris" aria-hidden />
                    <span className="lg-spec" aria-hidden />
                  </>
                )}
              </m.div>
            )}
        {stackRect && (
          <div className="absolute flex items-center justify-center" style={{ ...look.bar, borderRadius: 17, left: stackRect.x, top: stackRect.y, width: stackRect.w, height: stackRect.h }}>
            <Tray sys={sys} showIcons={dock.showTray} showClock={dock.showClock} fg={look.fg} compact />
          </div>
        )}
        {(style.separators || look.dividers) && !vertical &&
          placed.map((p, i) => {
            const n = placed[i + 1];
            if (!n || p.item.kind !== "app" || n.item.kind !== "app") return null;
            const x = bar.x + p.pos + p.len + spacing / 2 + (shifts[i] + shifts[i + 1]) / 2;
            return <div key={`div-${i}`} className="absolute opacity-25" style={{ left: x, top: bar.y + bar.h * 0.28, width: 1, height: bar.h * 0.44, background: look.fg }} />;
          })}

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
          if (it.kind === "tray") {
            return (
              <div key={it.id} className="absolute flex items-center justify-end" style={{ ...pos, left: bar.x + p.pos + shift, width: p.len }}>
                <Tray sys={sys} showIcons={dock.showTray} showClock={dock.showClock} fg={look.fg} />
              </div>
            );
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
              {it.kind === "app" && it.ai && (
                <m.span aria-hidden className={`dock-ai-ring ${aiBusy ? "busy" : ""}`} style={{ inset: -size * 0.08, borderRadius: Math.min(radius * 0.6 + 8, size * 0.36) }}
                  initial={false} animate={{ scale: sc }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
              )}
              <m.button
                type="button"
                aria-label={it.kind === "start" ? "Start" : it.kind === "search" ? "Search" : it.name}
                className="relative flex h-full w-full items-center justify-center outline-none"
                style={{ transformOrigin: origin, ...(itemStyle(look, it.id) && it.kind !== "search" ? { ...itemStyle(look, it.id), borderRadius: Math.min(radius * 0.6 + 6, size * 0.32) } : {}),
                  ...(it.kind === "search" && look.split ? { background: "rgba(127,127,127,0.14)", borderRadius: 999 } : {}) }}
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
                whileTap={{ scale: sc * 0.92 }}
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
                ) : it.kind === "search" ? (
                  <SearchGlyph size={size * 0.5} fg={look.fg} label={look.split} />
                ) : (
                  <AppIcon path={it.app?.path ?? (it.pin?.target || it.path)} hwnd={it.app?.windows[0]?.hwnd} name={it.name} size={size * (look.item ? 0.7 : 1)} accent={accent} iconStyle={style.iconStyle} />
                )}
              </m.button>
              {it.kind === "app" && it.app && (
                <Indicator kind={look.indicator} focused={it.app.focused} accent={accent} fg={look.fg} pos={style.position} size={size} pad={pad} count={it.app.windows.length} wide={!!look.wideIndicator} />
              )}
              {hoveredIdx === i && (
                <Tooltip text={it.kind === "start" ? "Start" : it.kind === "search" ? "Search" : it.name} pos={style.position} size={size} scale={sc} dark={dark} />
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

function AppIcon({ path, hwnd, name, size, accent, iconStyle }: { path: string; hwnd?: number; name: string; size: number; accent: string; iconStyle: IconStyle }) {
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
  if (src && iconStyle === "silhouette") {
    // Single-colour version: the icon's shape used as a mask over the accent.
    return (
      <div className="pointer-events-none" style={{ width: size * 0.82, height: size * 0.82, background: accent,
        WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center",
        filter: `drop-shadow(0 0 6px ${accent}66)` }} />
    );
  }
  if (src)
    return (
      <img src={src} alt="" draggable={false} style={{ width: size, height: size, filter: iconStyle === "mono" ? "grayscale(1) contrast(1.05) brightness(1.15)" : undefined }}
        className="pointer-events-none select-none drop-shadow" />
    );
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

function Indicator(p: { kind: "dot" | "line" | "glow"; focused: boolean; accent: string; fg: string; pos: string; size: number; pad: number; count: number; wide?: boolean }) {
  const color = p.focused || p.kind === "glow" ? p.accent : p.fg;
  const len = p.wide ? (p.focused ? p.size * 0.9 : p.size * 0.5) : p.kind === "line" ? (p.focused ? 18 : 8) : p.focused ? 14 : 5;
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

function SearchGlyph({ size, fg, label }: { size: number; fg: string; label?: boolean }) {
  return (
    <span className="flex items-center gap-2" style={{ color: fg }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      {label && <span className="text-[13px] opacity-80">Search</span>}
    </span>
  );
}

/** Wi-Fi, volume and battery icons plus the clock. Opens Quick Settings / calendar. */
function Tray({ sys, showIcons, showClock, fg, compact }: { sys: SystemState; showIcons: boolean; showClock: boolean; fg: string; compact?: boolean }) {
  const n = sys.network;
  const b = sys.battery;
  const icon = (d: React.ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
  );
  const d = new Date();
  return (
    <div className="flex items-center gap-1" style={{ color: fg }}>
      {showIcons && (
        <button type="button" aria-label="Quick settings" onClick={() => shell("quick")}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[rgba(127,127,127,0.18)]">
          {icon(n && !n.connected ? <path d="M2 2l20 20M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.8M2 9a15 15 0 0 1 4.2-2.8" /> : <><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19.5" r="1" fill="currentColor" /></>)}
          {icon(<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />)}
          {b && (
            <span className="flex items-center" title={`${b.percent}%${b.charging ? " (charging)" : ""}`}>
              <svg width="20" height="16" viewBox="0 0 26 14" fill="none" aria-hidden>
                <rect x="1" y="1" width="21" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <rect x="3" y="3" width={Math.max(1, (17 * b.percent) / 100)} height="8" rx="1.5" fill={b.percent <= 20 && !b.charging ? "#ef4444" : "currentColor"} />
                <path d="M24 5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </button>
      )}
      {showClock && (
        <button type="button" aria-label="Calendar and notifications" onClick={() => shell("calendar")}
          className={`flex flex-col items-end whitespace-nowrap rounded-lg px-2 py-0.5 text-right leading-tight hover:bg-[rgba(127,127,127,0.18)] ${compact ? "flex-row gap-2" : ""}`}>
          <span className="text-[12.5px] font-medium tabular-nums">{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          {!compact && <span className="text-[11px] opacity-70">{d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>}
        </button>
      )}
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
