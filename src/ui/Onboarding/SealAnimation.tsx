import { useEffect, useRef, useState } from "react";
import sealFile from "../../assets/sappy-seal.riv?url";
import { copy } from "../../copy";
import { isPaletteHidden, onPaletteVisibility } from "../../lib/native";
import { SealIcon } from "../icons";

// The seal on onboarding's last step: "Sappy Seal" by dob (CC BY, see the
// README), a Rive animation with its background made transparent. It watches
// the pointer and blushes wherever the pointer is in the window, and sends
// hearts when it is clicked.
//
// The canvas ignores the pointer, so it never gets in the way of a button or
// of selecting text. The window's pointer moves are only watched and passed on.
//
// The Rive engine is only loaded when this step opens, so summoning stays
// instant, and it comes from the app's own files, so it works with no network.
// If it can't load, the plain seal icon takes its place at the same size.

/** How long the engine and file get to load before the plain seal shows instead. */
const LOAD_LIMIT_MS = 4000;

/**
 * How far from the seal a pointer position is passed on, in canvas widths. The
 * file only tracks the pointer within a set area, so a pointer further away is
 * passed on at this distance, in the same direction.
 */
const REACH = 1;

type Input = { name: string; value?: unknown; fire?: () => void };

/** Passes the window's pointer moves to the seal. Returns a function that stops it. */
function followPointer(canvas: HTMLCanvasElement, blush: Input | undefined): () => void {
  let frame = 0;
  let last: MouseEvent | undefined;
  const send = () => {
    frame = 0;
    if (!last) return;
    const box = canvas.getBoundingClientRect();
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    let x = last.clientX - centreX;
    let y = last.clientY - centreY;
    const far = Math.hypot(x, y);
    const limit = box.width * REACH;
    if (far > limit) {
      x *= limit / far;
      y *= limit / far;
    }
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: centreX + x, clientY: centreY + y }));
    // After the move, as the file's own hover turns this off when the pointer leaves the seal.
    if (blush) blush.value = true;
  };
  const onMove = (event: MouseEvent) => {
    last = event;
    frame ||= requestAnimationFrame(send);
  };
  const onLeave = () => {
    if (blush) blush.value = false;
  };
  const root = document.documentElement;
  window.addEventListener("mousemove", onMove, { passive: true });
  root.addEventListener("mouseleave", onLeave);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("mousemove", onMove);
    root.removeEventListener("mouseleave", onLeave);
  };
}

export function SealAnimation({ fallback = false }: { /** The dev gallery only: draw the plain seal. */ fallback?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const love = useRef<Input | undefined>(undefined);
  const [failed, setFailed] = useState(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (fallback || !canvas.current) return;
    const target = canvas.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let gone = false;
    let stop = () => {};
    let stopFollowing = () => {};
    const limit = setTimeout(() => setFailed(true), LOAD_LIMIT_MS);

    void (async () => {
      const [{ Alignment, Fit, Layout, Rive, RuntimeLoader }, { default: engine }] = await Promise.all([
        import("@rive-app/canvas"),
        import("@rive-app/canvas/rive.wasm?url"),
      ]);
      if (gone) return;
      // Rive's defaults fetch from public CDNs. These keep it on the app's own copy.
      RuntimeLoader.setWasmUrl(engine);
      RuntimeLoader.setWasmFallbackUrl(null);
      RuntimeLoader.setWasmThreadsUrl(null);
      const rive = new Rive({
        src: sealFile,
        canvas: target,
        artboard: "Sappy",
        stateMachines: "Seal",
        autoplay: !still,
        // With reduced motion it is one still picture, so the pointer doesn't animate it either.
        shouldDisableRiveListeners: still,
        layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
        onLoad: () => {
          if (gone) return;
          clearTimeout(limit);
          // Sized from the layout, not the screen: the palette may still be mid entrance
          // animation, and measuring it then would leave the seal blurry.
          const scale = window.devicePixelRatio || 1;
          target.width = Math.round(target.offsetWidth * scale);
          target.height = Math.round(target.offsetHeight * scale);
          rive.resizeToCanvas();
          if (still) rive.drawFrame();
          else {
            const inputs = (rive.stateMachineInputs("Seal") ?? []) as Input[];
            love.current = inputs.find((input) => input.name === "Click");
            stopFollowing = followPointer(target, inputs.find((input) => input.name === "Blush"));
            // It finished loading after the app was hidden: wait to be shown.
            if (isPaletteHidden()) rive.pause();
          }
          setReady(true);
        },
        onLoadError: () => setFailed(true),
      });
      // Nothing draws while the app is hidden in the menu bar.
      const stopVisibility = onPaletteVisibility(() => {
        if (still) return;
        if (isPaletteHidden()) rive.pause();
        else rive.play();
      });
      stop = () => {
        stopVisibility();
        rive.cleanup();
      };
    })().catch(() => setFailed(true));

    return () => {
      gone = true;
      clearTimeout(limit);
      stopFollowing();
      stop();
    };
  }, [fallback]);

  return (
    <div role="img" aria-label={copy.onboarding.sealAlt} onClick={() => love.current?.fire?.()} className="relative grid size-48 place-items-center">
      {failed ? (
        <span className="fade-in text-muted">
          <SealIcon size={112} />
        </span>
      ) : (
        // Drawn larger than its box, as the seal only fills the middle of its artboard. It is
        // see-through to the pointer, so it can overlap the text around it without blocking it.
        <canvas
          ref={canvas}
          className={`seal-canvas pointer-events-none absolute top-1/2 left-1/2 size-[170%] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-(--duration-base) ${ready ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
