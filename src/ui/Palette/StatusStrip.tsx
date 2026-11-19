// One chip per data source. All four are "not connected" until the fake
// connectors land; later each chip shows syncing, ok, error and last sync.
const CONNECTORS = ["Bank", "Email", "Documents", "Calendar"] as const;

export function StatusStrip() {
  return (
    <ul aria-label="Connections" className="flex flex-wrap gap-1.5 px-4 pb-3">
      {CONNECTORS.map((name) => (
        <li
          key={name}
          className="flex h-6 items-center gap-1.5 rounded-full border border-hairline px-2.5 text-[11.5px] text-muted"
        >
          <span className="size-1.5 rounded-full border border-faint" aria-hidden="true" />
          {name}
          <span className="sr-only">: not connected yet</span>
        </li>
      ))}
    </ul>
  );
}
