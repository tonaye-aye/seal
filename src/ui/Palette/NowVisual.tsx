import { useEffect, useRef, useState } from "react";
import { isPaletteHidden, onPaletteVisibility } from "../../lib/native";
import { useScan } from "../../lib/scan-store";
import { copy } from "../../copy";
import { nowFrom, type Now } from "../now-state";
import { Mark } from "./Mark";

// The "now" visual: the seal, alive. It is the one atmospheric element in the
// app, and it only ever shows the real scan state (see now-state.ts).
//
// - idle: the seal is dim, with a slow, faint glow behind it.
// - working: the seal pulses, with a steady glow behind it.
// - needs-you: the seal is bright, with a violet glow that grows and breathes
//   faster as urgency rises.
//
// There are two layers. The seal is a plain SVG, so it stays sharp at any size,
// and its pulse is CSS. Behind it, a tiny WebGL shader (a program that runs on
// the graphics chip and colours every pixel of a small canvas) draws only the
// glow. The
// canvas is bigger than the seal so the glow can spill softly behind the app
// name. Rendering stops whenever the palette is hidden or the page is in the
// background, and with "reduce motion" on it draws one still frame per state
// change. If WebGL is not available the seal stays, with a CSS glow. Colours
// come from tokens.css and follow the light or dark theme.

/** The canvas size in CSS pixels. The seal (18 px) sits in the middle. */
const SIZE = 56;

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Distances are in CSS pixels from the centre of the 18 px seal.
const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;      // canvas size in device pixels
uniform float u_dpr;     // device pixels per CSS pixel
uniform vec3 u_mix;      // how much of idle, working, needs-you (sums to 1)
uniform float u_urgency; // 0 to 1
uniform float u_phase;   // breathing phase, advanced on the CPU so speed changes stay smooth
uniform vec3 u_accent;    // the theme's colours, read from the CSS variables (see readTheme)
uniform vec3 u_ember;
uniform vec3 u_muted;
uniform float u_halo;    // how strong the glow is: 1 on dark, softer on light

