import { useEffect, useRef } from "react";

// A small menu that opens from a button: upwards from the footer
// (Connectors), downwards from the top bar (Settings). Built by hand, no library. It closes on Esc, on a click outside
// it, or when an item is chosen. Esc is caught before the palette's own key
// handler sees it, so closing the menu doesn't also hide the palette.

export function Menu({
  open,
  onClose,
  align = "left",
  placement = "above",
  label,
  coach,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  /** Above the button (footer) or below it (top bar). */
  placement?: "above" | "below";
  label: string;
  /** A data-coach name, so the practice tour can let clicks reach it. */
  coach?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      // A click on the menu's own button toggles it there; anything else outside closes it.
      const t = e.target as Element | null;
      if (!ref.current?.contains(t) && !t?.closest("[data-menu-button]")) onClose();
    };
    // Capture: runs before the palette's key handler (which listens on window, later).
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-coach={coach}
      className={`sheet-in absolute ${placement === "above" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} z-40 min-w-[290px] rounded-lg border border-hairline bg-surface p-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)] ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

/** One row of a menu: icon, label, and the key that does the same thing on the right. */
export function MenuItem({
  icon,
  label,
  keys,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  keys?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-text"
    >
      <span className="grid size-4 shrink-0 place-items-center [&>svg]:block">{icon}</span>
      <span className="flex-1">{label}</span>
      {keys}
    </button>
  );
}
