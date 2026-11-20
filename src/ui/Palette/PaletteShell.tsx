import { forwardRef, useCallback, useLayoutEffect, useState } from "react";
import { LayerContainer, Tip } from "../layers";

// The palette's frame: top bar, replay banner, the icon rail beside the middle
// area and its bottom bar, the footer, plus anything floating on top (toast, sheets). The real
// palette and the dev gallery both draw through this, so they can't drift apart.

type Props = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  header: React.ReactNode;
  /** The "Replay mode" banner under the top bar (src/ui/replay.tsx says what it reads). */
  replay?: React.ReactNode;
  /** Another one-line note under the top bar (onboarding: the first check). */
  banner?: React.ReactNode;
  /** The icon rail on the left (Rail.tsx), left out on the setup screens. */
  rail?: React.ReactNode;
  /** What fills the middle (a view, plus the trace drawer when open). */
  children: React.ReactNode;
  /** An open finding's action bar, under the middle and beside the rail. */
  bar?: React.ReactNode;
  footer: React.ReactNode;
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

export const PaletteShell = forwardRef<HTMLDivElement, Props>(function PaletteShell(
  { header, replay, banner, rail, children, bar, footer, overlay, className = "", ...rest },
  ref,
) {
  // Menus, tooltips and sheets draw inside this panel (src/ui/layers.tsx).
  const [element, setElement] = useState<HTMLDivElement | null>(null);
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
      className={`relative flex h-full flex-col overflow-hidden rounded-[14px] border border-edge bg-panel outline-none ${className}`}
      {...rest}
    >
      <LayerContainer element={element}>
        {header}
        {replay && <Notice>{replay}</Notice>}
        {banner && <Notice>{banner}</Notice>}
        <div className="h-px shrink-0 bg-hairline" />
        {/* The rail runs from the top bar to the footer; the trace drawer and the
            action bar stay beside it, so Trace and Settings are never covered. */}
        <div className="flex min-h-0 flex-1">
          {rail}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
            {bar}
          </div>
        </div>
        {footer}
        {overlay}
      </LayerContainer>
    </div>
  );
});
