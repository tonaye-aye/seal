import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// The palette's motion, written by hand (no animation library):
//   useFlip      rows slide to their new place when the list changes order
//   useGlide     the selection highlight slides between rows on J/K
//   useCountUp   amounts count up the first time they appear
//   changeView   list, finding and timeline crossfade into each other
//   useScrollFade  no edge fade on a scrolling area whose content fits
//   useSettleText  text beside the sliding sidebar wraps once, not every frame
//
// Two rules hold everywhere. Nothing ever waits: a key press changes the state
// at once, and any motion still running is picked up from where it is. And with
// "reduce motion" switched on, there is no movement at all, only the end state.

// ---------- Scroll fade ----------

/**
 * Marks a `.scroll-fade` area whose content fits. The fade follows the scroll
 * position, and with nothing to scroll the browser reports "at the end", which
 * would fade the top row for no reason. Rechecks when the area or its rows resize.
 */
export function useScrollFade(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const update = () => {
      if (area.scrollHeight <= area.clientHeight + 1) area.dataset.fits = "";
      else delete area.dataset.fits;
    };
    update();
    const watch = new ResizeObserver(update);
    watch.observe(area);
    Array.from(area.children).forEach((child) => watch.observe(child));
    return () => watch.disconnect();
  });
}

// ---------- Shared ----------

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A timing token from tokens.css, in milliseconds (e.g. --duration-base is 180). */
function ms(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function easing(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out";
}

/** The same curve as --ease-out, roughly, for counting in JavaScript. */
function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

/**
 * While a side panel slides, the text beside it (anything marked `data-settle`,
 * inside a parent that clips it) takes the width it will end at straight away.
 * Its lines then wrap once and fade up, instead of rewrapping on every frame.
 */
export function useSettleText(
  areaRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  open: boolean,
) {
  const was = useRef(open);
  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const area = areaRef.current;
    const panel = panelRef.current;
    const full = panel?.firstElementChild as HTMLElement | null | undefined;
    if (!area || !panel || !full || reducedMotion()) return;
    const texts = Array.from(area.querySelectorAll<HTMLElement>("[data-settle]"));
    // Measured free of any earlier hold, so pressing again mid-slide still lands right.
    texts.forEach((text) => (text.style.width = ""));
    const change = panel.offsetWidth - (open ? full.offsetWidth : 0);
    const widths = texts.map((text) => text.offsetWidth + change);
    const duration = ms("--duration-panel", 280);
    texts.forEach((text, i) => {
      text.style.width = `${widths[i]}px`;
      text.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration, easing: easing() });
    });
    const release = () => texts.forEach((text) => (text.style.width = ""));
    const timer = setTimeout(release, duration + 40);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [open, areaRef, panelRef]);
}

/**
 * Dev gallery only: for each kind of motion, a number from 0 to 1 that stops
 * it at that point, so a still frame can show what it looks like partway.
 * 1 means "show the end state straight away". Left unset in the real app.
 */
export type Freeze = Partial<Record<"flip" | "glide" | "count", number>>;
export const MotionFreeze = createContext<Freeze | undefined>(undefined);

/** How many animations have started; a gallery still holds once its own have. */
let started = 0;

/** Start an animation, or, in a gallery still, start it and stop it at `freeze`. */
function play(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions, freeze: number | undefined): Animation {
  started++;
  // In a still, `freeze` means that far along the way, so the timing is even.
  const animation = el.animate(keyframes, freeze === undefined ? options : { ...options, easing: "linear" });
  if (freeze !== undefined) {
    animation.pause();
    animation.currentTime = Number(options.duration) * freeze;
  }
  return animation;
}

// ---------- Rows moving (FLIP) ----------

// FLIP: remember where each row was (First), let React put it where it goes
// (Last), push it back to where it was with a transform (Invert), then let the
// transform run back to zero (Play). Rows are marked with data-flip-key, and
// data-flip-group says which part of the list they belong to ("open" or
// "done"): a row that changes group leaves its place and fades in at the new
// one instead of travelling past every row in between.

type Snapshot = { top: number; left: number; width: number; group: string; copy: HTMLElement };

