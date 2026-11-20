// A key cap, used for every inline shortcut hint (e.g. "Esc Close").

// `onAccent`: the cap sits inside a filled violet (primary) button.
export function Kbd({ keys, onAccent = false }: { keys: string[]; onAccent?: boolean }) {
  const cap = onAccent ? "border-on-accent/25 bg-on-accent/10 text-on-accent" : "border-hairline bg-raised text-muted";
  return (
    <span className="inline-flex gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border px-1 font-mono text-label leading-none ${cap}`}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** A key cap followed by what it does. */
export function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-faint">
      <Kbd keys={keys} />
      <span>{label}</span>
    </span>
  );
}

/**
 * A key hint that is also a button: same action by key or by click. The one
 * button pattern across the app: in keyboard mode the key caps come before
 * the label; in mouse mode an icon does (see src/ui/icons.tsx).
 */
export function KeyButton({
  keys,
  label,
  onClick,
  icon,
  tone = "muted",
  mouse = false,
  disabled = false,
}: {
  keys: string[];
  label: string;
  onClick: () => void;
  /** Shown before the label in mouse mode, in place of the key caps. */
  icon?: React.ReactNode;
  /** "primary": the screen's main action (Approve, onboarding's next step), a filled violet button. */
  tone?: "muted" | "faint" | "primary";
  /** In mouse mode the key caps make way for the icon: it's just a button to click. */
  mouse?: boolean;
  /** Greyed out and not clickable (the caller also ignores its key). */
  disabled?: boolean;
}) {
  const primary = tone === "primary";
  const colour = primary
    ? `bg-accent-solid font-semibold text-on-accent ${disabled ? "" : "hover:bg-accent-solid-hover"}`
    : disabled
      ? "text-faint"
      : tone === "faint"
        ? "text-faint hover:text-muted"
        : "text-muted hover:text-text";
  // The primary button is a real filled button; the rest are key hints you can click.
  const shape = primary ? "h-7 px-2.5" : `-mx-1.5 px-1.5 py-1 ${disabled ? "" : "hover:bg-raised"}`;
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      // Keep keyboard focus on the palette, so the keys keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`press inline-flex items-center gap-1.5 rounded-md leading-none ${shape} ${disabled ? "cursor-default opacity-60" : "cursor-pointer"} ${colour}`}
    >
      {/* An exact 16 px box with a block-level icon, so icon and text share one centre line. */}
      {mouse ? icon && <span className="grid size-4 shrink-0 place-items-center [&>svg]:block">{icon}</span> : <Kbd keys={keys} onAccent={primary} />}
      {label}
    </button>
  );
}

/**
 * The top bar's view switch. For keyboard users it reads like a key hint
 * ("⌘↵ View timeline"). Once the mouse moves, the key caps make way for the
 * icon of the view it goes to; a key press brings them back.
 */
export function SwitchButton({
  keys,
  label,
  icon,
  mouse,
  onClick,
}: {
  keys: string[];
  label: string;
  /** The destination view's icon, shown in mouse mode instead of the keys. */
  icon: React.ReactNode;
  mouse: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      // Keep keyboard focus on the palette, so the keys keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 text-meta text-faint hover:border-hairline hover:bg-raised hover:text-text"
    >
      {mouse ? <span className="inline-grid size-4 place-items-center [&>svg]:size-3.5">{icon}</span> : <Kbd keys={keys} />}
      {label}
    </button>
  );
}
