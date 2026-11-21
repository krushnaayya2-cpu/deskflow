// Liquid Glass refraction: the pixels behind the island, bent through the
// pill's edge the way thick glass bends light, with the colour split
// (dispersion) that gives the rainbow edge.
//
// Why a capture + WebGL: in a transparent window CSS `backdrop-filter` has
// nothing behind it to filter, so the backend grabs the screen rectangle
// under the window (our own overlays excluded from the grab) and this draws
// it refracted. The grab is small (long edge 256 px), which is also where
// the frosted blur comes from.
import { useEffect, useRef } from "react";
import { captureBehind, setCaptureExcluded } from "../../lib/island";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uTex;
uniform vec2  uWin;      // window size (css px) = the captured area
uniform vec2  uPill;     // pill size (css px)
uniform vec2  uPillPos;  // pill top-left inside the window (css px)
uniform float uRadius;   // corner radius (css px)
uniform float uEdge;     // thickness of the bevelled edge (css px)
uniform float uBend;     // how far the edge pushes the sample (css px)
uniform float uChroma;   // colour split at the edge
uniform float uTint;     // darkening, for text contrast
uniform float uIris;     // rainbow strength
uniform float uTime;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Sample the captured screen at a point given in pill-local px.
vec3 sampleAt(vec2 p, vec2 halfSize) {
  vec2 win = (p + halfSize + uPillPos) / uWin;
  return texture(uTex, clamp(win, vec2(0.002), vec2(0.998))).rgb;
}

