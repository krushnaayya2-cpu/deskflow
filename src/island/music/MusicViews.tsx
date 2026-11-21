// Themed music player layouts for the Dynamic Island:
//   CompactMusic — the resting pill (art, title, play/pause, mini visualizer)
//   BarMusic     — hover (art, title/artist, visualizer, prev/play/next)
//   FullMusic    — click (big art, visualizer, progress, shuffle/repeat, volume)
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { audioVolume, livePosition, mediaControl, setAudioVolume, type Media } from "../../lib/island";
import * as I from "../icons";
import { gradient, type MusicTheme } from "./themes";
import { Visualizer } from "./Visualizer";

const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation() };

export interface MusicProps {
  media: Media;
  theme: MusicTheme;
  art: string | null;
  s: number;
  now: number;
  viz: boolean;
}

function Art({ art, theme, size, radius }: { art: string | null; theme: MusicTheme; size: number; radius: number }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0, boxShadow: `0 0 0 1px ${theme.colors[1]}55, 0 6px 18px rgba(0,0,0,0.35)` };
  if (art) return <img src={art} alt="" draggable={false} style={{ ...style, objectFit: "cover" }} />;
  return (
    <div style={{ ...style, background: `radial-gradient(circle at 30% 30%, ${theme.colors[2]}, transparent 60%), ${gradient(theme, "135deg")}` }} className="flex items-center justify-center">
      <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" opacity="0.85">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function Btn(props: { t: MusicTheme; size: number; label: string; onClick: () => void; children: ReactNode; primary?: boolean; active?: boolean }) {
  const { t } = props;
  // Never smaller than 26px: at the smallest island sizes these were too
  // small to hit, and a missed press used to collapse the island.
  const size = Math.max(props.size, 26);
  const base: CSSProperties = { width: size, height: size, borderRadius: size, color: props.active ? t.colors[1] : undefined };
  let look: CSSProperties = {};
  if (props.primary) {
    look =
      t.btn === "ring"
        ? { border: `1.5px solid ${t.colors[1]}`, boxShadow: `0 0 12px ${t.colors[1]}88, inset 0 0 10px ${t.colors[1]}33` }
        : t.btn === "solid"
          ? { background: gradient(t, "135deg"), color: "#fff", boxShadow: `0 4px 16px ${t.colors[1]}66` }
          : t.btn === "glass"
            ? { background: t.light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.12)", border: `1px solid ${t.light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.2)"}` }
            : { color: t.light ? t.fg : t.colors[1] };
  } else if (t.btn !== "plain") {
    look = { background: t.light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)" };
  }
  return (
    <button type="button" aria-label={props.label} title={props.label} {...stop} onClick={props.onClick} data-control
      className="isl-hit flex shrink-0 items-center justify-center transition-transform hover:scale-110 active:scale-95"
      style={{ ...base, ...look }}>
      {props.children}
    </button>
  );
}

function PlayIcon({ playing, size }: { playing: boolean; size: number }) {
  return playing ? <I.Pause width={size} height={size} /> : <I.Play width={size} height={size} />;
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Title({ media, theme, size, sub = true }: { media: Media; theme: MusicTheme; size: number; sub?: boolean }) {
  return (
    <div className="min-w-0" style={{ fontFamily: theme.mono ? "Consolas, 'Cascadia Mono', monospace" : undefined }}>
      <div className="truncate font-semibold leading-tight" style={{ fontSize: size }}>{media.title}</div>
      {sub && media.artist && <div className="truncate leading-tight" style={{ fontSize: size * 0.72, color: theme.muted, marginTop: 3 }}>{media.artist}</div>}
    </div>
  );
}

const Divider = ({ t, h }: { t: MusicTheme; h: number }) => <span className="shrink-0" style={{ width: 1, height: h, background: t.light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)" }} />;

export function CompactMusic({ media, theme, art, s, viz }: MusicProps) {
  return (
    <div className="flex w-full items-center" style={{ gap: 9 * s }}>
      <Art art={art} theme={theme} size={28 * s} radius={7 * s} />
      <Divider t={theme} h={18 * s} />
      <div className="min-w-0 flex-1"><Title media={media} theme={theme} size={12.5 * s} sub={false} /></div>
      <Btn t={theme} size={26 * s} label={media.playing ? "Pause" : "Play"} onClick={() => mediaControl("toggle")} primary>
        <PlayIcon playing={media.playing} size={11 * s} />
      </Btn>
      {viz && <Visualizer kind={theme.viz === "chrome" || theme.viz === "ribbon" ? "lines" : theme.viz === "mirror" ? "bars" : theme.viz} colors={theme.colors} playing={media.playing} width={64 * s} height={18 * s} fps={24} />}
    </div>
  );
}

export function BarMusic({ media, theme, art, s, viz }: MusicProps) {
  return (
    <div className="flex w-full items-center" style={{ gap: 12 * s }}>
      <Art art={art} theme={theme} size={58 * s} radius={13 * s} />
      <div style={{ width: 150 * s }}><Title media={media} theme={theme} size={15 * s} /></div>
      <div className="min-w-0 flex-1">{viz && <Visualizer kind={theme.viz} colors={theme.colors} playing={media.playing} height={52 * s} />}</div>
      <div className="flex items-center" style={{ gap: 6 * s }}>
        <Btn t={theme} size={30 * s} label="Previous track" onClick={() => mediaControl("prev")}><I.Prev width={13 * s} height={13 * s} /></Btn>
        <Btn t={theme} size={38 * s} label={media.playing ? "Pause" : "Play"} onClick={() => mediaControl("toggle")} primary><PlayIcon playing={media.playing} size={15 * s} /></Btn>
        <Btn t={theme} size={30 * s} label="Next track" onClick={() => mediaControl("next")}><I.Next width={13 * s} height={13 * s} /></Btn>
      </div>
    </div>
  );
}

function Track(props: { t: MusicTheme; value: number; onSeek?: (v: number) => void; label: string; height: number }) {
  const { t } = props;
  return (
    <div
      role="slider"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value * 100)}
      tabIndex={0}
      {...stop}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        props.onSeek?.(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") props.onSeek?.(Math.min(1, props.value + 0.05));
        if (e.key === "ArrowLeft") props.onSeek?.(Math.max(0, props.value - 0.05));
      }}
      className="relative flex-1 cursor-pointer"
      style={{ height: props.height * 3 }}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full" style={{ height: props.height, background: t.light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)" }} />
      <div className="absolute top-1/2 left-0 -translate-y-1/2 rounded-full" style={{ height: props.height, width: `${props.value * 100}%`, background: gradient(t), boxShadow: `0 0 8px ${t.colors[1]}88` }} />
      <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${props.value * 100}%`, width: props.height * 3.4, height: props.height * 3.4, boxShadow: `0 0 10px ${t.colors[1]}` }} />
    </div>
  );
}

