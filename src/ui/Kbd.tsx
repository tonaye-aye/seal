// A key cap, used for every inline shortcut hint (e.g. "Esc Close").

// `onAccent`: the cap sits inside a filled violet (primary) button.
// `large`: beside onboarding's larger text.
export function Kbd({ keys, onAccent = false, large = false }: { keys: string[]; onAccent?: boolean; large?: boolean }) {
  // A solid fill on a violet button, so the button's grain can't sit behind the key's letter.
  const cap = onAccent ? "border-on-accent/25 bg-accent-solid-hover text-on-accent" : "border-hairline bg-raised text-muted";
  return (
    <span className="inline-flex gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className={`inline-grid place-items-center border font-mono leading-none ${large ? "h-7 min-w-7 rounded-md px-1.5 text-small" : "h-[18px] min-w-[18px] rounded-[5px] px-1 text-label"} ${cap}`}
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
  size = "default",
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
  /** "cta": the oversized, full-width button on the onboarding steps (OnboardingCta). */
  size?: "default" | "cta";
}) {
  const primary = tone === "primary";
  const cta = size === "cta";
  // A locked CTA goes neutral: violet is only for an action you can take now.
  const locked = cta && disabled;
  const colour = locked
    ? "bg-raised font-semibold text-muted"
    : primary
      ? `grain grain-accent relative bg-accent-solid font-semibold text-on-accent ${disabled ? "" : "hover:bg-accent-solid-hover"}`
      : disabled
        ? "text-faint"
        : tone === "faint"
          ? "text-faint hover:text-muted"
          : "text-muted hover:text-text";
  // The primary button is a real filled button; the rest are key hints you can click.
  const shape = cta
    ? "h-11 w-full justify-center gap-2.5 rounded-lg px-5 text-title"
    : `gap-1.5 rounded-md ${primary ? "h-7 px-2.5" : `-mx-1.5 px-1.5 py-1 ${disabled ? "" : "hover:bg-raised"}`}`;
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      // Keep keyboard focus on the palette, so the keys keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`press inline-flex shrink-0 items-center leading-none whitespace-nowrap ${shape} ${disabled ? `cursor-default ${locked ? "" : "opacity-60"}` : "cursor-pointer"} ${colour}`}
    >
      {/* An exact box with a block-level icon, so icon and text share one centre line. The big button's is a size up. */}
      {mouse
        ? icon && <span className={`grid shrink-0 place-items-center [&>svg]:block ${cta ? "size-5 [&>svg]:size-4" : "size-4"}`}>{icon}</span>
        : <Kbd keys={keys} onAccent={primary && !locked} large={cta} />}
      {label}
    </button>
  );
}