const FLIP_ID = "flip";

/** How far a row is pushed right now by a slide still running (0 when none). */
function runningOffset(el: HTMLElement): number {
  const running = el.getAnimations().filter((a) => a.id === FLIP_ID);
  if (!running.length) return 0;
  const transform = getComputedStyle(el).transform;
  const offset = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
  running.forEach((a) => a.cancel());
  return offset;
}

/** A still copy of a row that just left, fading out where the row used to be. */
function leave(list: HTMLElement, snap: Snapshot, freeze: number | undefined) {
  const ghost = snap.copy;
  ghost.removeAttribute("data-flip-key");
  ghost.removeAttribute("role");
  ghost.removeAttribute("aria-selected");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "absolute",
    top: `${snap.top}px`,
    left: `${snap.left}px`,
    width: `${snap.width}px`,
    margin: "0",
    pointerEvents: "none",
  });
  list.appendChild(ghost);
  const animation = play(
    ghost,
    [{ opacity: 1 }, { opacity: 0, transform: "translateX(12px)" }],
    { duration: ms("--duration-fast", 120), easing: easing(), fill: "forwards" },
    freeze,
  );
  if (freeze === undefined) animation.finished.then(() => ghost.remove(), () => ghost.remove());
}

/** A row arriving: a short fade and lift into its place. */
function arrive(el: HTMLElement, freeze: number | undefined) {
  play(
    el,
    [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
    { duration: ms("--duration-base", 180), easing: easing(), id: FLIP_ID },
    freeze,
  );
}

/**
 * Slides the rows of `listRef` (each marked data-flip-key) to their new places
 * whenever the list changes. The list must be positioned (`relative`), since
 * rows are measured against it. Changing `reset` (the search text) puts rows
 * in their new places without any motion: filtering should feel instant.
 */
export function useFlip(listRef: React.RefObject<HTMLElement | null>, reset: unknown) {
  const freeze = useContext(MotionFreeze)?.flip;
  const snapshots = useRef(new Map<string, Snapshot>());
  const lastReset = useRef(reset);
  // A gallery still, once stopped partway, stays that way through later renders.
  const held = useRef(false);

  // No dependency list: this runs after every render, because any render can move rows.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || held.current) return;
    const before = snapshots.current;
    const animate = before.size > 0 && lastReset.current === reset && !reducedMotion() && freeze !== 1;
    lastReset.current = reset;
    const after = new Map<string, Snapshot>();
    const startedBefore = started;

    for (const el of list.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      // Rows in a closed group (marked data-flip-off) are not tracked: they are
      // folding away, or not drawn at all. A row moving into a closed group
      // counts as gone (it fades out), and one coming out of it as new.
      if (el.closest("[data-flip-off]")) continue;
      const key = el.dataset.flipKey!;
      const group = el.dataset.flipGroup ?? "";
      const was = before.get(key);
      // Where the row is drawn right now: its old place, plus any slide still running.
      const offset = runningOffset(el);
      const top = el.offsetTop;
      if (animate) {
        if (!was) arrive(el, freeze);
        else if (was.group !== group) {
          leave(list, was, freeze);
          arrive(el, freeze);
        } else {
          const dy = was.top + offset - top;
          if (Math.abs(dy) > 0.5) {
            play(
              el,
              [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
              { duration: ms("--duration-base", 180), easing: easing(), id: FLIP_ID },
              freeze,
            );
          }
        }
      }
      after.set(key, { top, left: el.offsetLeft, width: el.offsetWidth, group, copy: el.cloneNode(true) as HTMLElement });
    }

    // Rows that are gone altogether (not a search: that resets above) fade out where they were.
    if (animate) for (const [key, snap] of before) if (!after.has(key)) leave(list, snap, freeze);
    snapshots.current = after;
    if (freeze !== undefined && started > startedBefore) held.current = true;
  });
}

// ---------- Selection glide ----------

/**
 * Moves one highlight element (`highlightRef`, absolutely placed inside the
 * list) onto the list's [aria-selected="true"] row. A CSS transition does the
 * sliding (.glide in tokens.css), so a quick run of J presses keeps up: each
 * one retargets the slide from wherever it is. The first placement, and every
 * placement with reduced motion, jumps straight there.
 */
