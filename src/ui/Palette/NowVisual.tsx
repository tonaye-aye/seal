import { useEffect, useRef, useState } from "react";
import { isPaletteHidden, onPaletteVisibility } from "../../lib/native";
import { useScan } from "../../lib/scan-store";
import { nowFrom, type Now } from "../now-state";
import { Mark } from "./Mark";

// The "now" visual: the app's mark, alive. It is the one atmospheric element
// in the app, and it only ever shows the real scan state (see now-state.ts).
//
// - idle: the ring breathes slowly and dimly.
// - working: a bright spark sweeps round the ring, like a radar.
// - needs-you: a warm amber glow that grows and breathes faster as urgency rises.
//
// It is drawn by a tiny WebGL shader (a program that runs on the graphics chip
// and colours every pixel of a small canvas). The canvas is bigger than the
// mark so the glow can spill softly behind the app name. Rendering stops
// whenever the palette is hidden or the page is in the background, and with
// "reduce motion" on it draws one still frame per state change. If WebGL is not
// available the plain SVG mark shows instead, with a CSS glow.

/** The canvas size in CSS pixels. The mark (18 px) sits in the middle. */
const SIZE = 56;

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Distances are in CSS pixels from the centre, so the ring lines up with the
// 18 px SVG mark: radius 6.3, stroke 1.6, centre dot radius 2.
const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;      // canvas size in device pixels
uniform float u_dpr;     // device pixels per CSS pixel
uniform float u_time;    // seconds
uniform vec3 u_mix;      // how much of idle, working, needs-you (sums to 1)
uniform float u_urgency; // 0 to 1
uniform float u_phase;   // breathing phase, advanced on the CPU so speed changes stay smooth

const vec3 AMBER = vec3(0.949, 0.651, 0.353);
const vec3 EMBER = vec3(0.898, 0.451, 0.420);
const vec3 MUTED = vec3(0.639, 0.592, 0.529);
const float TAU = 6.2831853;
const float R = 6.3;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_dpr;
  float d = length(p);
  float aa = 0.75;
  float idle = u_mix.x, work = u_mix.y, need = u_mix.z;
  float breath = 0.5 + 0.5 * sin(u_phase);

  // The ring and the centre dot, the same shape as the mark.
  float ring = 1.0 - smoothstep(0.8 - aa, 0.8 + aa, abs(d - R));
  float dot = 1.0 - smoothstep(2.0 - aa, 2.0 + aa, d);

  // Working: a spark runs round the ring with a fading tail behind it.
  float angle = atan(p.y, p.x);
  float behind = mod(u_time * 3.2 - angle, TAU);
  float tail = exp(-behind * 1.4);
  float spark = tail * (1.0 - smoothstep(0.0, 3.5, abs(d - R)));

  // A soft glow outside the ring. It reaches further when more is at stake.
  float reach = mix(3.0, 3.5 + 5.0 * u_urgency, need) + 2.0 * work;
  // Fades to nothing well before the canvas edge, so no square shows.
  float halo = exp(-max(d - R, 0.0) / reach) * (1.0 - smoothstep(R + 4.0, 0.5 * u_res.x / u_dpr, d));
  float glowStrength =
      idle * (0.10 + 0.08 * breath) +
      work * 0.22 +
      need * (0.18 + 0.24 * u_urgency) * (0.6 + 0.4 * breath);

  // How bright the mark itself is in each state.
  float markAlpha = idle * (0.55 + 0.20 * breath) + work * 0.55 + need * 1.0;
  float dotAlpha = idle * (0.55 + 0.20 * breath) + work * (0.6 + 0.4 * tail) + need * 1.0;

  float a = max(max(ring * markAlpha, dot * dotAlpha), spark * work);
  a = max(a, halo * glowStrength * (1.0 - ring));

  // Very urgent findings warm the glow towards ember red, never further.
  // Idle leans towards the muted text colour, so amber means "something is waiting".
  vec3 col = mix(AMBER, MUTED, idle * 0.6);
  col = mix(col, EMBER, need * smoothstep(0.6, 1.0, u_urgency) * 0.25 * (1.0 - ring));
  col += work * spark * 0.25; // the spark is a little whiter than the ring

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
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(fallback);
  // The latest state, read by the drawing loop without restarting it.
  const live = useRef(now);
  live.current = now;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current;
    if (!el) return; // the CSS mark is showing
    const gl = el?.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    const program = gl && build(gl);
    if (!el || !gl || !program) {
      setFailed(true);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = el.height = Math.round(SIZE * dpr);
    gl.viewport(0, 0, el.width, el.height);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_res"), uDpr = u("u_dpr"), uTime = u("u_time"), uMix = u("u_mix"), uUrg = u("u_urgency"), uPhase = u("u_phase");
    gl.uniform2f(uRes, el.width, el.height);
    gl.uniform1f(uDpr, dpr);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = { get matches() { return forceStill || media.matches; } };
    // Eased copies of the state, so changes blend over about half a second.
    const mix = [...TARGET[live.current.state]];
    let urgency = live.current.urgency;
    let phase = Math.PI / 2; // start mid-breath
    let time = 0;
    let last = performance.now();
    let frame = 0;

    const draw = () => {
      gl.uniform1f(uTime, time);
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
      time += dt;
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
      time = 0.6; // puts the working spark at the top right, a clear "in progress" arc
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

    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(frame);
      setFailed(true);
    };

    update();
    const stopVisibility = onPaletteVisibility(update);
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    el.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(frame);
      stopVisibility();
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
      el.removeEventListener("webglcontextlost", lost);
      kick.current = () => {};
    };
  }, []);

  // With reduced motion there is no loop, so redraw the still frame when the state changes.
  useEffect(() => {
    kick.current();
  }, [now.state, now.urgency]);

  const label =
    now.state === "working" ? "Checking now" : now.state === "needs-you" ? `${now.waiting} waiting for you` : "Nothing waiting";

  return (
    <span
      className="relative grid size-[18px] shrink-0 place-items-center"
      role="img"
      aria-label={label}
      data-now={now.state}
      data-urgency={now.urgency}
    >
      {failed ? (
        <span className={`now-fallback text-amber now-${now.state}`}>
          <Mark />
        </span>
      ) : (
        <canvas
          ref={canvas}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ width: SIZE, height: SIZE, left: (18 - SIZE) / 2, top: (18 - SIZE) / 2 }}
        />
      )}
    </span>
  );
}

/**
 * Compiles a shader and uploads one triangle that covers the whole canvas.
 * Returns undefined on failure.
 */
function build(gl: WebGLRenderingContext): WebGLProgram | undefined {
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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  return program;
}
