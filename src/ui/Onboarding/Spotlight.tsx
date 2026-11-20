import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { KeyButton } from "../Kbd";
import { NextIcon } from "../icons";

// The practice tour's spotlight: everything in the palette dims except one
// element, with a tooltip beside it. It is the one reusable coaching pattern:
// give an element a data-coach="name" attribute, then point a tip at "name".
//
// It only draws. Clicks pass straight through (the palette decides what each
// action does during practice), and it doesn't listen to keys.

type Box = { left: number; top: number; width: number; height: number };

/** Space around the spotlit element, in pixels. */
const PAD = 4;
const TIP_WIDTH = 320;

/** The first target on screen (with a size), as a box inside `root`. */
function measure(root: HTMLElement, targets: string[]): Box | undefined {
  const base = root.getBoundingClientRect();
  for (const name of targets) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-coach="${CSS.escape(name)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Keep it inside the palette, so a target half scrolled away still reads.
      const top = Math.max(r.top, base.top) - base.top - PAD;
      const bottom = Math.min(r.bottom, base.bottom) - base.top + PAD;
      return { left: r.left - base.left - PAD, top, width: r.width + PAD * 2, height: Math.max(0, bottom - top) };
    }
  }
  return undefined;
}

export function Spotlight({
  rootRef,
  targets,
  children,
  label,
  next = false,
  nextLabel = "Next",
  mouse = false,
  onNext,
  flash = false,
  callout,
}: {
  /** The palette panel the spotlight covers. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** data-coach names to spotlight, first one on screen wins. */
  targets: string[];
  /** What the tooltip says. */
  children: React.ReactNode;
  /** A small line under the tip, e.g. "Details · 2 of 4". */
  label?: string;
  /** The tip only explains: show a Next button (Enter does the same). */
  next?: boolean;
  /** The Next button's words ("Finish" on the last tip). */
  nextLabel?: string;
  mouse?: boolean;
  onNext?: () => void;
  /** The tip's key was just used: its key caps light up. */
  flash?: boolean;
  /** A prompt that points at something without dimming the rest (the practice check). */
  callout?: "danger" | "positive";
}) {
  const [box, setBox] = useState<Box>();
  const [size, setSize] = useState({ width: 1000, height: 680 });
  // Top of the coach strip: a tooltip for something below it goes above the strip, not under it.
  const [stripTop, setStripTop] = useState<number>();
  const key = targets.join("|");
  const last = useRef("");
  // When the target briefly disappears (a view switching), keep the last box
  // a moment, so the highlight glides to the next one instead of blinking.
  const lastBox = useRef<{ box: Box; at: number } | undefined>(undefined);

  // Bring the target into view when the tip changes (e.g. a timeline line below the fold).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const name of targets) {
      const el = root.querySelector<HTMLElement>(`[data-coach="${CSS.escape(name)}"]`);
      if (el && el.getBoundingClientRect().height > 0) {
        el.scrollIntoView({ block: "nearest" });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Follow the target as things move (views animate in, lists scroll). Only
  // runs while a tip is up, and only updates when the box really changes.
  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      const root = rootRef.current;
      if (root) {
        let next = measure(root, targets);
        if (next) lastBox.current = { box: next, at: performance.now() };
        else if (lastBox.current && performance.now() - lastBox.current.at < 400) next = lastBox.current.box;
        const sig = next ? `${Math.round(next.left)},${Math.round(next.top)},${Math.round(next.width)},${Math.round(next.height)}` : "none";
        const strip = root.querySelector<HTMLElement>("[data-coach-strip]");
        const st = strip ? Math.round(strip.getBoundingClientRect().top - root.getBoundingClientRect().top) : undefined;
        const s = `${root.clientWidth}x${root.clientHeight}:${st}`;
        if (sig + s !== last.current) {
          last.current = sig + s;
          setBox(next);
          setSize({ width: root.clientWidth, height: root.clientHeight });
          setStripTop(st);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The tooltip goes under the target if there's room, otherwise above it.
  const below = !box || box.top + box.height + 150 < size.height - 60;
  const left = Math.min(Math.max(12, (box?.left ?? size.width / 2 - TIP_WIDTH / 2)), size.width - TIP_WIDTH - 12);
  const above = box && stripTop !== undefined && box.top >= stripTop ? stripTop : box?.top;
  // A big target (the whole list or timeline) leaves no room above or below:
  // the tooltip then sits inside it, bottom right, clear of the coach strip.
  const inside = box && !below && (above ?? box.top) < 150;
  const insideBottom = box && Math.min(box.top + box.height, stripTop ?? Infinity);
  const tipStyle: React.CSSProperties = !box
    ? { left, top: size.height / 3 }
    : inside
      ? { left: Math.max(12, box.left + box.width - TIP_WIDTH - 16), bottom: size.height - (insideBottom ?? 0) + 16 }
      : below
        ? { left, top: box.top + box.height + 10 }
        : { left, bottom: size.height - (above ?? box.top) + 10 };

  const ring = callout === "danger" ? "ring-danger/60" : callout === "positive" ? "ring-positive/60" : "ring-amber/50";
  const border = callout === "danger" ? "border-danger/40" : callout === "positive" ? "border-positive/40" : "border-amber/30";

  return (
    <>
      {/* The dimming sits under the coach strip (z-40), so the strip stays readable. A callout doesn't dim. */}
      <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
        {box ? (
          <div
            className={`spotlight-hole absolute rounded-[10px] ring-1 ${ring}`}
            style={{ ...box, boxShadow: callout ? undefined : "0 0 0 9999px rgb(10 8 6 / 0.62)" }}
          />
        ) : (
          !callout && <div className="absolute inset-0 bg-[rgb(10_8_6/0.62)]" />
        )}
      </div>
      {/* The tooltip sits above everything, the strip included. */}
      <div className="pointer-events-none absolute inset-0 z-50" aria-live="polite">
        <div
          key={key + (callout ?? "")}
          role="status"
          data-coach-tip
          className={`fade-in pointer-events-auto absolute flex flex-col gap-2 rounded-lg border ${border} bg-raised px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-text shadow-[0_12px_32px_rgb(0_0_0/0.45)] ${flash ? "coach-flash" : ""}`}
          style={{ ...tipStyle, width: TIP_WIDTH }}
        >
          <p>{children}</p>
          {(label || next) && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] text-faint tabular">{label}</span>
              {next && onNext && <KeyButton keys={["↵"]} label={nextLabel} icon={<NextIcon />} tone="amber" mouse={mouse} onClick={onNext} />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