export function useGlide(
  listRef: React.RefObject<HTMLElement | null>,
  highlightRef: React.RefObject<HTMLElement | null>,
) {
  const freeze = useContext(MotionFreeze)?.glide;
  const last = useRef<number | undefined>(undefined);

  // After every render: rows can move without the selection changing.
  useLayoutEffect(() => {
    const list = listRef.current;
    const highlight = highlightRef.current;
    if (!list || !highlight) return;
    // Rows sit right in the list, or in a group inside it marked data-glide-rows
    // (the findings list's "Checked and left alone").
    const row = [...list.querySelectorAll<HTMLElement>('[aria-selected="true"]')].find(
      (el) => el.parentElement === list || el.parentElement?.hasAttribute("data-glide-rows"),
    );
    if (!row) {
      highlight.style.opacity = "0";
      last.current = undefined;
      return;
    }
    let top = row.offsetTop;
    const instant = last.current === undefined || reducedMotion() || freeze !== undefined;
    // A gallery still stops partway from the last row to this one.
    if (freeze !== undefined && last.current !== undefined) top = last.current + (top - last.current) * freeze;
    if (top === last.current && highlight.style.opacity === "1") return;
    if (instant) highlight.style.transition = "none";
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.transform = `translateY(${top}px)`;
    highlight.style.opacity = "1";
    if (instant) {
      // Make the browser take the new place before the transition is switched back on.
      void highlight.offsetHeight;
      highlight.style.transition = "";
    }
    if (freeze === undefined) last.current = row.offsetTop;
    else if (last.current === undefined) last.current = top;
  });
}

// ---------- Counting up ----------

/** The last value shown for each amount, so it only counts again when it changes. */
const shown = new Map<string, number>();

/**
 * An amount (in cents) that counts up from zero the first time it is shown,
 * and from its old value when it changes. `id` names the amount ("row:<id>"),
 * so moving around, reopening the palette or switching views doesn't replay it.
 * Slower than other motion (--duration-count) so the count can be seen.
 */
export function useCountUp(id: string, target: number): number {
  const freeze = useContext(MotionFreeze)?.count;
  const [value, setValue] = useState(() => (reducedMotion() ? target : (shown.get(id) ?? 0)));

  useEffect(() => {
    if (freeze !== undefined) return;
    const from = shown.get(id) ?? 0;
    if (from === target || reducedMotion()) {
      shown.set(id, target);
      setValue(target);
      return;
    }
    const duration = ms("--duration-count", 420);
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      // The first frame's time can be from just before `start`: held at 0, or an amount would flash negative.
      const p = Math.max(0, Math.min(1, (t - start) / duration));
      const v = Math.round(from + (target - from) * easeOut(p));
      shown.set(id, v);
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [id, target, freeze]);

  if (freeze !== undefined) return Math.round(target * freeze);
  return value;
}

// ---------- Changing view ----------

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/** True when the webview can crossfade views itself (and motion is allowed). */
export function nativeViewTransitions(): boolean {
  return typeof document !== "undefined" && !!(document as ViewTransitionDocument).startViewTransition && !reducedMotion();
}

/**
 * Switch view (list, finding, timeline) with a short crossfade. Where the
 * webview supports view transitions, the browser pictures the old view, runs
 * `update`, then fades the new one in (one frame later, never blocking keys).
 * Elsewhere the update happens at once and the new view fades in by itself
 * (.view-in in tokens.css). "forward" slides in from the right, "back" from the left.
 * `after` runs once the new view is on the page.
 */
export function changeView(update: () => void, direction: "forward" | "back", after?: () => void) {
  // flushSync: React draws the new view straight away, so `after` (e.g.
  // focusing the search bar) finds it on the page.
  const run = () => {
    flushSync(update);
    after?.();
  };
  const doc = document as ViewTransitionDocument;
  if (!nativeViewTransitions() || !doc.startViewTransition) return run();
  document.documentElement.dataset.viewDir = direction;
  doc.startViewTransition(run);
}
