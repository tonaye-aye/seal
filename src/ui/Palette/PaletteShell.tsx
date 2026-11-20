import { forwardRef, useCallback, useState } from "react";
import { LayerContainer } from "../layers";

// The palette's frame: top bar, replay banner, the middle area, the bottom bar
// and the footer, plus anything floating on top (toast, sheets). The real
// palette and the dev gallery both draw through this, so they can't drift apart.

type Props = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  header: React.ReactNode;
  /** The "Replay mode" banner under the top bar (src/ui/replay.tsx says what it reads). */
  replay?: React.ReactNode;
  /** Another one-line note under the top bar (onboarding: the first check). */
  banner?: React.ReactNode;
  /** What fills the middle (a view, plus the trace drawer when open). */
  children: React.ReactNode;
  /** The action bar or timeline bar above the footer. */
  bar?: React.ReactNode;
  footer: React.ReactNode;
  /** Things that float above everything: the toast and the sheets. */
  overlay?: React.ReactNode;
};

// A one-line notice under the top bar: slim, in the info colour (it is the
// agent's own status, not something urgent).
const NOTICE = "mx-3 mb-1.5 flex h-6 shrink-0 items-center gap-2 overflow-hidden rounded-md bg-info/8 px-2.5 text-meta text-muted before:size-1.5 before:shrink-0 before:rounded-full before:bg-info";

export const PaletteShell = forwardRef<HTMLDivElement, Props>(function PaletteShell(
  { header, replay, banner, children, bar, footer, overlay, className = "", ...rest },
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
        {replay && (
          <p role="status" className={NOTICE}>
            <span className="min-w-0 truncate">{replay}</span>
          </p>
        )}
        {banner && (
          <p role="status" className={NOTICE}>
            <span className="min-w-0 truncate">{banner}</span>
          </p>
        )}
        <div className="h-px shrink-0 bg-hairline" />
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
        {bar}
        {footer}
        {overlay}
      </LayerContainer>
    </div>
  );
});
