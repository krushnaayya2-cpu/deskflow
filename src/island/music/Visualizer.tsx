// Audio-reactive visualizer drawn on a <canvas>.
//
// The level comes from the system's output peak meter (polled ~30x/s only
// while a visualizer is on screen and music plays). Shapes are procedural
// and modulated by that level, so they move with the music.
import { useEffect, useRef, useState } from "react";
import { audioPeak } from "../../lib/island";
import type { VizKind } from "./themes";

// ---- Shared level poller ---------------------------------------------------
let subscribers = 0;
let level = 0; // smoothed 0..1
let raw = 0;
let polling = false;
let silentSince = 0;

async function poll() {
  if (polling) return;
  polling = true;
  while (subscribers > 0) {
    try {
      raw = await audioPeak();
    } catch {
      raw = 0;
    }
    await new Promise((r) => setTimeout(r, 33));
  }
  polling = false;
}

/** Smoothed level with fast attack / slow release; gentle idle motion when silent. */
function sample(t: number, playing: boolean) {
  const target = Math.min(1, Math.pow(raw, 0.6) * 1.15);
  level += (target - level) * (target > level ? 0.5 : 0.08);
  if (raw > 0.01) silentSince = t;
  // If the meter reports nothing for a while (e.g. exclusive-mode audio),
  // keep a soft synthetic pulse so the visual still breathes.
  if (playing && t - silentSince > 1500) return 0.28 + 0.12 * Math.sin(t / 420) + 0.08 * Math.sin(t / 170);
  return playing ? level : level * 0.3;
}

// ---- Drawing ----------------------------------------------------------------
type Ctx = CanvasRenderingContext2D;

function hgrad(c: Ctx, w: number, colors: string[]) {
  const g = c.createLinearGradient(0, 0, w, 0);
  colors.forEach((col, i) => g.addColorStop(i / (colors.length - 1), col));
  return g;
}

/** Smooth pseudo-random envelope along x (0..1) varying in time. */
const env = (x: number, t: number) =>
  0.5 + 0.5 * (Math.sin(x * 9.1 + t * 1.9) * 0.55 + Math.sin(x * 23.7 - t * 2.7) * 0.3 + Math.sin(x * 3.3 + t * 0.7) * 0.15);
/** Centre-weighted bump so the middle peaks higher, like the references. */
const bump = (x: number) => 0.35 + 0.65 * Math.sin(Math.PI * x);