export function FullMusic({ media, theme, art, s, now, viz }: MusicProps) {
  const pos = livePosition(media, now);
  const frac = media.duration ? pos / media.duration : 0;
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => {
    audioVolume().then(setVol).catch(() => {});
  }, []);
  const repeatIcon = media.repeat === "track" ? <I.RepeatOne width={14 * s} height={14 * s} /> : <I.Repeat width={14 * s} height={14 * s} />;
  return (
    <div className="flex h-full w-full items-stretch" style={{ gap: 16 * s, padding: `${14 * s}px 0` }}>
      <div className="flex flex-col items-center justify-between">
        <Art art={art} theme={theme} size={128 * s} radius={18 * s} />
        <div className="flex" style={{ gap: 6 * s }}>
          {media.shuffle !== null && (
            <Btn t={theme} size={28 * s} label="Shuffle" active={!!media.shuffle} onClick={() => mediaControl("shuffle")}><I.Shuffle width={14 * s} height={14 * s} /></Btn>
          )}
          {media.repeat !== null && (
            <Btn t={theme} size={28 * s} label={`Repeat: ${media.repeat}`} active={media.repeat !== "none"} onClick={() => mediaControl("repeat")}>{repeatIcon}</Btn>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 6 * s }}>
        <div className="flex items-start justify-between" style={{ gap: 8 * s }}>
          <Title media={media} theme={theme} size={18 * s} />
          {theme.tag && (
            <span className="flex shrink-0 items-center tracking-[0.25em]" style={{ fontSize: 9 * s, color: theme.muted, gap: 5 * s }}>
              <span className="rounded-full" style={{ width: 5 * s, height: 5 * s, background: theme.colors[0], boxShadow: `0 0 6px ${theme.colors[0]}` }} />
              {theme.tag}
            </span>
          )}
        </div>
        <div className="flex-1">{viz && <Visualizer kind={theme.viz} colors={theme.colors} playing={media.playing} height={62 * s} />}</div>
        {media.duration > 0 && (
          <div className="flex items-center tabular-nums" style={{ gap: 10 * s, fontSize: 10.5 * s, color: theme.muted }}>
            <span>{fmt(pos)}</span>
            <Track t={theme} value={frac} height={3 * s} label="Seek" onSeek={(f) => mediaControl("seek", f * media.duration)} />
            <span>{fmt(media.duration)}</span>
          </div>
        )}
        <div className="flex items-center justify-between" style={{ gap: 10 * s }}>
          <div className="flex items-center" style={{ gap: 10 * s, marginLeft: 70 * s }}>
            <Btn t={theme} size={32 * s} label="Previous track" onClick={() => mediaControl("prev")}><I.Prev width={14 * s} height={14 * s} /></Btn>
            <Btn t={theme} size={42 * s} label={media.playing ? "Pause" : "Play"} onClick={() => mediaControl("toggle")} primary><PlayIcon playing={media.playing} size={17 * s} /></Btn>
            <Btn t={theme} size={32 * s} label="Next track" onClick={() => mediaControl("next")}><I.Next width={14 * s} height={14 * s} /></Btn>
          </div>
          {vol !== null && (
            <div className="flex items-center" style={{ gap: 8 * s, width: 130 * s }}>
              <I.Volume width={15 * s} height={15 * s} style={{ color: theme.muted }} />
              <Track t={theme} value={vol} height={3 * s} label="Volume" onSeek={(v) => { setVol(v); setAudioVolume(v).catch(() => {}); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Decorative layers drawn inside (or around) the shell. */
export function Decoration({ theme, s }: { theme: MusicTheme; s: number }) {
  switch (theme.deco) {
    case "rain":
      return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className="music-rain absolute top-0" style={{ left: `${(i * 37) % 100}%`, width: 1, height: 14 * s, background: `linear-gradient(transparent, ${theme.colors[1]})`, animationDelay: `${(i * 0.37) % 2}s`, animationDuration: `${1.2 + (i % 5) * 0.25}s` }} />
          ))}
        </div>
      );
    case "brackets":
      return (
        <div className="pointer-events-none absolute" style={{ inset: 5 * s }} aria-hidden>
          {["left-0 top-0 border-l-2 border-t-2 rounded-tl-[22px]", "right-0 top-0 border-r-2 border-t-2 rounded-tr-[22px]", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-[22px]", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-[22px]"].map((c) => (
            <span key={c} className={`absolute ${c}`} style={{ width: 22 * s, height: 16 * s, borderColor: theme.colors[1], filter: `drop-shadow(0 0 4px ${theme.colors[1]})` }} />
          ))}
        </div>
      );
    case "sheen":
      return <div className="music-sheen pointer-events-none absolute inset-0" aria-hidden />;
    default:
      return null;
  }
}

/** Orbit ring around the shell (Neon Orbit); drawn outside the clipped shell. */
export function OrbitRing({ theme, w, h }: { theme: MusicTheme; w: number; h: number }) {
  return (
    <svg className="pointer-events-none absolute" style={{ left: -w * 0.08, top: -h * 0.35, width: w * 1.16, height: h * 1.7 }} viewBox="0 0 116 170" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="orbit-g" x1="0" x2="1">
          <stop offset="0" stopColor={theme.colors[0]} />
          <stop offset="1" stopColor={theme.colors[2]} />
        </linearGradient>
      </defs>
      <ellipse cx="58" cy="85" rx="56" ry="38" fill="none" stroke="url(#orbit-g)" strokeWidth="0.8" transform="rotate(-8 58 85)" style={{ filter: `drop-shadow(0 0 2px ${theme.colors[1]})` }} vectorEffect="non-scaling-stroke" />
      <circle r="1.6" fill="#fff" className="music-orbit-dot" style={{ offsetPath: "path('M 2 85 A 56 38 0 1 0 114 85 A 56 38 0 1 0 2 85')" }} />
    </svg>
  );
}
