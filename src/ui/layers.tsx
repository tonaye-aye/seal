import { cloneElement, createContext, useContext, useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Kbd } from "./Kbd";

// Everything that floats above the palette: tooltips, menus and sheets, built
// on Radix (accessible, well tested) and drawn from our own tokens.
//
// The palette has one key handler for the whole window. While a menu or a
// sheet is open, that layer owns the keys instead, so J/K/A/D can't act on
// the list underneath, and the Esc that closes a menu doesn't also step the
// palette back. When a layer closes, focus goes back to the palette.

// ---------- Who owns the keys ----------

let openLayers = 0;
const owned = new WeakSet<Event>();

// Runs first for every key press (window, capture phase), before Radix and
// before the palette. A key pressed while a layer is open belongs to that
// layer, even if the press is what closes it.
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (openLayers > 0) owned.add(event);
    },
    true,
  );
}

/** True when this key press belongs to an open menu or sheet: the palette leaves it alone. */
export function layerOwns(event: Event): boolean {
  return owned.has(event);
}

/** Counts a layer as open while `open` is true, and hands focus back to the palette when it closes. */
function useLayer(open: boolean, counts: boolean) {
  useEffect(() => {
    if (!open || !counts) return;
    openLayers += 1;
    return () => {
      openLayers -= 1;
      focusPaletteSoon();
    };
  }, [open, counts]);
}

let palette: HTMLElement | null = null;

/** The palette panel registers itself, so a closing layer can hand focus back. */
export function setPaletteElement(element: HTMLElement | null) {
  palette = element;
}

function focusPalette() {
  // If another layer opened as this one closed (Settings, then Keyboard shortcuts), it keeps focus.
  if (openLayers === 0) palette?.focus({ preventScroll: true });
}

/**
 * Hand focus back as soon as a layer is told to close, without waiting for
 * its closing fade: otherwise the next key would land on the fading menu.
 * The short wait lets React finish closing it (and open any sheet that
 * replaces it) first.
 */
function focusPaletteSoon() {
  setTimeout(focusPalette, 0);
}

// ---------- Where layers draw ----------

type Scope = {
  /** The palette panel: layers draw inside it, so the scrim stays inside its rounded corners. */
  container: HTMLElement | null;
  /** The dev gallery: layers are non-modal, stay open, and never take focus. */
  preview: boolean;
};

const LayerScope = createContext<Scope>({ container: null, preview: false });

/** Set by the palette frame (PaletteShell) around its contents. */
export function LayerContainer({ element, children }: { element: HTMLElement | null; children: React.ReactNode }) {
  const parent = useContext(LayerScope);
  return <LayerScope.Provider value={{ ...parent, container: element }}>{children}</LayerScope.Provider>;
}

/** The gallery wraps its page in this: every layer is drawn as a still picture. */
export function PreviewLayers({ children }: { children: React.ReactNode }) {
  return <LayerScope.Provider value={{ container: null, preview: true }}>{children}</LayerScope.Provider>;
}

