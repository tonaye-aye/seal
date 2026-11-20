import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { isPaletteHidden } from "../../lib/native";
import { build } from "../Palette/NowVisual";

// The "training complete" moment at the end of the practice round: a ring
// draws itself round, a tick draws inside it, then a soft green bloom and a
// few rings move outwards and it settles. It plays once (about 2.6 s) and
// then stops drawing.
//
// Like the now mark, it is a small WebGL shader (a program on the graphics
// chip that colours each pixel). With "reduce motion" on, or while the palette
// is hidden, it draws only the settled last frame. Without WebGL, a plain
// tick in a ring shows instead.

const WIDTH = 300;
const HEIGHT = 170;
/** Seconds until it settles. */
const LENGTH = 2.6;

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_t; // seconds since it started

const vec3 AMBER = vec3(0.949, 0.651, 0.353);
const vec3 GREEN = vec3(0.561, 0.749, 0.541);
const float TAU = 6.2831853;
const float R = 28.0;

float ease(float x) { return 1.0 - pow(1.0 - clamp(x, 0.0, 1.0), 3.0); }

// Distance from p to the line from a to b, drawn only up to fraction k of its length.
float segment(vec2 p, vec2 a, vec2 b, float k) {
  if (k <= 0.0) return 1e4;
  vec2 end = mix(a, b, clamp(k, 0.0, 1.0));
  vec2 pa = p - a, ba = end - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_dpr;
  float d = length(p);
  float t = u_t;

  // 1. The ring draws itself clockwise from the top.
  float sweep = ease(t / 0.9) * TAU;
  float ang = mod(atan(p.x, p.y) + TAU, TAU);
  float ring = (1.0 - smoothstep(0.0, 1.5, abs(d - R))) * step(ang, sweep);

  // 2. The tick draws inside it, short stroke then long stroke.
  vec2 a = vec2(-11.0, 1.0), b = vec2(-3.5, -7.0), c = vec2(12.0, 9.0);
  float l1 = length(b - a), l2 = length(c - b);
  float drawn = ease((t - 0.75) / 0.5) * (l1 + l2);
  float dt = min(segment(p, a, b, drawn / l1), segment(p, b, c, (drawn - l1) / l2));
  float tick = 1.0 - smoothstep(1.2, 2.4, dt);

  // 3. Once the tick is in: a green bloom, and rings moving outwards.
  float done = smoothstep(1.15, 1.45, t);
  float bloom = exp(-max(d - R, 0.0) / 18.0) * done * mix(0.45, 0.22, smoothstep(1.5, 2.6, t));
  float w1 = clamp((t - 1.2) / 1.2, 0.0, 1.0);
  float w2 = clamp((t - 1.45) / 1.15, 0.0, 1.0);
  float r1 = (1.0 - w1) * (1.0 - smoothstep(0.0, 1.5 + 4.0 * w1, abs(d - mix(R, 82.0, ease(w1))))) * step(0.001, w1);
  float r2 = (1.0 - w2) * (1.0 - smoothstep(0.0, 1.5 + 3.0 * w2, abs(d - mix(R, 64.0, ease(w2))))) * step(0.001, w2);

  // Fade the glow out well before the canvas edge.
  float edge = 0.5 * u_res.y / u_dpr;
  bloom *= 1.0 - smoothstep(edge - 26.0, edge, d);

  // The ring turns from amber to green as the tick lands. Colours are
  // premultiplied (already multiplied by how solid each part is).
  vec3 ringCol = mix(AMBER, GREEN, done);
  float solid = max(ring, tick);
  float waves = max(r1 * 0.55, r2 * 0.35) * (1.0 - solid);
  float glow = bloom * (1.0 - solid) * (1.0 - waves);
  vec3 pre = ringCol * ring + GREEN * tick * (1.0 - ring) + AMBER * waves + GREEN * glow;
  float alpha = clamp(solid + waves + glow, 0.0, 1.0);
  gl_FragColor = vec4(min(pre, vec3(alpha)), alpha);
}
`;

/** `still` and `fallback` are for the dev gallery: force the settled frame or the plain tick. */
export function TrainingShader({ still = false, fallback = false }: { still?: boolean; fallback?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(fallback);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const gl = el.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    const program = gl && build(gl, FRAGMENT);
    if (!gl || !program) {
      setFailed(true);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(WIDTH * dpr);
    el.height = Math.round(HEIGHT * dpr);
    gl.viewport(0, 0, el.width, el.height);
    gl.uniform2f(gl.getUniformLocation(program, "u_res"), el.width, el.height);
    gl.uniform1f(gl.getUniformLocation(program, "u_dpr"), dpr);
    const uT = gl.getUniformLocation(program, "u_t");
    const draw = (t: number) => {
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const reduced = still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || isPaletteHidden()) {
      draw(LENGTH);
      el.dataset.rendering = "still";
      return;
    }
    el.dataset.rendering = "playing";
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= LENGTH || isPaletteHidden()) {
        // Settle on the last frame and stop drawing.
        draw(LENGTH);
        el.dataset.rendering = "settled";
        return;
      }
      draw(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still]);

  return (
    <div className="relative grid place-items-center" style={{ width: WIDTH, height: HEIGHT }} aria-hidden="true">
      {failed ? (
        <span className="celebration-fallback grid size-14 place-items-center rounded-full border-2 border-positive text-positive">
          <Check size={26} strokeWidth={2.2} />
        </span>
      ) : (
        <canvas ref={canvas} data-training className="pointer-events-none absolute inset-0" style={{ width: WIDTH, height: HEIGHT }} />
      )}
    </div>
  );
}
