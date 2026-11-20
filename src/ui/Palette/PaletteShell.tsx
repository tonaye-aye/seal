import { forwardRef } from "react";

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

export const PaletteShell = forwardRef<HTMLDivElement, Props>(function PaletteShell(
  { header, replay, banner, children, bar, footer, overlay, className = "", ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`relative flex h-full flex-col overflow-hidden rounded-[14px] border border-white/[0.06] bg-bg/[0.86] outline-none ${className}`}
      {...rest}
    >
      {header}
      {replay && (
        <p role="status" className="mx-3 mb-2 truncate rounded-md border border-amber/25 bg-amber-glow/30 px-3 py-1 text-[11.5px] text-muted">
          {replay}
        </p>
      )}
      {banner && (
        <p role="status" className="mx-3 mb-2 truncate rounded-md border border-amber/25 bg-amber-glow/30 px-3 py-1 text-[11.5px] text-muted">
          {banner}
        </p>
      )}
      <div className="h-px shrink-0 bg-hairline" />
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      {bar}
      {footer}
      {overlay}
    </div>
  );
});