const float R = 6.3;      // where the glow starts to fade

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_dpr;
  float d = length(p);
  float idle = u_mix.x, work = u_mix.y, need = u_mix.z;
  float breath = 0.5 + 0.5 * sin(u_phase);

  // A soft glow behind the seal. It reaches further when more is at stake.
  float reach = mix(3.0, 3.5 + 5.0 * u_urgency, need) + 2.0 * work;
  // Fades to nothing well before the canvas edge, so no square shows.
  float halo = exp(-max(d - R, 0.0) / reach) * (1.0 - smoothstep(R + 4.0, 0.5 * u_res.x / u_dpr, d));
  float glowStrength = u_halo * (
      idle * (0.10 + 0.08 * breath) +
      work * 0.22 +
      need * (0.18 + 0.24 * u_urgency) * (0.6 + 0.4 * breath));

  float a = halo * glowStrength;

  // Very urgent findings warm the glow towards ember red, never further.
  // Idle leans towards the muted text colour, so the accent means "something is waiting".
  vec3 col = mix(u_accent, u_muted, idle * 0.6);
  col = mix(col, u_ember, need * smoothstep(0.6, 1.0, u_urgency) * 0.25);

  gl_FragColor = vec4(col * a, a); // premultiplied alpha over a transparent canvas
}
`;

const TARGET: Record<Now["state"], [number, number, number]> = {
  idle: [1, 0, 0],
  working: [0, 1, 0],
  "needs-you": [0, 0, 1],
};

/** Breathing speed in radians a second: about 7 s a breath when idle, about 2 s when most urgent. */
function breathSpeed(mix: number[], urgency: number): number {
  return mix[0] * 0.9 + mix[1] * 1.6 + mix[2] * (1.3 + 1.8 * urgency);
}

/** `still` and `fallback` are for the dev gallery: force the reduced-motion frame or the CSS mark. */
export function NowVisual({ still: forceStill = false, fallback = false }: { still?: boolean; fallback?: boolean } = {}) {
  const scan = useScan();
  const now = nowFrom(scan);
  const glow = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(fallback);
  const [paused, setPaused] = useState(() => isPaletteHidden() || document.hidden);
  // The latest state, read by the drawing loop without restarting it.
  const live = useRef(now);
  live.current = now;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const host = glow.current;
    if (!host || fallback) return; // the CSS glow is showing
    // Made here, not by React: a released WebGL context can't be used again, and
    // React's development mode runs this effect twice on the same elements.
    const el = document.createElement("canvas");
    el.className = "block size-full";
    const gl = el.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    const made = gl ? build(gl) : undefined;
    if (!gl || !made) {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      setFailed(true);
      return;
    }
    const { program } = made;
    host.appendChild(el);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = el.height = Math.round(SIZE * dpr);
    gl.viewport(0, 0, el.width, el.height);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_res"), uDpr = u("u_dpr"), uMix = u("u_mix"), uUrg = u("u_urgency"), uPhase = u("u_phase");
    gl.uniform2f(uRes, el.width, el.height);
    gl.uniform1f(uDpr, dpr);

    // The colours come from tokens.css, and are read again when macOS
    // switches between light and dark.
    const applyTheme = () => {
      const theme = readTheme();
      gl.uniform3f(u("u_accent"), ...theme.accent);
      gl.uniform3f(u("u_ember"), ...theme.ember);
      gl.uniform3f(u("u_muted"), ...theme.muted);
      gl.uniform1f(u("u_halo"), theme.halo);
    };
    applyTheme();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = { get matches() { return forceStill || media.matches; } };
    // Eased copies of the state, so changes blend over about half a second.
    const mix = [...TARGET[live.current.state]];
    let urgency = live.current.urgency;
    let phase = Math.PI / 2; // start mid-breath
    let last = performance.now();
    let frame = 0;

    const draw = () => {
      gl.uniform3f(uMix, mix[0], mix[1], mix[2]);
      gl.uniform1f(uUrg, urgency);
      gl.uniform1f(uPhase, phase);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const tick = (at: number) => {
      const dt = Math.min((at - last) / 1000, 0.1);
      last = at;
      const target = TARGET[live.current.state];
      const k = 1 - Math.exp(-dt * 6); // reaches about 95% in half a second
      for (let i = 0; i < 3; i++) mix[i] += (target[i] - mix[i]) * k;
      urgency += (live.current.urgency - urgency) * k;
      phase += dt * breathSpeed(mix, urgency);
      draw();
      frame = requestAnimationFrame(tick);
    };

    // Reduce motion: snap to the state and draw a single still frame.
    const still = () => {
      const target = TARGET[live.current.state];
      for (let i = 0; i < 3; i++) mix[i] = target[i];
      urgency = live.current.urgency;
      phase = Math.PI / 2;
      draw();
    };

    const update = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const offScreen = isPaletteHidden() || document.hidden;
      el.dataset.rendering = String(!offScreen && !reduced.matches);
      if (offScreen) return; // nothing is drawn while no one can see it
      if (reduced.matches) return still();
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    kick.current = () => {
      if (reduced.matches && !isPaletteHidden()) still();
    };

    const themeChanged = () => {
      applyTheme();
      kick.current(); // the still frame needs redrawing; a running loop picks it up next frame
    };

    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(frame);
      el.remove();
      setFailed(true);
    };

    update();
    const stopVisibility = onPaletteVisibility(update);
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    scheme.addEventListener("change", themeChanged);
    el.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(frame);
      stopVisibility();
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
      scheme.removeEventListener("change", themeChanged);
      el.removeEventListener("webglcontextlost", lost);
      kick.current = () => {};
      release(gl, el, made);
    };
  }, []);

  // The CSS glow's animation stops too while no one can see it.
  useEffect(() => {
    if (!failed) return;
    const update = () => setPaused(isPaletteHidden() || document.hidden);
    update();
    const stopVisibility = onPaletteVisibility(update);
    document.addEventListener("visibilitychange", update);
    return () => {
      stopVisibility();
      document.removeEventListener("visibilitychange", update);
    };
  }, [failed]);

  // With reduced motion there is no loop, so redraw the still frame when the state changes.
  useEffect(() => {
    kick.current();
  }, [now.state, now.urgency]);

  const label =
    now.state === "working" ? copy.header.now.working : now.state === "needs-you" ? copy.header.now.waiting(now.waiting) : copy.header.now.idle;

  return (
    <span
      className="relative grid size-[18px] shrink-0 place-items-center"
      role="img"
      aria-label={label}
      data-now={now.state}
      data-urgency={now.urgency}
    >
      {/* The shader's canvas goes in here. */}
      <span
        ref={glow}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ width: SIZE, height: SIZE, left: (18 - SIZE) / 2, top: (18 - SIZE) / 2 }}
      />
      {/* relative: paints the seal above the glow. */}
      <span className={`now-seal relative now-${now.state}${forceStill ? " now-still" : ""}${failed ? " now-fallback" : ""}${failed && paused ? " now-paused" : ""}`}>
        <Mark />
      </span>
    </span>
  );
}

type Rgb = [number, number, number];

/** The shader's colours for the current theme, from the CSS variables in tokens.css. */
function readTheme(): { accent: Rgb; ember: Rgb; muted: Rgb; halo: number } {
  const css = getComputedStyle(document.documentElement);
  const halo = parseFloat(css.getPropertyValue("--now-halo"));
  return {
    accent: toRgb(css.getPropertyValue("--color-accent")),
    ember: toRgb(css.getPropertyValue("--color-danger")),
    muted: toRgb(css.getPropertyValue("--color-muted")),
    halo: Number.isFinite(halo) ? halo : 1,
  };
}

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Turns any CSS colour (hex, rgb(), oklch() and so on) into 0-1 RGB for the
 * shader: the browser paints it into one pixel and we read that pixel back.
 */
function toRgb(value: string): Rgb {
  if (probe === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return [1, 1, 1];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#fff";
  probe.fillStyle = value.trim() || "#fff"; // an invalid colour leaves the white
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/**
 * Gives the graphics memory back. Browsers allow only a few WebGL contexts at
 * once, and each summon makes a new one.
 */
function release(gl: WebGLRenderingContext, el: HTMLCanvasElement, made: { program: WebGLProgram; buffer: WebGLBuffer | null }) {
  if (!gl.isContextLost()) {
    gl.deleteBuffer(made.buffer);
    gl.deleteProgram(made.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  el.remove();
  el.width = el.height = 0;
}

/**
 * Compiles a shader and uploads one triangle that covers the whole canvas.
 * Returns undefined on failure.
 */
function build(gl: WebGLRenderingContext): { program: WebGLProgram; buffer: WebGLBuffer | null } | undefined {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn("[now] shader did not compile:", gl.getShaderInfoLog(shader));
    return undefined;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return undefined;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Linked programs keep their own copy, so the shaders can be let go now.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  return { program, buffer };
}