function drawBars(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[], mirror: boolean) {
  const bw = Math.max(2, w / 70);
  const gap = bw * 0.7;
  const n = Math.floor(w / (bw + gap));
  const base = mirror ? h * 0.72 : h;
  const maxH = mirror ? h * 0.7 : h * 0.95;
  c.fillStyle = hgrad(c, w, colors);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const bh = Math.max(2, maxH * (0.08 + 0.92 * lv * env(x, t) * bump(x)));
    const px = i * (bw + gap);
    c.globalAlpha = 1;
    c.beginPath();
    c.roundRect(px, base - bh, bw, bh, bw / 2);
    c.fill();
    if (mirror) {
      c.globalAlpha = 0.22;
      c.beginPath();
      c.roundRect(px, base + 2, bw, bh * 0.35, bw / 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

const peaks: number[] = [];
function drawPixels(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[]) {
  const s = Math.max(3, Math.round(h / 12));
  const gap = Math.max(1, Math.round(s / 4));
  const cols = Math.floor(w / (s + gap));
  const rows = Math.floor(h / (s + gap)) - 1;
  c.shadowColor = colors[1];
  c.shadowBlur = 6;
  for (let i = 0; i < cols; i++) {
    const x = i / cols;
    const hgt = Math.round(rows * (0.05 + 0.95 * lv * env(x, t) * bump(x)));
    peaks[i] = Math.max(hgt, (peaks[i] ?? 0) - 0.15);
    for (let r = 0; r < hgt; r++) {
      c.fillStyle = r > rows * 0.7 ? colors[2] : colors[1];
      c.fillRect(i * (s + gap), h - (r + 1) * (s + gap), s, s);
    }
    if (peaks[i] > hgt + 0.8) {
      c.fillStyle = colors[2];
      c.fillRect(i * (s + gap), h - (Math.round(peaks[i]) + 1) * (s + gap), s, s);
    }
  }
  c.shadowBlur = 0;
}

const wave = (x: number, t: number, k: number) =>
  Math.sin(x * 6.3 + t * 1.6 + k * 0.35) * 0.5 + Math.sin(x * 13.1 - t * 2.2 + k * 0.2) * 0.3 + Math.sin(x * 2.1 + t * 0.6) * 0.2;

function drawLines(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[]) {
  const mid = h / 2;
  const amp = h * 0.48 * (0.3 + 0.7 * lv);
  c.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    c.strokeStyle = hgrad(c, w, colors);
    c.globalAlpha = k === 0 ? 1 : 0.18 + 0.02 * (14 - k);
    if (k === 0) {
      c.lineWidth = 2;
      c.shadowColor = colors[1];
      c.shadowBlur = 10;
    } else {
      c.lineWidth = 0.8;
      c.shadowBlur = 0;
    }
    c.beginPath();
    for (let px = 0; px <= w; px += 3) {
      const x = px / w;
      const y = mid + amp * Math.sin(Math.PI * x) * wave(x, t, k) * (1 - k * 0.03);
      if (px === 0) c.moveTo(px, y);
      else c.lineTo(px, y);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
  c.shadowBlur = 0;
}

function drawDots(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[]) {
  const mid = h * 0.55;
  const amp = h * 0.45 * (0.3 + 0.7 * lv);
  c.fillStyle = hgrad(c, w, colors);
  for (let k = 0; k < 8; k++) {
    for (let px = 0; px <= w; px += 4) {
      const x = px / w;
      const y = mid + amp * Math.sin(Math.PI * x) * wave(x, t, k * 1.5) - k * 1.5;
      c.globalAlpha = k === 0 ? 0.95 : 0.12 + 0.06 * (8 - k);
      c.fillRect(px, y, k === 0 ? 2 : 1.4, k === 0 ? 2 : 1.4);
    }
  }
  c.globalAlpha = 1;
}

function drawParticles(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[]) {
  const mid = h / 2;
  const amp = h * 0.36 * (0.2 + 0.8 * lv);
  c.globalCompositeOperation = "lighter";
  const n = Math.round(w * 1.4);
  for (let i = 0; i < n; i++) {
    const r1 = Math.sin(i * 12.9898) * 43758.5453;
    const r = r1 - Math.floor(r1);
    const r2 = Math.sin(i * 78.233) * 12345.678;
    const q = r2 - Math.floor(r2);
    const x = (r + t * 0.02 * (0.5 + q)) % 1;
    const spread = (q - 0.5) * h * 0.5 * (0.3 + lv) * Math.sin(Math.PI * x);
    const y = mid + amp * Math.sin(Math.PI * x) * wave(x, t, 0) + spread;
    c.fillStyle = colors[q > 0.7 ? 2 : q > 0.35 ? 1 : 0];
    c.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 3 + i));
    c.fillRect(x * w, y, q > 0.9 ? 2 : 1.2, q > 0.9 ? 2 : 1.2);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
}

function drawRibbon(c: Ctx, w: number, h: number, t: number, lv: number, colors: string[]) {
  const mid = h / 2;
  c.globalCompositeOperation = "lighter";
  for (let k = 0; k < 3; k++) {
    const amp = h * (0.18 + 0.22 * lv) * (1 - k * 0.2);
    const thick = h * (0.06 + 0.1 * lv);
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "transparent");
    g.addColorStop(0.3, colors[k % 3]);
    g.addColorStop(0.7, colors[(k + 1) % 3]);
    g.addColorStop(1, "transparent");
    c.fillStyle = g;
    c.globalAlpha = 0.45;
    c.beginPath();
    for (let px = 0; px <= w; px += 4) {
      const x = px / w;
      c.lineTo(px, mid + amp * Math.sin(x * 5 + t * (0.8 + k * 0.3) + k * 2));
    }
    for (let px = w; px >= 0; px -= 4) {
      const x = px / w;
      c.lineTo(px, mid + amp * Math.sin(x * 5 + t * (0.8 + k * 0.3) + k * 2) + thick * (0.5 + 0.5 * Math.sin(x * 3 + t)));
    }
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
}

function drawChrome(c: Ctx, w: number, h: number, t: number, lv: number) {
  const base = h * 0.92;
  const amp = h * (0.25 + 0.45 * lv);
  const path = () => {
    c.beginPath();
    c.moveTo(0, base);
    for (let px = 0; px <= w; px += 3) {
      const x = px / w;
      c.lineTo(px, base - amp * Math.sin(Math.PI * x) * (0.55 + 0.45 * env(x * 0.6, t * 0.6)));
    }
    c.lineTo(w, base);
    c.closePath();
  };
  const g = c.createLinearGradient(0, base - amp, 0, base);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, "#c7ccd5");
  g.addColorStop(0.7, "#eef0f4");
  g.addColorStop(1, "#9aa1ad");
  path();
  c.fillStyle = g;
  c.fill();
  // Iridescent rim.
  const rim = c.createLinearGradient(0, 0, w, 0);
  ["#f9a8d4", "#a5f3fc", "#fde68a", "#c4b5fd"].forEach((col, i) => rim.addColorStop(i / 3, col));
  c.strokeStyle = rim;
  c.lineWidth = 1.5;
  c.globalAlpha = 0.8;
  path();
  c.stroke();
  c.globalAlpha = 1;
}

export function Visualizer(props: { kind: VizKind; colors: string[]; playing: boolean; width?: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  // Without an explicit width the visualizer fills its container.
  useEffect(() => {
    if (props.width || !box.current) return;
    const ro = new ResizeObserver(([e]) => setMeasured(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [props.width]);
  const width = props.width ?? measured;
  const propsRef = useRef({ ...props, width });
  propsRef.current = { ...props, width };

  useEffect(() => {
    subscribers++;
    poll();
    let raf = 0;
    const frame = (now: number) => {
      const cv = ref.current;
      const p = propsRef.current;
      if (cv) {
        const dpr = window.devicePixelRatio || 1;
        if (!p.width) {
          raf = requestAnimationFrame(frame);
          return;
        }
        const W = Math.round(p.width * dpr);
        const H = Math.round(p.height * dpr);
        if (cv.width !== W || cv.height !== H) {
          cv.width = W;
          cv.height = H;
        }
        const c = cv.getContext("2d")!;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, p.width, p.height);
        const t = now / 1000;
        const lv = sample(now, p.playing);
        const args = [c, p.width, p.height, t, lv, p.colors] as const;
        switch (p.kind) {
          case "bars": drawBars(...args, false); break;
          case "mirror": drawBars(...args, true); break;
          case "pixels": drawPixels(...args); break;
          case "lines": drawLines(...args); break;
          case "dots": drawDots(...args); break;
          case "particles": drawParticles(...args); break;
          case "ribbon": drawRibbon(...args); break;
          case "chrome": drawChrome(c, p.width, p.height, t, lv); break;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      subscribers--;
    };
  }, []);

  return (
    <div ref={box} style={{ width: props.width ?? "100%", height: props.height }}>
      <canvas ref={ref} style={{ width, height: props.height, display: "block" }} aria-hidden />
    </div>
  );
}
