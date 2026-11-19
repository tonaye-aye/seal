// A key cap, used for every inline shortcut hint (e.g. "Esc Close").

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border border-hairline bg-raised px-1 font-mono text-[10.5px] leading-none text-muted"
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

/** A key hint that is also a button: same action by key or by click. */
export function KeyButton({
  keys,
  label,
  onClick,
  tone = "muted",
}: {
  keys: string[];
  label: string;
  onClick: () => void;
  tone?: "muted" | "amber" | "faint";
}) {
  const colour = tone === "amber" ? "text-amber" : tone === "faint" ? "text-faint hover:text-muted" : "text-muted hover:text-text";
  return (
    <button
      type="button"
      tabIndex={-1}
      // Keep keyboard focus on the palette, so the keys keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`-mx-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-(--duration-fast) hover:bg-raised ${colour}`}
    >
      <Kbd keys={keys} />
      {label}
    </button>
  );
}
