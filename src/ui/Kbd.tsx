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