void main() {
  vec2 halfSize = uPill * 0.5;
  vec2 p = (vUv - 0.5) * uPill;
  p.y = -p.y;                       // uv is y-up, layout is y-down

  float d = sdRound(p, halfSize, uRadius);
  float alpha = 1.0 - smoothstep(-1.2, 0.3, d);
  if (alpha <= 0.0) { frag = vec4(0.0); return; }

  // Surface normal of the glass from the slope of the distance field.
  vec2 e = vec2(1.2, 0.0);
  vec2 n = normalize(vec2(
    sdRound(p + e.xy, halfSize, uRadius) - sdRound(p - e.xy, halfSize, uRadius),
    sdRound(p + e.yx, halfSize, uRadius) - sdRound(p - e.yx, halfSize, uRadius)
  ) + 1e-6);

  // 0 deep inside the glass, 1 right at the rim: the bevel.
  float bevel = 1.0 - clamp(-d / uEdge, 0.0, 1.0);
  float lens = pow(bevel, 1.45);

  // Liquid wobble: the edge thickness breathes a little, so the glass looks
  // poured rather than stamped.
  float wob = 1.0 + 0.16 * sin(d * 0.08 + uTime * 0.9 + (p.x + p.y) * 0.012);

  // Refraction: the body magnifies slightly, like a thick lens, and near
  // the rim the view is pushed outwards, so the background squeezes and
  // stretches exactly as it does through a glass edge.
  vec2 base = p * 0.9;
  vec2 push = n * uBend * lens * wob;
  vec3 col;
  col.r = sampleAt(base + push * (1.0 + uChroma), halfSize).r;
  col.g = sampleAt(base + push, halfSize).g;
  col.b = sampleAt(base + push * (1.0 - uChroma), halfSize).b;

  // A second, wider tap set pulls light in from further out, which is what
  // makes a thick edge glow instead of just bending.
  vec3 wide;
  wide.r = sampleAt(base + push * (2.1 + uChroma), halfSize).r;
  wide.g = sampleAt(base + push * 2.1, halfSize).g;
  wide.b = sampleAt(base + push * (2.1 - uChroma), halfSize).b;
  col = mix(col, wide, pow(bevel, 1.8) * 0.38);

  // Oil-slick iridescence: a broad band following the edge, its hue set by
  // the surface angle and how deep into the bevel the pixel sits.
  float ang = atan(n.y, n.x) / 6.2831853;
  float depth = pow(bevel, 1.7);
  vec3 iris = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + ang * 1.3 + depth * 0.8 + uTime * 0.03));
  col += iris * depth * uIris;

  // Brighter at the rim, calmer in the middle: that reads as thick glass
  // and keeps the UI text on top legible.
  col *= mix(0.7, 1.0, pow(bevel, 0.8));

  // Specular: a key light from the top-left and a softer one from below,
  // plus the bright lit rim that reads as polished glass.
  vec2 L = normalize(vec2(-0.55, 0.83));
  vec2 L2 = normalize(vec2(0.6, -0.8));
  float spec = pow(max(dot(n, L), 0.0), 5.0) * bevel;
  float spec2 = pow(max(dot(n, L2), 0.0), 9.0) * bevel * 0.5;
  float rim = pow(bevel, 4.0);
  col += vec3((spec + spec2) * 0.5 + rim * 0.32);

  // A little darker so UI text stays readable over bright wallpapers.
  col = mix(col, col * 0.55, uTint);

  frag = vec4(col, alpha);
}`;

/** Hide this window from other apps' screen capture while refraction runs. */
export function useCaptureExcluded(on: boolean) {
  useEffect(() => {
    setCaptureExcluded(on).catch(() => {});
    return () => {
      if (on) setCaptureExcluded(false).catch(() => {});
    };
  }, [on]);
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
  return sh;
}

export interface RefractProps {
  /** Pill size and corner radius, in CSS px. */
  w: number;
  h: number;
  radius: number;
  /** Pill's top-left inside the window, in CSS px. */
  x: number;
  y: number;
  /** Expanded or hovered: capture more often. */
  active: boolean;
  /** Called when WebGL or the screen capture is unavailable. */
  onUnsupported?: () => void;
}

export function Refraction({ w, h, radius, x, y, active, onUnsupported }: RefractProps) {
  // While this is mounted the window must not appear in the capture, or
  // each frame would refract the previous one.
  useCaptureExcluded(true);
  const ref = useRef<HTMLCanvasElement>(null);
  // Live values the render loop reads without being restarted.
  const geom = useRef({ w, h, radius, x, y });
  geom.current = { w, h, radius, x, y };
  const activeRef = useRef(active);
  activeRef.current = active;
  const failed = useRef(onUnsupported);
  failed.current = onUnsupported;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) {
      failed.current?.();
      return;
    }
    let stopped = false;

    const prog = gl.createProgram()!;
    try {
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch {
      failed.current?.();
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 48, 255]));

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uWin = u("uWin"), uPill = u("uPill"), uPillPos = u("uPillPos"), uRadius = u("uRadius");
    const uEdge = u("uEdge"), uBend = u("uBend"), uTime = u("uTime");
    gl.uniform1f(u("uChroma"), 0.55);
    gl.uniform1f(u("uTint"), 0.46);
    gl.uniform1f(u("uIris"), 0.5);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // ---- The screen behind, refreshed on a timer ---------------------------
    let shotBusy = false;
    let failures = 0;
    const shoot = async () => {
      if (stopped || shotBusy || document.hidden) return;
      shotBusy = true;
      try {
        const shot = await captureBehind();
        if (!shot) {
          if (++failures >= 3) failed.current?.();
          return;
        }
        failures = 0;
        const img = new Image();
        img.decoding = "async";
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("decode"));
          img.src = shot.url;
        });
        if (stopped) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        dirty = true;
      } catch {
        /* a dropped frame is harmless; the previous one stays */
      } finally {
        shotBusy = false;
      }
    };
    // Faster while the island is open, slow while it just sits there.
    let timer = 0;
    const tick = () => {
      shoot();
      timer = window.setTimeout(tick, activeRef.current ? 110 : 700);
    };
    tick();

    // ---- Draw --------------------------------------------------------------
    const start = performance.now();
    let raf = 0;
    let dirty = true;
    let last = "";
    const draw = () => {
      if (stopped) return;
      const g = geom.current;
      // Idle: nothing moves, so there is nothing to redraw. Only a new
      // capture, a shape change or the slow rainbow drift needs a frame.
      const key = `${g.w}x${g.h}x${g.radius}x${g.x}x${g.y}`;
      if (key !== last) {
        last = key;
        dirty = true;
      }
      if (!dirty && !activeRef.current) {
        raf = requestAnimationFrame(draw);
        return;
      }
      dirty = false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round(g.w * dpr));
      const ch = Math.max(1, Math.round(g.h * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      gl.viewport(0, 0, cw, ch);
      gl.uniform2f(uWin, window.innerWidth, window.innerHeight);
      gl.uniform2f(uPill, g.w, g.h);
      gl.uniform2f(uPillPos, g.x, g.y);
      gl.uniform1f(uRadius, g.radius);
      // The bevel scales with the pill so small pills do not look chunky.
      // A thick glass edge: it is what gives the reference its depth.
      const edge = Math.max(14, Math.min(g.h * 0.55, 46));
      gl.uniform1f(uEdge, edge);
      gl.uniform1f(uBend, edge * 1.7);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