/** One tooltip provider for the whole app: a short delay, then quick moves between neighbours. */
export function LayerProvider({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}

/** In the gallery: keep a layer open whatever happens outside it, and leave focus where it is. */
const keepOpen = (e: Event) => e.preventDefault();
function previewProps(preview: boolean) {
  return preview ? { onPointerDownOutside: keepOpen, onFocusOutside: keepOpen, onInteractOutside: keepOpen, onOpenAutoFocus: keepOpen } : {};
}

// ---------- Tooltip ----------

/**
 * A small label on hover (and on keyboard focus, where a control can take
 * it), with the control's key when it has one. No text, no tooltip.
 */
export function Tip({
  content,
  keys,
  side = "top",
  open,
  children,
  ...trigger
}: {
  content?: React.ReactNode;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  /** Held open (the dev gallery only). */
  open?: boolean;
  /** One element that can hold a ref (a DOM element). */
  children: React.ReactElement<Record<string, unknown>>;
  /**
   * Anything else is passed on to that element, so a menu's button can sit
   * inside a tooltip (<Menu trigger={<Tip><button/></Tip>}>).
   */
} & React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLButtonElement> }) {
  const { container } = useContext(LayerScope);
  const [shown, setShown] = useState(false);
  if (!content) return Object.keys(trigger).length ? cloneElement(children, trigger) : children;
  return (
    <Tooltip.Root open={open ?? shown} onOpenChange={setShown}>
      <Tooltip.Trigger
        asChild
        {...trigger}
        // A press hides the tooltip. Radix does this itself, but skips it when a
        // menu's button underneath has already handled the press, so the
        // tooltip would sit on top of the menu it just opened.
        onPointerDownCapture={() => setShown(false)}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal container={container ?? undefined}>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="layer-pop z-50 flex max-w-[280px] items-center gap-2 rounded-md border border-hairline bg-surface px-2 py-1 text-meta text-muted shadow-(--shadow-menu)"
        >
          <span className="min-w-0">{content}</span>
          {keys && <Kbd keys={keys} />}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// ---------- Menu ----------

/**
 * A small menu that opens from a button: upwards from the footer, to the
 * right from the icon rail, downwards from a row. Arrow keys and Enter move through it; the key shown on a
 * row (`shortcuts`) runs that row straight away; Esc or a click outside closes it.
 */
export function Menu({
  open,
  onOpenChange,
  trigger,
  label,
  side = "top",
  align = "start",
  shortcuts,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens it (one element that can hold a ref). */
  trigger: React.ReactElement;
  label: string;
  /** Above the button (footer), beside it (icon rail) or below it. */
  side?: "top" | "bottom" | "right";
  /** Line up with the button's left edge ("start") or right edge ("end"). */
  align?: "start" | "end";
  /** Keys that run a row while the menu is open: "a", "?", "⌘,". */
  shortcuts?: Record<string, () => void>;
  children: React.ReactNode;
}) {
  const { container, preview } = useContext(LayerScope);
  useLayer(open, !preview);
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={!preview}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          // Keep the side asked for (the ⋯ menu already picks it from where its row sits).
          avoidCollisions={false}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusPalette();
          }}
          onKeyDown={(e) => {
            if (!shortcuts || e.ctrlKey || e.altKey) return;
            const run = shortcuts[`${e.metaKey ? "⌘" : ""}${e.key.toLowerCase()}`];
            if (!run) return;
            e.preventDefault();
            onOpenChange(false);
            run();
          }}
          {...previewProps(preview)}
          className="layer-pop z-40 min-w-[290px] rounded-lg border border-hairline bg-surface p-1 shadow-(--shadow-menu) outline-none"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One row of a menu: icon, label, and the key that does the same thing on the right. */
export function MenuItem({
  icon,
  label,
  keys,
  current = false,
  focusOnOpen = false,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  keys?: React.ReactNode;
  /** The row that is already chosen (the View menu's current view): brighter text. */
  current?: boolean;
  /**
   * Land the keyboard highlight on this row when the menu opens, instead of
   * the first one (the View menu: the view you'd switch to, so Enter does it).
   */
  focusOnOpen?: boolean;
  onSelect: () => void;
}) {
  const { preview } = useContext(LayerScope);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusOnOpen || preview) return;
    // Radix puts the highlight on the first row as the menu opens; this runs
    // just after that and moves it here (focus is what highlights a row).
    const id = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [focusOnOpen, preview]);
  return (
    <DropdownMenu.Item
      ref={ref}
      onSelect={onSelect}
      aria-current={current || undefined}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-small outline-none data-highlighted:bg-raised data-highlighted:text-text ${
        current ? "text-text" : "text-muted"
      }`}
    >
      <span className="grid size-4 shrink-0 place-items-center [&>svg]:block">{icon}</span>
      <span className="flex-1">{label}</span>
      {keys}
    </DropdownMenu.Item>
  );
}

// ---------- Sheet ----------

/**
 * A centred sheet over a dimmed palette (the shortcut sheet, the demo
 * controls). Esc or a click on the dimmed part closes it. Focus stays inside
 * while it is open, starting on the sheet itself, so its own keys work.
 */
export function Sheet({
  open,
  title,
  onClose,
  onKeyDown,
  className,
  children,
}: {
  open: boolean;
  /** The sheet's name: give a SheetTitle inside instead to show it. */
  title?: string;
  onClose: () => void;
  /** The sheet's own keys. */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className: string;
  children: React.ReactNode;
}) {
  const { container, preview } = useContext(LayerScope);
  const content = useRef<HTMLDivElement>(null);
  useLayer(open, !preview);

  const sheet = (
    <Dialog.Content
      ref={content}
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        if (!preview) content.current?.focus({ preventScroll: true });
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        focusPalette();
      }}
      onKeyDown={onKeyDown}
      {...(preview ? { onPointerDownOutside: keepOpen, onFocusOutside: keepOpen, onInteractOutside: keepOpen } : {})}
      className={`layer-sheet outline-none ${className}`}
    >
      {title && <Dialog.Title className="sr-only">{title}</Dialog.Title>}
      {children}
    </Dialog.Content>
  );

  const scrim = "absolute inset-0 z-30 grid place-items-center bg-scrim backdrop-blur-sm";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()} modal={!preview}>
      <Dialog.Portal container={container ?? undefined}>
        {/* Radix draws its overlay only for a modal sheet; the gallery's still picture gets a plain one. */}
        {preview ? <div className={scrim}>{sheet}</div> : <Dialog.Overlay className={`layer-scrim ${scrim}`}>{sheet}</Dialog.Overlay>}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A sheet's visible title (it also names the sheet for screen readers). */
export const SheetTitle = Dialog.Title;
/** A sheet's visible description. */
export const SheetDescription = Dialog.Description;
