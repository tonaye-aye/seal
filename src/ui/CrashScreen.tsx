import { Component, useLayoutEffect, useRef, type ErrorInfo, type ReactNode, type Ref } from "react";
import { copy } from "../copy";
import { hidePalette, onPaletteShown } from "../lib/native";

// What shows if drawing the app fails. The window is see-through, so without
// this a crash would leave nothing on screen and no way back. It stays small
// and imports almost nothing, because anything it shares with the app could be
// the very thing that broke.

const KEY_CAP = "inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border px-1 font-mono text-label leading-none";
const BUTTON = "press inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 leading-none whitespace-nowrap";

/** The picture on its own, with no keys, so the dev gallery can show it safely. */
export function CrashPanel({ onReload, onHide, panelRef }: { onReload: () => void; onHide: () => void; panelRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="palette-shell grain relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[14px] border border-edge bg-panel px-10 text-center"
    >
      <div role="alert" className="flex flex-col items-center">
        <div className="mb-4 grid size-10 place-items-center rounded-full border border-hairline bg-raised">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-danger">
            <path d="M10 6v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="10" cy="14" r="1" fill="currentColor" />
          </svg>
        </div>
        <h1 className="heading text-heading font-semibold text-text">{copy.crash.title}</h1>
        <p className="mt-1.5 max-w-[48ch] text-muted">{copy.crash.body}</p>
      </div>
      <div className="mt-5 flex items-center gap-2">
        {/* A click leaves focus where it is, so the keys keep working. */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onReload}
          className={`${BUTTON} grain grain-accent relative bg-accent-solid font-semibold text-on-accent hover:bg-accent-solid-hover`}
        >
          <kbd className={`${KEY_CAP} border-on-accent/25 bg-accent-solid-hover text-on-accent`}>R</kbd>
          {copy.crash.reload}
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onHide} className={`${BUTTON} text-muted hover:bg-raised hover:text-text`}>
          <kbd className={`${KEY_CAP} border-hairline bg-raised text-muted`}>Esc</kbd>
          {copy.crash.hide}
        </button>
      </div>
    </div>
  );
}

function reload() {
  window.location.reload();
}

/** The real screen: the panel plus its own keys, because the palette's are gone after a crash. */
function CrashScreen() {
  const panel = useRef<HTMLDivElement>(null);

  // Before the first paint, so the keys work the moment the screen appears.
  useLayoutEffect(() => {
    const focus = () => panel.current?.focus();
    focus();
    const stopShown = onPaletteShown(focus);

    const onKey = (e: KeyboardEvent) => {
      // Only a fresh, plain press counts. A key still held from before the
      // crash repeats by itself, and must never trigger a reload.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        hidePalette();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        reload();
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        // On a focused button, Enter presses that button instead.
        e.preventDefault();
        reload();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      stopShown();
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return <CrashPanel panelRef={panel} onReload={reload} onHide={hidePalette} />;
}

/** Catches an error while React draws anything inside it, and shows the crash screen instead. */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Seal crashed while drawing:", error, info.componentStack);
  }

  render() {
    return this.state.crashed ? <CrashScreen /> : this.props.children;
  }
}
