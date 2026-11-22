import { useEffect, useLayoutEffect, useRef } from "react";
import { useLive } from "../../connectors/live";
import type { ConnectorId } from "../../connectors/types";
import type { Step } from "../../lib/onboarding";
import { rankedFindings, useScan } from "../../lib/scan-store";
import { ms, reducedMotion } from "../motion";
import { SealAnimation } from "./SealAnimation";
import { sealReaction, type SealPlug } from "./seal-reaction";

// One seal for all three onboarding steps. Each step only reserves a space for
// it (SealSlot). On a new step the seal fades out where it was, moves while it
// can't be seen, and fades back in with the new step. It stays mounted, so the
// animation engine loads once. Because the space is reserved, nothing else
// moves when the seal loads or can't load. Keys and buttons never wait for this.

/** The seal's full size in pixels (SealAnimation's size-48). Smaller slots scale it down. */
const SEAL_SIZE = 192;

/** Holds the seal's place on a step. Its size decides how large the seal is there. */
export function SealSlot({ className }: { className: string }) {
  return <div data-seal-slot aria-hidden="true" className={className} />;
}

/** Moves the seal onto the current step's slot, measured from the layout so the entrance animation can't skew it. */
function placeSeal(seal: HTMLElement) {
  // Faded out: it moves once it can't be seen.
  if (seal.dataset.fading !== undefined) return;
  const root = seal.parentElement;
  const slot = root?.querySelector<HTMLElement>("[data-seal-slot]");
  if (!root || !slot) return;
  let x = 0;
  let y = 0;
  for (let at: HTMLElement | null = slot; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  const place = `translate(${x}px, ${y}px) scale(${slot.offsetWidth / SEAL_SIZE})`;
  if (seal.dataset.place === place) return;
  seal.dataset.place = place;
  seal.style.transform = place;
}

export function SealStage({
  step,
  summoned,
  fallback,
  preview,
  connected,
  connecting,
}: {
  step: Step;
  summoned: boolean;
  fallback: boolean;
  preview: boolean;
  /** Sources added so far, and the one being connected right now. */
  connected: ConnectorId[];
  connecting?: ConnectorId;
}) {
  const scan = useScan();
  const live = useLive();
  // Already connected when this seal appeared (a reload or a summon): it is holding the plug, with no second lift.
  const startedConnected = useRef(connected.length > 0);
  useEffect(() => {
    if (!connected.length) startedConnected.current = false;
  }, [connected.length]);
  const failed = (id: ConnectorId) => ["needs_reconnect", "error"].includes(live.statuses[id]?.state ?? "");
  const plugged = connected.some((id) => id !== connecting && !failed(id));
  const plug: SealPlug = !plugged ? "none" : startedConnected.current ? "held" : "lift";
  const seal = useRef<HTMLDivElement>(null);
  const shownStep = useRef<Step | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Runs after every draw, before the screen updates, as a step's text can move its slot.
  useLayoutEffect(() => {
    const element = seal.current;
    const root = element?.parentElement;
    if (!element || !root) return;
    const changed = shownStep.current !== undefined && shownStep.current !== step;
    shownStep.current = step;
    const fade = changed && !reducedMotion() ? ms("--duration-seal-fade", 0) : 0;
    if (fade > 0 && element.dataset.fading === undefined) {
      clearTimeout(timer.current);
      element.dataset.fading = "";
      // The new step's words wait too, so the old seal never sits on top of them.
      root.dataset.sealMoving = "";
      timer.current = setTimeout(() => {
        delete element.dataset.fading;
        placeSeal(element);
        timer.current = setTimeout(() => delete root.dataset.sealMoving, fade);
      }, fade);
      return;
    }
    placeSeal(element);
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  // The replay notice can shrink this area, and late fonts can move the text.
  useEffect(() => {
    const element = seal.current;
    const root = element?.parentElement;
    if (!element || !root) return;
    const again = () => {
      if (element.isConnected) placeSeal(element);
    };
    const watcher = new ResizeObserver(again);
    watcher.observe(root);
    void document.fonts?.ready.then(again);
    return () => watcher.disconnect();
  }, []);

  return (
    <div ref={seal} className="seal-stage pointer-events-none absolute top-0 left-0 z-1 size-48">
      <SealAnimation fallback={fallback} preview={preview} reaction={sealReaction(step, summoned, scan.phase, rankedFindings(scan).length, plug)} />
    </div>
  );
}
