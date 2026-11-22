import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LayerContainer, Tip } from "../layers";

// The palette's frame: top bar, replay banner, the middle area, the footer,
// plus anything floating on top (toast, sheets). The real
// palette and the dev gallery both draw through this, so they can't drift apart.
// To the right of all that is a slot for a column that runs the whole height
// of the window: an open finding's sidebar (ShellAside).

type Props = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  header: React.ReactNode;
  /** The "Replay mode" banner under the top bar (src/ui/replay.tsx says what it reads). */
  replay?: React.ReactNode;
  /** What fills the middle (a view, plus the trace drawer when open). */
  children: React.ReactNode;
  /** The bottom bar, left out on the onboarding steps. */
  footer?: React.ReactNode;
  /** Things that float above everything: the toast and the sheets. */
  overlay?: React.ReactNode;
};

// A one-line notice under the top bar: slim, in the info colour (it is the
// agent's own status, not something urgent). Two notices stack with a small gap.
const NOTICE =
  "mx-3 mb-1.5 flex h-6 shrink-0 items-center gap-2 overflow-hidden rounded-md bg-info/8 px-2.5 text-meta leading-none text-muted before:size-1.5 before:shrink-0 before:rounded-full before:bg-info";

/** One notice. When the window is too narrow for the whole line, hovering it shows the rest. */
function Notice({ children }: { children: React.ReactNode }) {
  // Held in state, not a ref: turning the tooltip on re-creates the line, and
  // the size watcher has to move to the new one.
  const [text, setText] = useState<HTMLSpanElement | null>(null);
  // The whole line as plain text, set only while it doesn't fit.
  const [full, setFull] = useState<string>();
  useLayoutEffect(() => {
    if (!text) return;
    const measure = () => setFull(text.scrollWidth > text.clientWidth + 1 ? (text.textContent ?? undefined) : undefined);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [text, children]);
  return (
    <Tip content={full} side="bottom">
      <p role="status" className={NOTICE}>
        <span ref={setText} className="min-w-0 truncate">
          {children}
        </span>
      </p>
    </Tip>
  );
}

const AsideSlot = createContext<HTMLElement | null>(null);

/** Draws its children in the full-height column at the right of the window. */
export function ShellAside({ children }: { children: React.ReactNode }) {
  const slot = useContext(AsideSlot);
  return slot ? createPortal(children, slot) : null;
}

export const PaletteShell = forwardRef<HTMLDivElement, Props>(function PaletteShell(
  { header, replay, children, footer, overlay, className = "", ...rest },
  ref,
) {
  // Menus, tooltips and sheets draw inside this panel (src/ui/layers.tsx).
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [aside, setAside] = useState<HTMLDivElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setElement(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <div
      ref={setRefs}
      className={`palette-shell grain relative flex h-full overflow-hidden rounded-[14px] border border-edge bg-panel ${className}`}
      {...rest}
    >
      <LayerContainer element={element}>
        <AsideSlot.Provider value={aside}>
          <div className="flex min-w-0 flex-1 flex-col">
            {header}
            {replay && <Notice>{replay}</Notice>}
            <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
            {footer}
          </div>
          <div ref={setAside} className="flex shrink-0" />
          {overlay}
        </AsideSlot.Provider>
      </LayerContainer>
    </div>
  );
});
